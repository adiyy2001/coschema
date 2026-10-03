import { rectContainsPoint, type Rect, type Vec2 } from '@coschema/geometry';
import type { GraphNode } from '@coschema/model';

export function nodeRect(node: Pick<GraphNode, 'pos' | 'size'>): Rect {
  return { x: node.pos[0], y: node.pos[1], width: node.size[0], height: node.size[1] };
}

export function nodeContainsPoint(node: GraphNode, point: Vec2): boolean {
  const bounds = nodeRect(node);
  if (!rectContainsPoint(bounds, point)) return false;
  const halfWidth = bounds.width / 2;
  const halfHeight = bounds.height / 2;
  const offsetX = (point[0] - bounds.x - halfWidth) / halfWidth;
  const offsetY = (point[1] - bounds.y - halfHeight) / halfHeight;
  if (node.type === 'ellipse') return offsetX * offsetX + offsetY * offsetY <= 1;
  if (node.type === 'diamond') return Math.abs(offsetX) + Math.abs(offsetY) <= 1;
  return true;
}

export function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - from[0], point[1] - from[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared),
  );
  return Math.hypot(point[0] - (from[0] + t * dx), point[1] - (from[1] + t * dy));
}

export function distanceToPolyline(point: Vec2, points: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    best = Math.min(best, distanceToSegment(point, from, to));
  }
  return best;
}
