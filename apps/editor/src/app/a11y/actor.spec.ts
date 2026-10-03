import { describe, expect, it } from 'vitest';
import type { Peer } from '../presence/peers';
import { SEVERAL_ACTORS, UNKNOWN_ACTOR, actorName } from './actor';

function peer(clientId: number, name: string): Peer {
  return {
    clientId,
    user: { name, color: '#1c7ed6' },
    selection: [],
    viewport: null,
    following: null,
  };
}

describe('actorName', () => {
  const peers = [peer(1, 'Anna'), peer(2, 'Bartek'), peer(3, 'Celina')];

  it('uses the name of the person who wrote the update', () => {
    expect(actorName(peers, [2], 99)).toBe('Bartek');
  });

  it('names two authors and summarises more', () => {
    expect(actorName(peers, [1, 2], 99)).toBe('Anna and Bartek');
    expect(actorName(peers, [1, 2, 3], 99)).toBe(SEVERAL_ACTORS);
  });

  it('counts one person with two clients once', () => {
    expect(actorName([peer(1, 'Anna'), peer(2, 'Anna')], [1, 2], 99)).toBe('Anna');
  });

  it('says someone when the author has left', () => {
    expect(actorName(peers, [42], 99)).toBe(UNKNOWN_ACTOR);
    expect(actorName(peers, [1, 42], 99)).toBe(UNKNOWN_ACTOR);
  });

  it('ignores the own client id', () => {
    expect(actorName(peers, [99, 1], 99)).toBe('Anna');
  });

  it('falls back to the only other person for a change without an author, such as a deletion', () => {
    expect(actorName([peer(1, 'Anna')], [], 99)).toBe('Anna');
    expect(actorName(peers, [], 99)).toBe(UNKNOWN_ACTOR);
    expect(actorName([], [], 99)).toBe(UNKNOWN_ACTOR);
  });
});
