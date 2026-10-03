import {
  Injectable,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { centerOn, rectCenter, rectContainsRect, snapToGrid, zoomAround } from '@coschema/geometry';
import {
  DEFAULT_NODE_SIZES,
  connect,
  moveNodes,
  portAnchor,
  type NodeId,
  type Vec2,
} from '@coschema/model';
import { ViewportState } from '../canvas/viewport-state';
import { COLLAB_CLOCK } from '../collab/collaboration';
import { DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';
import type { Selection } from '../interaction/types';
import { Announcements } from './announcements';
import { portsBetween } from './connect-ports';
import { nodeName, shapeName } from './describe-change';
import {
  BROWSE,
  reduceKey,
  type FocusTarget,
  type KeyEffect,
  type KeyInput,
  type KeyMode,
  type KeyboardEnv,
} from './keyboard-model';
import { MoveBurst } from './move-burst';
import { edgeOrder, readingOrder, type PlacedNode } from './ordering';

export interface FocusRequest {
  readonly target: FocusTarget | 'surface';
  readonly serial: number;
}

const REVEAL_MARGIN_PIXELS = 32;
const REVEAL_ZOOM = 1;
const DEFAULT_NEW_NODE = 'rect' as const;

function toInput(event: KeyboardEvent): KeyInput {
  return {
    key: event.key,
    shift: event.shiftKey,
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    repeat: event.repeat,
  };
}

function selectionOf(target: FocusTarget): Selection {
  return target.kind === 'node'
    ? { nodes: [target.id], edges: [] }
    : { nodes: [], edges: [target.id] };
}

function sameTarget(left: FocusTarget | undefined, right: FocusTarget | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind && left.id === right.id;
}

@Injectable()
export class KeyboardController {
  private readonly session = inject(DocumentSession);
  private readonly viewport = inject(ViewportState);
  private readonly selection = inject(SelectionState);
  private readonly interaction = inject(InteractionController);
  private readonly announcements = inject(Announcements);
  private readonly injector = inject(Injector);
  private readonly burst = new MoveBurst(this.session.history, inject(COLLAB_CLOCK));
  private serial = 0;

  readonly focus = signal<FocusTarget | undefined>(undefined);
  readonly mode = signal<KeyMode>(BROWSE);
  readonly helpOpen = signal(false);
  readonly tabStop = signal<NodeId | undefined>(undefined);
  readonly focusRequest = signal<FocusRequest | undefined>(undefined);

  constructor() {
    effect(() => {
      const current = this.selection.selection();
      untracked(() => {
        this.followSelection(current);
      });
    });
    effect(() => {
      this.session.graph.revision();
      untracked(() => {
        this.dropStaleState();
      });
    });
  }

  handleKey(event: KeyboardEvent): boolean {
    const outcome = reduceKey(this.mode(), toInput(event), this.environment());
    this.mode.set(outcome.mode);
    for (const effectToApply of outcome.effects) this.apply(effectToApply, event.repeat);
    return outcome.handled;
  }

  focusNode(id: NodeId): void {
    this.focusTarget({ kind: 'node', id });
  }

  adopt(target: FocusTarget): void {
    this.focus.set(target);
    const wanted = selectionOf(target);
    const current = this.selection.selection();
    const already =
      current.nodes.length === wanted.nodes.length &&
      current.edges.length === wanted.edges.length &&
      current.nodes.every((id, index) => id === wanted.nodes[index]) &&
      current.edges.every((id, index) => id === wanted.edges[index]);
    if (!already) this.selection.set(wanted);
  }

  restoreFocus(): void {
    const target = this.focus();
    this.requestFocus(target ?? 'surface');
  }

  focusFallback(): void {
    const active = globalThis.document.activeElement;
    if (active !== null && active !== globalThis.document.body) return;
    const stop = this.tabStop();
    if (stop !== undefined && this.session.graph.peekNode(stop) !== undefined) {
      this.focusNode(stop);
      return;
    }
    this.restoreFocus();
  }

  cancelConnect(): void {
    if (this.mode().kind !== 'connect') return;
    this.mode.set(BROWSE);
    this.interaction.connectPreview.set(undefined);
  }

  addNode(): void {
    const screen = this.viewport.screen();
    const view = this.viewport.viewport();
    const center: Vec2 = [
      (screen.width / 2 - view.x) / view.zoom,
      (screen.height / 2 - view.y) / view.zoom,
    ];
    const [width, height] = DEFAULT_NODE_SIZES[DEFAULT_NEW_NODE];
    const grid = this.interaction.snap().gridSize;
    const position: Vec2 = [
      snapToGrid(center[0] - width / 2, grid),
      snapToGrid(center[1] - height / 2, grid),
    ];
    const id = this.interaction.createNodeAt(DEFAULT_NEW_NODE, position);
    this.session.graph.flush();
    this.announcements.announce(`Added a ${shapeName(DEFAULT_NEW_NODE)}.`);
    this.focusNode(id);
  }

  private environment(): KeyboardEnv {
    const graph = this.session.graph;
    const placed = (): PlacedNode[] =>
      graph.nodeGrid.all().map((entry) => ({ id: entry.id, rect: entry.rect }));
    const nodeOrder = (): NodeId[] => readingOrder(placed());
    return {
      focus: this.focus(),
      selection: this.selection.selection(),
      nodeOrder,
      edgeOrder: () =>
        edgeOrder(
          graph.edgeGrid.all().flatMap((entry) => {
            const edge = graph.peekEdge(entry.id);
            return edge === undefined
              ? []
              : [{ id: edge.id, source: edge.source, target: edge.target }];
          }),
          nodeOrder(),
        ),
      gridSize: this.interaction.snap().gridSize,
      placedNodes: placed,
      rectOf: (id) => graph.nodeGrid.rectOf(id),
      nameOf: (target) => this.nameOf(target),
    };
  }

  private nameOf(target: FocusTarget): string {
    const graph = this.session.graph;
    if (target.kind === 'node') {
      const node = graph.peekNode(target.id);
      return node === undefined ? 'a node' : nodeName(node);
    }
    const edge = graph.peekEdge(target.id);
    if (edge === undefined) return 'a connection';
    const source = graph.peekNode(edge.source);
    const destination = graph.peekNode(edge.target);
    return `connection from ${source === undefined ? 'a node' : nodeName(source)} to ${destination === undefined ? 'a node' : nodeName(destination)}`;
  }

  private apply(change: KeyEffect, repeat: boolean): void {
    switch (change.kind) {
      case 'focus':
        this.focusTarget(change.target);
        return;
      case 'move':
        this.moveBy(change.ids, change.dx, change.dy, repeat);
        return;
      case 'panView':
        this.viewport.viewport.update((view) => ({
          ...view,
          x: view.x - change.dx,
          y: view.y - change.dy,
        }));
        return;
      case 'editLabel':
        this.interaction.startLabelEdit(change.id);
        return;
      case 'previewConnect':
        this.previewConnect(change.sourceId, change.targetId);
        return;
      case 'commitConnect':
        this.commitConnect(change.sourceId, change.targetId);
        return;
      case 'cancelConnect':
        this.interaction.connectPreview.set(undefined);
        return;
      case 'deleteSubject':
        this.deleteSubject();
        return;
      case 'undo':
        this.undoOrRedo('undo');
        return;
      case 'redo':
        this.undoOrRedo('redo');
        return;
      case 'help':
        this.helpOpen.set(true);
        return;
      case 'escape':
        this.escape();
        return;
      case 'announce':
        this.announcements.announce(change.text);
        return;
    }
  }

  private focusTarget(target: FocusTarget): void {
    this.adopt(target);
    this.reveal(target);
    this.requestFocus(target);
  }

  private requestFocus(target: FocusTarget | 'surface'): void {
    this.serial += 1;
    this.focusRequest.set({ target, serial: this.serial });
  }

  private reveal(target: FocusTarget): void {
    const graph = this.session.graph;
    const rect =
      target.kind === 'node' ? graph.nodeGrid.rectOf(target.id) : graph.edgeGrid.rectOf(target.id);
    const screen = this.viewport.screen();
    if (rect === undefined || screen.width === 0 || screen.height === 0) return;
    const view = this.viewport.viewport();
    const margin = REVEAL_MARGIN_PIXELS / view.zoom;
    const visible = this.viewport.worldRect();
    const inner = {
      x: visible.x + margin,
      y: visible.y + margin,
      width: Math.max(0, visible.width - 2 * margin),
      height: Math.max(0, visible.height - 2 * margin),
    };
    const hidden = this.viewport.detail() === 'minimal';
    if (!hidden && rectContainsRect(inner, rect)) return;
    const base = hidden
      ? zoomAround(view, [screen.width / 2, screen.height / 2], REVEAL_ZOOM)
      : view;
    this.viewport.viewport.set(centerOn(base, rectCenter(rect), screen));
  }

  private moveBy(ids: readonly NodeId[], dx: number, dy: number, repeat: boolean): void {
    const graph = this.session.graph;
    const snap = this.interaction.snap();
    const moves = ids.flatMap((id) => {
      const node = graph.committedNode(id);
      if (node === undefined) return [];
      const x = node.pos[0] + dx;
      const y = node.pos[1] + dy;
      const pos: Vec2 = snap.enabled
        ? [snapToGrid(x, snap.gridSize), snapToGrid(y, snap.gridSize)]
        : [x, y];
      return [{ id, pos }];
    });
    if (moves.length === 0) return;
    this.burst.run(repeat, () => {
      moveNodes(this.session.context, moves);
    });
    graph.flush();
    const focus = this.focus();
    if (focus !== undefined) this.reveal(focus);
  }

  private previewConnect(sourceId: NodeId, targetId: NodeId | undefined): void {
    const graph = this.session.graph;
    const source = graph.peekNode(sourceId);
    const target = targetId === undefined ? undefined : graph.peekNode(targetId);
    if (source === undefined) return;
    if (target === undefined || targetId === undefined) {
      this.interaction.connectPreview.set({
        sourceId,
        sourcePort: 'e',
        pointer: portAnchor(source.pos, source.size, 'e'),
        target: undefined,
      });
      return;
    }
    const ports = portsBetween(source, target);
    this.interaction.connectPreview.set({
      sourceId,
      sourcePort: ports.sourcePort,
      pointer: portAnchor(target.pos, target.size, ports.targetPort),
      target: { id: targetId, port: ports.targetPort },
    });
  }

  private commitConnect(sourceId: NodeId, targetId: NodeId): void {
    const graph = this.session.graph;
    this.interaction.connectPreview.set(undefined);
    const source = graph.peekNode(sourceId);
    const target = graph.peekNode(targetId);
    if (source === undefined || target === undefined) {
      this.announcements.announce('That node is gone, so nothing was connected.');
      return;
    }
    const ports = portsBetween(source, target);
    const id = connect(this.session.context, { source: sourceId, target: targetId, ...ports });
    const summary = `${nodeName(source)} to ${nodeName(target)}`;
    if (id === undefined) {
      this.announcements.announce(`Could not connect ${summary}.`);
      return;
    }
    graph.flush();
    this.announcements.announce(`Connected ${summary}.`);
    this.focusTarget({ kind: 'edge', id });
  }

  private deleteSubject(): void {
    const focus = this.focus();
    const current = this.selection.selection();
    if (current.nodes.length === 0 && current.edges.length === 0 && focus !== undefined) {
      this.selection.set(selectionOf(focus));
    }
    const doomed = this.selection.selection();
    const count = doomed.nodes.length + doomed.edges.length;
    if (count === 0) return;
    const description =
      count > 1
        ? `${count} items`
        : this.nameOf(
            doomed.nodes[0] === undefined
              ? { kind: 'edge', id: doomed.edges[0] ?? '' }
              : { kind: 'node', id: doomed.nodes[0] },
          );
    const before = this.sequence();
    const index = focus === undefined ? 0 : Math.max(0, this.indexOfTarget(before, focus));
    this.interaction.deleteSelection();
    this.session.graph.flush();
    this.announcements.announce(`Deleted ${description}.`);
    const after = this.sequence();
    const next = after[Math.min(index, after.length - 1)];
    if (next === undefined) {
      this.focus.set(undefined);
      this.requestFocus('surface');
      return;
    }
    this.focusTarget(next);
  }

  private sequence(): FocusTarget[] {
    const environment = this.environment();
    return [
      ...environment.nodeOrder().map((id): FocusTarget => ({ kind: 'node', id })),
      ...environment.edgeOrder().map((id): FocusTarget => ({ kind: 'edge', id })),
    ];
  }

  private indexOfTarget(sequence: readonly FocusTarget[], target: FocusTarget): number {
    return sequence.findIndex((entry) => sameTarget(entry, target));
  }

  private undoOrRedo(direction: 'undo' | 'redo'): void {
    this.interaction.endLabelEdit();
    this.burst.end();
    const history = this.session.history;
    const done = direction === 'undo' ? history.undo() : history.redo();
    if (done) {
      this.announcements.announce(
        direction === 'undo' ? 'Undid your last change.' : 'Redid your change.',
      );
    } else {
      this.announcements.announce(direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
    }
  }

  private escape(): void {
    this.cancelConnect();
    this.interaction.dispatch({ type: 'cancel' });
    this.interaction.setTool('select');
    this.selection.clear();
  }

  private followSelection(current: Selection): void {
    const [onlyNode] = current.nodes;
    const [onlyEdge] = current.edges;
    if (current.nodes.length === 1 && current.edges.length === 0 && onlyNode !== undefined) {
      const target: FocusTarget = { kind: 'node', id: onlyNode };
      if (!sameTarget(this.focus(), target)) this.focus.set(target);
    }
    if (current.nodes.length === 0 && current.edges.length === 1 && onlyEdge !== undefined) {
      const target: FocusTarget = { kind: 'edge', id: onlyEdge };
      if (!sameTarget(this.focus(), target)) this.focus.set(target);
    }
  }

  private dropStaleState(): void {
    const graph = this.session.graph;
    const focus = this.focus();
    const gone =
      focus !== undefined &&
      (focus.kind === 'node' ? graph.peekNode(focus.id) : graph.peekEdge(focus.id)) === undefined;
    if (gone) {
      this.focus.set(undefined);
      afterNextRender(
        () => {
          this.focusFallback();
        },
        { injector: this.injector },
      );
    }
    const mode = this.mode();
    if (mode.kind === 'connect' && graph.peekNode(mode.sourceId) === undefined)
      this.cancelConnect();
  }
}
