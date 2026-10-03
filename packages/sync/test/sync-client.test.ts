import * as decoding from 'lib0/decoding';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_ABNORMAL,
  DEFAULT_ACK_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  Emitter,
  MessageType,
  SYNC_STEP_2,
  decodeEnvelope,
  encodeAck,
  type SyncSnapshot,
  type Transport,
} from '../src';
import {
  constantRandom,
  createHarness,
  deferred,
  flushPromises,
  labelsOf,
  setLabel,
  type FrameLog,
} from './support';

function newLog(): FrameLog {
  return { sent: [], received: [] };
}

function typesOf(frames: readonly Uint8Array[]): number[] {
  return frames.map((frame) => decodeEnvelope(frame).type);
}

function keysInStep2(frames: readonly Uint8Array[]): string[] {
  const keys: string[] = [];
  for (const frame of frames) {
    const decoder = decoding.createDecoder(frame);
    if (decoding.readVarUint(decoder) !== MessageType.sync) continue;
    if (decoding.readVarUint(decoder) !== SYNC_STEP_2) continue;
    const { structs } = Y.decodeUpdate(decoding.readVarUint8Array(decoder));
    for (const struct of structs) {
      if ('parentSub' in struct && typeof struct.parentSub === 'string')
        keys.push(struct.parentSub);
    }
  }
  return keys;
}

class ScriptedTransport implements Transport {
  readonly sent: Uint8Array[] = [];
  closed = false;
  private readonly opens = new Emitter<[]>();
  private readonly messages = new Emitter<[Uint8Array]>();
  private readonly closes = new Emitter<[number, string]>();

  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  onOpen(handler: () => void) {
    return this.opens.subscribe(handler);
  }
  onMessage(handler: (data: Uint8Array) => void) {
    return this.messages.subscribe(handler);
  }
  onClose(handler: (code: number, reason: string) => void) {
    return this.closes.subscribe(handler);
  }
  open(): void {
    this.opens.emit();
  }
  receive(data: Uint8Array): void {
    this.messages.emit(data);
  }
  drop(code = CLOSE_ABNORMAL): void {
    this.closes.emit(code, '');
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SyncClient handshake', () => {
  it('sends auth, sync step 1 and an awareness query in that order', () => {
    const harness = createHarness();
    const log = newLog();
    const client = harness.client({}, 1, log);
    client.start();
    harness.network.settle();
    expect(typesOf(log.sent).slice(0, 3)).toEqual([
      MessageType.auth,
      MessageType.sync,
      MessageType.queryAwareness,
    ]);
    expect(client.currentStatus).toBe('online');
    expect(client.isSynced).toBe(true);
  });

  it('exchanges state in both directions', () => {
    const harness = createHarness();
    setLabel(harness.hub.doc, 'server', 'x');
    const client = harness.client();
    setLabel(client.doc, 'local', 'y');
    client.start();
    harness.network.settle();
    expect(labelsOf(client.doc)).toEqual({ server: 'x', local: 'y' });
    expect(labelsOf(harness.hub.doc)).toEqual({ server: 'x', local: 'y' });
  });

  it('syncs two clients through the hub', () => {
    const harness = createHarness();
    const alice = harness.client();
    const bob = harness.client();
    alice.start();
    bob.start();
    harness.network.settle();
    setLabel(alice.doc, 'a', '1');
    harness.network.settle();
    setLabel(bob.doc, 'b', '2');
    harness.network.settle();
    expect(labelsOf(alice.doc)).toEqual({ a: '1', b: '2' });
    expect(labelsOf(bob.doc)).toEqual({ a: '1', b: '2' });
  });

  it('sends only the difference when it reconnects with partial state', () => {
    const harness = createHarness();
    const alice = harness.client();
    const bob = harness.client();
    alice.start();
    bob.start();
    for (let index = 0; index < 50; index += 1) setLabel(bob.doc, `old${index}`, 'x'.repeat(20));
    harness.network.settle();
    alice.stop();
    harness.network.settle();
    setLabel(bob.doc, 'fresh', 'from bob');
    setLabel(alice.doc, 'offline', 'from alice');
    harness.network.settle();
    const log = newLog();
    const reconnecting = harness.client({ doc: alice.doc }, 1, log);
    reconnecting.start();
    harness.network.settle();
    expect(keysInStep2(log.received)).toEqual(['fresh']);
    expect(keysInStep2(log.sent)).toEqual(['offline']);
    expect(labelsOf(alice.doc)).toEqual(labelsOf(bob.doc));
  });

  it('does not count updates received from the hub as pending', () => {
    const harness = createHarness();
    const alice = harness.client();
    const bob = harness.client();
    alice.start();
    bob.start();
    setLabel(alice.doc, 'a', '1');
    harness.network.settle();
    expect(bob.pendingCount).toBe(0);
    expect(alice.pendingCount).toBe(0);
  });

  it('tolerates frames that arrive twice', () => {
    const harness = createHarness();
    const alice = harness.client();
    const duplicating = (): Transport => {
      const inner = harness.connector()();
      return {
        ...inner,
        send: (data) => {
          inner.send(data);
        },
        close: (code, reason) => {
          inner.close(code, reason);
        },
        onOpen: (handler) => inner.onOpen(handler),
        onClose: (handler) => inner.onClose(handler),
        onMessage: (handler) =>
          inner.onMessage((data) => {
            handler(data);
            handler(data);
          }),
      };
    };
    const bob = harness.client({ connect: duplicating });
    alice.start();
    bob.start();
    setLabel(alice.doc, 'a', '1');
    harness.network.settle();
    expect(labelsOf(bob.doc)).toEqual({ a: '1' });
    expect(harness.errors).toEqual([]);
  });
});

describe('SyncClient pending count', () => {
  it('counts local transactions until the hub acknowledged them', () => {
    const harness = createHarness();
    const client = harness.client();
    const snapshots: SyncSnapshot[] = [];
    client.subscribe((snapshot) => snapshots.push(snapshot));
    client.start();
    harness.network.settle();
    setLabel(client.doc, 'a', '1');
    expect(client.pendingCount).toBe(1);
    setLabel(client.doc, 'b', '2');
    expect(client.pendingCount).toBe(2);
    harness.network.settle();
    expect(client.pendingCount).toBe(0);
    expect(snapshots.map((snapshot) => snapshot.pendingCount)).toContain(2);
  });

  it('keeps counting while offline and clears the count after the handshake', () => {
    const harness = createHarness();
    const client = harness.client();
    setLabel(client.doc, 'a', '1');
    setLabel(client.doc, 'b', '2');
    setLabel(client.doc, 'c', '3');
    expect(client.pendingCount).toBe(3);
    client.start();
    harness.network.settle();
    expect(client.pendingCount).toBe(0);
    expect(labelsOf(harness.hub.doc)).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('holds the count while the hub has not persisted the update', async () => {
    const gate = deferred();
    const harness = createHarness({ onUpdate: () => gate.promise });
    const client = harness.client({ ackTimeoutMs: 60_000 });
    client.start();
    harness.network.settle();
    setLabel(client.doc, 'a', '1');
    harness.network.settle();
    expect(client.pendingCount).toBe(1);
    gate.resolve();
    await flushPromises();
    harness.network.settle();
    expect(client.pendingCount).toBe(0);
  });

  it('ignores an ack for a transaction that never happened and a stale ack', () => {
    const transport = new ScriptedTransport();
    const harness = createHarness();
    const client = harness.client({ connect: () => transport });
    client.start();
    transport.open();
    setLabel(client.doc, 'a', '1');
    setLabel(client.doc, 'b', '2');
    transport.receive(encodeAck({ token: 99, stateVector: new Uint8Array() }));
    expect(client.pendingCount).toBe(0);
    transport.receive(encodeAck({ token: 1, stateVector: new Uint8Array() }));
    expect(client.pendingCount).toBe(0);
  });
});

describe('SyncClient reconnects', () => {
  function failingConnect(attempts: number[]): () => Transport {
    return () => {
      attempts.push(performance.now());
      const transport = new ScriptedTransport();
      queueMicrotask(() => {
        transport.drop();
      });
      return transport;
    };
  }

  it('retries with exponential backoff up to the maximum', async () => {
    const harness = createHarness();
    const attempts: number[] = [];
    const client = harness.client({ connect: failingConnect(attempts), random: constantRandom(0) });
    client.start();
    for (let step = 0; step < 9; step += 1) {
      await flushPromises();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const gaps = attempts.slice(1).map((time, index) => time - (attempts[index] ?? 0));
    expect(gaps.slice(0, 8).map((gap) => Math.min(gap, 30_000))).toEqual([
      500, 1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it('applies jitter to the delay', async () => {
    const harness = createHarness();
    const attempts: number[] = [];
    const client = harness.client({ connect: failingConnect(attempts), random: constantRandom(1) });
    client.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(250);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(250);
  });

  it('starts over at the base delay after a successful sync', async () => {
    const harness = createHarness();
    let failures = 2;
    const attempts: number[] = [];
    const real = harness.connector();
    const client = harness.client({
      random: constantRandom(0),
      connect: () => {
        attempts.push(performance.now());
        if (failures > 0) {
          failures -= 1;
          const transport = new ScriptedTransport();
          queueMicrotask(() => {
            transport.drop();
          });
          return transport;
        }
        return real();
      },
    });
    client.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    harness.network.settle();
    expect(client.currentStatus).toBe('online');
    expect(client.snapshot.reconnectAttempt).toBe(0);
    harness.hub.destroy();
    harness.network.settle();
    const dropAt = performance.now();
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts[attempts.length - 1]).toBe(dropAt + 500);
  });

  it('gives up on a transport that never opens', async () => {
    const harness = createHarness();
    const transports: ScriptedTransport[] = [];
    const client = harness.client({
      connect: () => {
        const transport = new ScriptedTransport();
        transports.push(transport);
        return transport;
      },
      random: constantRandom(0),
    });
    client.start();
    expect(client.currentStatus).toBe('connecting');
    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_TIMEOUT_MS);
    expect(transports[0]?.closed).toBe(true);
    expect(client.currentStatus).toBe('waiting');
    await vi.advanceTimersByTimeAsync(500);
    expect(transports).toHaveLength(2);
  });

  it('reconnects when no acknowledgement arrives in time', async () => {
    const gate = deferred();
    const harness = createHarness({ onUpdate: () => gate.promise });
    let connects = 0;
    const real = harness.connector();
    const client = harness.client({
      connect: () => {
        connects += 1;
        return real();
      },
      random: constantRandom(0),
    });
    client.start();
    harness.network.settle();
    setLabel(client.doc, 'a', '1');
    harness.network.settle();
    expect(connects).toBe(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_ACK_TIMEOUT_MS);
    harness.network.settle();
    expect(client.currentStatus).toBe('waiting');
    await vi.advanceTimersByTimeAsync(500);
    expect(connects).toBe(2);
  });

  it('does not reconnect while acknowledgements keep arriving', async () => {
    const harness = createHarness();
    let connects = 0;
    const real = harness.connector();
    const client = harness.client({
      connect: () => {
        connects += 1;
        return real();
      },
    });
    client.start();
    harness.network.settle();
    for (let index = 0; index < 5; index += 1) {
      setLabel(client.doc, `k${index}`, 'v');
      harness.network.settle();
      await vi.advanceTimersByTimeAsync(DEFAULT_ACK_TIMEOUT_MS / 2);
    }
    expect(connects).toBe(1);
    expect(client.currentStatus).toBe('online');
  });

  it('keeps the watchdog running while acknowledgements make progress', async () => {
    const gate = deferred();
    let acknowledged = 0;
    const harness = createHarness({
      onUpdate: () => {
        acknowledged += 1;
        return acknowledged === 1 ? gate.promise : undefined;
      },
    });
    const client = harness.client({ ackTimeoutMs: 1000 });
    client.start();
    harness.network.settle();
    setLabel(client.doc, 'a', '1');
    harness.network.settle();
    gate.resolve();
    await flushPromises();
    harness.network.settle();
    setLabel(client.doc, 'b', '2');
    harness.network.settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.pendingCount).toBe(0);
    expect(client.currentStatus).toBe('online');
  });

  it('stops reconnecting once the hub denies the token', async () => {
    const harness = createHarness({ authenticate: () => ({ ok: false, reason: 'expired' }) });
    let connects = 0;
    const real = harness.connector();
    const client = harness.client({
      connect: () => {
        connects += 1;
        return real();
      },
    });
    client.start();
    harness.network.settle();
    expect(client.currentStatus).toBe('denied');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connects).toBe(1);
    client.start();
    expect(connects).toBe(2);
  });

  it('stays stopped after stop and connects at once on reconnect', async () => {
    const harness = createHarness();
    let connects = 0;
    const real = harness.connector();
    const client = harness.client({
      connect: () => {
        connects += 1;
        return real();
      },
    });
    client.start();
    client.start();
    harness.network.settle();
    client.stop();
    harness.network.settle();
    expect(client.currentStatus).toBe('stopped');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(connects).toBe(1);
    client.reconnect();
    harness.network.settle();
    expect(connects).toBe(2);
    expect(client.currentStatus).toBe('online');
  });

  it('reconnects after the hub closes the socket', async () => {
    const harness = createHarness();
    let connects = 0;
    const real = harness.connector();
    const client = harness.client({
      connect: () => {
        connects += 1;
        return real();
      },
      random: constantRandom(0),
    });
    client.start();
    harness.network.settle();
    harness.hub.destroy();
    harness.network.settle();
    expect(client.currentStatus).toBe('waiting');
    await vi.advanceTimersByTimeAsync(500);
    expect(connects).toBe(2);
  });

  it('reports a throwing connect function and retries', async () => {
    const harness = createHarness();
    let attempts = 0;
    const client = harness.client({
      connect: () => {
        attempts += 1;
        throw new Error('no network');
      },
      random: constantRandom(0),
    });
    client.start();
    expect(harness.errors).toHaveLength(1);
    expect(client.currentStatus).toBe('waiting');
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);
  });

  it('drops a connection whose hub sends garbage', () => {
    const transports: ScriptedTransport[] = [];
    const harness = createHarness();
    const client = harness.client({
      connect: () => {
        const transport = new ScriptedTransport();
        transports.push(transport);
        return transport;
      },
      random: constantRandom(0),
    });
    client.start();
    transports[0]?.open();
    transports[0]?.receive(new Uint8Array([77]));
    expect(harness.errors).toHaveLength(1);
    expect(transports[0]?.closed).toBe(true);
    expect(client.currentStatus).toBe('waiting');
  });

  it('survives a transport whose send throws', () => {
    const harness = createHarness();
    const transport = new ScriptedTransport();
    transport.send = () => {
      throw new Error('closed');
    };
    const client = harness.client({ connect: () => transport });
    client.start();
    transport.open();
    expect(harness.errors.length).toBeGreaterThan(0);
    expect(client.currentStatus).toBe('waiting');
  });

  it('ignores frames and closes from a transport it already replaced', () => {
    const transports: ScriptedTransport[] = [];
    const harness = createHarness();
    const client = harness.client({
      connect: () => {
        const transport = new ScriptedTransport();
        transports.push(transport);
        return transport;
      },
    });
    client.start();
    client.reconnect();
    transports[0]?.open();
    transports[0]?.receive(new Uint8Array([77]));
    transports[0]?.drop();
    expect(harness.errors).toEqual([]);
    expect(client.currentStatus).toBe('connecting');
  });

  it('stops sending after destroy', () => {
    const harness = createHarness();
    const client = harness.client();
    client.start();
    harness.network.settle();
    client.destroy();
    client.destroy();
    client.start();
    setLabel(client.doc, 'a', '1');
    harness.network.settle();
    expect(labelsOf(harness.hub.doc)).toEqual({});
    expect(client.currentStatus).toBe('stopped');
  });
});

describe('SyncClient awareness', () => {
  it('shares local state and removes it when the client disconnects', () => {
    const harness = createHarness();
    const alice = harness.client({}, 1);
    const bob = harness.client({}, 2);
    alice.start();
    bob.start();
    harness.network.settle();
    alice.awareness.setLocalState({ name: 'Alice' });
    harness.network.settle();
    expect(bob.awareness.getStates().get(1)).toEqual({ name: 'Alice' });
    alice.stop();
    harness.network.settle();
    expect(bob.awareness.getStates().has(1)).toBe(false);
  });

  it('sends the current local state in the handshake', () => {
    const harness = createHarness();
    const alice = harness.client({}, 1);
    alice.awareness.setLocalState({ name: 'Alice' });
    alice.start();
    const bob = harness.client({}, 2);
    bob.start();
    harness.network.settle();
    expect(bob.awareness.getStates().get(1)).toEqual({ name: 'Alice' });
  });

  it('forgets remote states while disconnected', () => {
    const harness = createHarness();
    const alice = harness.client({}, 1);
    const bob = harness.client({}, 2);
    alice.start();
    bob.start();
    alice.awareness.setLocalState({ name: 'Alice' });
    harness.network.settle();
    bob.stop();
    expect(bob.awareness.getStates().has(1)).toBe(false);
  });

  it('sends at most one awareness frame per interval and keeps the latest state', async () => {
    const harness = createHarness();
    const log = newLog();
    const alice = harness.client({}, 1, log);
    alice.start();
    harness.network.settle();
    const before = log.sent.length;
    for (let index = 0; index < 5; index += 1) alice.awareness.setLocalState({ cursor: index });
    harness.network.settle();
    expect(log.sent.length - before).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    harness.network.settle();
    expect(log.sent.length - before).toBe(2);
    expect(harness.hub.awareness.getStates().get(1)).toEqual({ cursor: 4 });
    await vi.advanceTimersByTimeAsync(500);
    alice.awareness.setLocalState({ cursor: 9 });
    harness.network.settle();
    expect(log.sent.length - before).toBe(3);
  });

  it('does not send awareness while offline', () => {
    const harness = createHarness();
    const log = newLog();
    const alice = harness.client({}, 1, log);
    alice.awareness.setLocalState({ name: 'Alice' });
    harness.network.settle();
    expect(log.sent).toHaveLength(0);
  });

  it('announces its own removal', async () => {
    const harness = createHarness();
    const alice = harness.client({}, 1);
    const bob = harness.client({}, 2);
    alice.start();
    bob.start();
    alice.awareness.setLocalState({ name: 'Alice' });
    harness.network.settle();
    alice.awareness.setLocalState(null);
    await vi.advanceTimersByTimeAsync(50);
    harness.network.settle();
    expect(bob.awareness.getStates().has(1)).toBe(false);
  });
});
