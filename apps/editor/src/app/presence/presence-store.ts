import { signal, type Signal } from '@angular/core';
import {
  createPresence,
  type NodeId,
  type PresenceCursor,
  type PresenceState,
  type PresenceUser,
  type PresenceViewport,
} from '@coschema/model';
import type { SyncClient } from '@coschema/sync';
import { CursorAnimator, type CursorPoint } from './cursor-animator';
import { readPeers, sameViewportRect, samePeers, type Peer } from './peers';

type AwarenessHandle = SyncClient['awareness'];

interface AwarenessChange {
  readonly added: readonly number[];
  readonly updated: readonly number[];
  readonly removed: readonly number[];
}

function sameCursor(left: PresenceCursor | null, right: PresenceCursor | null): boolean {
  if (left === null || right === null) return left === right;
  return left.x === right.x && left.y === right.y;
}

function sameSelection(left: readonly NodeId[], right: readonly NodeId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export class PresenceStore {
  private readonly peersSignal = signal<readonly Peer[]>([]);
  private readonly animator: CursorAnimator;
  private readonly frameWatchers = new Set<() => void>();
  private local: PresenceState;
  private disposed = false;

  constructor(
    private readonly awareness: AwarenessHandle,
    user: PresenceUser,
    reducedMotion: boolean,
  ) {
    this.animator = new CursorAnimator(undefined, reducedMotion);
    this.local = createPresence(user);
    awareness.setLocalState(this.local);
    awareness.on('change', this.onChange);
    this.refresh();
  }

  get peers(): Signal<readonly Peer[]> {
    return this.peersSignal.asReadonly();
  }

  get localClientId(): number {
    return this.awareness.clientID;
  }

  get animating(): boolean {
    return this.animator.active;
  }

  setReducedMotion(reduced: boolean): void {
    this.animator.setReducedMotion(reduced);
  }

  setUser(user: PresenceUser): void {
    this.publish({ ...this.local, user });
  }

  setCursor(cursor: PresenceCursor | null): void {
    if (sameCursor(this.local.cursor, cursor)) return;
    this.publish({ ...this.local, cursor });
  }

  setSelection(selection: readonly NodeId[]): void {
    if (sameSelection(this.local.selection, selection)) return;
    this.publish({ ...this.local, selection });
  }

  setViewport(viewport: PresenceViewport | null): void {
    if (sameViewportRect(this.local.viewport, viewport)) return;
    this.publish({ ...this.local, viewport });
  }

  setFollowing(following: number | null): void {
    if (this.local.following === following) return;
    this.publish({ ...this.local, following });
  }

  peer(clientId: number): Peer | undefined {
    return this.peersSignal().find((candidate) => candidate.clientId === clientId);
  }

  cursorPositions(now: number): ReadonlyMap<number, CursorPoint> {
    return this.animator.step(now);
  }

  watchCursors(listener: () => void): () => void {
    this.frameWatchers.add(listener);
    return () => {
      this.frameWatchers.delete(listener);
    };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.awareness.off('change', this.onChange);
    this.frameWatchers.clear();
    this.awareness.setLocalState(null);
  }

  private publish(next: PresenceState): void {
    this.local = next;
    if (!this.disposed) this.awareness.setLocalState(next);
  }

  private readonly onChange = (change: AwarenessChange): void => {
    const own = this.awareness.clientID;
    const remote = [...change.added, ...change.updated, ...change.removed].some((id) => id !== own);
    if (remote) this.refresh();
  };

  private refresh(): void {
    const snapshot = readPeers(this.awareness.getStates(), this.awareness.clientID);
    const known = new Set(snapshot.peers.map((peer) => peer.clientId));
    for (const [clientId, cursor] of snapshot.cursors) this.animator.setTarget(clientId, cursor);
    for (const peer of this.peersSignal())
      if (!known.has(peer.clientId)) this.animator.remove(peer.clientId);
    if (!samePeers(this.peersSignal(), snapshot.peers)) this.peersSignal.set(snapshot.peers);
    for (const listener of [...this.frameWatchers]) listener();
  }
}
