import type { LinkStats } from '@coschema/sim/link';
import { describe, expect, it } from 'vitest';
import { dropped, inFlight } from './link-stats';

function stats(patch: Partial<LinkStats>): LinkStats {
  return {
    sent: 0,
    delivered: 0,
    duplicated: 0,
    droppedByLoss: 0,
    droppedByPartition: 0,
    droppedByOffline: 0,
    droppedBecauseClosed: 0,
    connects: 0,
    ...patch,
  };
}

describe('link stats', () => {
  it('counts what was sent and has neither arrived nor been dropped', () => {
    expect(inFlight(stats({ sent: 10, delivered: 6, droppedByLoss: 1 }))).toBe(3);
  });

  it('counts a duplicate as another message on the way', () => {
    expect(inFlight(stats({ sent: 4, duplicated: 1, delivered: 3 }))).toBe(2);
  });

  it('never goes below zero', () => {
    expect(inFlight(stats({ sent: 1, delivered: 2 }))).toBe(0);
  });

  it('adds up every kind of drop', () => {
    expect(
      dropped(
        stats({
          droppedByLoss: 1,
          droppedByPartition: 2,
          droppedByOffline: 3,
          droppedBecauseClosed: 4,
        }),
      ),
    ).toBe(10);
  });
});
