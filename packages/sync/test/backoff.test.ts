import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF, backoffCeiling, backoffDelay } from '../src';

describe('backoff', () => {
  it('doubles the ceiling and stops at the maximum', () => {
    const ceilings = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((attempt) =>
      backoffCeiling(attempt, DEFAULT_BACKOFF),
    );
    expect(ceilings).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
  });

  it('treats a negative attempt as the first one', () => {
    expect(backoffCeiling(-3, DEFAULT_BACKOFF)).toBe(500);
  });

  it('keeps the delay between the jittered floor and the ceiling', () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ceiling = backoffCeiling(attempt, DEFAULT_BACKOFF);
      expect(backoffDelay(attempt, DEFAULT_BACKOFF, () => 0)).toBe(ceiling);
      const lowest = backoffDelay(attempt, DEFAULT_BACKOFF, () => 0.999999);
      expect(lowest).toBeGreaterThanOrEqual(Math.floor(ceiling * 0.5));
      expect(lowest).toBeLessThanOrEqual(ceiling);
    }
  });

  it('is deterministic for a given random source', () => {
    expect(backoffDelay(3, DEFAULT_BACKOFF, () => 0.25)).toBe(
      backoffDelay(3, DEFAULT_BACKOFF, () => 0.25),
    );
  });
});
