import {
  connect,
  createNode,
  createPresence,
  deleteEdges,
  deleteNodes,
  deriveGraph,
  moveNodes,
  portsOf,
  reorderNode,
  reorderNodes,
  replaceLabelRange,
  resizeNode,
  setStyle,
  type CommandContext,
  type GraphNode,
  type History,
  type NodeId,
  type PresenceUser,
} from '@coschema/model';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { pickByIndex, type Operation } from './scenario';

export interface OperationTarget {
  readonly index: number;
  readonly doc: Y.Doc;
  readonly history: History;
  readonly context: CommandContext;
  readonly awareness: Awareness;
  readonly user: PresenceUser;
}

export interface OperationEffects {
  created(id: NodeId): void;
}

function nodeAt(nodes: readonly GraphNode[], index: number): GraphNode | undefined {
  return pickByIndex(nodes, index);
}

function distinctNodeAt(
  nodes: readonly GraphNode[],
  index: number,
  other: GraphNode,
): GraphNode | undefined {
  const candidate = pickByIndex(nodes, index);
  if (candidate === undefined || candidate.id !== other.id) return candidate;
  return pickByIndex(nodes, index + 1) === candidate ? undefined : pickByIndex(nodes, index + 1);
}

function drag(
  target: OperationTarget,
  node: GraphNode,
  operation: Extract<Operation, { type: 'drag' }>,
): string {
  const frames = Math.max(1, Math.min(6, Math.trunc(operation.frames)));
  target.history.run(() => {
    for (let frame = 1; frame <= frames; frame += 1) {
      const progress = frame / frames;
      moveNodes(target.context, [
        {
          id: node.id,
          pos: [node.pos[0] + operation.dx * progress, node.pos[1] + operation.dy * progress],
        },
      ]);
    }
  });
  return `dragged ${node.id}`;
}

export function applyOperation(
  target: OperationTarget,
  operation: Operation,
  effects: OperationEffects,
): string {
  const graph = deriveGraph(target.doc);
  const context = target.context;
  switch (operation.type) {
    case 'create': {
      const id = createNode(context, {
        type: operation.nodeType,
        pos: [operation.x, operation.y],
        label: operation.label,
      });
      effects.created(id);
      return `created ${id}`;
    }
    case 'move': {
      const node = nodeAt(graph.nodes, operation.node);
      if (node === undefined) return 'skipped';
      moveNodes(context, [
        { id: node.id, pos: [node.pos[0] + operation.dx, node.pos[1] + operation.dy] },
      ]);
      return `moved ${node.id}`;
    }
    case 'drag': {
      const node = nodeAt(graph.nodes, operation.node);
      return node === undefined ? 'skipped' : drag(target, node, operation);
    }
    case 'delete': {
      const node = nodeAt(graph.nodes, operation.node);
      if (node === undefined) return 'skipped';
      deleteNodes(context, [node.id]);
      return `deleted ${node.id}`;
    }
    case 'connect': {
      const source = nodeAt(graph.nodes, operation.source);
      if (source === undefined) return 'skipped';
      const targetNode = distinctNodeAt(graph.nodes, operation.target, source);
      if (targetNode === undefined) return 'skipped';
      const sourcePort = pickByIndex(portsOf(source.type), operation.sourcePort);
      const targetPort = pickByIndex(portsOf(targetNode.type), operation.targetPort);
      if (sourcePort === undefined || targetPort === undefined) return 'skipped';
      const id = connect(context, {
        source: source.id,
        target: targetNode.id,
        sourcePort,
        targetPort,
      });
      return id === undefined ? 'refused' : `connected ${id}`;
    }
    case 'disconnect': {
      const edge = pickByIndex(graph.edges, operation.edge);
      if (edge === undefined) return 'skipped';
      deleteEdges(context, [edge.id]);
      return `disconnected ${edge.id}`;
    }
    case 'edit-label': {
      const node = nodeAt(graph.nodes, operation.node);
      if (node === undefined) return 'skipped';
      replaceLabelRange(
        context,
        node.id,
        Math.abs(operation.at) % (node.label.length + 1),
        Math.abs(operation.remove),
        operation.insert,
      );
      return `edited ${node.id}`;
    }
    case 'reorder': {
      const node = nodeAt(graph.nodes, operation.node);
      if (node === undefined) return 'skipped';
      reorderNode(context, node.id, Math.abs(operation.to));
      return `reordered ${node.id}`;
    }
    case 'reorder-many': {
      const ids = operation.nodes.flatMap((index) => nodeAt(graph.nodes, index)?.id ?? []);
      if (ids.length === 0) return 'skipped';
      reorderNodes(context, ids, operation.target);
      return `reordered ${ids.length}`;
    }
    case 'style': {
      const node = nodeAt(graph.nodes, operation.node);
      if (node === undefined) return 'skipped';
      setStyle(context, [node.id], { fill: operation.fill });
      return `styled ${node.id}`;
    }
    case 'resize': {
      const node = nodeAt(graph.nodes, operation.node);
      if (node === undefined) return 'skipped';
      resizeNode(context, node.id, { size: [operation.width, operation.height] });
      return `resized ${node.id}`;
    }
    case 'undo':
      return target.history.undo() ? 'undone' : 'nothing to undo';
    case 'redo':
      return target.history.redo() ? 'redone' : 'nothing to redo';
    case 'presence':
      target.awareness.setLocalState({
        ...createPresence(target.user),
        cursor: { x: operation.x, y: operation.y },
      });
      return 'presence set';
  }
}
