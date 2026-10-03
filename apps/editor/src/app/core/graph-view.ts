import { type Signal, signal } from '@angular/core';
import {
  RouteCache,
  SpatialGrid,
  inflateRect,
  rectsIntersect,
  unionRects,
  type CellWindow,
  type Rect,
  type Route,
} from '@coschema/geometry';
import {
  GraphStore,
  compareNodes,
  type EdgeId,
  type GraphChange,
  type GraphDelta,
  type GraphEdge,
  type GraphNode,
  type NodeId,
  type Vec2,
} from '@coschema/model';
import type { FrameScheduler } from './frame-scheduler';
import { SignalMap } from './signal-map';
import { distanceToPolyline, nodeContainsPoint, nodeRect } from './shapes';
import type * as Y from 'yjs';

const EDGE_AREA_MARGIN = 12;
const ROUTE_INVALIDATION_MARGIN = 16;

export interface ExportEdge {
  readonly id: EdgeId;
  readonly points: readonly Vec2[];
  readonly fallback: boolean;
}

export interface ExportScene {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly ExportEdge[];
}

export interface NodePosition {
  readonly id: NodeId;
  readonly pos: Vec2;
}

function sameRect(left: Rect | undefined, right: Rect | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

export class GraphView {
  readonly revision = signal(0);
  readonly nodeCount = signal(0);
  readonly edgeCount = signal(0);
  readonly nodeGrid = new SpatialGrid<NodeId>();
  readonly edgeGrid = new SpatialGrid<EdgeId>();

  private readonly store: GraphStore;
  private readonly nodes = new SignalMap<NodeId, GraphNode>();
  private readonly edges = new SignalMap<EdgeId, GraphEdge>();
  private readonly routes = new SignalMap<EdgeId, Route>();
  private readonly routeCache = new RouteCache();
  private readonly incidence = new Map<NodeId, Set<EdgeId>>();
  private readonly edgeEnds = new Map<EdgeId, readonly [NodeId, NodeId]>();
  private readonly previews = new Map<NodeId, Vec2>();
  private readonly dirtyNodes = new Set<NodeId>();
  private readonly dirtyEdges = new Set<EdgeId>();
  private activeEdges = new Set<EdgeId>();
  private cancelFrame: (() => void) | undefined;
  private readonly changeListeners = new Set<(delta: GraphDelta, change: GraphChange) => void>();
  private readonly unsubscribe: () => void;

  constructor(
    doc: Y.Doc,
    private readonly schedule: FrameScheduler,
  ) {
    this.store = new GraphStore(doc);
    const initial = this.store.getGraph();
    for (const node of initial.nodes) this.dirtyNodes.add(node.id);
    for (const edge of initial.edges) this.dirtyEdges.add(edge.id);
    this.flush();
    this.unsubscribe = this.store.subscribe((delta, change) => {
      this.collect(delta);
      for (const listener of [...this.changeListeners]) listener(delta, change);
    });
  }

  subscribeChanges(listener: (delta: GraphDelta, change: GraphChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  node(id: NodeId): Signal<GraphNode | undefined> {
    return this.nodes.read(id);
  }

  edge(id: EdgeId): Signal<GraphEdge | undefined> {
    return this.edges.read(id);
  }

  route(id: EdgeId): Signal<Route | undefined> {
    return this.routes.read(id);
  }

  peekNode(id: NodeId): GraphNode | undefined {
    return this.nodes.peek(id);
  }

  peekEdge(id: EdgeId): GraphEdge | undefined {
    return this.edges.peek(id);
  }

  peekRoute(id: EdgeId): Route | undefined {
    return this.routes.peek(id);
  }

  committedNode(id: NodeId): GraphNode | undefined {
    return this.store.getNode(id);
  }

  nodeIdsInWindow(window: CellWindow): NodeId[] {
    return this.sortedNodes(this.nodeGrid.queryWindow(window).map((entry) => entry.id));
  }

  nodeIdsInArea(area: Rect): NodeId[] {
    return this.sortedNodes(this.nodeGrid.query(area).map((entry) => entry.id));
  }

  edgeIdsInWindow(window: CellWindow): EdgeId[] {
    return this.edgeGrid
      .queryWindow(window)
      .map((entry) => entry.id)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  }

  nodeAt(point: Vec2): NodeId | undefined {
    const candidates = this.sortedNodes(
      this.nodeGrid
        .query({ x: point[0], y: point[1], width: 0, height: 0 })
        .map((entry) => entry.id),
    );
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const id = candidates[index];
      const node = id === undefined ? undefined : this.nodes.peek(id);
      if (node !== undefined && nodeContainsPoint(node, point)) return node.id;
    }
    return undefined;
  }

  edgeAt(point: Vec2, tolerance: number): EdgeId | undefined {
    let best: EdgeId | undefined;
    let bestDistance = tolerance;
    for (const id of this.activeEdges) {
      const route = this.routes.peek(id);
      if (route === undefined) continue;
      const distance = distanceToPolyline(point, route.points);
      if (distance <= bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  }

  exportScene(): ExportScene {
    const graph = this.store.getGraph();
    const edges: ExportEdge[] = [];
    for (const edge of graph.edges) {
      const route = this.routeOf(edge);
      if (route !== undefined) {
        edges.push({ id: edge.id, points: route.points, fallback: route.fallback });
      }
    }
    return { nodes: [...graph.nodes].sort(compareNodes), edges };
  }

  contentBounds(): Rect | undefined {
    let bounds: Rect | undefined;
    for (const entry of this.nodeGrid.all()) {
      bounds = bounds === undefined ? entry.rect : unionRects(bounds, entry.rect);
    }
    return bounds;
  }

  setPreview(positions: readonly NodePosition[] | undefined): void {
    for (const id of this.previews.keys()) this.dirtyNodes.add(id);
    this.previews.clear();
    for (const position of positions ?? []) {
      this.previews.set(position.id, position.pos);
      this.dirtyNodes.add(position.id);
    }
    this.requestFlush();
  }

  activate(ids: readonly EdgeId[]): void {
    const next = new Set(ids);
    for (const id of this.activeEdges) {
      if (!next.has(id)) this.routes.set(id, undefined);
    }
    const previous = this.activeEdges;
    this.activeEdges = next;
    for (const id of next) {
      if (!previous.has(id)) this.computeRoute(id);
    }
  }

  flush(): void {
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    if (this.dirtyNodes.size === 0 && this.dirtyEdges.size === 0) return;
    const changedAreas: Rect[] = [];
    const edgesToRefresh = new Set(this.dirtyEdges);
    for (const id of this.dirtyNodes) this.refreshNode(id, changedAreas, edgesToRefresh);
    this.dirtyNodes.clear();
    this.dirtyEdges.clear();
    for (const id of edgesToRefresh) this.refreshEdge(id);
    this.rerouteActive(changedAreas, edgesToRefresh);
    this.nodeCount.set(this.store.nodeCount);
    this.edgeCount.set(this.store.edgeCount);
    this.revision.update((value) => value + 1);
  }

  destroy(): void {
    this.unsubscribe();
    this.changeListeners.clear();
    this.cancelFrame?.();
    this.cancelFrame = undefined;
    this.store.destroy();
  }

  private collect(delta: GraphDelta): void {
    for (const node of delta.addedNodes) this.dirtyNodes.add(node.id);
    for (const node of delta.updatedNodes) this.dirtyNodes.add(node.id);
    for (const id of delta.removedNodes) this.dirtyNodes.add(id);
    for (const edge of delta.addedEdges) this.dirtyEdges.add(edge.id);
    for (const edge of delta.updatedEdges) this.dirtyEdges.add(edge.id);
    for (const id of delta.removedEdges) this.dirtyEdges.add(id);
    this.requestFlush();
  }

  private requestFlush(): void {
    if (this.cancelFrame !== undefined) return;
    this.cancelFrame = this.schedule(() => {
      this.cancelFrame = undefined;
      this.flush();
    });
  }

  private effectiveNode(id: NodeId): GraphNode | undefined {
    const record = this.store.getNode(id);
    const preview = this.previews.get(id);
    if (record === undefined || preview === undefined) return record;
    return { ...record, pos: preview };
  }

  private refreshNode(id: NodeId, changedAreas: Rect[], edgesToRefresh: Set<EdgeId>): void {
    const previousRect = this.nodeGrid.rectOf(id);
    const next = this.effectiveNode(id);
    if (next === undefined) {
      this.nodeGrid.remove(id);
      this.nodes.set(id, undefined);
      if (previousRect !== undefined) changedAreas.push(previousRect);
      this.collectIncident(id, edgesToRefresh);
      return;
    }
    const nextRect = nodeRect(next);
    if (previousRect === undefined) this.nodeGrid.insert(id, nextRect);
    else this.nodeGrid.move(id, nextRect);
    this.nodes.set(id, next);
    if (sameRect(previousRect, nextRect)) return;
    changedAreas.push(nextRect);
    if (previousRect !== undefined) changedAreas.push(previousRect);
    this.collectIncident(id, edgesToRefresh);
  }

  private collectIncident(nodeId: NodeId, into: Set<EdgeId>): void {
    const incident = this.incidence.get(nodeId);
    if (incident === undefined) return;
    for (const edgeId of incident) into.add(edgeId);
  }

  private refreshEdge(id: EdgeId): void {
    const previousEnds = this.edgeEnds.get(id);
    if (previousEnds !== undefined) {
      for (const nodeId of previousEnds) this.incidence.get(nodeId)?.delete(id);
      this.edgeEnds.delete(id);
    }
    const edge = this.store.getEdge(id);
    const source = edge === undefined ? undefined : this.nodeGrid.rectOf(edge.source);
    const target = edge === undefined ? undefined : this.nodeGrid.rectOf(edge.target);
    if (edge === undefined || source === undefined || target === undefined) {
      this.edges.set(id, undefined);
      this.edgeGrid.remove(id);
      this.routes.set(id, undefined);
      this.routeCache.invalidate(id);
      return;
    }
    this.edgeEnds.set(id, [edge.source, edge.target]);
    for (const nodeId of [edge.source, edge.target]) {
      const bucket = this.incidence.get(nodeId) ?? new Set<EdgeId>();
      bucket.add(id);
      this.incidence.set(nodeId, bucket);
    }
    this.edges.set(id, edge);
    const area = inflateRect(unionRects(source, target), EDGE_AREA_MARGIN);
    if (this.edgeGrid.has(id)) this.edgeGrid.move(id, area);
    else this.edgeGrid.insert(id, area);
  }

  private rerouteActive(changedAreas: readonly Rect[], touched: ReadonlySet<EdgeId>): void {
    for (const id of this.activeEdges) {
      if (touched.has(id) || this.isRouteAffected(id, changedAreas)) this.computeRoute(id);
    }
  }

  private isRouteAffected(id: EdgeId, changedAreas: readonly Rect[]): boolean {
    if (changedAreas.length === 0) return false;
    const route = this.routes.peek(id);
    if (route === undefined) return false;
    return route.dependencies.some((dependency) =>
      changedAreas.some((area) =>
        rectsIntersect(inflateRect(area, ROUTE_INVALIDATION_MARGIN), dependency),
      ),
    );
  }

  private computeRoute(id: EdgeId): void {
    const edge = this.edges.peek(id);
    this.routes.set(id, edge === undefined ? undefined : this.routeOf(edge));
  }

  private routeOf(edge: GraphEdge): Route | undefined {
    const source = this.nodeGrid.rectOf(edge.source);
    const target = this.nodeGrid.rectOf(edge.target);
    if (source === undefined || target === undefined) return undefined;
    return this.routeCache.route(
      edge.id,
      {
        source: { id: edge.source, rect: source, port: edge.sourcePort },
        target: { id: edge.target, rect: target, port: edge.targetPort },
        waypoints: edge.waypoints,
      },
      this.nodeGrid,
    );
  }

  private sortedNodes(ids: readonly NodeId[]): NodeId[] {
    const nodes: GraphNode[] = [];
    for (const id of ids) {
      const node = this.nodes.peek(id);
      if (node !== undefined) nodes.push(node);
    }
    return nodes.sort(compareNodes).map((node) => node.id);
  }
}
