import { describe, expect, it } from 'vitest';
import { MinHeap } from '../../src/router/heap';
import {
  DIRECTION_VECTORS,
  EAST,
  NORTH,
  SOUTH,
  WEST,
  isHorizontal,
  oppositeDirection,
  portDirection,
  portPoint,
  stubPoint,
} from '../../src/router/ports';
import { simplifyPath } from '../../src';
import { buildSparseGrid, lineIndex, nodeIndex } from '../../src/router/sparse-grid';
import { clipRect, relaxObstacles } from '../../src/router/obstacles';
import { fingerprintEntries } from '../../src/router/fingerprint';

describe('MinHeap', () => {
  it('pops in priority order and breaks ties by insertion order', () => {
    const heap = new MinHeap();
    heap.push(5, 50);
    heap.push(1, 10);
    heap.push(3, 30);
    heap.push(1, 11);
    heap.push(1, 12);
    expect(heap.size).toBe(5);
    expect(heap.peekPriority()).toBe(1);
    const order: number[] = [];
    for (let value = heap.pop(); value !== undefined; value = heap.pop()) order.push(value);
    expect(order).toEqual([10, 11, 12, 30, 50]);
    expect(heap.peekPriority()).toBe(Number.POSITIVE_INFINITY);
    expect(heap.pop()).toBeUndefined();
  });

  it('sorts a long random sequence', () => {
    const heap = new MinHeap();
    const values = Array.from({ length: 500 }, (_, index) => (index * 7919) % 503);
    values.forEach((value) => heap.push(value, value));
    const popped: number[] = [];
    for (let value = heap.pop(); value !== undefined; value = heap.pop()) popped.push(value);
    expect(popped).toEqual([...values].sort((left, right) => left - right));
  });
});

describe('ports', () => {
  it('maps ports to directions and anchors', () => {
    const box = { x: 100, y: 200, width: 80, height: 40 };
    expect(portDirection('n')).toBe(NORTH);
    expect(portDirection('e')).toBe(EAST);
    expect(portDirection('s')).toBe(SOUTH);
    expect(portDirection('w')).toBe(WEST);
    expect(portDirection('ne')).toBe(EAST);
    expect(portDirection('sw')).toBe(WEST);
    expect(portDirection('nonsense')).toBe(EAST);
    expect(portPoint(box, 'n')).toEqual([140, 200]);
    expect(portPoint(box, 'e')).toEqual([180, 220]);
    expect(portPoint(box, 's')).toEqual([140, 240]);
    expect(portPoint(box, 'w')).toEqual([100, 220]);
    expect(portPoint(box, 'ne')).toEqual([180, 200]);
    expect(portPoint(box, 'se')).toEqual([180, 240]);
    expect(portPoint(box, 'sw')).toEqual([100, 240]);
    expect(portPoint(box, 'nw')).toEqual([100, 200]);
    expect(portPoint(box, 'nonsense')).toEqual([180, 220]);
  });

  it('computes stubs and opposites', () => {
    expect(stubPoint([10, 10], NORTH, 12)).toEqual([10, -2]);
    expect(stubPoint([10, 10], WEST, 12)).toEqual([-2, 10]);
    expect(oppositeDirection(EAST)).toBe(WEST);
    expect(oppositeDirection(NORTH)).toBe(SOUTH);
    expect(isHorizontal(EAST)).toBe(true);
    expect(isHorizontal(SOUTH)).toBe(false);
    expect(DIRECTION_VECTORS).toHaveLength(4);
  });
});

describe('simplifyPath', () => {
  it('drops duplicates and collinear points', () => {
    expect(
      simplifyPath([
        [0, 0],
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 5],
        [10, 10],
        [20, 10],
      ]),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]);
  });

  it('handles short input', () => {
    expect(simplifyPath([])).toEqual([]);
    expect(simplifyPath([[1, 1]])).toEqual([[1, 1]]);
  });
});

describe('sparse grid', () => {
  it('has a line for every distinct obstacle edge and extra coordinate', () => {
    const grid = buildSparseGrid([0, 100, 50], [0, 100], [{ x: 20, y: 20, width: 30, height: 30 }]);
    expect([...grid.xs]).toEqual([0, 20, 50, 100]);
    expect([...grid.ys]).toEqual([0, 20, 50, 100]);
    expect(lineIndex(grid.xs, 50)).toBe(2);
    expect(lineIndex(grid.xs, 51)).toBe(-1);
    expect(nodeIndex(grid, 2, 1)).toBe(6);
  });

  it('blocks segments through the interior and not along the boundary', () => {
    const grid = buildSparseGrid([0, 100], [0, 100], [{ x: 20, y: 20, width: 60, height: 60 }]);
    const at = (column: number, row: number): number => nodeIndex(grid, column, row);
    expect(grid.blockedRight[at(0, 1)]).toBe(0);
    expect(grid.blockedRight[at(1, 1)]).toBe(0);
    expect(grid.blockedDown[at(1, 1)]).toBe(0);
    expect(grid.blockedRight[at(1, 0)]).toBe(0);
  });

  it('blocks the segments inside a wide obstacle', () => {
    const grid = buildSparseGrid(
      [0, 100, 50],
      [0, 100, 50],
      [{ x: 20, y: 20, width: 60, height: 60 }],
    );
    const at = (column: number, row: number): number => nodeIndex(grid, column, row);
    expect(grid.blockedRight[at(1, 2)]).toBe(1);
    expect(grid.blockedRight[at(2, 2)]).toBe(1);
    expect(grid.blockedDown[at(2, 1)]).toBe(1);
    expect(grid.blockedDown[at(2, 2)]).toBe(1);
    expect(grid.blockedRight[at(1, 1)]).toBe(0);
  });

  it('blocks the boundary line where an obstacle was cut off by the window', () => {
    const grid = buildSparseGrid(
      [0, 100],
      [0, 100],
      [{ x: 20, y: 20, width: 20, height: 80, clippedBottom: true }],
    );
    const bottomRow = grid.rows - 1;
    expect(grid.blockedRight[nodeIndex(grid, 1, bottomRow)]).toBe(1);
    const left = buildSparseGrid(
      [0, 100],
      [0, 100],
      [{ x: 0, y: 20, width: 20, height: 20, clippedLeft: true, clippedRight: true }],
    );
    expect(left.blockedDown[nodeIndex(left, 0, 1)]).toBe(1);
    expect(left.blockedDown[nodeIndex(left, left.columns - 1, 1)]).toBe(0);
  });
});

describe('obstacles', () => {
  it('clips to a window and remembers which sides were cut', () => {
    const window = { x: 0, y: 0, width: 100, height: 100 };
    expect(clipRect({ x: 200, y: 200, width: 10, height: 10 }, window)).toBeUndefined();
    expect(clipRect({ x: 100, y: 0, width: 10, height: 10 }, window)).toBeUndefined();
    expect(clipRect({ x: -50, y: 20, width: 200, height: 30 }, window)).toEqual({
      x: 0,
      y: 20,
      width: 100,
      height: 30,
      clippedLeft: true,
      clippedTop: false,
      clippedRight: true,
      clippedBottom: false,
    });
  });

  it('inflates, relaxes where a pin sits in the margin and refuses a pin inside', () => {
    const wall = { x: 100, y: 0, width: 20, height: 50 };
    expect(relaxObstacles([wall], 12, [[0, 0]])).toEqual([
      { x: 88, y: -12, width: 44, height: 74 },
    ]);
    expect(relaxObstacles([wall], 12, [[95, 25]])).toEqual([wall]);
    expect(relaxObstacles([wall], 12, [[110, 25]])).toBeUndefined();
  });
});

describe('fingerprintEntries', () => {
  const entry = (id: string, x: number) => ({ id, rect: { x, y: 0, width: 10, height: 10 } });

  it('does not depend on the order of the entries', () => {
    expect(fingerprintEntries([entry('a', 1), entry('b', 2)])).toBe(
      fingerprintEntries([entry('b', 2), entry('a', 1)]),
    );
  });

  it('changes when an id or a coordinate changes', () => {
    const base = fingerprintEntries([entry('a', 1)]);
    expect(fingerprintEntries([entry('a', 2)])).not.toBe(base);
    expect(fingerprintEntries([entry('b', 1)])).not.toBe(base);
    expect(fingerprintEntries([])).not.toBe(base);
  });
});
