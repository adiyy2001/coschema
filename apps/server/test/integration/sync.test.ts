import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  MessageType,
  SyncClient,
  SYNC_STEP_2,
  SYNC_UPDATE,
  createWebSocketTransport,
  decodeEnvelope,
  encodeAuthToken,
  encodeSyncStep1,
  systemClock,
  type Transport,
} from '@coschema/sync';
import { signToken } from '../../src/auth';
import { TEST_SECRET, tokenFor, until } from '../support/app';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/database';
import { Editor, graphOf, stateVectorKey } from '../support/documents';
import { AppFleet, countRows } from '../support/postgres-app';
import { openRawSocket } from '../support/raw-socket';

let database: IsolatedDatabase;
let fleet: AppFleet;

beforeAll(async () => {
  database = await createIsolatedDatabase(inject('adminDatabaseUrl'));
});

afterAll(async () => {
  await database.drop();
});

afterEach(async () => {
  await fleet.stopAll();
});

function begin(): AppFleet {
  fleet = new AppFleet(database);
  return fleet;
}

function storedDocument(snapshot: Uint8Array | undefined, updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot !== undefined) Y.applyUpdate(doc, snapshot);
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

function structOwners(frame: Uint8Array): Set<number> {
  const owners = new Set<number>();
  const envelope = decodeEnvelope(frame);
  if (envelope.type !== MessageType.sync) return owners;
  const messageType = decoding.readVarUint(envelope.decoder);
  if (messageType !== SYNC_STEP_2 && messageType !== SYNC_UPDATE) return owners;
  const payload = decoding.readVarUint8Array(envelope.decoder);
  for (const struct of Y.decodeUpdate(payload).structs) owners.add(struct.id.client);
  return owners;
}

function recordingFactory(url: string, received: Uint8Array[]): () => Transport {
  return () => {
    const transport = createWebSocketTransport(url);
    return {
      send: (data) => {
        transport.send(data);
      },
      close: (code, reason) => {
        transport.close(code, reason);
      },
      onOpen: (handler) => transport.onOpen(handler),
      onMessage: (handler) =>
        transport.onMessage((data) => {
          received.push(data.slice());
          handler(data);
        }),
      onClose: (handler) => transport.onClose(handler),
    };
  };
}

describe('reconnect with partial state', () => {
  it('sends only what the returning client is missing and merges its offline work', async () => {
    const group = begin();
    const app = await group.start();
    const received: Uint8Array[] = [];
    const annaDoc = new Y.Doc();
    const annaEditor = new Editor(1, annaDoc);
    const token = await tokenFor('partial', 'Anna');
    const anna = new SyncClient({
      doc: annaDoc,
      connect: recordingFactory(`${app.wsUrl}/rooms/partial`, received),
      getToken: () => token,
      clock: systemClock,
      random: Math.random,
    });
    group.track({ doc: annaDoc, client: anna, stop: () => anna.destroy() });
    anna.start();
    await until(() => anna.isSynced, 'Anna to sync');
    for (let index = 0; index < 20; index += 1) annaEditor.addNode(`shared ${index}`, index, index);
    const ben = await group.join(app, 'partial', 'Ben');
    await until(() => new Editor(2, ben.doc).labels.length === 20, 'Ben to receive the nodes');
    await until(() => anna.pendingCount === 0, 'Anna to be acked');

    anna.stop();
    annaEditor.addNode('written offline', 500, 500);
    new Editor(3, ben.doc).addNode('written by Ben meanwhile', 600, 600);
    await until(
      () => app.app.metrics.count('updates_applied_total') >= 21,
      'the server to see Ben',
    );
    received.length = 0;
    anna.start();
    await until(() => anna.isSynced && anna.pendingCount === 0, 'Anna to catch up');
    await until(() => new Editor(4, ben.doc).labels.length === 22, 'Ben to get the offline node');

    expect(graphOf(annaDoc)).toBe(graphOf(ben.doc));
    const owners = new Set<number>();
    for (const frame of received) for (const owner of structOwners(frame)) owners.add(owner);
    expect(owners.has(ben.doc.clientID)).toBe(true);
    expect(owners.has(annaDoc.clientID)).toBe(false);
    const stored = await app.store.load('partial');
    expect(stateVectorKey(storedDocument(stored.snapshot, stored.updates))).toBe(
      stateVectorKey(annaDoc),
    );
  });

  it('answers a stale state vector with the missing part only', async () => {
    const group = begin();
    const app = await group.start();
    const editor = new Editor(5);
    for (let index = 0; index < 30; index += 1) editor.addNode(`known ${index}`, index, index);
    const staleDoc = new Y.Doc();
    Y.applyUpdate(staleDoc, Y.encodeStateAsUpdate(editor.doc));
    const seeder = await group.join(app, 'diff', 'Seeder', editor.doc);
    editor.addNode('new one');
    await until(() => seeder.client.pendingCount === 0, 'the seed to be acked');
    const raw = openRawSocket(app, 'diff');
    await raw.opened;
    raw.socket.send(encodeAuthToken(await tokenFor('diff')));
    raw.socket.send(encodeSyncStep1(staleDoc));
    await until(() => raw.frames.some((frame) => structOwners(frame).size > 0), 'the diff reply');
    raw.socket.close();
    const reply = raw.frames.find((frame) => structOwners(frame).size > 0);
    const fullSize = Y.encodeStateAsUpdate(editor.doc).byteLength;
    expect(reply?.byteLength).toBeLessThan(fullSize / 3);
  });
});

describe('compaction through the server', () => {
  it('preserves the document, removes the log rows and writes a smaller snapshot', async () => {
    const group = begin();
    const app = await group.start({ COSCHEMA_COMPACT_ROWS: '8', COSCHEMA_IDLE_MS: '60000' });
    const writer = await group.join(app, 'compact', 'Anna');
    const editor = new Editor(6, writer.doc);
    const id = editor.addNode('moving');
    await until(() => writer.client.pendingCount === 0, 'the first ack');
    for (let step = 0; step < 40; step += 1) {
      editor.move(id, step, step * 3);
      await until(() => writer.client.pendingCount === 0, `ack of step ${step}`);
    }
    await until(() => app.app.metrics.count('compactions_total') >= 1, 'a compaction to run');
    const snapshots = await countRows(database, 'doc_snapshots', 'compact');
    expect(snapshots).toBe(1);
    const stored = await app.store.load('compact');
    expect(stored.logRows).toBeLessThan(9);
    const restored = storedDocument(stored.snapshot, stored.updates);
    expect(graphOf(restored)).toBe(graphOf(writer.doc));
    expect(stateVectorKey(restored)).toBe(stateVectorKey(writer.doc));
    const reader = await group.join(app, 'compact', 'Ben');
    expect(graphOf(reader.doc)).toBe(graphOf(writer.doc));
  });

  it('writes a smaller snapshot than the log it replaces', async () => {
    const group = begin();
    const app = await group.start({ COSCHEMA_COMPACT_ROWS: '1000' });
    const writer = await group.join(app, 'shrink', 'Anna');
    const editor = new Editor(7, writer.doc);
    const id = editor.addNode('moving');
    for (let step = 0; step < 50; step += 1) {
      editor.move(id, step, step);
      await until(() => writer.client.pendingCount === 0, `ack of step ${step}`);
    }
    const before = await app.store.load('shrink');
    const result = await app.store.compact('shrink');
    expect(result?.rows).toBe(before.logRows);
    expect(result?.snapshotBytes).toBeLessThan(before.logBytes);
    expect(await countRows(database, 'doc_updates', 'shrink')).toBe(0);
  });
});

describe('authentication', () => {
  async function forged(kind: string, room: string): Promise<string> {
    const past = () => new Date(Date.now() - 2 * 3600 * 1000);
    const identity = { sub: 'mallory', name: 'Mallory', color: '#d95f02', room };
    switch (kind) {
      case 'expired':
        return signToken(identity, { secret: TEST_SECRET, now: past });
      case 'wrong signature':
        return signToken(identity, {
          secret: 'some-other-secret-of-length',
          now: () => new Date(),
        });
      case 'wrong room':
        return signToken(
          { ...identity, room: 'someone-elses' },
          { secret: TEST_SECRET, now: () => new Date() },
        );
      case 'wrong audience':
        return signToken(identity, {
          secret: TEST_SECRET,
          now: () => new Date(),
          audience: 'other',
        });
      case 'alg none': {
        const header = Buffer.from('{"alg":"none"}').toString('base64url');
        const payload = Buffer.from(
          JSON.stringify({ ...identity, iss: 'coschema', aud: 'coschema', exp: 4_000_000_000 }),
        ).toString('base64url');
        return `${header}.${payload}.`;
      }
      case 'missing':
        return '';
      default:
        return 'not-a-jwt';
    }
  }

  it.each([
    'expired',
    'wrong signature',
    'wrong room',
    'wrong audience',
    'alg none',
    'missing',
    'garbage',
  ])('rejects a token that is %s with 4401 and reveals nothing', async (kind) => {
    const group = begin();
    const app = await group.start();
    const room = `secure-${kind.replace(' ', '-')}`;
    const seeded = await group.join(app, room, 'Owner');
    new Editor(8, seeded.doc).addNode('secret plan');
    await until(() => seeded.client.pendingCount === 0, 'the owner edit to be acked');

    const raw = openRawSocket(app, room);
    await raw.opened;
    raw.socket.send(encodeAuthToken(await forged(kind, room)));
    raw.socket.send(encodeSyncStep1(new Y.Doc()));
    expect(await raw.closed).toBe(4401);
    expect(raw.frames).toHaveLength(1);
    expect(decodeEnvelope(raw.frames[0] ?? new Uint8Array()).type).toBe(MessageType.auth);
    const bytes = raw.frames.reduce((sum, frame) => sum + frame.byteLength, 0);
    expect(bytes).toBeLessThan(80);
  });

  it('rejects a join to a room that was never created without writing anything', async () => {
    const group = begin();
    const app = await group.start();
    const raw = openRawSocket(app, 'ghost');
    await raw.opened;
    raw.socket.send(encodeAuthToken('forged'));
    expect(await raw.closed).toBe(4401);
    expect(await countRows(database, 'doc_updates', 'ghost')).toBe(0);
    expect(await countRows(database, 'doc_snapshots', 'ghost')).toBe(0);
  });

  it('closes a socket that never sends the auth frame', async () => {
    const group = begin();
    const app = await group.start({ COSCHEMA_AUTH_TIMEOUT_MS: '150' });
    const raw = openRawSocket(app, 'silent');
    await raw.opened;
    expect(await raw.closed).toBe(4401);
  });

  it('closes with 1009 on an oversize frame', async () => {
    const group = begin();
    const app = await group.start({ COSCHEMA_MAX_PAYLOAD_BYTES: '2048' });
    const raw = openRawSocket(app, 'big');
    await raw.opened;
    raw.socket.send(encodeAuthToken(await tokenFor('big')));
    raw.socket.send(new Uint8Array(10_000));
    expect(await raw.closed).toBe(1009);
  });

  it('keeps an authenticated client apart from a rejected one in the same room', async () => {
    const group = begin();
    const app = await group.start();
    const honest = await group.join(app, 'mixed', 'Anna');
    const raw = openRawSocket(app, 'mixed');
    await raw.opened;
    raw.socket.send(encodeAuthToken('forged'));
    expect(await raw.closed).toBe(4401);
    new Editor(9, honest.doc).addNode('still works');
    await until(() => honest.client.pendingCount === 0, 'the ack');
    expect(honest.client.currentStatus).toBe('online');
  });
});

describe('idle unload', () => {
  it('flushes, compacts and unloads an idle room and loads the same document again', async () => {
    const group = begin();
    const app = await group.start({ COSCHEMA_IDLE_MS: '200' });
    const writer = await group.join(app, 'idle', 'Anna');
    const editor = new Editor(10, writer.doc);
    const id = editor.addNode('kept');
    editor.move(id, 4, 4);
    await until(() => writer.client.pendingCount === 0, 'the ack');
    const expected = graphOf(writer.doc);
    writer.stop();
    await until(() => app.app.manager.roomCount === 0, 'the room to unload');
    expect(app.app.metrics.count('rooms_unloaded_total')).toBe(1);
    expect(await countRows(database, 'doc_updates', 'idle')).toBe(0);
    expect(await countRows(database, 'doc_snapshots', 'idle')).toBe(1);
    const reader = await group.join(app, 'idle', 'Ben');
    expect(graphOf(reader.doc)).toBe(expected);
    expect(app.app.metrics.count('rooms_loaded_total')).toBe(2);
  });

  it('does not unload a room that still has a connection', async () => {
    const group = begin();
    const app = await group.start({ COSCHEMA_IDLE_MS: '100' });
    await group.join(app, 'busy', 'Anna');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(app.app.manager.roomCount).toBe(1);
  });
});

describe('room isolation', () => {
  it('keeps documents, rows and tokens of two rooms apart', async () => {
    const group = begin();
    const app = await group.start();
    const left = await group.join(app, 'iso-left', 'Anna');
    const right = await group.join(app, 'iso-right', 'Ben');
    new Editor(11, left.doc).addNode('left only');
    await until(() => left.client.pendingCount === 0, 'the left ack');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(new Editor(12, right.doc).labels).toEqual([]);
    expect(await countRows(database, 'doc_updates', 'iso-left')).toBe(1);
    expect(await countRows(database, 'doc_updates', 'iso-right')).toBe(0);
    const raw = openRawSocket(app, 'iso-right');
    await raw.opened;
    raw.socket.send(encodeAuthToken(await tokenFor('iso-left')));
    expect(await raw.closed).toBe(4401);
  });
});

describe('presence', () => {
  it('removes a client from the awareness of the others when its connection closes', async () => {
    const group = begin();
    const app = await group.start();
    const anna = await group.join(app, 'aware', 'Anna');
    const ben = await group.join(app, 'aware', 'Ben');
    anna.client.awareness.setLocalState({ cursor: [1, 2] });
    await until(() => ben.client.awareness.getStates().has(anna.doc.clientID), 'Anna to appear');
    anna.stop();
    await until(() => !ben.client.awareness.getStates().has(anna.doc.clientID), 'Anna to vanish');
  });
});
