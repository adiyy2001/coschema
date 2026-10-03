import * as Y from 'yjs';
import { createId } from '../ids';
import { after, before, between, isValidOrderKey } from '../fractional-index';
import { compareNodes, readNode, type GraphNode } from '../graph';
import type { NodeId } from '../ids';
import { DEFAULT_NODE_SIZES, clampSize, type Size, type Vec2 } from '../node-types';
import {
  EDGE_KEYS,
  NODE_KEYS,
  STYLE_KEYS,
  getEdges,
  getNodes,
  type NodeInit,
  type NodeStyle,
  type YNode,
} from '../schema';
import { assertFinitePoint, runInTransaction, type CommandContext } from './context';
import { diffText } from '../text-diff';

export type StylePatch = { [Key in keyof NodeStyle]?: NodeStyle[Key] | null };

export interface NodeMove {
  readonly id: NodeId;
  readonly pos: Vec2;
}

export interface NodeResize {
  readonly size: Size;
  readonly pos?: Vec2;
}

export type ReorderTarget = 'front' | 'back';

function existingNodes(context: CommandContext, ids: readonly NodeId[]): [NodeId, YNode][] {
  const nodes = getNodes(context.doc);
  const found: [NodeId, YNode][] = [];
  for (const id of new Set(ids)) {
    const yNode = nodes.get(id);
    if (yNode !== undefined) found.push([id, yNode]);
  }
  return found;
}

function allNodesInOrder(context: CommandContext): GraphNode[] {
  const result: GraphNode[] = [];
  getNodes(context.doc).forEach((yNode, id) => {
    result.push(readNode(id, yNode));
  });
  return result.sort(compareNodes);
}

function highestKey(context: CommandContext): string | undefined {
  let highest: string | undefined;
  getNodes(context.doc).forEach((yNode) => {
    const z = yNode.get(NODE_KEYS.z);
    if (typeof z === 'string' && isValidOrderKey(z) && (highest === undefined || z > highest)) {
      highest = z;
    }
  });
  return highest;
}

function usableKey(key: string | undefined): string | undefined {
  return key === undefined || key === '' ? undefined : key;
}

function applyStylePatch(yStyle: Y.Map<unknown>, patch: StylePatch): void {
  for (const key of STYLE_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) yStyle.delete(key);
    else yStyle.set(key, value);
  }
}

export function createNode(context: CommandContext, init: NodeInit): NodeId {
  assertFinitePoint(init.pos, 'pos');
  const id = init.id ?? createId(context.random);
  return runInTransaction(context, () => {
    const nodes = getNodes(context.doc);
    if (nodes.has(id)) throw new Error(`node ${id} already exists`);
    const topKey = highestKey(context);
    const yNode = new Y.Map<unknown>();
    yNode.set(NODE_KEYS.type, init.type);
    yNode.set(NODE_KEYS.pos, [init.pos[0], init.pos[1]]);
    yNode.set(NODE_KEYS.size, [...clampSize(init.size ?? DEFAULT_NODE_SIZES[init.type])]);
    yNode.set(NODE_KEYS.z, init.z ?? after(topKey ?? '1', context.random));
    const yStyle = new Y.Map<unknown>();
    applyStylePatch(yStyle, init.style ?? {});
    yNode.set(NODE_KEYS.style, yStyle);
    yNode.set(NODE_KEYS.label, new Y.Text(init.label ?? ''));
    nodes.set(id, yNode);
    return id;
  });
}

export function moveNodes(context: CommandContext, moves: readonly NodeMove[]): void {
  for (const move of moves) assertFinitePoint(move.pos, 'pos');
  runInTransaction(context, () => {
    const nodes = getNodes(context.doc);
    for (const move of moves) {
      nodes.get(move.id)?.set(NODE_KEYS.pos, [move.pos[0], move.pos[1]]);
    }
  });
}

export function translateNodes(
  context: CommandContext,
  ids: readonly NodeId[],
  deltaX: number,
  deltaY: number,
): void {
  assertFinitePoint([deltaX, deltaY], 'delta');
  runInTransaction(context, () => {
    for (const [id, yNode] of existingNodes(context, ids)) {
      const current = readNode(id, yNode).pos;
      yNode.set(NODE_KEYS.pos, [current[0] + deltaX, current[1] + deltaY]);
    }
  });
}

export function resizeNode(context: CommandContext, id: NodeId, resize: NodeResize): void {
  assertFinitePoint(resize.size, 'size');
  if (resize.pos !== undefined) assertFinitePoint(resize.pos, 'pos');
  runInTransaction(context, () => {
    const yNode = getNodes(context.doc).get(id);
    if (yNode === undefined) return;
    yNode.set(NODE_KEYS.size, [...clampSize(resize.size)]);
    if (resize.pos !== undefined) yNode.set(NODE_KEYS.pos, [resize.pos[0], resize.pos[1]]);
  });
}

export function setStyle(context: CommandContext, ids: readonly NodeId[], patch: StylePatch): void {
  runInTransaction(context, () => {
    for (const [, yNode] of existingNodes(context, ids)) {
      const current = yNode.get(NODE_KEYS.style);
      if (current instanceof Y.Map) {
        applyStylePatch(current as Y.Map<unknown>, patch);
      } else {
        const created = new Y.Map<unknown>();
        applyStylePatch(created, patch);
        yNode.set(NODE_KEYS.style, created);
      }
    }
  });
}

export function editLabel(context: CommandContext, id: NodeId, text: string): void {
  runInTransaction(context, () => {
    const yNode = getNodes(context.doc).get(id);
    const label = yNode?.get(NODE_KEYS.label);
    if (!(label instanceof Y.Text)) return;
    const edit = diffText(label.toJSON(), text);
    if (edit === undefined) return;
    if (edit.deleteCount > 0) label.delete(edit.index, edit.deleteCount);
    if (edit.insert.length > 0) label.insert(edit.index, edit.insert);
  });
}

export function replaceLabelRange(
  context: CommandContext,
  id: NodeId,
  index: number,
  deleteCount: number,
  insert: string,
): void {
  runInTransaction(context, () => {
    const label = getNodes(context.doc).get(id)?.get(NODE_KEYS.label);
    if (!(label instanceof Y.Text)) return;
    const start = Math.min(Math.max(0, index), label.length);
    const count = Math.min(Math.max(0, deleteCount), label.length - start);
    if (count > 0) label.delete(start, count);
    if (insert.length > 0) label.insert(start, insert);
  });
}

function keyBetween(
  lower: string | undefined,
  upper: string | undefined,
  context: CommandContext,
): string {
  const usableLower = usableKey(lower);
  const usableUpper = usableKey(upper);
  if (usableLower !== undefined && usableUpper !== undefined && usableLower >= usableUpper) {
    return usableLower;
  }
  return between(usableLower, usableUpper, context.random);
}

export function reorderNode(context: CommandContext, id: NodeId, targetIndex: number): void {
  runInTransaction(context, () => {
    const yNode = getNodes(context.doc).get(id);
    if (yNode === undefined) return;
    const others = allNodesInOrder(context).filter((node) => node.id !== id);
    const index = Math.min(Math.max(0, Math.trunc(targetIndex)), others.length);
    yNode.set(NODE_KEYS.z, keyBetween(others[index - 1]?.z, others[index]?.z, context));
  });
}

export function reorderNodes(
  context: CommandContext,
  ids: readonly NodeId[],
  target: ReorderTarget,
): void {
  runInTransaction(context, () => {
    const selected = new Set(existingNodes(context, ids).map(([id]) => id));
    if (selected.size === 0) return;
    const ordered = allNodesInOrder(context);
    const moving = ordered.filter((node) => selected.has(node.id));
    const staying = ordered.filter((node) => !selected.has(node.id));
    const nodes = getNodes(context.doc);
    if (target === 'front') {
      let previous = usableKey(staying[staying.length - 1]?.z);
      for (const node of moving) {
        previous = after(previous ?? '1', context.random);
        nodes.get(node.id)?.set(NODE_KEYS.z, previous);
      }
      return;
    }
    let next = usableKey(staying[0]?.z);
    for (const node of [...moving].reverse()) {
      next = before(next ?? 'V', context.random);
      nodes.get(node.id)?.set(NODE_KEYS.z, next);
    }
  });
}

export function deleteNodes(context: CommandContext, ids: readonly NodeId[]): number {
  return runInTransaction(context, () => {
    const doomed = new Set(existingNodes(context, ids).map(([id]) => id));
    if (doomed.size === 0) return 0;
    const edges = getEdges(context.doc);
    const attached: string[] = [];
    edges.forEach((yEdge, edgeId) => {
      const source: unknown = yEdge.get(EDGE_KEYS.source);
      const target: unknown = yEdge.get(EDGE_KEYS.target);
      if (
        (typeof source === 'string' && doomed.has(source)) ||
        (typeof target === 'string' && doomed.has(target))
      ) {
        attached.push(edgeId);
      }
    });
    for (const edgeId of attached) edges.delete(edgeId);
    const nodes = getNodes(context.doc);
    for (const id of doomed) nodes.delete(id);
    return doomed.size;
  });
}
