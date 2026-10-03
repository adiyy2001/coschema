import { createAwareness } from '@coschema/sync';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { dashFor, initialsOf, readPeers, samePeers } from './peers';
import { PresenceStore } from './presence-store';

type Awareness = ReturnType<typeof createAwareness>;

const anna = { name: 'Anna', color: '#d6336c' };
const bartek = { name: 'Bartek', color: '#1c7ed6' };

function connectedStores(): { mine: PresenceStore; theirs: PresenceStore } {
  const first = createAwareness(new Y.Doc());
  const second = createAwareness(new Y.Doc());
  const forward = (from: Awareness, to: Awareness): void => {
    from.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        if (origin === 'relay') return;
        applyAwarenessUpdate(
          to,
          encodeAwarenessUpdate(from, [...added, ...updated, ...removed]),
          'relay',
        );
      },
    );
  };
  forward(first, second);
  forward(second, first);
  const mine = new PresenceStore(first, anna, false);
  const theirs = new PresenceStore(second, bartek, false);
  return { mine, theirs };
}

describe('readPeers', () => {
  it('skips the local client and states that do not parse, and sorts by client id', () => {
    const states = new Map<number, unknown>([
      [
        9,
        { user: bartek, cursor: { x: 1, y: 2 }, selection: ['a'], viewport: null, following: null },
      ],
      [3, { user: anna, cursor: null, selection: [], viewport: null, following: 9 }],
      [5, { nonsense: true }],
      [1, { user: anna, cursor: null, selection: [], viewport: null, following: null }],
    ]);
    const { peers, cursors } = readPeers(states, 1);
    expect(peers.map((peer) => peer.clientId)).toEqual([3, 9]);
    expect(peers[0]?.following).toBe(9);
    expect(cursors.get(9)).toEqual({ x: 1, y: 2 });
    expect(cursors.get(3)).toBeNull();
  });

  it('compares peers by identity, selection, viewport and following', () => {
    const base = { clientId: 2, user: anna, selection: ['a'], viewport: null, following: null };
    expect(samePeers([base], [{ ...base }])).toBe(true);
    expect(samePeers([base], [])).toBe(false);
    expect(samePeers([base], [{ ...base, selection: ['b'] }])).toBe(false);
    expect(samePeers([base], [{ ...base, selection: ['a', 'b'] }])).toBe(false);
    expect(samePeers([base], [{ ...base, user: { ...anna, name: 'Ola' } }])).toBe(false);
    expect(samePeers([base], [{ ...base, user: { ...anna, color: '#000000' } }])).toBe(false);
    expect(samePeers([base], [{ ...base, following: 4 }])).toBe(false);
    expect(samePeers([base], [{ ...base, clientId: 3 }])).toBe(false);
    const view = { x: 0, y: 0, width: 10, height: 10 };
    expect(samePeers([{ ...base, viewport: view }], [{ ...base, viewport: { ...view } }])).toBe(
      true,
    );
    expect(
      samePeers([{ ...base, viewport: view }], [{ ...base, viewport: { ...view, width: 11 } }]),
    ).toBe(false);
    expect(samePeers([{ ...base, viewport: view }], [base])).toBe(false);
  });

  it('builds initials and a dash pattern per client', () => {
    expect(initialsOf('Anna Nowak')).toBe('AN');
    expect(initialsOf('  zofia ')).toBe('Z');
    expect(initialsOf('42 !!')).toBe('?');
    expect(initialsOf('')).toBe('?');
    expect(dashFor(0)).toBe('');
    expect(dashFor(1)).not.toBe('');
    expect(dashFor(-7)).toBe(dashFor(7));
  });
});

describe('PresenceStore', () => {
  it('announces the local user and starts without peers', () => {
    const awareness = createAwareness(new Y.Doc());
    const store = new PresenceStore(awareness, anna, false);
    expect(awareness.getLocalState()).toMatchObject({ user: anna, cursor: null, selection: [] });
    expect(store.peers()).toEqual([]);
    expect(store.localClientId).toBe(awareness.clientID);
    store.destroy();
    expect(awareness.getLocalState()).toBeNull();
  });

  it('shows a remote peer with its selection, viewport and who it follows', () => {
    const { mine, theirs } = connectedStores();
    theirs.setSelection(['n1', 'n2']);
    theirs.setViewport({ x: 0, y: 0, width: 800, height: 600 });
    theirs.setFollowing(mine.localClientId);
    const [peer] = mine.peers();
    expect(peer?.user).toEqual(bartek);
    expect(peer?.selection).toEqual(['n1', 'n2']);
    expect(peer?.viewport).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(peer?.following).toBe(mine.localClientId);
    expect(mine.peer(theirs.localClientId)?.user.name).toBe('Bartek');
    expect(mine.peer(12345)).toBeUndefined();
  });

  it('keeps the peers signal stable while only the cursor moves', () => {
    const { mine, theirs } = connectedStores();
    theirs.setSelection(['n1']);
    const before = mine.peers();
    theirs.setCursor({ x: 10, y: 20 });
    theirs.setCursor({ x: 30, y: 40 });
    expect(mine.peers()).toBe(before);
    let now = 0;
    for (let frame = 0; frame < 60 && mine.animating; frame += 1) {
      now += 16.7;
      mine.cursorPositions(now);
    }
    expect(mine.cursorPositions(now + 16.7).get(theirs.localClientId)).toEqual({ x: 30, y: 40 });
  });

  it('interpolates a remote cursor towards its newest position', () => {
    const { mine, theirs } = connectedStores();
    theirs.setCursor({ x: 0, y: 0 });
    mine.cursorPositions(0);
    theirs.setCursor({ x: 100, y: 0 });
    expect(mine.animating).toBe(true);
    const halfway = mine.cursorPositions(16).get(theirs.localClientId)?.x ?? 0;
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(100);
  });

  it('can switch reduced motion on and off', () => {
    const { mine, theirs } = connectedStores();
    mine.setReducedMotion(true);
    theirs.setCursor({ x: 0, y: 0 });
    theirs.setCursor({ x: 100, y: 0 });
    expect(mine.cursorPositions(0).get(theirs.localClientId)).toEqual({ x: 100, y: 0 });
    mine.setReducedMotion(false);
    theirs.setCursor({ x: 500, y: 0 });
    expect(mine.animating).toBe(true);
  });

  it('removes a peer and its cursor when its state goes away', () => {
    const { mine, theirs } = connectedStores();
    theirs.setCursor({ x: 5, y: 5 });
    expect(mine.peers()).toHaveLength(1);
    theirs.destroy();
    expect(mine.peers()).toEqual([]);
    expect(mine.cursorPositions(0).size).toBe(0);
  });

  it('tells watchers when peers or cursors changed and stops after they unsubscribe', () => {
    const { mine, theirs } = connectedStores();
    let calls = 0;
    const stop = mine.watchCursors(() => {
      calls += 1;
    });
    theirs.setCursor({ x: 1, y: 1 });
    expect(calls).toBeGreaterThan(0);
    const seen = calls;
    stop();
    theirs.setCursor({ x: 2, y: 2 });
    expect(calls).toBe(seen);
  });

  it('does not publish an unchanged cursor, selection, viewport or follow target', () => {
    const awareness = createAwareness(new Y.Doc());
    const store = new PresenceStore(awareness, anna, false);
    let updates = 0;
    awareness.on('update', () => {
      updates += 1;
    });
    store.setCursor(null);
    store.setSelection([]);
    store.setViewport(null);
    store.setFollowing(null);
    expect(updates).toBe(0);
    store.setCursor({ x: 1, y: 1 });
    store.setCursor({ x: 1, y: 1 });
    store.setSelection(['a']);
    store.setSelection(['a']);
    store.setViewport({ x: 0, y: 0, width: 1, height: 1 });
    store.setViewport({ x: 0, y: 0, width: 1, height: 1 });
    store.setFollowing(3);
    store.setFollowing(3);
    expect(updates).toBe(4);
    store.setUser({ name: 'Zofia', color: '#2f9e44' });
    expect(awareness.getLocalState()).toMatchObject({ user: { name: 'Zofia' } });
  });

  it('ignores local changes when deciding to refresh and survives destroy twice', () => {
    const { mine } = connectedStores();
    mine.setCursor({ x: 1, y: 1 });
    mine.destroy();
    mine.destroy();
    mine.setCursor({ x: 2, y: 2 });
  });
});
