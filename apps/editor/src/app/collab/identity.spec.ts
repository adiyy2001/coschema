import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/bench-scene';
import {
  IDENTITY_KEY,
  MAX_DISPLAY_NAME_LENGTH,
  createIdentity,
  loadIdentity,
  parseIdentity,
  renameIdentity,
  sanitizeName,
  saveIdentity,
  type KeyValueStorage,
} from './identity';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const throwingStorage: KeyValueStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('identity', () => {
  it('creates a named, coloured identity from the random source', () => {
    const identity = createIdentity(mulberry32(4));
    expect(identity.id).toMatch(/^[a-z0-9]{12}$/u);
    expect(identity.name).toMatch(/^[A-Z][a-z]+ \d{2}$/u);
    expect(identity.color).toMatch(/^#[0-9a-f]{6}$/u);
    expect(createIdentity(mulberry32(4))).toEqual(identity);
  });

  it('keeps the first identity in storage and returns it on the next load', () => {
    const storage = new MemoryStorage();
    const first = loadIdentity(storage, mulberry32(1));
    const second = loadIdentity(storage, mulberry32(2));
    expect(second).toEqual(first);
    expect(storage.values.has(IDENTITY_KEY)).toBe(true);
  });

  it('works without storage and when storage throws', () => {
    expect(loadIdentity(undefined, mulberry32(1)).name).not.toBe('');
    expect(loadIdentity(throwingStorage, mulberry32(1)).name).not.toBe('');
    expect(() => {
      saveIdentity(throwingStorage, createIdentity(mulberry32(1)));
    }).not.toThrow();
  });

  it('rejects malformed stored identities', () => {
    expect(parseIdentity(null)).toBeUndefined();
    expect(parseIdentity('not json')).toBeUndefined();
    expect(parseIdentity('null')).toBeUndefined();
    expect(parseIdentity('{"id":"","name":"A","color":"#aabbcc"}')).toBeUndefined();
    expect(parseIdentity('{"id":"x","name":"A","color":"red"}')).toBeUndefined();
    expect(parseIdentity('{"id":"x","name":"  ","color":"#aabbcc"}')).toBeUndefined();
    expect(parseIdentity('{"id":"x","name":"Ola","color":"#AABBCC"}')).toEqual({
      id: 'x',
      name: 'Ola',
      color: '#aabbcc',
    });
  });

  it('replaces a corrupt stored identity with a new one', () => {
    const storage = new MemoryStorage();
    storage.setItem(IDENTITY_KEY, '{"broken"');
    expect(loadIdentity(storage, mulberry32(3)).id).toMatch(/^[a-z0-9]{12}$/u);
  });

  it('collapses whitespace, trims and caps names', () => {
    expect(sanitizeName('  Anna   Nowak ')).toBe('Anna Nowak');
    expect(sanitizeName('x'.repeat(100))).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
  });

  it('renames an identity and ignores an empty name', () => {
    const identity = createIdentity(mulberry32(5));
    expect(renameIdentity(identity, ' Zofia ').name).toBe('Zofia');
    expect(renameIdentity(identity, '   ')).toBe(identity);
  });
});
