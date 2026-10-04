import { rectsOverlap, type Rect, type Vec2 } from '@coschema/geometry';

const MAX_RINGS = 24;

function ringOffsets(ring: number): [number, number][] {
  if (ring === 0) return [[0, 0]];
  const offsets: [number, number][] = [];
  for (let step = -ring; step <= ring; step += 1) {
    offsets.push([step, -ring], [step, ring]);
    if (Math.abs(step) !== ring) offsets.push([-ring, step], [ring, step]);
  }
  return offsets;
}

export function freePosition(
  preferred: Vec2,
  size: Vec2,
  occupied: readonly Rect[],
  gridSize: number,
): Vec2 {
  const stepX = Math.ceil((size[0] + gridSize) / gridSize) * gridSize;
  const stepY = Math.ceil((size[1] + gridSize) / gridSize) * gridSize;
  for (let ring = 0; ring <= MAX_RINGS; ring += 1) {
    for (const [dx, dy] of ringOffsets(ring)) {
      const x = preferred[0] + dx * stepX;
      const y = preferred[1] + dy * stepY;
      const candidate: Rect = { x, y, width: size[0], height: size[1] };
      if (!occupied.some((other) => rectsOverlap(candidate, other))) return [x, y];
    }
  }
  return preferred;
}
