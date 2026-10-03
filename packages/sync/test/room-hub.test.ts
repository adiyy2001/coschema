import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_GOING_AWAY,
  CLOSE_INVALID_DATA,
  CLOSE_UNAUTHORIZED,
  DEFAULT_AUTH_TIMEOUT_MS,
  MAX_QUEUED_FRAMES_BEFORE_AUTH,
  MalformedFrameError,
  MessageType,
  RoomHub,
  createAwareness,
  decodeAck,
  decodeAuthDenied,
  encodeAwarenessOf,
  encodeFlush,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeUpdate,
  readSyncFrame,
  systemClock,
  type AuthResult,
} from '../src';
import {
  authenticatedPeer,
  connectRawPeer,
  deferred,
  flushPromises,
  labelsOf,
  setLabel,
  updatesOf,
} from './support';

function newHub(
  options: ConstructorParameters<typeof RoomHub>[0] extends infer T ? Partial<T> : never = {},
) {
  const errors: unknown[] = [];
  const hub = new RoomHub({
    clock: systemClock,
    onError: (error) => errors.push(error),
    ...options,
  });
  return { hub, errors };
}

function awarenessFrame(clientId: number, state: object | null, clock: number): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const awareness = createAwareness(doc);
  awareness.meta.set(clientId, { clock: clock - 1, lastUpdated: 0 });
  awareness.setLocalState(state);
  return encodeAwarenessOf(awareness, [clientId]);
}

function awarenessStatesIn(frameUpdate: Uint8Array): Map<number, unknown> {
  const doc = new Y.Doc();
  const awareness = createAwareness(doc);
  awarenessProtocol.applyAwarenessUpdate(awareness, frameUpdate, 'test');
  return awareness.getStates();
}

describe('RoomHub authentication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a valid token with sync step 1 and awareness states', () => {
    const { hub } = newHub();
    setLabel(hub.doc, 'a', '1');
    const peer = authenticatedPeer(hub);
    expect(peer.ofType(MessageType.sync)).toHaveLength(1);
    expect(hub.readyConnectionCount).toBe(1);
  });

  it('passes the token to the authenticator and keeps the identity', () => {
    const seen: string[] = [];
    const { hub } = newHub({
      authenticate: (token) => {
        seen.push(token);
        return { ok: true, identity: { name: 'Anna' } };
      },
    });
    const peer = connectRawPeer(hub);
    peer.send(new Uint8Array([MessageType.auth, 1, 120]));
    peer.settle();
    expect(seen).toEqual(['x']);
    expect(hub.readyConnectionCount).toBe(1);
  });

  it('denies a first frame that is not an auth message', () => {
    const { hub } = newHub();
    const peer = connectRawPeer(hub);
    peer.send(encodeSyncStep1(new Y.Doc()));
    peer.settle();
    expect(peer.closes[0]?.code).toBe(CLOSE_UNAUTHORIZED);
    const denied = peer.ofType(MessageType.auth)[0];
    expect(denied).toBeDefined();
    if (denied !== undefined) expect(decodeAuthDenied(denied.decoder)).toMatch(/must authenticate/);
    expect(hub.connectionCount).toBe(0);
  });

  it('denies a malformed first frame and reports it', () => {
    const { hub, errors } = newHub();
    const peer = connectRawPeer(hub);
    peer.send(new Uint8Array([MessageType.auth]));
    peer.settle();
    expect(peer.closes[0]?.code).toBe(CLOSE_UNAUTHORIZED);
    expect(errors[0]).toBeInstanceOf(MalformedFrameError);
  });

  it('denies when the authenticator says no, throws or rejects', async () => {
    const { hub } = newHub({ authenticate: () => ({ ok: false, reason: 'expired' }) });
    const peer = authenticatedPeer(hub);
    expect(peer.closes[0]).toEqual({ code: CLOSE_UNAUTHORIZED, reason: 'expired' });

    const thrower = newHub({
      authenticate: () => {
        throw new Error('boom');
      },
    });
    const second = authenticatedPeer(thrower.hub);
    expect(second.closes[0]?.code).toBe(CLOSE_UNAUTHORIZED);

    const rejecter = newHub({ authenticate: () => Promise.reject(new Error('boom')) });
    const third = authenticatedPeer(rejecter.hub);
    await flushPromises();
    third.settle();
    expect(third.closes[0]?.code).toBe(CLOSE_UNAUTHORIZED);
  });

  it('queues frames that arrive while the authenticator is pending and replays them in order', async () => {
    const decision = deferred<AuthResult>();
    const { hub } = newHub({ authenticate: () => decision.promise });
    const source = new Y.Doc();
    const [first, second] = updatesOf(source, [
      (doc) => setLabel(doc, 'a', '1'),
      (doc) => setLabel(doc, 'b', '2'),
    ]);
    const peer = authenticatedPeer(hub);
    peer.send(encodeUpdate(first ?? new Uint8Array()));
    peer.send(encodeUpdate(second ?? new Uint8Array()));
    peer.settle();
    expect(labelsOf(hub.doc)).toEqual({});
    expect(peer.received).toHaveLength(0);
    decision.resolve({ ok: true });
    await flushPromises();
    peer.settle();
    expect(labelsOf(hub.doc)).toEqual({ a: '1', b: '2' });
    expect(peer.received[0]?.type).toBe(MessageType.sync);
  });

  it('closes a connection that floods frames before authentication finishes', () => {
    const decision = deferred<AuthResult>();
    const { hub } = newHub({ authenticate: () => decision.promise });
    const peer = authenticatedPeer(hub);
    for (let index = 0; index <= MAX_QUEUED_FRAMES_BEFORE_AUTH; index += 1) {
      peer.send(encodeQueryAwareness());
    }
    peer.settle();
    expect(peer.closes[0]?.code).toBe(CLOSE_UNAUTHORIZED);
  });

  it('ignores a late authentication result after the connection closed', async () => {
    const decision = deferred<AuthResult>();
    const { hub } = newHub({ authenticate: () => decision.promise });
    const peer = authenticatedPeer(hub);
    peer.pair.client.close();
    peer.settle();
    decision.resolve({ ok: true });
    await flushPromises();
    expect(hub.connectionCount).toBe(0);
  });

  it('closes a connection that stays silent past the deadline', () => {
    const { hub } = newHub();
    const peer = connectRawPeer(hub);
    vi.advanceTimersByTime(DEFAULT_AUTH_TIMEOUT_MS - 1);
    peer.settle();
    expect(peer.closes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    peer.settle();
    expect(peer.closes[0]?.code).toBe(CLOSE_UNAUTHORIZED);
  });

  it('stops the deadline once the connection authenticated', () => {
    const { hub } = newHub();
    const peer = authenticatedPeer(hub);
    vi.advanceTimersByTime(DEFAULT_AUTH_TIMEOUT_MS * 4);
    peer.settle();
    expect(peer.closes).toHaveLength(0);
    expect(hub.readyConnectionCount).toBe(1);
  });
});

describe('RoomHub sync', () => {
  it('answers step 1 with exactly the missing structs', () => {
    const { hub } = newHub();
    setLabel(hub.doc, 'a', '1');
    const known = new Y.Doc();
    Y.applyUpdate(known, Y.encodeStateAsUpdate(hub.doc));
    setLabel(hub.doc, 'b', '2');
    const peer = authenticatedPeer(hub);
    peer.send(encodeSyncStep1(known));
    peer.settle();
    const syncFrames = peer.ofType(MessageType.sync);
    const reply = syncFrames[syncFrames.length - 1];
    if (reply === undefined) throw new Error('no reply');
    readSyncFrame(reply.decoder, known, 'peer');
    expect(labelsOf(known)).toEqual({ a: '1', b: '2' });
  });

  it('broadcasts updates to the other connections but never back to the sender', () => {
    const { hub } = newHub();
    const alice = authenticatedPeer(hub);
    const bob = authenticatedPeer(hub);
    const source = new Y.Doc();
    const [update] = updatesOf(source, [(doc) => setLabel(doc, 'a', '1')]);
    alice.send(encodeUpdate(update ?? new Uint8Array()));
    alice.settle();
    bob.settle();
    expect(labelsOf(hub.doc)).toEqual({ a: '1' });
    expect(alice.ofType(MessageType.sync)).toHaveLength(1);
    expect(bob.ofType(MessageType.sync)).toHaveLength(2);
  });

  it('applies duplicated and out of order updates once', () => {
    const { hub, errors } = newHub();
    const source = new Y.Doc();
    const updates = updatesOf(source, [
      (doc) => setLabel(doc, 'a', '1'),
      (doc) => setLabel(doc, 'b', '2'),
      (doc) => setLabel(doc, 'c', '3'),
    ]);
    const peer = authenticatedPeer(hub);
    for (const index of [2, 0, 0, 1, 2, 1]) {
      peer.send(encodeUpdate(updates[index] ?? new Uint8Array()));
    }
    peer.settle();
    expect(labelsOf(hub.doc)).toEqual({ a: '1', b: '2', c: '3' });
    expect(Y.encodeStateVector(hub.doc)).toEqual(Y.encodeStateVector(source));
    expect(errors).toEqual([]);
  });

  it('keeps loaded updates out of persistence and broadcasts', () => {
    const persisted: Uint8Array[] = [];
    const { hub } = newHub({ onUpdate: (update) => void persisted.push(update) });
    const peer = authenticatedPeer(hub);
    const source = new Y.Doc();
    setLabel(source, 'a', '1');
    hub.loadUpdate(Y.encodeStateAsUpdate(source));
    peer.settle();
    expect(persisted).toEqual([]);
    expect(peer.ofType(MessageType.sync)).toHaveLength(1);
    expect(labelsOf(hub.doc)).toEqual({ a: '1' });
  });

  it('closes a connection that sends a corrupt update and reports the error', () => {
    const { hub, errors } = newHub();
    const peer = authenticatedPeer(hub);
    peer.send(encodeUpdate(new Uint8Array([255, 255, 255])));
    peer.settle();
    expect(peer.closes[0]?.code).toBe(CLOSE_INVALID_DATA);
    expect(errors[0]).toBeInstanceOf(MalformedFrameError);
    expect(hub.connectionCount).toBe(0);
  });

  it('closes a connection that sends an unknown message type', () => {
    const { hub } = newHub();
    const peer = authenticatedPeer(hub);
    peer.send(new Uint8Array([77]));
    peer.settle();
    expect(peer.closes[0]?.code).toBe(CLOSE_INVALID_DATA);
  });

  it('ignores ack and auth frames from clients', () => {
    const { hub } = newHub();
    const peer = authenticatedPeer(hub);
    peer.send(new Uint8Array([MessageType.ack, 1, 0]));
    peer.send(new Uint8Array([MessageType.auth, 1, 120]));
    peer.settle();
    expect(peer.closes).toHaveLength(0);
  });

  it('closes a connection when sending to it fails', () => {
    const { hub, errors } = newHub();
    const peer = authenticatedPeer(hub);
    const original = peer.pair.server.send.bind(peer.pair.server);
    peer.pair.server.send = () => {
      throw new Error('socket gone');
    };
    const other = authenticatedPeer(hub);
    const source = new Y.Doc();
    const [update] = updatesOf(source, [(doc) => setLabel(doc, 'a', '1')]);
    other.send(encodeUpdate(update ?? new Uint8Array()));
    other.settle();
    peer.pair.server.send = original;
    expect(errors).toHaveLength(1);
    expect(hub.readyConnectionCount).toBe(1);
  });

  it('closes every connection on destroy', () => {
    const { hub } = newHub();
    const alice = authenticatedPeer(hub);
    const bob = authenticatedPeer(hub);
    hub.destroy();
    hub.destroy();
    alice.settle();
    bob.settle();
    expect(alice.closes[0]?.code).toBe(CLOSE_GOING_AWAY);
    expect(bob.closes[0]?.code).toBe(CLOSE_GOING_AWAY);
    expect(hub.connectionCount).toBe(0);
  });
});

describe('RoomHub awareness', () => {
  it('relays awareness to the other connections but not back', () => {
    const { hub } = newHub();
    const alice = authenticatedPeer(hub);
    const bob = authenticatedPeer(hub);
    alice.send(awarenessFrame(7, { name: 'Alice' }, 1));
    alice.settle();
    bob.settle();
    expect(bob.ofType(MessageType.awareness)).toHaveLength(1);
    expect(alice.ofType(MessageType.awareness)).toHaveLength(0);
    expect(hub.awareness.getStates().get(7)).toEqual({ name: 'Alice' });
  });

  it('sends the known states to a new connection and to a query', () => {
    const { hub } = newHub();
    const alice = authenticatedPeer(hub);
    alice.send(awarenessFrame(7, { name: 'Alice' }, 1));
    alice.settle();
    const bob = authenticatedPeer(hub);
    expect(bob.ofType(MessageType.awareness)).toHaveLength(1);
    bob.send(encodeQueryAwareness());
    bob.settle();
    const frames = bob.ofType(MessageType.awareness);
    expect(frames).toHaveLength(2);
    expect(awarenessStatesIn(frames[1]?.update ?? new Uint8Array()).get(7)).toEqual({
      name: 'Alice',
    });
  });

  it('removes the states of a closed connection and tells the others', () => {
    const { hub } = newHub();
    const alice = authenticatedPeer(hub);
    const bob = authenticatedPeer(hub);
    alice.send(awarenessFrame(7, { name: 'Alice' }, 1));
    alice.settle();
    bob.settle();
    alice.pair.client.close();
    alice.settle();
    bob.settle();
    expect(hub.awareness.getStates().has(7)).toBe(false);
    const frames = bob.ofType(MessageType.awareness);
    const states = awarenessStatesIn(frames[frames.length - 1]?.update ?? new Uint8Array());
    expect(states.has(7)).toBe(false);
    expect(frames).toHaveLength(2);
  });

  it('keeps a state that a newer connection took over when the old one closes late', () => {
    const { hub } = newHub();
    const ghost = authenticatedPeer(hub);
    ghost.send(awarenessFrame(7, { name: 'Alice' }, 1));
    ghost.settle();
    const fresh = authenticatedPeer(hub);
    fresh.send(awarenessFrame(7, { name: 'Alice again' }, 2));
    fresh.settle();
    ghost.pair.client.close();
    ghost.settle();
    expect(hub.awareness.getStates().get(7)).toEqual({ name: 'Alice again' });
    fresh.pair.client.close();
    fresh.settle();
    expect(hub.awareness.getStates().has(7)).toBe(false);
  });

  it('does not control a state that the client removed itself', () => {
    const { hub } = newHub();
    const alice = authenticatedPeer(hub);
    alice.send(awarenessFrame(7, { name: 'Alice' }, 1));
    alice.send(awarenessFrame(7, null, 2));
    alice.settle();
    expect(hub.awareness.getStates().has(7)).toBe(false);
    alice.pair.client.close();
    alice.settle();
    expect(hub.connectionCount).toBe(0);
  });
});

describe('RoomHub acknowledgements', () => {
  function updateFrames(count: number): Uint8Array[] {
    const source = new Y.Doc();
    source.clientID = 9;
    return updatesOf(
      source,
      Array.from({ length: count }, (_, index) => (doc: Y.Doc) => {
        setLabel(doc, `k${index}`, 'v');
      }),
    ).map(encodeUpdate);
  }

  function acksOf(peer: ReturnType<typeof authenticatedPeer>) {
    return peer.ofType(MessageType.ack).map((envelope) => decodeAck(envelope.decoder));
  }

  it('acks at once when nothing persists', () => {
    const { hub } = newHub();
    const peer = authenticatedPeer(hub);
    const [frame] = updateFrames(1);
    peer.send(frame ?? new Uint8Array());
    peer.send(encodeFlush(1));
    peer.settle();
    const [ack] = acksOf(peer);
    expect(ack?.token).toBe(1);
    expect(ack?.stateVector).toEqual(Y.encodeStateVector(hub.doc));
  });

  it('acks only after the persistence callback resolved', async () => {
    const gate = deferred();
    const { hub } = newHub({ onUpdate: () => gate.promise });
    const peer = authenticatedPeer(hub);
    const [frame] = updateFrames(1);
    peer.send(frame ?? new Uint8Array());
    peer.send(encodeFlush(1));
    peer.settle();
    await flushPromises();
    peer.settle();
    expect(acksOf(peer)).toHaveLength(0);
    gate.resolve();
    await flushPromises();
    peer.settle();
    expect(acksOf(peer).map((ack) => ack.token)).toEqual([1]);
    expect(hub.persistedStateVector).toEqual(Y.encodeStateVector(hub.doc));
  });

  it('acks a flush after several updates only once all of them persisted, in order', async () => {
    const gates = [deferred(), deferred()];
    let call = 0;
    const { hub } = newHub({
      onUpdate: () => {
        const gate = gates[call];
        call += 1;
        return gate?.promise;
      },
    });
    const peer = authenticatedPeer(hub);
    const frames = updateFrames(2);
    peer.send(frames[0] ?? new Uint8Array());
    peer.send(frames[1] ?? new Uint8Array());
    peer.send(encodeFlush(2));
    peer.settle();
    gates[1]?.resolve();
    await flushPromises();
    peer.settle();
    expect(acksOf(peer)).toHaveLength(0);
    gates[0]?.resolve();
    await flushPromises();
    peer.settle();
    expect(acksOf(peer).map((ack) => ack.token)).toEqual([2]);
  });

  it('acks at once when the callback is synchronous', () => {
    const persisted: Uint8Array[] = [];
    const { hub } = newHub({ onUpdate: (update) => void persisted.push(update) });
    const peer = authenticatedPeer(hub);
    const [frame] = updateFrames(1);
    peer.send(frame ?? new Uint8Array());
    peer.send(encodeFlush(1));
    peer.settle();
    expect(persisted).toHaveLength(1);
    expect(acksOf(peer)).toHaveLength(1);
  });

  it('never acks after a persistence failure and reports it', async () => {
    const { hub, errors } = newHub({ onUpdate: () => Promise.reject(new Error('disk full')) });
    const peer = authenticatedPeer(hub);
    const [frame] = updateFrames(1);
    peer.send(frame ?? new Uint8Array());
    peer.send(encodeFlush(1));
    peer.settle();
    await flushPromises();
    peer.settle();
    expect(acksOf(peer)).toHaveLength(0);
    expect(hub.hasPersistenceFailure).toBe(true);
    expect(errors).toHaveLength(1);
    peer.send(encodeFlush(1));
    peer.settle();
    expect(acksOf(peer)).toHaveLength(0);
  });

  it('treats a throwing callback as a persistence failure', () => {
    const { hub, errors } = newHub({
      onUpdate: () => {
        throw new Error('broken');
      },
    });
    const peer = authenticatedPeer(hub);
    const [frame] = updateFrames(1);
    peer.send(frame ?? new Uint8Array());
    peer.settle();
    expect(hub.hasPersistenceFailure).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('drops waiting acks of a connection that closed', async () => {
    const gate = deferred();
    const { hub } = newHub({ onUpdate: () => gate.promise });
    const peer = authenticatedPeer(hub);
    const other = authenticatedPeer(hub);
    const [frame] = updateFrames(1);
    peer.send(frame ?? new Uint8Array());
    peer.send(encodeFlush(1));
    other.send(encodeFlush(5));
    peer.settle();
    other.settle();
    peer.pair.client.close();
    peer.settle();
    gate.resolve();
    await flushPromises();
    other.settle();
    expect(acksOf(peer)).toHaveLength(0);
    expect(acksOf(other).map((ack) => ack.token)).toEqual([5]);
  });
});
