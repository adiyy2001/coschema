import type * as Y from 'yjs';
import type { EdgeId, NodeId } from './ids';
import type { NodeType, PortId, Size, Vec2 } from './node-types';

export const SCHEMA_VERSION = 1;

export const ROOT_NODES = 'nodes';
export const ROOT_EDGES = 'edges';
export const ROOT_META = 'meta';

export const NODE_KEYS = {
  type: 'type',
  pos: 'pos',
  size: 'size',
  z: 'z',
  style: 'style',
  label: 'label',
} as const;

export const EDGE_KEYS = {
  source: 'source',
  target: 'target',
  sourcePort: 'sourcePort',
  targetPort: 'targetPort',
  waypoints: 'waypoints',
} as const;

export const META_KEYS = {
  schemaVersion: 'schemaVersion',
} as const;

export interface NodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
}

export const STYLE_KEYS = ['fill', 'stroke', 'strokeWidth', 'fontSize'] as const;

export type YNode = Y.Map<unknown>;
export type YEdge = Y.Map<unknown>;
export type YNodes = Y.Map<YNode>;
export type YEdges = Y.Map<YEdge>;

export interface NodeInit {
  id?: NodeId;
  type: NodeType;
  pos: Vec2;
  size?: Size;
  z?: string;
  label?: string;
  style?: NodeStyle;
}

export interface EdgeInit {
  id?: EdgeId;
  source: NodeId;
  target: NodeId;
  sourcePort: PortId;
  targetPort: PortId;
  waypoints?: readonly Vec2[];
}

export function getNodes(doc: Y.Doc): YNodes {
  return doc.getMap<YNode>(ROOT_NODES);
}

export function getEdges(doc: Y.Doc): YEdges {
  return doc.getMap<YEdge>(ROOT_EDGES);
}

export function getMeta(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(ROOT_META);
}

export function initializeDocument(doc: Y.Doc, origin: unknown = null): void {
  doc.transact(() => {
    const meta = getMeta(doc);
    if (!meta.has(META_KEYS.schemaVersion)) meta.set(META_KEYS.schemaVersion, SCHEMA_VERSION);
    getNodes(doc);
    getEdges(doc);
  }, origin);
}

export function readSchemaVersion(doc: Y.Doc): number | undefined {
  const version = getMeta(doc).get(META_KEYS.schemaVersion);
  return typeof version === 'number' ? version : undefined;
}
