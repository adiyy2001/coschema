import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  DEFAULT_GRID_SIZE,
  inflateRect,
  zoomAround,
  zoomByFactorAround,
  type Rect,
  type Vec2,
} from '@coschema/geometry';
import {
  connect,
  createNode,
  deleteEdges,
  deleteNodes,
  moveNodes,
  portAnchor,
  portsOf,
  type NodeId,
  type PortId,
} from '@coschema/model';
import { ViewportState } from '../canvas/viewport-state';
import { DocumentSession } from '../core/document-session';
import { reduce } from './machine';
import { SelectionState } from './selection-state';
import {
  IDLE,
  type ConnectPreview,
  type Effect,
  type Hit,
  type InteractionEnv,
  type InteractionEvent,
  type InteractionState,
  type SnapSettings,
  type Tool,
} from './types';

export const PORT_HIT_RADIUS_PIXELS = 9;
export const EDGE_HIT_TOLERANCE_PIXELS = 6;
const MAX_PORT_NODES = 8;
const ZOOM_STEP = 1.25;

@Injectable()
export class InteractionController {
  private readonly session = inject(DocumentSession);
  private readonly viewport = inject(ViewportState);
  private readonly selection = inject(SelectionState);

  readonly tool = signal<Tool>('select');
  readonly snap = signal<SnapSettings>({ enabled: true, gridSize: DEFAULT_GRID_SIZE });
  readonly state = signal<InteractionState>(IDLE);
  readonly marquee = signal<Rect | undefined>(undefined);
  readonly connectPreview = signal<ConnectPreview | undefined>(undefined);
  readonly hoverNode = signal<NodeId | undefined>(undefined);
  readonly hoverHit = signal<Hit['kind']>('canvas');
  readonly editingNode = signal<NodeId | undefined>(undefined);
  readonly portNodes = computed(() => {
    const ids = new Set<NodeId>(this.selection.selection().nodes.slice(0, MAX_PORT_NODES));
    const hovered = this.hoverNode();
    if (hovered !== undefined) ids.add(hovered);
    const preview = this.connectPreview();
    if (preview !== undefined) ids.add(preview.sourceId);
    if (preview?.target !== undefined) ids.add(preview.target.id);
    return [...ids];
  });

  constructor() {
    effect(() => {
      const graph = this.session.graph;
      graph.revision();
      untracked(() => {
        this.selection.retain(
          (id) => graph.peekNode(id) !== undefined,
          (id) => graph.peekEdge(id) !== undefined,
        );
        const editing = this.editingNode();
        if (editing !== undefined && graph.peekNode(editing) === undefined) {
          this.editingNode.set(undefined);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.session.graph.setPreview(undefined);
    });
  }

  dispatch(event: InteractionEvent): void {
    const { state, effects } = reduce(this.state(), event, this.environment());
    this.state.set(state);
    for (const effect of effects) this.apply(effect);
  }

  updateHover(screen: Vec2): void {
    const world = this.toWorld(screen);
    const hit = this.hitTest(world);
    const hovered = hit.kind === 'node' || hit.kind === 'port' ? hit.id : this.nodeNearPorts(world);
    if (this.hoverNode() !== hovered) this.hoverNode.set(hovered);
    if (this.hoverHit() !== hit.kind) this.hoverHit.set(hit.kind);
  }

  clearHover(): void {
    this.hoverNode.set(undefined);
    this.hoverHit.set('canvas');
  }

  hitTest(world: Vec2): Hit {
    const zoom = this.viewport.zoom();
    const portHit = this.portAt(world, PORT_HIT_RADIUS_PIXELS / zoom);
    if (portHit !== undefined) return portHit;
    const graph = this.session.graph;
    const nodeId = graph.nodeAt(world);
    if (nodeId !== undefined) return { kind: 'node', id: nodeId };
    const edgeId = graph.edgeAt(world, EDGE_HIT_TOLERANCE_PIXELS / zoom);
    if (edgeId !== undefined) return { kind: 'edge', id: edgeId };
    return { kind: 'canvas' };
  }

  nearestPort(id: NodeId, world: Vec2): PortId | undefined {
    const node = this.session.graph.peekNode(id);
    if (node === undefined) return undefined;
    let best: PortId | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const port of portsOf(node.type)) {
      const anchor = portAnchor(node.pos, node.size, port);
      const distance = Math.hypot(anchor[0] - world[0], anchor[1] - world[1]);
      if (distance < bestDistance) {
        best = port;
        bestDistance = distance;
      }
    }
    return best;
  }

  setTool(tool: Tool): void {
    this.tool.set(tool);
  }

  toggleSnap(): void {
    this.snap.update((current) => ({ ...current, enabled: !current.enabled }));
  }

  undo(): void {
    this.endLabelEdit();
    this.session.history.undo();
  }

  redo(): void {
    this.endLabelEdit();
    this.session.history.redo();
  }

  deleteSelection(): void {
    const { nodes, edges } = this.selection.selection();
    if (nodes.length === 0 && edges.length === 0) return;
    const context = this.session.context;
    this.session.history.run(() => {
      deleteEdges(context, edges);
      deleteNodes(context, nodes);
    });
    this.selection.clear();
  }

  startLabelEdit(id: NodeId): void {
    if (this.session.graph.peekNode(id) === undefined) return;
    this.dispatch({ type: 'cancel' });
    this.editingNode.set(id);
  }

  editSelectedLabel(): void {
    const { nodes } = this.selection.selection();
    const [only] = nodes;
    if (nodes.length === 1 && only !== undefined) this.startLabelEdit(only);
  }

  endLabelEdit(): void {
    this.editingNode.set(undefined);
  }

  zoomBy(factor: number): void {
    const screen = this.viewport.screen();
    this.viewport.viewport.update((current) =>
      zoomByFactorAround(current, [screen.width / 2, screen.height / 2], factor),
    );
  }

  zoomIn(): void {
    this.zoomBy(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomBy(1 / ZOOM_STEP);
  }

  resetZoom(): void {
    const screen = this.viewport.screen();
    this.viewport.viewport.update((current) =>
      zoomAround(current, [screen.width / 2, screen.height / 2], 1),
    );
  }

  fit(): void {
    this.viewport.fit(this.session.graph.contentBounds());
  }

  private environment(): InteractionEnv {
    const graph = this.session.graph;
    return {
      viewport: this.viewport.viewport(),
      tool: this.tool(),
      selection: this.selection.selection(),
      snap: this.snap(),
      hitTest: (world) => this.hitTest(world),
      nodeRect: (id) => graph.nodeGrid.rectOf(id),
      nodesIntersecting: (area) => graph.nodeIdsInArea(area),
      nearestPort: (id, world) => this.nearestPort(id, world),
    };
  }

  private toWorld(screen: Vec2): Vec2 {
    const viewport = this.viewport.viewport();
    return [(screen[0] - viewport.x) / viewport.zoom, (screen[1] - viewport.y) / viewport.zoom];
  }

  private portAt(world: Vec2, radius: number): Hit | undefined {
    for (const id of this.portNodes()) {
      const node = this.session.graph.peekNode(id);
      if (node === undefined) continue;
      for (const port of portsOf(node.type)) {
        const anchor = portAnchor(node.pos, node.size, port);
        if (Math.hypot(anchor[0] - world[0], anchor[1] - world[1]) <= radius) {
          return { kind: 'port', id, port };
        }
      }
    }
    return undefined;
  }

  private nodeNearPorts(world: Vec2): NodeId | undefined {
    const radius = PORT_HIT_RADIUS_PIXELS / this.viewport.zoom();
    const area = inflateRect({ x: world[0], y: world[1], width: 0, height: 0 }, radius);
    const candidates = this.session.graph.nodeIdsInArea(area);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const id = candidates[index];
      const node = id === undefined ? undefined : this.session.graph.peekNode(id);
      if (node === undefined) continue;
      const near = portsOf(node.type).some((port) => {
        const anchor = portAnchor(node.pos, node.size, port);
        return Math.hypot(anchor[0] - world[0], anchor[1] - world[1]) <= radius;
      });
      if (near) return node.id;
    }
    return undefined;
  }

  private apply(effect: Effect): void {
    switch (effect.kind) {
      case 'select':
        this.selection.set(effect.selection);
        return;
      case 'previewMove':
        this.session.graph.setPreview(effect.moves);
        return;
      case 'clearPreview':
        this.session.graph.setPreview(undefined);
        return;
      case 'commitMove':
        this.session.history.run(() => {
          moveNodes(this.session.context, effect.moves);
        });
        return;
      case 'viewport':
        this.viewport.viewport.set(effect.viewport);
        return;
      case 'marquee':
        this.marquee.set(effect.rect);
        return;
      case 'connectPreview':
        this.connectPreview.set(effect.preview);
        return;
      case 'connect':
        this.connectNodes(effect);
        return;
      case 'createNode':
        this.createNodeAt(effect.nodeType, effect.position);
        return;
    }
  }

  private connectNodes(effect: Extract<Effect, { kind: 'connect' }>): void {
    const id = connect(this.session.context, {
      source: effect.sourceId,
      target: effect.targetId,
      sourcePort: effect.sourcePort,
      targetPort: effect.targetPort,
    });
    if (id !== undefined) this.selection.set({ nodes: [], edges: [id] });
  }

  createNodeAt(
    nodeType: Extract<Effect, { kind: 'createNode' }>['nodeType'],
    position: Vec2,
  ): NodeId {
    const id = createNode(this.session.context, { type: nodeType, pos: position });
    this.selection.set({ nodes: [id], edges: [] });
    this.tool.set('select');
    return id;
  }
}
