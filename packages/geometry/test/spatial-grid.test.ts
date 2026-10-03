import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src';
import { SpatialGrid, rectsIntersect, windowCellCount, windowsEqual } from '../src';

function linearScan(entries: ReadonlyMap<number, Rect>, area: Rect): number[] {
  return [...entries].filter(([, rect]) => rectsIntersect(rect, area)).map(([id]) => id);
}

const rectArbitrary = fc.record({
  x: fc.integer({ min: -3000, max: 3000 }),
  y: fc.integer({ min: -3000, max: 3000 }),
  width: fc.integer({ min: 0, max: 1500 }),
  height: fc.integer({ min: 0, max: 1500 }),
});

const operation = fc.oneof(
  fc.record({
    kind: fc.constant('insert' as const),
    id: fc.integer({ min: 0, max: 40 }),
    rect: rectArbitrary,
  }),
  fc.record({
    kind: fc.constant('move' as const),
    id: fc.integer({ min: 0, max: 40 }),
    rect: rectArbitrary,
  }),
  fc.record({ kind: fc.constant('remove' as const), id: fc.integer({ min: 0, max: 40 }) }),
);

describe('SpatialGrid', () => {
  it('rejects a cell size that is not a positive number', () => {
    expect(() => new SpatialGrid(0)).toThrow(RangeError);
    expect(() => new SpatialGrid(Number.NaN)).toThrow(RangeError);
    expect(() => new SpatialGrid(-5)).toThrow(RangeError);
  });

  it('rejects rectangles that are not finite or have a negative size', () => {
    const grid = new SpatialGrid<number>();
    expect(() => grid.insert(1, { x: Number.NaN, y: 0, width: 1, height: 1 })).toThrow(RangeError);
    expect(() => grid.insert(1, { x: 0, y: 0, width: -1, height: 1 })).toThrow(RangeError);
    grid.insert(1, { x: 0, y: 0, width: 1, height: 1 });
    expect(() => grid.move(1, { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 })).toThrow(
      RangeError,
    );
  });

  it('answers every query like a linear scan after random inserts, moves and removals', () => {
    fc.assert(
      fc.property(
        fc.array(operation, { maxLength: 80 }),
        fc.array(rectArbitrary, { minLength: 1, maxLength: 8 }),
        fc.constantFrom(64, 256, 512),
        (operations, queries, cellSize) => {
          const grid = new SpatialGrid<number>(cellSize);
          const reference = new Map<number, Rect>();
          for (const step of operations) {
            if (step.kind === 'insert') {
              grid.insert(step.id, step.rect);
              reference.set(step.id, step.rect);
            } else if (step.kind === 'move') {
              expect(grid.move(step.id, step.rect)).toBe(reference.has(step.id));
              if (reference.has(step.id)) reference.set(step.id, step.rect);
            } else {
              expect(grid.remove(step.id)).toBe(reference.delete(step.id));
            }
          }
          expect(grid.size).toBe(reference.size);
          for (const area of queries) {
            const fromGrid = grid.queryIds(area);
            expect([...fromGrid].sort((left, right) => left - right)).toEqual(
              linearScan(reference, area).sort((left, right) => left - right),
            );
            expect(new Set(fromGrid).size).toBe(fromGrid.length);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('returns results in the order the ids were first inserted', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert('c', { x: 0, y: 0, width: 10, height: 10 });
    grid.insert('a', { x: 20, y: 0, width: 10, height: 10 });
    grid.insert('b', { x: 400, y: 400, width: 10, height: 10 });
    grid.move('c', { x: 405, y: 405, width: 10, height: 10 });
    expect(grid.queryIds({ x: -10, y: -10, width: 1000, height: 1000 })).toEqual(['c', 'a', 'b']);
    expect(grid.all().map((entry) => entry.id)).toEqual(['c', 'a', 'b']);
  });

  it('counts a rectangle that touches the query as a hit, like the linear scan', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert('touching', { x: 100, y: 0, width: 10, height: 10 });
    expect(grid.queryIds({ x: 0, y: 0, width: 100, height: 10 })).toEqual(['touching']);
  });

  it('treats inserting a known id as a move', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert('a', { x: 0, y: 0, width: 10, height: 10 });
    grid.insert('a', { x: 900, y: 900, width: 10, height: 10 });
    expect(grid.size).toBe(1);
    expect(grid.queryIds({ x: 0, y: 0, width: 50, height: 50 })).toEqual([]);
    expect(grid.queryIds({ x: 890, y: 890, width: 50, height: 50 })).toEqual(['a']);
    expect(grid.has('a')).toBe(true);
    expect(grid.rectOf('a')).toEqual({ x: 900, y: 900, width: 10, height: 10 });
  });

  it('keeps the entry in place when a move stays inside the same cells', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert('a', { x: 10, y: 10, width: 10, height: 10 });
    grid.move('a', { x: 30, y: 30, width: 10, height: 10 });
    expect(grid.queryIds({ x: 30, y: 30, width: 1, height: 1 })).toEqual(['a']);
    expect(grid.queryIds({ x: 10, y: 10, width: 1, height: 1 })).toEqual([]);
  });

  it('spans entries over several cells without duplicating them', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert('wide', { x: 0, y: 0, width: 950, height: 950 });
    expect(grid.queryIds({ x: 0, y: 0, width: 2000, height: 2000 })).toEqual(['wide']);
    expect(grid.remove('wide')).toBe(true);
    expect(grid.remove('wide')).toBe(false);
    expect(grid.queryIds({ x: 0, y: 0, width: 2000, height: 2000 })).toEqual([]);
  });

  it('answers a huge query by looking only at the occupied cells', () => {
    const grid = new SpatialGrid<number>(512);
    for (let id = 0; id < 50; id += 1) {
      grid.insert(id, { x: id * 700, y: -id * 300, width: 100, height: 100 });
    }
    const everything = { x: -1e12, y: -1e12, width: 2e12, height: 2e12 };
    expect(grid.queryIds(everything)).toHaveLength(50);
  });

  it('finds negative coordinates and clears completely', () => {
    const grid = new SpatialGrid<string>(100);
    grid.insert('left', { x: -250, y: -250, width: 20, height: 20 });
    expect(grid.queryIds({ x: -300, y: -300, width: 100, height: 100 })).toEqual(['left']);
    grid.clear();
    expect(grid.size).toBe(0);
    expect(grid.queryIds({ x: -300, y: -300, width: 100, height: 100 })).toEqual([]);
  });

  describe('visible window', () => {
    const grid = new SpatialGrid<string>(512);

    it('covers the viewport plus one cell of margin by default', () => {
      const window = grid.visibleWindow({ x: 0, y: 0, width: 1000, height: 800 });
      expect(window).toEqual({ minColumn: -1, minRow: -1, maxColumn: 2, maxRow: 2 });
      expect(windowCellCount(window)).toBe(16);
    });

    it('stays equal while the pan stays inside the same cells', () => {
      const first = grid.visibleWindow({ x: 10, y: 10, width: 400, height: 300 });
      const second = grid.visibleWindow({ x: 100, y: 150, width: 400, height: 300 });
      expect(windowsEqual(first, second)).toBe(true);
    });

    it('changes when the pan crosses a cell border', () => {
      const first = grid.visibleWindow({ x: 10, y: 10, width: 400, height: 300 });
      const second = grid.visibleWindow({ x: 200, y: 10, width: 400, height: 300 });
      expect(windowsEqual(first, second)).toBe(false);
    });

    it('selects the entries of a window, a superset of the exact query', () => {
      const filled = new SpatialGrid<number>(512);
      const rects = new Map<number, Rect>();
      for (let id = 0; id < 200; id += 1) {
        const rect = { x: (id % 20) * 300, y: Math.floor(id / 20) * 300, width: 120, height: 64 };
        filled.insert(id, rect);
        rects.set(id, rect);
      }
      const viewport = { x: 1500, y: 600, width: 1920, height: 1080 };
      const window = filled.visibleWindow(viewport);
      const candidates = filled.queryWindow(window).map((entry) => entry.id);
      const exact = filled.queryIds(viewport);
      expect(exact.every((id) => candidates.includes(id))).toBe(true);
      expect(new Set(exact)).toEqual(new Set(linearScan(rects, viewport)));
    });
  });
});
