import type { Rect } from './rect';
import { isFiniteRect, rectBottom, rectRight, rectsIntersect } from './rect';

export type GridId = string | number;

export interface CellWindow {
  readonly minColumn: number;
  readonly minRow: number;
  readonly maxColumn: number;
  readonly maxRow: number;
}

export interface GridEntry<Id extends GridId> {
  readonly id: Id;
  readonly rect: Rect;
}

interface Entry<Id extends GridId> {
  readonly id: Id;
  readonly order: number;
  rect: Rect;
  window: CellWindow;
  stamp: number;
}

export const DEFAULT_CELL_SIZE = 512;
const KEY_OFFSET = 2 ** 25;
const KEY_SPAN = 2 ** 26;
const MAX_CELL_INDEX = KEY_OFFSET - 1;

function cellKey(column: number, row: number): number {
  return (column + KEY_OFFSET) * KEY_SPAN + (row + KEY_OFFSET);
}

function clampIndex(index: number): number {
  return Math.max(-MAX_CELL_INDEX, Math.min(MAX_CELL_INDEX, index));
}

export function windowsEqual(left: CellWindow, right: CellWindow): boolean {
  return (
    left.minColumn === right.minColumn &&
    left.minRow === right.minRow &&
    left.maxColumn === right.maxColumn &&
    left.maxRow === right.maxRow
  );
}

export function windowCellCount(window: CellWindow): number {
  return (window.maxColumn - window.minColumn + 1) * (window.maxRow - window.minRow + 1);
}

export class SpatialGrid<Id extends GridId> {
  private readonly cells = new Map<number, Entry<Id>[]>();
  private readonly entries = new Map<Id, Entry<Id>>();
  private nextOrder = 0;
  private queryStamp = 0;

  constructor(readonly cellSize: number = DEFAULT_CELL_SIZE) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) {
      throw new RangeError('cellSize must be a positive finite number');
    }
  }

  get size(): number {
    return this.entries.size;
  }

  has(id: Id): boolean {
    return this.entries.has(id);
  }

  rectOf(id: Id): Rect | undefined {
    return this.entries.get(id)?.rect;
  }

  windowOfRect(rect: Rect, marginCells = 0): CellWindow {
    return {
      minColumn: clampIndex(Math.floor(rect.x / this.cellSize) - marginCells),
      minRow: clampIndex(Math.floor(rect.y / this.cellSize) - marginCells),
      maxColumn: clampIndex(Math.floor(rectRight(rect) / this.cellSize) + marginCells),
      maxRow: clampIndex(Math.floor(rectBottom(rect) / this.cellSize) + marginCells),
    };
  }

  visibleWindow(viewportRect: Rect, marginCells = 1): CellWindow {
    return this.windowOfRect(viewportRect, marginCells);
  }

  insert(id: Id, rect: Rect): void {
    if (!isFiniteRect(rect)) throw new RangeError('rect must be finite with a non-negative size');
    if (this.entries.has(id)) {
      this.move(id, rect);
      return;
    }
    const entry: Entry<Id> = {
      id,
      order: this.nextOrder,
      rect,
      window: this.windowOfRect(rect),
      stamp: 0,
    };
    this.nextOrder += 1;
    this.entries.set(id, entry);
    this.addToCells(entry);
  }

  move(id: Id, rect: Rect): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    if (!isFiniteRect(rect)) throw new RangeError('rect must be finite with a non-negative size');
    const nextWindow = this.windowOfRect(rect);
    if (windowsEqual(entry.window, nextWindow)) {
      entry.rect = rect;
      return true;
    }
    this.removeFromCells(entry);
    entry.rect = rect;
    entry.window = nextWindow;
    this.addToCells(entry);
    return true;
  }

  remove(id: Id): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined) return false;
    this.removeFromCells(entry);
    this.entries.delete(id);
    return true;
  }

  clear(): void {
    this.cells.clear();
    this.entries.clear();
  }

  query(area: Rect): GridEntry<Id>[] {
    return this.collect(this.windowOfRect(area), area);
  }

  queryWindow(window: CellWindow): GridEntry<Id>[] {
    return this.collect(window, undefined);
  }

  queryIds(area: Rect): Id[] {
    return this.query(area).map((entry) => entry.id);
  }

  all(): GridEntry<Id>[] {
    return [...this.entries.values()]
      .sort((left, right) => left.order - right.order)
      .map((entry) => ({ id: entry.id, rect: entry.rect }));
  }

  private collect(window: CellWindow, exact: Rect | undefined): GridEntry<Id>[] {
    this.queryStamp += 1;
    const stamp = this.queryStamp;
    const found: Entry<Id>[] = [];
    const consider = (entry: Entry<Id>): void => {
      if (entry.stamp === stamp) return;
      entry.stamp = stamp;
      if (exact === undefined || rectsIntersect(entry.rect, exact)) found.push(entry);
    };
    if (windowCellCount(window) > this.cells.size) {
      for (const [key, bucket] of this.cells) {
        const column = Math.floor(key / KEY_SPAN) - KEY_OFFSET;
        const row = (key % KEY_SPAN) - KEY_OFFSET;
        if (
          column < window.minColumn ||
          column > window.maxColumn ||
          row < window.minRow ||
          row > window.maxRow
        ) {
          continue;
        }
        bucket.forEach(consider);
      }
    } else {
      for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
        for (let row = window.minRow; row <= window.maxRow; row += 1) {
          this.cells.get(cellKey(column, row))?.forEach(consider);
        }
      }
    }
    found.sort((left, right) => left.order - right.order);
    return found.map((entry) => ({ id: entry.id, rect: entry.rect }));
  }

  private addToCells(entry: Entry<Id>): void {
    const { window } = entry;
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      for (let row = window.minRow; row <= window.maxRow; row += 1) {
        const key = cellKey(column, row);
        const bucket = this.cells.get(key);
        if (bucket === undefined) this.cells.set(key, [entry]);
        else bucket.push(entry);
      }
    }
  }

  private removeFromCells(entry: Entry<Id>): void {
    const { window } = entry;
    for (let column = window.minColumn; column <= window.maxColumn; column += 1) {
      for (let row = window.minRow; row <= window.maxRow; row += 1) {
        const key = cellKey(column, row);
        const bucket = this.cells.get(key);
        if (bucket === undefined) continue;
        const index = bucket.indexOf(entry);
        if (index >= 0) {
          const last = bucket.pop();
          if (last !== undefined && last !== entry) bucket[index] = last;
        }
        if (bucket.length === 0) this.cells.delete(key);
      }
    }
  }
}
