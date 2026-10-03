import type { Rect } from '../rect';
import type { Vec2 } from '../vec';

export type Direction = 0 | 1 | 2 | 3;

export const EAST: Direction = 0;
export const SOUTH: Direction = 1;
export const WEST: Direction = 2;
export const NORTH: Direction = 3;

export const DIRECTION_VECTORS: readonly Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const PORT_DIRECTIONS: Readonly<Record<string, Direction>> = {
  n: NORTH,
  e: EAST,
  s: SOUTH,
  w: WEST,
  ne: EAST,
  se: EAST,
  sw: WEST,
  nw: WEST,
};

const PORT_OFFSETS: Readonly<Record<string, Vec2>> = {
  n: [0.5, 0],
  e: [1, 0.5],
  s: [0.5, 1],
  w: [0, 0.5],
  ne: [1, 0],
  se: [1, 1],
  sw: [0, 1],
  nw: [0, 0],
};

export function oppositeDirection(direction: Direction): Direction {
  return ((direction + 2) % 4) as Direction;
}

export function isHorizontal(direction: Direction): boolean {
  return direction === EAST || direction === WEST;
}

export function portDirection(port: string): Direction {
  return PORT_DIRECTIONS[port] ?? EAST;
}

export function portPoint(rect: Rect, port: string): Vec2 {
  const [offsetX, offsetY] = PORT_OFFSETS[port] ?? [1, 0.5];
  return [rect.x + rect.width * offsetX, rect.y + rect.height * offsetY];
}

export function stubPoint(anchor: Vec2, direction: Direction, length: number): Vec2 {
  const vector = DIRECTION_VECTORS[direction] ?? [1, 0];
  return [anchor[0] + vector[0] * length, anchor[1] + vector[1] * length];
}
