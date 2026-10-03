import type { Peer } from '../presence/peers';

export const UNKNOWN_ACTOR = 'Someone';
export const SEVERAL_ACTORS = 'Several people';

function namesOf(peers: readonly Peer[], clientIds: readonly number[]): string[] | undefined {
  const names: string[] = [];
  for (const clientId of clientIds) {
    const peer = peers.find((candidate) => candidate.clientId === clientId);
    if (peer === undefined) return undefined;
    if (!names.includes(peer.user.name)) names.push(peer.user.name);
  }
  return names;
}

export function actorName(
  peers: readonly Peer[],
  authors: readonly number[],
  ownClientId: number,
): string {
  const others = authors.filter((clientId) => clientId !== ownClientId);
  if (others.length > 0) {
    const names = namesOf(peers, others);
    if (names === undefined) return UNKNOWN_ACTOR;
    if (names.length <= 2) return names.join(' and ');
    return SEVERAL_ACTORS;
  }
  const [only] = peers;
  return peers.length === 1 && only !== undefined ? only.user.name : UNKNOWN_ACTOR;
}
