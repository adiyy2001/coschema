import type { Rect, Vec2 } from '../src';
import { SpatialGrid, segmentCrossesInterior } from '../src';

export interface Scene {
  readonly grid: SpatialGrid<string>;
  readonly nodes: ReadonlyMap<string, Rect>;
}

export function sceneOf(nodes: Readonly<Record<string, Rect>>): Scene {
  const grid = new SpatialGrid<string>(128);
  for (const [id, rect] of Object.entries(nodes)) grid.insert(id, rect);
  return { grid, nodes: new Map(Object.entries(nodes)) };
}

export function nodeRect(x: number, y: number, width = 120, height = 64): Rect {
  return { x, y, width, height };
}

export function isOrthogonal(points: readonly Vec2[]): boolean {
  return points.every((point, index) => {
    const previous = points[index - 1];
    return previous === undefined || previous[0] === point[0] || previous[1] === point[1];
  });
}

export function crossedNodes(points: readonly Vec2[], rects: Iterable<Rect>): number {
  const all = [...rects];
  let crossings = 0;
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous === undefined) return;
    for (const rect of all) {
      if (segmentCrossesInterior(previous, point, rect)) crossings += 1;
    }
  });
  return crossings;
}

export function bendCount(points: readonly Vec2[]): number {
  return Math.max(0, points.length - 2);
}

export function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
