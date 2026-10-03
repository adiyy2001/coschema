import {
  connect,
  createNode,
  deleteNodes,
  editLabel,
  getEdges,
  getNodes,
  initializeDocument,
  moveNodes,
  type CommandContext,
  type NodeType,
} from '@coschema/model';
import * as Y from 'yjs';
import { generateScene, mulberry32, type Scene } from '../geometry/scene';

const NODE_TYPES_IN_ORDER: readonly NodeType[] = ['rect', 'rounded', 'ellipse', 'diamond'];
const DRAG_STEPS = 12;
const DRAGGED_SHARE = 0.3;
const RETYPED_SHARE = 0.2;
const DELETED_SHARE = 0.05;
const LABEL_REVISIONS = 6;

export interface RecordedSession {
  readonly updates: readonly Uint8Array[];
  readonly doc: Y.Doc;
  readonly nodes: number;
  readonly edges: number;
}

function typeFor(index: number): NodeType {
  return NODE_TYPES_IN_ORDER[index % NODE_TYPES_IN_ORDER.length] ?? 'rect';
}

function createScene(context: CommandContext, scene: Scene): void {
  scene.nodes.forEach((node, index) => {
    createNode(context, {
      id: node.id,
      type: typeFor(index),
      pos: [node.rect.x, node.rect.y],
      size: [node.rect.width, node.rect.height],
      label: `Pump ${index}`,
    });
  });
  for (const edge of scene.edges) {
    connect(context, {
      id: edge.id,
      source: edge.source,
      sourcePort: 'e',
      target: edge.target,
      targetPort: 'w',
    });
  }
}

function dragNode(context: CommandContext, id: string, from: readonly [number, number]): void {
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    moveNodes(context, [{ id, pos: [from[0] + step * 7, from[1] + step * 3] }]);
  }
}

function retypeLabel(context: CommandContext, id: string, base: string): void {
  for (let revision = 1; revision <= LABEL_REVISIONS; revision += 1) {
    editLabel(context, id, `${base} r${revision}`);
  }
}

function churn(context: CommandContext, scene: Scene, next: () => number): void {
  const removed: string[] = [];
  scene.nodes.forEach((node, index) => {
    const draw = next();
    if (draw < DRAGGED_SHARE) dragNode(context, node.id, [node.rect.x, node.rect.y]);
    if (next() < RETYPED_SHARE) retypeLabel(context, node.id, `Pump ${index}`);
    if (next() < DELETED_SHARE) removed.push(node.id);
  });
  for (const id of removed) deleteNodes(context, [id]);
}

export function recordSession(nodeCount: number, seed: number): RecordedSession {
  const scene = generateScene(nodeCount, seed);
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update);
  });
  initializeDocument(doc);
  const random = mulberry32(seed + nodeCount);
  const context: CommandContext = { doc, origin: 'size-bench', random };
  createScene(context, scene);
  churn(context, scene, mulberry32(seed ^ nodeCount));
  return {
    updates,
    doc,
    nodes: getNodes(doc).size,
    edges: getEdges(doc).size,
  };
}
