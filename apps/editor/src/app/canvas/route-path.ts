import type { Vec2 } from '@coschema/geometry';

const DEFAULT_CORNER_RADIUS = 8;

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function towards(from: Vec2, to: Vec2, distance: number): Vec2 {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) return from;
  const ratio = distance / length;
  return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
}

export function routePath(points: readonly Vec2[], radius = DEFAULT_CORNER_RADIUS): string {
  const [first, ...rest] = points;
  if (first === undefined) return '';
  const commands = [`M${format(first[0])} ${format(first[1])}`];
  rest.forEach((current, index) => {
    const previous = points[index];
    const following = points[index + 2];
    if (previous === undefined) return;
    if (following === undefined) {
      commands.push(`L${format(current[0])} ${format(current[1])}`);
      return;
    }
    const inLength = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const outLength = Math.hypot(following[0] - current[0], following[1] - current[1]);
    const corner = Math.min(radius, inLength / 2, outLength / 2);
    const entry = towards(current, previous, corner);
    const exit = towards(current, following, corner);
    commands.push(
      `L${format(entry[0])} ${format(entry[1])}`,
      `Q${format(current[0])} ${format(current[1])} ${format(exit[0])} ${format(exit[1])}`,
    );
  });
  return commands.join('');
}
