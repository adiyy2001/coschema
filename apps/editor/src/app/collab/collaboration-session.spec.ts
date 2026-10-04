import {
  RoomHub,
  createMemoryPair,
  systemClock,
  type Clock,
  type MemoryPair,
  type SyncSnapshot,
  type TimerHandle,
  type Transport,
} from '@coschema/sync';
import * as Y from 'yjs';
import { describe, expect, it, vi } from 'vitest';
import {
  CollaborationSession,
  stateOf,
  type CollaborationOptions,
  type DiskPersistence,
} from './collaboration-session';
import { fixedTokenProvider, type TokenProvider } from './connection';
import type { KeyValueStorage } from './identity';
import { pendingKey } from './pending-store';

class Network {
  readonly pairs: MemoryPair[] = [];

  settle(): void {
    for (let round = 0; round < 1000; round += 1) {
      const busy = this.pairs.filter((pair) => pair.queued > 0);
      if (busy.length === 0) return;
      for (const pair of busy) pair.flush();
    }
    throw new Error('network did not settle');
  }
}

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

interface Fixture {
  readonly hub: RoomHub;
  readonly network: Network;
  readonly doc: Y.Doc;
  readonly storage: ReturnType<typeof memoryStorage>;
  readonly calls: string[];
  make(overrides?: Partial<CollaborationOptions>): CollaborationSession;
}

function fixture(hubOptions: { authenticate?: () => { ok: false; reason: string } } = {}): Fixture {
  const hub = new RoomHub({ clock: systemClock, ...hubOptions });
  const network = new Network();
  const doc = new Y.Doc();
  const storage = memoryStorage();
  const calls: string[] = [];
  const connect = (): Transport => {
    const pair = createMemoryPair();
    network.pairs.push(pair);
    hub.accept(pair.server);
    return pair.client;
  };
  return {
    hub,
    network,
    doc,
    storage,
    calls,
    make: (overrides = {}) =>
      new CollaborationSession({
        doc,
        room: 'plant',
        connect,
        tokens: fixedTokenProvider('token'),
        clock: systemClock,
        random: () => 0,
        storage,
        prepare: () => {
          calls.push('prepare');
        },
        onFirstSync: () => {
          calls.push('first-sync');
        },
        ...overrides,
      }),
  };
}

function editLocally(doc: Y.Doc, key: string, value: string): void {
  doc.getMap<string>('labels').set(key, value);
}

describe('stateOf', () => {
  const snapshot = (status: SyncSnapshot['status']): SyncSnapshot => ({
    status,
    synced: status === 'online',
    pendingCount: 0,
    reconnectAttempt: 0,
  });

  it('maps the sync status to what the person sees', () => {
    expect(stateOf(snapshot('online'), false)).toBe('online');
    expect(stateOf(snapshot('denied'), false)).toBe('denied');
    expect(stateOf(snapshot('connecting'), false)).toBe('connecting');
    expect(stateOf(snapshot('syncing'), false)).toBe('connecting');
    expect(stateOf(snapshot('waiting'), false)).toBe('offline');
    expect(stateOf(snapshot('stopped'), true)).toBe('offline');
    expect(stateOf(snapshot('stopped'), false)).toBe('connecting');
  });
});

describe('CollaborationSession', () => {
  it('prepares the document, connects and reports the first sync once', async () => {
    const f = fixture();
    const session = f.make();
    expect(session.state()).toBe('loading');
    await session.start();
    f.network.settle();
    expect(session.state()).toBe('online');
    expect(session.synced()).toBe(true);
    expect(session.pending()).toBe(0);
    expect(f.calls).toEqual(['prepare', 'first-sync']);
    session.destroy();
  });

  it('starts only once', async () => {
    const f = fixture();
    const session = f.make();
    await session.start();
    await session.start();
    f.network.settle();
    expect(f.calls.filter((call) => call === 'prepare')).toHaveLength(1);
    session.destroy();
  });

  it('counts edits made while the person switched to offline and sends them on reconnect', async () => {
    const f = fixture();
    const session = f.make();
    await session.start();
    f.network.settle();
    session.setOffline(true);
    f.network.settle();
    expect(session.state()).toBe('offline');
    expect(session.manuallyOffline()).toBe(true);
    editLocally(f.doc, 'a', '1');
    editLocally(f.doc, 'b', '2');
    expect(session.pending()).toBe(2);
    expect(f.storage.values.get(pendingKey('plant'))).toBe('2');
    expect(f.hub.doc.getMap('labels').toJSON()).toEqual({});
    session.setOffline(false);
    await Promise.resolve();
    await Promise.resolve();
    f.network.settle();
    expect(session.state()).toBe('online');
    expect(session.pending()).toBe(0);
    expect(f.storage.values.get(pendingKey('plant'))).toBe('0');
    expect(f.hub.doc.getMap('labels').toJSON()).toEqual({ a: '1', b: '2' });
    session.destroy();
  });

  it('goes offline when the browser reports a lost network and syncs when it returns', async () => {
    const f = fixture();
    let handlers: { lost: () => void; restored: () => void } | undefined;
    let unsubscribed = false;
    const session = f.make({
      network: {
        subscribe: (given) => {
          handlers = given;
          return () => {
            unsubscribed = true;
          };
        },
      },
    });
    await session.start();
    f.network.settle();
    expect(session.state()).toBe('online');
    handlers?.lost();
    expect(session.state()).toBe('offline');
    editLocally(f.doc, 'a', '1');
    expect(session.pending()).toBe(1);
    handlers?.restored();
    f.network.settle();
    expect(session.state()).toBe('online');
    expect(session.pending()).toBe(0);
    expect(f.hub.doc.getMap('labels').toJSON()).toEqual({ a: '1' });
    session.destroy();
    expect(unsubscribed).toBe(true);
  });

  it('does not reconnect on a network event while the person is offline on purpose', async () => {
    const f = fixture();
    let handlers: { lost: () => void; restored: () => void } | undefined;
    const session = f.make({
      network: {
        subscribe: (given) => {
          handlers = given;
          return () => undefined;
        },
      },
    });
    await session.start();
    f.network.settle();
    session.setOffline(true);
    handlers?.lost();
    handlers?.restored();
    f.network.settle();
    expect(session.state()).toBe('offline');
    expect(session.manuallyOffline()).toBe(true);
    session.destroy();
  });

  it('ignores a second switch to the same state', async () => {
    const f = fixture();
    const session = f.make();
    await session.start();
    f.network.settle();
    session.setOffline(false);
    expect(session.manuallyOffline()).toBe(false);
    session.setOffline(true);
    session.setOffline(true);
    expect(session.manuallyOffline()).toBe(true);
    session.destroy();
  });

  it('restores the pending count after a reload and clears it on the first ack', async () => {
    const f = fixture();
    f.storage.setItem(pendingKey('plant'), '3');
    const session = f.make();
    await session.start();
    expect(session.pending()).toBe(3);
    f.network.settle();
    expect(session.pending()).toBe(0);
    session.destroy();
  });

  it('shows denied for a rejected token and does not refresh a fixed one', async () => {
    const f = fixture({ authenticate: () => ({ ok: false, reason: 'bad token' }) });
    const get = vi.fn(() => Promise.resolve({ token: 'bad' }));
    const session = f.make({ tokens: { refreshable: false, get } });
    await session.start();
    f.network.settle();
    await Promise.resolve();
    f.network.settle();
    expect(session.state()).toBe('denied');
    expect(get).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it('asks a refreshable provider for a new token once after a denial', async () => {
    const f = fixture({ authenticate: () => ({ ok: false, reason: 'expired' }) });
    const get = vi.fn(() => Promise.resolve({ token: 'stale' }));
    const session = f.make({ tokens: { refreshable: true, get } });
    await session.start();
    for (let round = 0; round < 6; round += 1) {
      f.network.settle();
      await Promise.resolve();
    }
    expect(session.state()).toBe('denied');
    expect(get).toHaveBeenCalledTimes(2);
    session.destroy();
  });

  it('reports a failed token request, stays offline and retries with backoff', async () => {
    const f = fixture();
    const timers: { callback: () => void; delay: number }[] = [];
    const clock: Clock = {
      now: () => 0,
      setTimeout: (callback, delay): TimerHandle => timers.push({ callback, delay }),
      clearTimeout: () => undefined,
    };
    let attempts = 0;
    const tokens: TokenProvider = {
      refreshable: true,
      get: () => {
        attempts += 1;
        return attempts < 2
          ? Promise.reject(new Error('server down'))
          : Promise.resolve({ token: 't' });
      },
    };
    const onError = vi.fn();
    const session = f.make({ tokens, clock, onError });
    await session.start();
    expect(session.state()).toBe('offline');
    expect(session.error()).toBe('server down');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(1);
    timers[0]?.callback();
    await Promise.resolve();
    await Promise.resolve();
    expect(session.error()).toBeUndefined();
    expect(attempts).toBe(2);
    session.destroy();
  });

  it('does not retry a token request while the person is offline on purpose', async () => {
    const f = fixture();
    const timers: (() => void)[] = [];
    const clock: Clock = {
      now: () => 0,
      setTimeout: (callback): TimerHandle => timers.push(callback),
      clearTimeout: () => undefined,
    };
    const tokens: TokenProvider = {
      refreshable: true,
      get: () => Promise.reject(new Error('down')),
    };
    const session = f.make({ tokens, clock });
    await session.start();
    expect(timers).toHaveLength(1);
    session.setOffline(true);
    timers[0]?.();
    await Promise.resolve();
    expect(session.state()).toBe('offline');
    session.destroy();
  });

  it('loads the disk copy before preparing the document and destroys it with the session', async () => {
    const f = fixture();
    const order: string[] = [];
    const destroy = vi.fn();
    const persistence = (name: string): DiskPersistence => {
      order.push(`open ${name}`);
      return {
        loaded: Promise.resolve().then(() => {
          order.push('loaded');
        }),
        destroy,
      };
    };
    const session = f.make({
      persistence,
      prepare: () => {
        order.push('prepare');
      },
    });
    await session.start();
    expect(order).toEqual(['open coschema:room:plant', 'loaded', 'prepare']);
    expect(session.diskLoaded()).toBe(true);
    session.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('carries on without a disk copy when opening it fails', async () => {
    const f = fixture();
    const onError = vi.fn();
    const session = f.make({
      persistence: () => {
        throw new Error('blocked');
      },
      onError,
    });
    await session.start();
    f.network.settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(session.state()).toBe('online');
    session.destroy();
  });

  it('does nothing after it was destroyed', async () => {
    const f = fixture();
    const session = f.make();
    session.destroy();
    session.destroy();
    await session.start();
    session.setOffline(true);
    expect(session.state()).toBe('loading');
    expect(f.calls).toEqual([]);
  });
});
