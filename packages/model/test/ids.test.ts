import { describe, expect, it } from 'vitest';
import {
  BASE62_ALPHABET,
  ID_LENGTH,
  createId,
  cryptoRandom,
  digitAt,
  digitValue,
  isBase62,
} from '../src';
import { seededRandom } from './support';

describe('createId', () => {
  it('makes a 16 character base 62 id', () => {
    const id = createId(seededRandom(1));
    expect(id).toHaveLength(ID_LENGTH);
    expect(isBase62(id)).toBe(true);
  });

  it('is deterministic for one random source and differs between sources', () => {
    expect(createId(seededRandom(5))).toBe(createId(seededRandom(5)));
    expect(createId(seededRandom(5))).not.toBe(createId(seededRandom(6)));
  });

  it('makes distinct ids for 10000 draws', () => {
    const random = seededRandom(2);
    const ids = new Set(Array.from({ length: 10_000 }, () => createId(random)));
    expect(ids.size).toBe(10_000);
  });

  it('copes with sources that return the extremes', () => {
    expect(createId(() => 0)).toBe('0'.repeat(ID_LENGTH));
    expect(createId(() => 0.9999999999999999)).toBe('z'.repeat(ID_LENGTH));
    expect(createId(() => 1)).toBe('z'.repeat(ID_LENGTH));
  });
});

describe('base 62 helpers', () => {
  it('maps digits to values and back', () => {
    BASE62_ALPHABET.split('').forEach((digit, value) => {
      expect(digitValue(digit)).toBe(value);
      expect(digitAt(value)).toBe(digit);
    });
  });

  it('rejects values outside the alphabet', () => {
    expect(() => digitValue('-')).toThrow(RangeError);
    expect(() => digitAt(62)).toThrow(RangeError);
    expect(() => digitAt(-1)).toThrow(RangeError);
  });

  it('draws crypto randoms in the unit interval', () => {
    for (let draw = 0; draw < 100; draw += 1) {
      const value = cryptoRandom();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
