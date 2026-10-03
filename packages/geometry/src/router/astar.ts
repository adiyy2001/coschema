import type { Vec2 } from '../vec';
import { MinHeap } from './heap';
import type { Direction } from './ports';
import { oppositeDirection } from './ports';
import { lineIndex, type SparseGrid } from './sparse-grid';
import { at } from './typed';

export interface PathRequest {
  readonly grid: SparseGrid;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly startDirection: Direction | undefined;
  readonly endDirection: Direction | undefined;
  readonly bendPenalty: number;
}

export interface PathResult {
  readonly points: readonly Vec2[];
  readonly cost: number;
}

const DIRECTIONS: readonly Direction[] = [0, 1, 2, 3];
const NO_PARENT = -1;

function neighbour(grid: SparseGrid, node: number, direction: Direction): number {
  const column = node % grid.columns;
  const row = (node - column) / grid.columns;
  switch (direction) {
    case 0:
      return column < grid.columns - 1 && grid.blockedRight[node] === 0 ? node + 1 : NO_PARENT;
    case 2:
      return column > 0 && grid.blockedRight[node - 1] === 0 ? node - 1 : NO_PARENT;
    case 1:
      return row < grid.rows - 1 && grid.blockedDown[node] === 0 ? node + grid.columns : NO_PARENT;
    case 3:
      return row > 0 && grid.blockedDown[node - grid.columns] === 0
        ? node - grid.columns
        : NO_PARENT;
  }
}

function pointOf(grid: SparseGrid, node: number): Vec2 {
  const column = node % grid.columns;
  const row = (node - column) / grid.columns;
  return [at(grid.xs, column), at(grid.ys, row)];
}

export function findPath(request: PathRequest): PathResult | undefined {
  const { grid, start, end, startDirection, endDirection, bendPenalty } = request;
  const startColumn = lineIndex(grid.xs, start[0]);
  const startRow = lineIndex(grid.ys, start[1]);
  const endColumn = lineIndex(grid.xs, end[0]);
  const endRow = lineIndex(grid.ys, end[1]);
  if (startColumn < 0 || startRow < 0 || endColumn < 0 || endRow < 0) return undefined;
  const startNode = startRow * grid.columns + startColumn;
  const goalNode = endRow * grid.columns + endColumn;
  if (startNode === goalNode) return { points: [start], cost: 0 };

  const stateCount = grid.columns * grid.rows * 4;
  const cost = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(stateCount).fill(NO_PARENT);
  const closed = new Uint8Array(stateCount);
  const heap = new MinHeap();
  const heuristic = (node: number): number => {
    const column = node % grid.columns;
    const row = (node - column) / grid.columns;
    return Math.abs(at(grid.xs, column) - end[0]) + Math.abs(at(grid.ys, row) - end[1]);
  };
  const terminalPenalty = (direction: Direction): number =>
    endDirection === undefined || endDirection === direction ? 0 : bendPenalty;

  for (const direction of DIRECTIONS) {
    if (startDirection !== undefined && startDirection !== direction) continue;
    const state = startNode * 4 + direction;
    cost[state] = 0;
    heap.push(heuristic(startNode), state);
  }

  let bestTotal = Number.POSITIVE_INFINITY;
  let bestState = NO_PARENT;
  while (heap.size > 0) {
    if (heap.peekPriority() >= bestTotal) break;
    const state = heap.pop();
    if (state === undefined) break;
    if (closed[state] === 1) continue;
    closed[state] = 1;
    const node = state >> 2;
    const direction = (state & 3) as Direction;
    const spent = at(cost, state);
    const here = pointOf(grid, node);
    for (const next of DIRECTIONS) {
      if (next === oppositeDirection(direction)) continue;
      const target = neighbour(grid, node, next);
      if (target === NO_PARENT) continue;
      const there = pointOf(grid, target);
      const length = Math.abs(there[0] - here[0]) + Math.abs(there[1] - here[1]);
      const total = spent + length + (next === direction ? 0 : bendPenalty);
      const nextState = target * 4 + next;
      if (total >= at(cost, nextState)) continue;
      cost[nextState] = total;
      parent[nextState] = state;
      if (target === goalNode) {
        const finished = total + terminalPenalty(next);
        if (finished < bestTotal) {
          bestTotal = finished;
          bestState = nextState;
        }
      } else {
        heap.push(total + heuristic(target), nextState);
      }
    }
  }
  if (bestState === NO_PARENT) return undefined;

  const reversed: Vec2[] = [];
  for (let state = bestState; state !== NO_PARENT; state = at(parent, state)) {
    reversed.push(pointOf(grid, state >> 2));
  }
  return { points: reversed.reverse(), cost: bestTotal };
}
