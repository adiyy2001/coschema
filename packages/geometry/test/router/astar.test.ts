import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Direction, Rect, Vec2 } from '../../src';
import {
  buildSparseGrid,
  findPath,
  rectInteriorContainsPoint,
  segmentCrossesInterior,
} from '../../src';
import { bendCount, crossedNodes, isOrthogonal } from '../helpers';

const SIZE = 8;
const STEPS: readonly Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

interface Problem {
  readonly obstacles: readonly Rect[];
  readonly start: Vec2;
  readonly end: Vec2;
  readonly startDirection: Direction | undefined;
  readonly endDirection: Direction | undefined;
  readonly bendPenalty: number;
}

function bruteForceCost(problem: Problem): number | undefined {
  const { start, end, bendPenalty } = problem;
  if (start[0] === end[0] && start[1] === end[1]) return 0;
  const width = SIZE + 1;
  const stateOf = (x: number, y: number, direction: number): number =>
    (y * width + x) * 4 + direction;
  const best = new Array<number>(width * width * 4).fill(Number.POSITIVE_INFINITY);
  const done = new Array<boolean>(width * width * 4).fill(false);
  for (const direction of [0, 1, 2, 3]) {
    if (problem.startDirection === undefined || problem.startDirection === direction) {
      best[stateOf(start[0], start[1], direction)] = 0;
    }
  }
  let result = Number.POSITIVE_INFINITY;
  for (;;) {
    let current = -1;
    for (let state = 0; state < best.length; state += 1) {
      const value = best[state] ?? Number.POSITIVE_INFINITY;
      const known = current < 0 ? Number.POSITIVE_INFINITY : (best[current] ?? 0);
      if (done[state] !== true && value < known) current = state;
    }
    if (current < 0) break;
    done[current] = true;
    const spent = best[current] ?? 0;
    const direction = current % 4;
    const cell = (current - direction) / 4;
    const x = cell % width;
    const y = (cell - x) / width;
    for (let next = 0; next < 4; next += 1) {
      if (next === (direction + 2) % 4) continue;
      const step = STEPS[next] ?? [0, 0];
      const nx = x + step[0];
      const ny = y + step[1];
      if (nx < 0 || ny < 0 || nx > SIZE || ny > SIZE) continue;
      if (problem.obstacles.some((item) => segmentCrossesInterior([x, y], [nx, ny], item)))
        continue;
      const total = spent + 1 + (next === direction ? 0 : bendPenalty);
      if (nx === end[0] && ny === end[1]) {
        const finished =
          total +
          (problem.endDirection === undefined || problem.endDirection === next ? 0 : bendPenalty);
        result = Math.min(result, finished);
        continue;
      }
      const state = stateOf(nx, ny, next);
      if (total < (best[state] ?? Number.POSITIVE_INFINITY)) best[state] = total;
    }
  }
  return Number.isFinite(result) ? result : undefined;
}

const EVERY_COORDINATE = Array.from({ length: SIZE + 1 }, (_, index) => index);

function sparseResult(problem: Problem, everyCoordinate = false): ReturnType<typeof findPath> {
  const grid = buildSparseGrid(
    everyCoordinate ? EVERY_COORDINATE : [0, SIZE, problem.start[0], problem.end[0]],
    everyCoordinate ? EVERY_COORDINATE : [0, SIZE, problem.start[1], problem.end[1]],
    problem.obstacles,
  );
  return findPath({ grid, ...problem });
}

function withoutDirections(candidate: Problem): Problem {
  return { ...candidate, startDirection: undefined, endDirection: undefined };
}

const coordinate = fc.integer({ min: 0, max: SIZE });
const direction = fc.option(fc.constantFrom<Direction>(0, 1, 2, 3), { nil: undefined });

const obstacle = fc
  .tuple(coordinate, coordinate, fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }))
  .map(([x, y, width, height]): Rect => ({
    x,
    y,
    width: Math.min(width, SIZE - x),
    height: Math.min(height, SIZE - y),
  }))
  .filter((item) => item.width > 0 && item.height > 0);

const problem = fc
  .record({
    obstacles: fc.array(obstacle, { maxLength: 6 }),
    start: fc.tuple(coordinate, coordinate),
    end: fc.tuple(coordinate, coordinate),
    startDirection: direction,
    endDirection: direction,
    bendPenalty: fc.integer({ min: 0, max: 6 }),
  })
  .filter(
    (candidate) =>
      !candidate.obstacles.some(
        (item) =>
          rectInteriorContainsPoint(item, candidate.start) ||
          rectInteriorContainsPoint(item, candidate.end),
      ),
  );

describe('findPath against a brute-force search on a uniform grid', () => {
  it('finds a path of the same cost, or none, when the directions are free', () => {
    fc.assert(
      fc.property(problem, (candidate) => {
        const free = withoutDirections(candidate);
        expect(sparseResult(free)?.cost).toBe(bruteForceCost(free));
      }),
      { numRuns: 500 },
    );
  });

  it('matches the brute-force cost with start and end directions on a full grid', () => {
    fc.assert(
      fc.property(problem, (candidate) => {
        expect(sparseResult(candidate, true)?.cost).toBe(bruteForceCost(candidate));
      }),
      { numRuns: 500 },
    );
  });

  it('never beats the brute-force cost with directions on a sparse grid', () => {
    fc.assert(
      fc.property(problem, (candidate) => {
        const expected = bruteForceCost(candidate);
        const actual = sparseResult(candidate)?.cost;
        expect(actual === undefined).toBe(expected === undefined);
        if (actual !== undefined && expected !== undefined) {
          expect(actual).toBeGreaterThanOrEqual(expected);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('returns orthogonal paths that avoid every obstacle interior', () => {
    fc.assert(
      fc.property(problem, (candidate) => {
        const actual = sparseResult(candidate);
        if (actual === undefined) return;
        expect(isOrthogonal(actual.points)).toBe(true);
        expect(crossedNodes(actual.points, candidate.obstacles)).toBe(0);
        expect(actual.points[0]).toEqual(candidate.start);
        expect(actual.points[actual.points.length - 1]).toEqual(candidate.end);
      }),
      { numRuns: 300 },
    );
  });
});

describe('findPath', () => {
  const open = (extra: readonly Rect[] = [], lines: readonly number[] = []) =>
    buildSparseGrid([0, 10, ...lines], [0, 10, ...lines], extra);

  it('returns a single point when start and end coincide', () => {
    const result = findPath({
      grid: open([], [4]),
      start: [4, 4],
      end: [4, 4],
      startDirection: undefined,
      endDirection: undefined,
      bendPenalty: 5,
    });
    expect(result).toEqual({ points: [[4, 4]], cost: 0 });
  });

  it('returns nothing when an endpoint is not on the grid', () => {
    const result = findPath({
      grid: open(),
      start: [3, 3],
      end: [10, 10],
      startDirection: undefined,
      endDirection: undefined,
      bendPenalty: 5,
    });
    expect(result).toBeUndefined();
  });

  it('prefers the path with fewer bends when lengths are equal', () => {
    const grid = buildSparseGrid([0, 10], [0, 10], []);
    const result = findPath({
      grid,
      start: [0, 0],
      end: [10, 10],
      startDirection: 0,
      endDirection: 1,
      bendPenalty: 10,
    });
    expect(result?.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(result?.cost).toBe(30);
    expect(bendCount(result?.points ?? [])).toBe(1);
  });

  it('pays the bend penalty at the start when the first move turns', () => {
    const result = findPath({
      grid: open(),
      start: [0, 0],
      end: [0, 10],
      startDirection: 0,
      endDirection: undefined,
      bendPenalty: 7,
    });
    expect(result?.cost).toBe(10 + 7);
  });

  it('goes around a wall', () => {
    const wall: Rect = { x: 4, y: 0, width: 2, height: 8 };
    const result = findPath({
      grid: open([wall], [4]),
      start: [0, 4],
      end: [10, 4],
      startDirection: undefined,
      endDirection: undefined,
      bendPenalty: 1,
    });
    expect(result?.cost).toBe(10 + 8 + 2);
    expect(crossedNodes(result?.points ?? [], [wall])).toBe(0);
  });

  it('runs along an obstacle edge without crossing it', () => {
    const block: Rect = { x: 2, y: 2, width: 4, height: 4 };
    const result = findPath({
      grid: open([block], [2]),
      start: [0, 2],
      end: [10, 2],
      startDirection: 0,
      endDirection: 0,
      bendPenalty: 3,
    });
    expect(result?.cost).toBe(10);
    expect(segmentCrossesInterior([0, 2], [10, 2], block)).toBe(false);
  });

  it('is deterministic', () => {
    const request = {
      grid: open([{ x: 3, y: 3, width: 3, height: 3 }]),
      start: [0, 0] as Vec2,
      end: [10, 10] as Vec2,
      startDirection: undefined,
      endDirection: undefined,
      bendPenalty: 0,
    };
    expect(findPath(request)).toEqual(findPath(request));
  });
});
