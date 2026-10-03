import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { RoomManager, type RoomManagerOptions } from '../src/rooms/room-manager';
import type { RoomSettings } from '../src/rooms/room';
import { createLogger } from '../src/logger';
import { Metrics } from '../src/metrics';
import type { TokenVerifier } from '../src/auth';
import { Editor, graphOf } from './support/documents';
import { FlakyStore } from './support/flaky-store';
import { ManualClock, settle } from './support/manual-clock';
import { connectMemoryClient, memoryToken, pump, type MemoryClient } from './support/memory-room';

const verifyToken: TokenVerifier = (token, room) =>
  Promise.resolve(
    token === memoryToken(room) ? { ok: true } : { ok: false, reason: 'invalid token' },
  );

interface Setup {
  clock: ManualClock;
  store: FlakyStore;
  metrics: Metrics;
  manager: RoomManager;
  logs: string[];
}

const SETTINGS: RoomSettings = {
  batchMs: 50,
  batchMaxBytes: 1_000_000,
  compactRows: 500,
  compactBytes: 10_000_000,
  authTimeoutMs: 5000,
};

function setup(overrides: Partial<RoomSettings> = {}, idleMs = 1000): Setup {
  const clock = new ManualClock();
  const store = new FlakyStore();
  const metrics = new Metrics();
  const logs: string[] = [];
  const options: RoomManagerOptions = {
    store,
    clock,
    metrics,
    logger: createLogger({
      write: (line) => logs.push(line),
      now: () => new Date(0),
      level: 'debug',
    }),
    verifyToken,
    idleMs,
    settings: { ...SETTINGS, ...overrides },
  };
  return { clock, store, metrics, manager: new RoomManager(options), logs };
}

const clientsToStop: MemoryClient[] = [];

function connect(
  context: Setup,
  room: string,
  options?: { token?: string; doc?: Y.Doc },
): MemoryClient {
  const entry = connectMemoryClient(context.manager, room, context.clock, options);
  clientsToStop.push(entry);
  return entry;
}

afterEach(() => {
  for (const entry of clientsToStop.splice(0)) entry.client.destroy();
});

async function persistedGraph(store: FlakyStore, room: string): Promise<string> {
  const stored = await store.load(room);
  const doc = new Y.Doc();
  if (stored.snapshot !== undefined) Y.applyUpdate(doc, stored.snapshot);
  for (const update of stored.updates) Y.applyUpdate(doc, update);
  return graphOf(doc);
}

describe('RoomManager', () => {
  it('loads the room on the first join and hands the stored document to the client', async () => {
    const context = setup();
    const seed = new Editor(1);
    seed.addNode('stored');
    await context.store.append('plant', Y.encodeStateAsUpdate(seed.doc));
    const first = connect(context, 'plant');
    await pump([first]);
    expect(first.client.isSynced).toBe(true);
    expect(graphOf(first.doc)).toBe(graphOf(seed.doc));
    expect(context.manager.roomCount).toBe(1);
    expect(context.metrics.count('rooms_loaded_total')).toBe(1);
  });

  it('keeps rooms apart', async () => {
    const context = setup();
    const left = connect(context, 'left');
    const right = connect(context, 'right');
    await pump([left, right]);
    new Editor(2, left.doc).addNode('only in left');
    await pump([left, right]);
    await context.clock.advance(50);
    await pump([left, right]);
    expect(new Editor(3, right.doc).labels).toEqual([]);
    expect(context.manager.roomCount).toBe(2);
  });

  it('acknowledges only after the batch was written', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    new Editor(4, entry.doc).addNode('a');
    await pump([entry]);
    expect(entry.client.pendingCount).toBe(1);
    expect(context.store.appendCount).toBe(0);
    await context.clock.advance(50);
    await pump([entry]);
    expect(context.store.appendCount).toBe(1);
    expect(entry.client.pendingCount).toBe(0);
    expect(context.metrics.count('batches_flushed_total')).toBe(1);
    expect(context.metrics.count('updates_applied_total')).toBe(1);
    expect(context.metrics.count('bytes_persisted_total')).toBeGreaterThan(0);
  });

  it('writes the updates of one window as one row', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    const editor = new Editor(5, entry.doc);
    const id = editor.addNode('a');
    editor.move(id, 1, 1);
    editor.move(id, 2, 2);
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    expect(context.store.appendCount).toBe(1);
    expect(await persistedGraph(context.store, 'plant')).toBe(graphOf(entry.doc));
  });

  it('unloads an idle room, compacts it and loads it again on the next join', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    new Editor(6, entry.doc).addNode('kept');
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    const expected = graphOf(entry.doc);
    entry.client.destroy();
    await pump([entry]);
    expect(context.manager.connectionCount).toBe(0);
    await context.clock.advance(999);
    expect(context.manager.roomCount).toBe(1);
    await context.clock.advance(1);
    await settle();
    expect(context.manager.roomCount).toBe(0);
    expect(context.metrics.count('rooms_unloaded_total')).toBe(1);
    expect(context.store.compactCalls).toEqual(['plant']);
    expect((await context.store.load('plant')).logRows).toBe(0);
    const again = connect(context, 'plant');
    await pump([again]);
    expect(graphOf(again.doc)).toBe(expected);
    expect(context.metrics.count('rooms_loaded_total')).toBe(2);
  });

  it('keeps the room when a client comes back before the idle timeout', async () => {
    const context = setup();
    const first = connect(context, 'plant');
    await pump([first]);
    first.client.destroy();
    await pump([first]);
    await context.clock.advance(900);
    const second = connect(context, 'plant');
    await pump([second]);
    await context.clock.advance(5000);
    await pump([second]);
    expect(context.manager.roomCount).toBe(1);
    expect(context.metrics.count('rooms_loaded_total')).toBe(1);
    expect(context.metrics.count('rooms_unloaded_total')).toBe(0);
  });

  it('makes a join wait while the room is unloading and then reloads it', async () => {
    const context = setup();
    const first = connect(context, 'plant');
    await pump([first]);
    new Editor(7, first.doc).addNode('before unload');
    await pump([first]);
    await context.clock.advance(50);
    await pump([first]);
    first.client.destroy();
    await pump([first]);
    let release: () => void = () => undefined;
    context.store.compactGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.clock.advance(1000);
    await settle();
    expect(context.store.compactCalls).toHaveLength(1);
    const second = connect(context, 'plant');
    await settle();
    expect(context.manager.roomCount).toBe(1);
    release();
    await settle();
    await pump([second]);
    expect(second.client.isSynced).toBe(true);
    expect(new Editor(8, second.doc).labels).toEqual(['before unload']);
    expect(context.metrics.count('rooms_loaded_total')).toBe(2);
  });

  it('closes the socket with 1013 when the room cannot be loaded and retries on the next join', async () => {
    const context = setup();
    context.store.failLoad = true;
    const failed = connect(context, 'plant');
    await pump([failed]);
    expect(failed.closeCodes).toContain(1013);
    expect(context.manager.roomCount).toBe(0);
    expect(context.logs.some((line) => line.includes('room failed to load'))).toBe(true);
    context.store.failLoad = false;
    const retry = connect(context, 'plant');
    await pump([retry]);
    expect(retry.client.isSynced).toBe(true);
  });

  it('evicts a room whose log write failed and closes its connections', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    context.store.failAppend = true;
    new Editor(9, entry.doc).addNode('lost on the server');
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    expect(entry.client.pendingCount).toBe(1);
    expect(context.manager.roomCount).toBe(0);
    expect(context.metrics.count('persistence_errors_total')).toBe(1);
    expect(context.logs.some((line) => line.includes('persistence failed'))).toBe(true);
    expect(entry.closeCodes).toContain(1001);
    context.store.failAppend = false;
    await context.clock.advance(1000);
    await pump([entry]);
    await context.clock.advance(1000);
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    expect(entry.client.pendingCount).toBe(0);
    expect(await persistedGraph(context.store, 'plant')).toBe(graphOf(entry.doc));
  });

  it('compacts in the background once the log passes the row threshold', async () => {
    const context = setup({ compactRows: 3 });
    const entry = connect(context, 'plant');
    await pump([entry]);
    const editor = new Editor(10, entry.doc);
    const id = editor.addNode('a');
    for (let step = 1; step <= 3; step += 1) {
      editor.move(id, step, step);
      await pump([entry]);
      await context.clock.advance(50);
      await pump([entry]);
    }
    await settle();
    expect(context.store.compactCalls).toEqual(['plant']);
    expect(context.metrics.count('compactions_total')).toBe(1);
    expect((await context.store.load('plant')).logRows).toBe(0);
    expect(await persistedGraph(context.store, 'plant')).toBe(graphOf(entry.doc));
  });

  it('compacts once the log passes the byte threshold', async () => {
    const context = setup({ compactBytes: 10 });
    const entry = connect(context, 'plant');
    await pump([entry]);
    new Editor(11, entry.doc).addNode('a');
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    await settle();
    expect(context.metrics.count('compactions_total')).toBe(1);
  });

  it('survives a failing compaction and tries again on the next write', async () => {
    const context = setup({ compactRows: 1 });
    context.store.failCompact = true;
    const entry = connect(context, 'plant');
    await pump([entry]);
    const editor = new Editor(12, entry.doc);
    const id = editor.addNode('a');
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    await settle();
    expect(context.logs.some((line) => line.includes('compaction failed'))).toBe(true);
    expect(entry.client.pendingCount).toBe(0);
    context.store.failCompact = false;
    editor.move(id, 3, 3);
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    await settle();
    expect(context.metrics.count('compactions_total')).toBe(1);
    expect(context.store.compactCalls).toHaveLength(2);
  });

  it('logs and drops a room whose unload fails', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    new Editor(13, entry.doc).addNode('a');
    await pump([entry]);
    await context.clock.advance(50);
    await pump([entry]);
    context.store.failCompact = true;
    entry.client.destroy();
    await pump([entry]);
    await context.clock.advance(1000);
    await settle();
    expect(context.manager.roomCount).toBe(0);
    expect(context.logs.some((line) => line.includes('room unload failed'))).toBe(true);
  });

  it('counts connections closed for failed authentication', async () => {
    const context = setup();
    const intruder = connect(context, 'plant', { token: 'forged' });
    await pump([intruder]);
    expect(intruder.client.currentStatus).toBe('denied');
    expect(context.metrics.count('auth_failures_total')).toBe(1);
    expect(context.manager.connectionCount).toBe(0);
  });

  it('closes an unauthenticated connection after the timeout', async () => {
    const context = setup({ authTimeoutMs: 200 });
    const { createMemoryPair } = await import('@coschema/sync');
    const pair = createMemoryPair();
    const codes: number[] = [];
    pair.client.onClose((code) => codes.push(code));
    context.manager.join('plant', pair.server).catch(() => undefined);
    const watcher: MemoryClient = { pairs: [pair], closeCodes: codes } as unknown as MemoryClient;
    await pump([watcher]);
    await context.clock.advance(200);
    await pump([watcher]);
    expect(codes).toContain(4401);
  });

  it('reports rooms and connections as gauges', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    expect(context.metrics.gauge('rooms')).toBe(1);
    expect(context.metrics.gauge('connections')).toBe(1);
    expect(context.metrics.render()).toContain('coschema_rooms 1');
  });

  it('flushes the pending batch on shutdown and refuses new joins', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    new Editor(14, entry.doc).addNode('flushed on shutdown');
    await pump([entry]);
    expect(context.store.appendCount).toBe(0);
    const summary = await context.manager.shutdown();
    expect(summary).toEqual({ rooms: 1, failed: 0 });
    expect(context.store.appendCount).toBe(1);
    expect(await persistedGraph(context.store, 'plant')).toBe(graphOf(entry.doc));
    expect(context.manager.isDraining).toBe(true);
    await pump([entry]);
    expect(entry.closeCodes).toContain(1001);
    const late = connect(context, 'plant');
    await pump([late]);
    expect(late.closeCodes).toContain(1001);
  });

  it('reports rooms that failed to shut down cleanly', async () => {
    const context = setup();
    const entry = connect(context, 'plant');
    await pump([entry]);
    new Editor(15, entry.doc).addNode('a');
    await pump([entry]);
    context.store.failAppend = true;
    const summary = await context.manager.shutdown();
    expect(summary).toEqual({ rooms: 1, failed: 1 });
  });

  it('refuses joins that were still loading when shutdown began', async () => {
    const context = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalLoad = context.store.load.bind(context.store);
    context.store.load = async (room) => {
      await gate;
      return originalLoad(room);
    };
    const late = connect(context, 'plant');
    await pump([late]);
    const shutdown = context.manager.shutdown();
    release();
    await shutdown;
    await pump([late]);
    expect(late.closeCodes).toContain(1001);
  });
});
