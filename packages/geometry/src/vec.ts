export type Vec2 = readonly [number, number];

export function vec(x: number, y: number): Vec2 {
  return [x, y];
}

export function add(left: Vec2, right: Vec2): Vec2 {
  return [left[0] + right[0], left[1] + right[1]];
}

export function subtract(left: Vec2, right: Vec2): Vec2 {
  return [left[0] - right[0], left[1] - right[1]];
}

export function scale(value: Vec2, factor: number): Vec2 {
  return [value[0] * factor, value[1] * factor];
}

export function midpoint(left: Vec2, right: Vec2): Vec2 {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

export function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

export function manhattan(left: Vec2, right: Vec2): number {
  return Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]);
}

export function equalVec(left: Vec2, right: Vec2): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function isFiniteVec(value: Vec2): boolean {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]);
}
