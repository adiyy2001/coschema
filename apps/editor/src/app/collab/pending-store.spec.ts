import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './identity';
import { pendingKey, readPending, restorePending, writePending } from './pending-store';

function memoryStorage(): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('pending store', () => {
  it('keeps one count per room', () => {
    const storage = memoryStorage();
    writePending(storage, 'alpha', 3);
    writePending(storage, 'beta', 0);
    expect(readPending(storage, 'alpha')).toBe(3);
    expect(readPending(storage, 'beta')).toBe(0);
    expect(readPending(storage, 'gamma')).toBeUndefined();
    expect(pendingKey('alpha')).not.toBe(pendingKey('beta'));
  });

  it('ignores values that are not whole non-negative numbers', () => {
    const storage = memoryStorage();
    for (const bad of ['-1', '1.5', 'abc', '']) {
      storage.values.set(pendingKey('r'), bad);
      expect(readPending(storage, 'r')).toBeUndefined();
    }
  });

  it('survives storage that throws or is missing', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readPending(broken, 'r')).toBeUndefined();
    expect(() => {
      writePending(broken, 'r', 1);
    }).not.toThrow();
    expect(readPending(undefined, 'r')).toBeUndefined();
    expect(() => {
      writePending(undefined, 'r', 1);
    }).not.toThrow();
  });

  it('restores the stored count and falls back to the content of the document', () => {
    const empty = new Y.Doc();
    expect(restorePending(empty, 4)).toBe(4);
    expect(restorePending(empty, 0)).toBe(0);
    expect(restorePending(empty, undefined)).toBe(0);
    const filled = new Y.Doc();
    filled.getMap('m').set('a', 1);
    expect(restorePending(filled, undefined)).toBe(1);
    expect(restorePending(filled, 0)).toBe(0);
  });
});
