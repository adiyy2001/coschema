import * as Y from 'yjs';
import { compareOrderKeys, isValidOrderKey } from './fractional-index';
import type { EdgeId, NodeId } from './ids';
import {
  clampSize,
  hasPort,
  isNodeType,
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
  type NodeType,
  type PortId,
  type Size,
  type Vec2,
} from './node-types';
import {
  EDGE_KEYS,
  NODE_KEYS,
  STYLE_KEYS,
  getEdges,
  getNodes,
  type NodeStyle,
  type YEdge,
  type YNode,
} from './schema';

export interface GraphNode {
  readonly id: NodeId;
  readonly type: NodeType;
  readonly pos: Vec2;
  readonly size: Size;
  readonly z: string;
  readonly style: Readonly<NodeStyle>;
  readonly label: string;
}

export interface GraphEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly sourcePort: PortId;
  readonly targetPort: PortId;
  readonly waypoints: readonly Vec2[];
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface RawEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly sourcePort: string;
  readonly targetPort: string;
  readonly waypoints: readonly Vec2[];
}

export const DEFAULT_NODE_TYPE: NodeType = 'rect';
export const FALLBACK_Z = '';

function parseVec2(value: unknown): Vec2 | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [x, y] = value as unknown[];
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

function readWaypoints(value: unknown): Vec2[] {
  if (!Array.isArray(value)) return [];
  const waypoints: Vec2[] = [];
  for (const entry of value as unknown[]) {
    const point = parseVec2(entry);
    if (point !== undefined) waypoints.push(point);
  }
  return waypoints;
}

function readStyle(value: unknown): NodeStyle {
  if (!(value instanceof Y.Map)) return {};
  const style: Record<string, string | number> = {};
  for (const key of STYLE_KEYS) {
    const entry: unknown = value.get(key);
    if (typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))) {
      style[key] = entry;
    }
  }
  return style;
}

export function readNode(id: NodeId, yNode: YNode): GraphNode {
  const type = yNode.get(NODE_KEYS.type);
  const z = yNode.get(NODE_KEYS.z);
  const label = yNode.get(NODE_KEYS.label);
  return {
    id,
    type: isNodeType(type) ? type : DEFAULT_NODE_TYPE,
    pos: parseVec2(yNode.get(NODE_KEYS.pos)) ?? [0, 0],
    size: clampSize(parseVec2(yNode.get(NODE_KEYS.size)) ?? [0, 0]),
    z: typeof z === 'string' && isValidOrderKey(z) ? z : FALLBACK_Z,
    style: readStyle(yNode.get(NODE_KEYS.style)),
    label: label instanceof Y.Text ? label.toJSON() : '',
  };
}

export function readRawEdge(id: EdgeId, yEdge: YEdge): RawEdge | undefined {
  const source = yEdge.get(EDGE_KEYS.source);
  const target = yEdge.get(EDGE_KEYS.target);
  const sourcePort = yEdge.get(EDGE_KEYS.sourcePort);
  const targetPort = yEdge.get(EDGE_KEYS.targetPort);
  if (typeof source !== 'string' || typeof target !== 'string') return undefined;
  if (typeof sourcePort !== 'string' || typeof targetPort !== 'string') return undefined;
  return {
    id,
    source,
    target,
    sourcePort,
    targetPort,
    waypoints: readWaypoints(yEdge.get(EDGE_KEYS.waypoints)),
  };
}

export function toVisibleEdge(
  raw: RawEdge,
  findNode: (id: NodeId) => GraphNode | undefined,
): GraphEdge | undefined {
  if (raw.source === raw.target) return undefined;
  const source = findNode(raw.source);
  const target = findNode(raw.target);
  if (source === undefined || target === undefined) return undefined;
  if (!hasPort(source.type, raw.sourcePort) || !hasPort(target.type, raw.targetPort)) {
    return undefined;
  }
  return {
    id: raw.id,
    source: raw.source,
    target: raw.target,
    sourcePort: raw.sourcePort,
    targetPort: raw.targetPort,
    waypoints: raw.waypoints,
  };
}

export function compareNodes(left: GraphNode, right: GraphNode): number {
  const byKey = compareOrderKeys(left.z, right.z);
  return byKey !== 0 ? byKey : compareOrderKeys(left.id, right.id);
}

export function compareEdges(left: GraphEdge, right: GraphEdge): number {
  return compareOrderKeys(left.id, right.id);
}

export function deriveGraph(doc: Y.Doc): Graph {
  const nodeById = new Map<NodeId, GraphNode>();
  getNodes(doc).forEach((yNode, id) => {
    if (yNode instanceof Y.Map) nodeById.set(id, readNode(id, yNode));
  });
  const edges: GraphEdge[] = [];
  getEdges(doc).forEach((yEdge, id) => {
    if (!(yEdge instanceof Y.Map)) return;
    const raw = readRawEdge(id, yEdge);
    const visible =
      raw === undefined ? undefined : toVisibleEdge(raw, (nodeId) => nodeById.get(nodeId));
    if (visible !== undefined) edges.push(visible);
  });
  return {
    nodes: [...nodeById.values()].sort(compareNodes),
    edges: edges.sort(compareEdges),
  };
}

export function findViolations(graph: Graph): string[] {
  const violations: string[] = [];
  const nodeById = new Map<NodeId, GraphNode>();
  for (const node of graph.nodes) {
    if (nodeById.has(node.id)) violations.push(`duplicate node id ${node.id}`);
    nodeById.set(node.id, node);
    if (node.size[0] < MIN_NODE_SIZE || node.size[1] < MIN_NODE_SIZE) {
      violations.push(`node ${node.id} is below the minimum size`);
    }
    if (node.size[0] > MAX_NODE_SIZE || node.size[1] > MAX_NODE_SIZE) {
      violations.push(`node ${node.id} is above the maximum size`);
    }
  }
  graph.nodes.forEach((node, index) => {
    const previous = graph.nodes[index - 1];
    if (previous !== undefined && compareNodes(previous, node) >= 0) {
      violations.push(`nodes ${previous.id} and ${node.id} are out of order`);
    }
  });
  const edgeIds = new Set<EdgeId>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) violations.push(`duplicate edge id ${edge.id}`);
    edgeIds.add(edge.id);
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (edge.source === edge.target) violations.push(`edge ${edge.id} is a self-loop`);
    if (source === undefined) violations.push(`edge ${edge.id} has no source node`);
    if (target === undefined) violations.push(`edge ${edge.id} has no target node`);
    if (source !== undefined && !hasPort(source.type, edge.sourcePort)) {
      violations.push(`edge ${edge.id} uses a source port the node does not have`);
    }
    if (target !== undefined && !hasPort(target.type, edge.targetPort)) {
      violations.push(`edge ${edge.id} uses a target port the node does not have`);
    }
  }
  return violations;
}

export function isGraphValid(graph: Graph): boolean {
  return findViolations(graph).length === 0;
}
