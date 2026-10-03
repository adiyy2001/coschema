import type { Vec2 } from '../vec';
import { equalVec } from '../vec';

function collinear(first: Vec2, second: Vec2, third: Vec2): boolean {
  return (
    (first[0] === second[0] && second[0] === third[0]) ||
    (first[1] === second[1] && second[1] === third[1])
  );
}

export function simplifyPath(points: readonly Vec2[]): Vec2[] {
  const distinct: Vec2[] = [];
  for (const point of points) {
    const previous = distinct[distinct.length - 1];
    if (previous === undefined || !equalVec(previous, point)) distinct.push(point);
  }
  const result: Vec2[] = [];
  for (const point of distinct) {
    while (result.length >= 2) {
      const last = result[result.length - 1];
      const beforeLast = result[result.length - 2];
      if (last === undefined || beforeLast === undefined || !collinear(beforeLast, last, point)) {
        break;
      }
      result.pop();
    }
    result.push(point);
  }
  return result;
}
