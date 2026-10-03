import type { Rect } from '../rect';
import { rectBottom, rectRight } from '../rect';
import { at } from './typed';

export interface GridObstacle extends Rect {
  readonly clippedLeft?: boolean;
  readonly clippedTop?: boolean;
  readonly clippedRight?: boolean;
  readonly clippedBottom?: boolean;
}

export interface SparseGrid {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly columns: number;
  readonly rows: number;
  readonly blockedRight: Uint8Array;
  readonly blockedDown: Uint8Array;
}

function sortedUnique(values: readonly number[]): Float64Array {
  const sorted = Float64Array.from(values).sort();
  let length = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const value = at(sorted, index);
    if (length === 0 || at(sorted, length - 1) !== value) {
      sorted[length] = value;
      length += 1;
    }
  }
  return sorted.slice(0, length);
}

export function lineIndex(lines: Float64Array, value: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = at(lines, middle);
    if (candidate === value) return middle;
    if (candidate < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

export function nodeIndex(grid: SparseGrid, column: number, row: number): number {
  return row * grid.columns + column;
}

export function buildSparseGrid(
  extraXs: readonly number[],
  extraYs: readonly number[],
  obstacles: readonly GridObstacle[],
): SparseGrid {
  const xs = sortedUnique([...extraXs, ...obstacles.flatMap((item) => [item.x, rectRight(item)])]);
  const ys = sortedUnique([...extraYs, ...obstacles.flatMap((item) => [item.y, rectBottom(item)])]);
  const columns = xs.length;
  const rows = ys.length;
  const blockedRight = new Uint8Array(columns * rows);
  const blockedDown = new Uint8Array(columns * rows);
  for (const item of obstacles) {
    const firstColumn = lineIndex(xs, item.x);
    const lastColumn = lineIndex(xs, rectRight(item));
    const firstRow = lineIndex(ys, item.y);
    const lastRow = lineIndex(ys, rectBottom(item));
    const innerFirstRow = item.clippedTop === true ? firstRow : firstRow + 1;
    const innerLastRow = item.clippedBottom === true ? lastRow : lastRow - 1;
    const innerFirstColumn = item.clippedLeft === true ? firstColumn : firstColumn + 1;
    const innerLastColumn = item.clippedRight === true ? lastColumn : lastColumn - 1;
    for (let row = innerFirstRow; row <= innerLastRow; row += 1) {
      for (let column = firstColumn; column < lastColumn; column += 1) {
        blockedRight[row * columns + column] = 1;
      }
    }
    for (let row = firstRow; row < lastRow; row += 1) {
      for (let column = innerFirstColumn; column <= innerLastColumn; column += 1) {
        blockedDown[row * columns + column] = 1;
      }
    }
  }
  return { xs, ys, columns, rows, blockedRight, blockedDown };
}
