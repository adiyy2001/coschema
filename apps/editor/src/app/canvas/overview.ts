import { rectCenter, type Rect } from '@coschema/geometry';

function format(value: number): string {
  return String(Math.round(value));
}

export function rectsPath(rects: readonly Rect[]): string {
  return rects
    .map(
      (rect) =>
        `M${format(rect.x)} ${format(rect.y)}h${format(rect.width)}v${format(rect.height)}h${format(-rect.width)}z`,
    )
    .join('');
}

export function linesPath(pairs: readonly (readonly [Rect, Rect])[]): string {
  return pairs
    .map(([from, to]) => {
      const start = rectCenter(from);
      const end = rectCenter(to);
      return `M${format(start[0])} ${format(start[1])}L${format(end[0])} ${format(end[1])}`;
    })
    .join('');
}
