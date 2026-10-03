import type { Vec2 } from './vec';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function rectFromCorners(left: Vec2, right: Vec2): Rect {
  const x = Math.min(left[0], right[0]);
  const y = Math.min(left[1], right[1]);
  return { x, y, width: Math.max(left[0], right[0]) - x, height: Math.max(left[1], right[1]) - y };
}

export function rectRight(value: Rect): number {
  return value.x + value.width;
}

export function rectBottom(value: Rect): number {
  return value.y + value.height;
}

export function rectCenter(value: Rect): Vec2 {
  return [value.x + value.width / 2, value.y + value.height / 2];
}

export function isFiniteRect(value: Rect): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width >= 0 &&
    value.height >= 0
  );
}

export function inflateRect(value: Rect, amount: number): Rect {
  return {
    x: value.x - amount,
    y: value.y - amount,
    width: value.width + amount * 2,
    height: value.height + amount * 2,
  };
}

export function translateRect(value: Rect, delta: Vec2): Rect {
  return { x: value.x + delta[0], y: value.y + delta[1], width: value.width, height: value.height };
}

export function unionRects(left: Rect, right: Rect): Rect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(rectRight(left), rectRight(right)) - x,
    height: Math.max(rectBottom(left), rectBottom(right)) - y,
  };
}

export function boundsOfRects(values: readonly Rect[]): Rect | undefined {
  const [first, ...rest] = values;
  if (first === undefined) return undefined;
  return rest.reduce(unionRects, first);
}

export function boundsOfPoints(points: readonly Vec2[]): Rect | undefined {
  const [first, ...rest] = points;
  if (first === undefined) return undefined;
  let minX = first[0];
  let maxX = first[0];
  let minY = first[1];
  let maxY = first[1];
  for (const point of rest) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectsIntersect(left: Rect, right: Rect): boolean {
  return (
    left.x <= rectRight(right) &&
    right.x <= rectRight(left) &&
    left.y <= rectBottom(right) &&
    right.y <= rectBottom(left)
  );
}

export function rectsOverlap(left: Rect, right: Rect): boolean {
  return (
    left.x < rectRight(right) &&
    right.x < rectRight(left) &&
    left.y < rectBottom(right) &&
    right.y < rectBottom(left)
  );
}

export function rectContainsPoint(value: Rect, point: Vec2): boolean {
  return (
    point[0] >= value.x &&
    point[0] <= rectRight(value) &&
    point[1] >= value.y &&
    point[1] <= rectBottom(value)
  );
}

export function rectInteriorContainsPoint(value: Rect, point: Vec2): boolean {
  return (
    point[0] > value.x &&
    point[0] < rectRight(value) &&
    point[1] > value.y &&
    point[1] < rectBottom(value)
  );
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}

export function segmentCrossesInterior(from: Vec2, to: Vec2, value: Rect): boolean {
  const low = [Math.min(from[0], to[0]), Math.min(from[1], to[1])] as const;
  const high = [Math.max(from[0], to[0]), Math.max(from[1], to[1])] as const;
  if (from[0] === to[0]) {
    return (
      from[0] > value.x &&
      from[0] < rectRight(value) &&
      low[1] < rectBottom(value) &&
      high[1] > value.y
    );
  }
  if (from[1] === to[1]) {
    return (
      from[1] > value.y &&
      from[1] < rectBottom(value) &&
      low[0] < rectRight(value) &&
      high[0] > value.x
    );
  }
  throw new RangeError('segmentCrossesInterior only handles horizontal and vertical segments');
}
