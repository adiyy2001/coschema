import type { GridEntry } from '../spatial-grid';
import type { Rect } from '../rect';
import { inflateRect, rectBottom, rectInteriorContainsPoint, rectRight } from '../rect';
import type { Vec2 } from '../vec';
import type { GridObstacle } from './sparse-grid';

export interface ObstacleSource {
  query(area: Rect): readonly GridEntry<string>[];
}

export function relaxObstacles(
  raw: readonly Rect[],
  margin: number,
  pins: readonly Vec2[],
): Rect[] | undefined {
  const relaxed: Rect[] = [];
  for (const item of raw) {
    if (pins.some((pin) => rectInteriorContainsPoint(item, pin))) return undefined;
    const inflated = inflateRect(item, margin);
    const pinned = pins.some((pin) => rectInteriorContainsPoint(inflated, pin));
    relaxed.push(pinned ? item : inflated);
  }
  return relaxed;
}

export function clipRect(item: Rect, window: Rect): GridObstacle | undefined {
  const x = Math.max(item.x, window.x);
  const y = Math.max(item.y, window.y);
  const right = Math.min(rectRight(item), rectRight(window));
  const bottom = Math.min(rectBottom(item), rectBottom(window));
  if (right <= x || bottom <= y) return undefined;
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    clippedLeft: item.x < window.x,
    clippedTop: item.y < window.y,
    clippedRight: rectRight(item) > rectRight(window),
    clippedBottom: rectBottom(item) > rectBottom(window),
  };
}

export function compareRects(left: Rect, right: Rect): number {
  return (
    left.x - right.x || left.y - right.y || left.width - right.width || left.height - right.height
  );
}
