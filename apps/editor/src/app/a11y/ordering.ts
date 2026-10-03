import type { Rect } from '@coschema/geometry';
import type { EdgeId, NodeId } from '@coschema/model';

export interface PlacedNode {
  readonly id: NodeId;
  readonly rect: Rect;
}

export interface EdgeEnds {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const READING_ROW_HEIGHT = 96;
const CROSS_AXIS_WEIGHT = 2;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function readingOrder(
  nodes: readonly PlacedNode[],
  rowHeight = READING_ROW_HEIGHT,
): NodeId[] {
  return [...nodes]
    .sort((left, right) => {
      const rowDifference =
        Math.round(left.rect.y / rowHeight) - Math.round(right.rect.y / rowHeight);
      if (rowDifference !== 0) return rowDifference;
      if (left.rect.x !== right.rect.x) return left.rect.x - right.rect.x;
      return compareText(left.id, right.id);
    })
    .map((node) => node.id);
}

export function edgeOrder(edges: readonly EdgeEnds[], nodeOrder: readonly NodeId[]): EdgeId[] {
  const position = new Map(nodeOrder.map((id, index) => [id, index]));
  const rank = (id: NodeId): number => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...edges]
    .sort((left, right) => {
      const bySource = rank(left.source) - rank(right.source);
      if (bySource !== 0) return bySource;
      const byTarget = rank(left.target) - rank(right.target);
      return byTarget !== 0 ? byTarget : compareText(left.id, right.id);
    })
    .map((edge) => edge.id);
}

function centerOf(rect: Rect): readonly [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

function alongAndAcross(
  from: readonly [number, number],
  to: readonly [number, number],
  direction: Direction,
): readonly [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  switch (direction) {
    case 'right':
      return [dx, dy];
    case 'left':
      return [-dx, dy];
    case 'down':
      return [dy, dx];
    case 'up':
      return [-dy, dx];
  }
}

export function nearestInDirection(
  from: Rect,
  candidates: readonly PlacedNode[],
  direction: Direction,
): NodeId | undefined {
  const origin = centerOf(from);
  let best: PlacedNode | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const [along, across] = alongAndAcross(origin, centerOf(candidate.rect), direction);
    if (along <= 0) continue;
    const score = along + CROSS_AXIS_WEIGHT * Math.abs(across);
    const better =
      score < bestScore ||
      (score === bestScore && best !== undefined && compareText(candidate.id, best.id) < 0);
    if (better) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.id;
}

export function stepThrough<Item>(
  sequence: readonly Item[],
  current: Item | undefined,
  step: 1 | -1,
): Item | undefined {
  if (sequence.length === 0) return undefined;
  const index = current === undefined ? -1 : sequence.indexOf(current);
  if (index === -1) return step === 1 ? sequence[0] : sequence[sequence.length - 1];
  return sequence[(index + step + sequence.length) % sequence.length];
}
