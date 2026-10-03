import {
  parsePresence,
  type NodeId,
  type PresenceCursor,
  type PresenceUser,
  type PresenceViewport,
} from '@coschema/model';

export interface Peer {
  readonly clientId: number;
  readonly user: PresenceUser;
  readonly selection: readonly NodeId[];
  readonly viewport: PresenceViewport | null;
  readonly following: number | null;
}

export interface PeerSnapshot {
  readonly peers: readonly Peer[];
  readonly cursors: ReadonlyMap<number, PresenceCursor | null>;
}

export function readPeers(
  states: ReadonlyMap<number, unknown>,
  localClientId: number,
): PeerSnapshot {
  const peers: Peer[] = [];
  const cursors = new Map<number, PresenceCursor | null>();
  for (const [clientId, raw] of states) {
    if (clientId === localClientId) continue;
    const state = parsePresence(raw);
    if (state === undefined) continue;
    peers.push({
      clientId,
      user: state.user,
      selection: state.selection,
      viewport: state.viewport,
      following: state.following,
    });
    cursors.set(clientId, state.cursor);
  }
  peers.sort((left, right) => left.clientId - right.clientId);
  return { peers, cursors };
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function sameViewportRect(
  left: PresenceViewport | null,
  right: PresenceViewport | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function samePeer(left: Peer, right: Peer): boolean {
  return (
    left.clientId === right.clientId &&
    left.user.name === right.user.name &&
    left.user.color === right.user.color &&
    left.following === right.following &&
    sameList(left.selection, right.selection) &&
    sameViewportRect(left.viewport, right.viewport)
  );
}

export function samePeers(left: readonly Peer[], right: readonly Peer[]): boolean {
  return (
    left.length === right.length &&
    left.every((peer, index) => {
      const other = right[index];
      return other !== undefined && samePeer(peer, other);
    })
  );
}

export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => /\p{L}/u.test(word));
  const letters = words.slice(0, 2).map((word) => String.fromCodePoint(word.codePointAt(0) ?? 63));
  return letters.join('').toUpperCase() || '?';
}

const DASH_PATTERNS: readonly string[] = ['', '6 3', '2 3', '10 3 2 3', '1 4', '12 4'];

export function dashFor(clientId: number): string {
  return DASH_PATTERNS[Math.abs(clientId) % DASH_PATTERNS.length] ?? '';
}
