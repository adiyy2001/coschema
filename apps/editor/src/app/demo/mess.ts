import {
  createNode,
  editLabel,
  moveNodes,
  type CommandContext,
  type NodeId,
  type RandomSource,
  type Vec2,
} from '@coschema/model';

export interface MessTarget {
  readonly context: CommandContext;
  readonly nodeIds: () => readonly NodeId[];
  readonly labelOf: (id: NodeId) => string | undefined;
}

const MESS_NODE_TYPES = ['rect', 'rounded', 'ellipse', 'diamond'] as const;

const FIELD_WIDTH = 900;
const FIELD_HEIGHT = 480;
const FIELD_MARGIN = 40;
const GRID = 8;

function randomPosition(random: RandomSource): Vec2 {
  const snap = (value: number): number => Math.round(value / GRID) * GRID;
  return [
    snap(FIELD_MARGIN + random() * FIELD_WIDTH),
    snap(FIELD_MARGIN + random() * FIELD_HEIGHT),
  ];
}

export function applyMess(target: MessTarget, tag: string, random: RandomSource): number {
  const ids = [...target.nodeIds()].sort();
  const [shared, renamed] = ids;
  let edits = 0;
  if (shared !== undefined) {
    moveNodes(target.context, [{ id: shared, pos: randomPosition(random) }]);
    edits += 1;
  }
  if (renamed !== undefined) {
    const label = target.labelOf(renamed) ?? '';
    editLabel(target.context, renamed, `${label} (${tag})`);
    edits += 1;
  }
  const type = MESS_NODE_TYPES[Math.floor(random() * MESS_NODE_TYPES.length)] ?? 'rect';
  createNode(target.context, {
    type,
    pos: randomPosition(random),
    label: `${tag} says hi`,
  });
  return edits + 1;
}
