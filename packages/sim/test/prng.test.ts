import { describe, expect, it } from 'vitest';
import { Prng, hashLabel } from '../src/prng';

function draw(prng: Prng, count: number): number[] {
  return Array.from({ length: count }, () => prng.nextUint32());
}

describe('Prng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(draw(Prng.fromSeed(42), 50)).toEqual(draw(Prng.fromSeed(42), 50));
  });

  it('produces different sequences for different seeds', () => {
    expect(draw(Prng.fromSeed(1), 20)).not.toEqual(draw(Prng.fromSeed(2), 20));
  });

  it('keeps numbers in the half open unit interval', () => {
    const prng = Prng.fromSeed(7);
    for (let index = 0; index < 5000; index += 1) {
      const value = prng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const prng = Prng.fromSeed(99);
    const buckets = new Array<number>(10).fill(0);
    const draws = 20_000;
    for (let index = 0; index < draws; index += 1) {
      const bucket = Math.floor(prng.next() * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 10 - 300);
      expect(count).toBeLessThan(draws / 10 + 300);
    }
  });

  it('draws integers below the limit and picks from lists', () => {
    const prng = Prng.fromSeed(3);
    const seen = new Set<number>();
    for (let index = 0; index < 500; index += 1) seen.add(prng.int(6));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(['a', 'b', 'c']).toContain(prng.pick(['a', 'b', 'c']));
    expect(() => prng.pick([])).toThrow(RangeError);
  });

  it('answers chance with the requested frequency', () => {
    const prng = Prng.fromSeed(5);
    let hits = 0;
    for (let index = 0; index < 10_000; index += 1) if (prng.chance(0.25)) hits += 1;
    expect(hits).toBeGreaterThan(2300);
    expect(hits).toBeLessThan(2700);
    expect(prng.chance(0)).toBe(false);
    expect(prng.chance(1)).toBe(true);
  });

  it('splits into streams that do not depend on how much the parent drew', () => {
    const fresh = Prng.fromSeed(11);
    const used = Prng.fromSeed(11);
    draw(used, 1000);
    expect(draw(fresh.split('link-1'), 20)).toEqual(draw(used.split('link-1'), 20));
  });

  it('splits into independent streams per label and per seed', () => {
    const parent = Prng.fromSeed(11);
    const first = draw(parent.split('a'), 200);
    const second = draw(parent.split('b'), 200);
    expect(first).not.toEqual(second);
    expect(draw(Prng.fromSeed(12).split('a'), 200)).not.toEqual(first);
    const shared = first.filter((value, index) => value === second[index]);
    expect(shared.length).toBeLessThan(3);
  });

  it('does not let a child disturb its parent', () => {
    const parent = Prng.fromSeed(8);
    const reference = Prng.fromSeed(8);
    draw(parent.split('child'), 100);
    expect(draw(parent, 10)).toEqual(draw(reference, 10));
  });

  it('exposes a random source and a stable label hash', () => {
    const prng = Prng.fromSeed(1);
    const source = prng.source();
    expect(source()).toBeLessThan(1);
    expect(hashLabel('abc')).toBe(hashLabel('abc'));
    expect(hashLabel('abc')).not.toBe(hashLabel('abd'));
  });
});
