import * as Y from 'yjs';
import {
  compareEdges,
  compareNodes,
  readNode,
  readRawEdge,
  toVisibleEdge,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type RawEdge,
} from './graph';
import type { EdgeId, NodeId } from './ids';
import { getEdges, getNodes } from './schema';

export interface GraphDelta {
  readonly addedNodes: readonly GraphNode[];
  readonly updatedNodes: readonly GraphNode[];
  readonly removedNodes: readonly NodeId[];
  readonly addedEdges: readonly GraphEdge[];
  readonly updatedEdges: readonly GraphEdge[];
  readonly removedEdges: readonly EdgeId[];
  readonly previousNodes: ReadonlyMap<NodeId, GraphNode>;
}

export interface GraphChange {
  readonly origin: unknown;
  readonly local: boolean;
  readonly authors: readonly number[];
}

export type GraphListener = (delta: GraphDelta, change: GraphChange) => void;

function authorsOf(transaction: Y.Transaction): number[] {
  const authors: number[] = [];
  for (const [clientId, clock] of transaction.afterState) {
    if (clock > (transaction.beforeState.get(clientId) ?? 0)) authors.push(clientId);
  }
  return authors.sort((left, right) => left - right);
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectDirtyIds<T>(
  events: readonly Y.YEvent<Y.AbstractType<unknown>>[],
  root: Y.Map<T>,
  into: Set<string>,
): void {
  for (const event of events) {
    if (event.target === root) {
      for (const key of (event as Y.YMapEvent<unknown>).keys.keys()) into.add(key);
      continue;
    }
    const head = event.path[0];
    if (typeof head === 'string') into.add(head);
  }
}

export class GraphStore {
  private readonly nodeRecords = new Map<NodeId, GraphNode>();
  private readonly rawEdges = new Map<EdgeId, RawEdge>();
  private readonly visibleEdges = new Map<EdgeId, GraphEdge>();
  private readonly edgesByNode = new Map<NodeId, Set<EdgeId>>();
  private readonly dirtyNodes = new Set<NodeId>();
  private readonly dirtyEdges = new Set<EdgeId>();
  private readonly listeners = new Set<GraphListener>();
  private cachedGraph: Graph | undefined;
  private destroyed = false;

  constructor(private readonly doc: Y.Doc) {
    getNodes(doc).forEach((_, id) => this.dirtyNodes.add(id));
    getEdges(doc).forEach((_, id) => this.dirtyEdges.add(id));
    this.process();
    getNodes(doc).observeDeep(this.onNodeEvents);
    getEdges(doc).observeDeep(this.onEdgeEvents);
    doc.on('afterTransaction', this.onAfterTransaction);
  }

  getGraph(): Graph {
    if (this.cachedGraph === undefined) {
      this.cachedGraph = {
        nodes: [...this.nodeRecords.values()].sort(compareNodes),
        edges: [...this.visibleEdges.values()].sort(compareEdges),
      };
    }
    return this.cachedGraph;
  }

  getNode(id: NodeId): GraphNode | undefined {
    return this.nodeRecords.get(id);
  }

  getEdge(id: EdgeId): GraphEdge | undefined {
    return this.visibleEdges.get(id);
  }

  get nodeCount(): number {
    return this.nodeRecords.size;
  }

  get edgeCount(): number {
    return this.visibleEdges.size;
  }

  subscribe(listener: GraphListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    getNodes(this.doc).unobserveDeep(this.onNodeEvents);
    getEdges(this.doc).unobserveDeep(this.onEdgeEvents);
    this.doc.off('afterTransaction', this.onAfterTransaction);
    this.listeners.clear();
  }

  private readonly onNodeEvents = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    collectDirtyIds(events, getNodes(this.doc), this.dirtyNodes);
  };

  private readonly onEdgeEvents = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    collectDirtyIds(events, getEdges(this.doc), this.dirtyEdges);
  };

  private readonly onAfterTransaction = (transaction: Y.Transaction): void => {
    if (this.dirtyNodes.size === 0 && this.dirtyEdges.size === 0) return;
    const delta = this.process();
    if (delta === undefined) return;
    const change: GraphChange = {
      origin: transaction.origin,
      local: transaction.local,
      authors: authorsOf(transaction),
    };
    for (const listener of [...this.listeners]) listener(delta, change);
  };

  private process(): GraphDelta | undefined {
    const addedNodes: GraphNode[] = [];
    const updatedNodes: GraphNode[] = [];
    const removedNodes: NodeId[] = [];
    const previousNodes = new Map<NodeId, GraphNode>();
    const edgesToCheck = new Set<EdgeId>(this.dirtyEdges);
    const nodes = getNodes(this.doc);
    for (const id of this.dirtyNodes) {
      const previous = this.nodeRecords.get(id);
      const yNode = nodes.get(id);
      if (!(yNode instanceof Y.Map)) {
        if (previous === undefined) continue;
        this.nodeRecords.delete(id);
        previousNodes.set(id, previous);
        removedNodes.push(id);
        this.collectIncident(id, edgesToCheck);
        continue;
      }
      const next = readNode(id, yNode);
      if (previous === undefined) {
        this.nodeRecords.set(id, next);
        addedNodes.push(next);
        this.collectIncident(id, edgesToCheck);
      } else if (!sameRecord(previous, next)) {
        this.nodeRecords.set(id, next);
        previousNodes.set(id, previous);
        updatedNodes.push(next);
        if (previous.type !== next.type) this.collectIncident(id, edgesToCheck);
      }
    }
    this.refreshRawEdges();
    const edgeChanges = this.refreshVisibleEdges(edgesToCheck);
    this.dirtyNodes.clear();
    this.dirtyEdges.clear();
    const changed =
      addedNodes.length + updatedNodes.length + removedNodes.length > 0 ||
      edgeChanges.addedEdges.length +
        edgeChanges.updatedEdges.length +
        edgeChanges.removedEdges.length >
        0;
    if (!changed) return undefined;
    this.cachedGraph = undefined;
    return { addedNodes, updatedNodes, removedNodes, previousNodes, ...edgeChanges };
  }

  private collectIncident(nodeId: NodeId, into: Set<EdgeId>): void {
    const incident = this.edgesByNode.get(nodeId);
    if (incident === undefined) return;
    for (const edgeId of incident) into.add(edgeId);
  }

  private refreshRawEdges(): void {
    const yEdges = getEdges(this.doc);
    for (const id of this.dirtyEdges) {
      const previous = this.rawEdges.get(id);
      if (previous !== undefined) this.unindexEdge(previous);
      const yEdge = yEdges.get(id);
      const next = yEdge instanceof Y.Map ? readRawEdge(id, yEdge) : undefined;
      if (next === undefined) {
        this.rawEdges.delete(id);
      } else {
        this.rawEdges.set(id, next);
        this.indexEdge(next);
      }
    }
  }

  private refreshVisibleEdges(
    ids: ReadonlySet<EdgeId>,
  ): Pick<GraphDelta, 'addedEdges' | 'updatedEdges' | 'removedEdges'> {
    const addedEdges: GraphEdge[] = [];
    const updatedEdges: GraphEdge[] = [];
    const removedEdges: EdgeId[] = [];
    for (const id of ids) {
      const raw = this.rawEdges.get(id);
      const next =
        raw === undefined
          ? undefined
          : toVisibleEdge(raw, (nodeId) => this.nodeRecords.get(nodeId));
      const previous = this.visibleEdges.get(id);
      if (next === undefined) {
        if (previous === undefined) continue;
        this.visibleEdges.delete(id);
        removedEdges.push(id);
      } else if (previous === undefined) {
        this.visibleEdges.set(id, next);
        addedEdges.push(next);
      } else if (!sameRecord(previous, next)) {
        this.visibleEdges.set(id, next);
        updatedEdges.push(next);
      }
    }
    return { addedEdges, updatedEdges, removedEdges };
  }

  private indexEdge(edge: RawEdge): void {
    for (const nodeId of [edge.source, edge.target]) {
      const bucket = this.edgesByNode.get(nodeId) ?? new Set<EdgeId>();
      bucket.add(edge.id);
      this.edgesByNode.set(nodeId, bucket);
    }
  }

  private unindexEdge(edge: RawEdge): void {
    for (const nodeId of [edge.source, edge.target]) {
      const bucket = this.edgesByNode.get(nodeId);
      if (bucket === undefined) continue;
      bucket.delete(edge.id);
      if (bucket.size === 0) this.edgesByNode.delete(nodeId);
    }
  }
}

export function createGraphStore(doc: Y.Doc): GraphStore {
  return new GraphStore(doc);
}
