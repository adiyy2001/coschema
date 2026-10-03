import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  InvalidOrderKeyError,
  RANDOM_SUFFIX_LENGTH,
  after,
  before,
  between,
  compareOrderKeys,
  first,
  isValidOrderKey,
  sequenceAfter,
  BASE62_ALPHABET,
} from '../src';
import { seededRandom } from './support';

const keyArbitrary = fc
  .array(fc.constantFrom(...BASE62_ALPHABET.split('')), { minLength: 1, maxLength: 12 })
  .map((digits) => digits.join(''))
  .filter(isValidOrderKey);

const orderedPair = fc
  .tuple(keyArbitrary, keyArbitrary)
  .filter(([left, right]) => left !== right)
  .map(([left, right]): [string, string] => (left < right ? [left, right] : [right, left]));

describe('fractional index keys', () => {
  it('accepts keys over the alphabet that do not end in the lowest digit', () => {
    expect(isValidOrderKey('1')).toBe(true);
    expect(isValidOrderKey('0V')).toBe(true);
    expect(isValidOrderKey('zz')).toBe(true);
  });

  it('rejects empty keys, foreign characters and a trailing lowest digit', () => {
    expect(isValidOrderKey('')).toBe(false);
    expect(isValidOrderKey('a0')).toBe(false);
    expect(isValidOrderKey('0')).toBe(false);
    expect(isValidOrderKey('a-b')).toBe(false);
    expect(isValidOrderKey('é')).toBe(false);
  });

  it('compares like plain strings', () => {
    expect(compareOrderKeys('a', 'b')).toBe(-1);
    expect(compareOrderKeys('b', 'a')).toBe(1);
    expect(compareOrderKeys('a', 'a')).toBe(0);
    expect(compareOrderKeys('Z', 'a')).toBe(-1);
    expect(compareOrderKeys('9', 'A')).toBe(-1);
  });
});

describe('between', () => {
  it('stays strictly inside random bounds', () => {
    fc.assert(
      fc.property(orderedPair, fc.integer(), ([lower, upper], seed) => {
        const key = between(lower, upper, seededRandom(seed));
        expect(key > lower).toBe(true);
        expect(key < upper).toBe(true);
        expect(isValidOrderKey(key)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('stays below an upper bound alone and above a lower bound alone', () => {
    fc.assert(
      fc.property(keyArbitrary, fc.integer(), (bound, seed) => {
        const random = seededRandom(seed);
        const lowerKey = before(bound, random);
        const upperKey = after(bound, random);
        expect(lowerKey < bound).toBe(true);
        expect(upperKey > bound).toBe(true);
        expect(isValidOrderKey(lowerKey)).toBe(true);
        expect(isValidOrderKey(upperKey)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it('handles bounds that are prefixes of each other', () => {
    const random = seededRandom(7);
    for (const [lower, upper] of [
      ['a', 'a1'],
      ['a', 'a11'],
      ['a1', 'a2'],
      ['zz', 'zzz1'],
      ['1', '11'],
      ['0V', '1'],
    ] as const) {
      const key = between(lower, upper, random);
      expect(key > lower && key < upper).toBe(true);
      expect(isValidOrderKey(key)).toBe(true);
    }
  });

  it('puts a key before the smallest key and after the largest keys', () => {
    const random = seededRandom(1);
    expect(before('1', random) < '1').toBe(true);
    expect(after('zzzz', random) > 'zzzz').toBe(true);
    expect(after('z', random) > 'z').toBe(true);
    expect(first(random).length).toBe(1 + RANDOM_SUFFIX_LENGTH);
  });

  it('keeps the order of a random insert sequence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 1, maxLength: 80 }),
        fc.integer(),
        (positions, seed) => {
          const random = seededRandom(seed);
          const intended: string[] = [];
          for (const position of positions) {
            const index = position % (intended.length + 1);
            const key = between(intended[index - 1], intended[index], random);
            intended.splice(index, 0, key);
          }
          const sorted = [...intended].sort(compareOrderKeys);
          expect(sorted).toEqual(intended);
          expect(new Set(intended).size).toBe(intended.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never collides when two sources insert into the same gap', () => {
    fc.assert(
      fc.property(orderedPair, fc.integer(), fc.integer(), ([lower, upper], seedA, seedB) => {
        fc.pre(seedA !== seedB);
        const keyA = between(lower, upper, seededRandom(seedA));
        const keyB = between(lower, upper, seededRandom(seedB));
        expect(keyA).not.toBe(keyB);
      }),
      { numRuns: 2000 },
    );
  });

  it('is deterministic for one random source', () => {
    fc.assert(
      fc.property(orderedPair, fc.integer(), ([lower, upper], seed) => {
        expect(between(lower, upper, seededRandom(seed))).toBe(
          between(lower, upper, seededRandom(seed)),
        );
      }),
    );
  });

  it('never produces a key that ends in the lowest digit, even from a constant source', () => {
    for (const constant of [0, 0.5, 0.999999999]) {
      const key = between('a', 'b', () => constant);
      expect(isValidOrderKey(key)).toBe(true);
    }
  });

  it('throws for invalid or misordered bounds', () => {
    const random = seededRandom(1);
    expect(() => between('b', 'a', random)).toThrow(InvalidOrderKeyError);
    expect(() => between('a', 'a', random)).toThrow(InvalidOrderKeyError);
    expect(() => between('', undefined, random)).toThrow(InvalidOrderKeyError);
    expect(() => between(undefined, 'a0', random)).toThrow(InvalidOrderKeyError);
    expect(() => between('a-', undefined, random)).toThrow(InvalidOrderKeyError);
  });
});

describe('key growth', () => {
  const INSERTS = 1000;
  const MAX_KEY_LENGTH_AFTER_1000_INSERTS = 64;

  function longest(keys: readonly string[]): number {
    return Math.max(...keys.map((key) => key.length));
  }

  it('bounds the key length for 1000 inserts after the last key', () => {
    const keys = sequenceAfter(undefined, INSERTS, seededRandom(3));
    expect([...keys].sort(compareOrderKeys)).toEqual(keys);
    expect(longest(keys)).toBeLessThan(MAX_KEY_LENGTH_AFTER_1000_INSERTS);
  });

  it('bounds the key length for 1000 inserts into one shrinking gap', () => {
    const random = seededRandom(4);
    const lower = '1';
    let upper = 'z';
    const keys: string[] = [];
    for (let count = 0; count < INSERTS; count += 1) {
      upper = between(lower, upper, random);
      keys.push(upper);
    }
    expect(keys.every((key, index) => index === 0 || key < (keys[index - 1] ?? ''))).toBe(true);
    expect(longest(keys)).toBeLessThan(MAX_KEY_LENGTH_AFTER_1000_INSERTS);
  });

  it('bounds the key length for 1000 inserts before the first key', () => {
    const random = seededRandom(5);
    let current = first(random);
    const keys = [current];
    for (let count = 1; count < INSERTS; count += 1) {
      current = before(current, random);
      keys.push(current);
    }
    expect(longest(keys)).toBeLessThan(MAX_KEY_LENGTH_AFTER_1000_INSERTS);
  });
});

describe('key growth under alternating inserts', () => {
  it('stays bounded when every insert goes between the two newest keys', () => {
    const random = seededRandom(9);
    let lower = '1';
    let upper = 'z';
    let longest = 0;
    for (let count = 0; count < 1000; count += 1) {
      const key = between(lower, upper, random);
      if (count % 2 === 0) lower = key;
      else upper = key;
      longest = Math.max(longest, key.length);
    }
    expect(longest).toBeLessThan(600);
  });
});
