import type { Rect } from './rect';
import { boundsOfRects, rectBottom, rectRight } from './rect';
import type { Vec2 } from './vec';

export const DEFAULT_GRID_SIZE = 8;
export const DEFAULT_SNAP_THRESHOLD = 6;

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return normalizeZero(Math.round(value / gridSize) * gridSize);
}

export function snapPointToGrid(point: Vec2, gridSize: number): Vec2 {
  return [snapToGrid(point[0], gridSize), snapToGrid(point[1], gridSize)];
}

export function snapWithinThreshold(value: number, gridSize: number, threshold: number): number {
  const snapped = snapToGrid(value, gridSize);
  return Math.abs(snapped - value) <= threshold ? snapped : value;
}

export function snapMovementToGrid(
  selection: readonly Rect[],
  delta: Vec2,
  gridSize: number,
): Vec2 {
  const bounds = boundsOfRects(selection);
  if (bounds === undefined) return delta;
  const snapped = snapPointToGrid([bounds.x + delta[0], bounds.y + delta[1]], gridSize);
  return [normalizeZero(snapped[0] - bounds.x), normalizeZero(snapped[1] - bounds.y)];
}

export interface AlignmentGuide {
  readonly axis: 'x' | 'y';
  readonly position: number;
}

export interface AlignmentSnap {
  readonly delta: Vec2;
  readonly guides: readonly AlignmentGuide[];
}

interface AxisMatch {
  readonly offset: number;
  readonly position: number;
}

function anchorsOnX(value: Rect): readonly number[] {
  return [value.x, value.x + value.width / 2, rectRight(value)];
}

function anchorsOnY(value: Rect): readonly number[] {
  return [value.y, value.y + value.height / 2, rectBottom(value)];
}

function closestMatch(
  moving: readonly number[],
  fixed: readonly number[],
  threshold: number,
): AxisMatch | undefined {
  let best: AxisMatch | undefined;
  for (const from of moving) {
    for (const to of fixed) {
      const offset = to - from;
      if (Math.abs(offset) > threshold) continue;
      if (best === undefined || Math.abs(offset) < Math.abs(best.offset)) {
        best = { offset, position: to };
      }
    }
  }
  return best;
}

export function snapToAlignment(
  selection: readonly Rect[],
  delta: Vec2,
  others: readonly Rect[],
  threshold = DEFAULT_SNAP_THRESHOLD,
): AlignmentSnap {
  const bounds = boundsOfRects(selection);
  if (bounds === undefined) return { delta, guides: [] };
  const moved: Rect = { ...bounds, x: bounds.x + delta[0], y: bounds.y + delta[1] };
  const fixedX = others.flatMap(anchorsOnX);
  const fixedY = others.flatMap(anchorsOnY);
  const matchX = closestMatch(anchorsOnX(moved), fixedX, threshold);
  const matchY = closestMatch(anchorsOnY(moved), fixedY, threshold);
  const guides: AlignmentGuide[] = [];
  if (matchX !== undefined) guides.push({ axis: 'x', position: matchX.position });
  if (matchY !== undefined) guides.push({ axis: 'y', position: matchY.position });
  return {
    delta: [delta[0] + (matchX?.offset ?? 0), delta[1] + (matchY?.offset ?? 0)],
    guides,
  };
}
