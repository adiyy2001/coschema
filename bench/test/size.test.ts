import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../apps/server/src/persistence/memory-store';
import { measureSize } from '../size/measure';
import { DEFAULT_SIZE_OPTIONS, parseSizeOptions } from '../size/options';
import { recordSession } from '../size/session';

describe('recordSession', () => {
  it('records the same updates for the same seed', () => {
    const first = recordSession(40, 3);
    const second = recordSession(40, 3);
    expect(first.updates.length).toBe(second.updates.length);
    expect(first.nodes).toBe(second.nodes);
    expect(first.edges).toBeGreaterThan(0);
  });

  it('records many more updates than nodes because of drags and typing', () => {
    const session = recordSession(60, 5);
    expect(session.updates.length).toBeGreaterThan(session.nodes * 2);
  });
});

describe('measureSize', () => {
  it('compacts the log into one snapshot that loads to the same graph', async () => {
    const result = await measureSize(new MemoryStore(), 50, 9);
    expect(result.before.rows).toBe(result.updates);
    expect(result.after.rows).toBe(1);
    expect(result.after.bytes).toBeLessThan(result.before.bytes);
    expect(result.loadedNodes).toBe(result.nodes);
    expect(result.after.bytes).toBe(result.encodedStateBytes);
  });
});

describe('parseSizeOptions', () => {
  it('uses the defaults and reads overrides', () => {
    expect(parseSizeOptions([])).toEqual(DEFAULT_SIZE_OPTIONS);
    expect(
      parseSizeOptions(['--sizes', '10,20', '--seed', '4', '--store', 'memory', '--output', 'tmp']),
    ).toEqual({ sizes: [10, 20], seed: 4, store: 'memory', output: 'tmp' });
  });

  it('rejects an unknown store and a bad size', () => {
    expect(() => parseSizeOptions(['--store', 'redis'])).toThrow('postgres or memory');
    expect(() => parseSizeOptions(['--sizes', '0'])).toThrow('positive integer');
  });
});
