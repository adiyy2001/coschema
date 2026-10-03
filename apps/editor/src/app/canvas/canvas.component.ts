import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  untracked,
  viewChild,
} from '@angular/core';
import type { Vec2 } from '@coschema/geometry';
import { KeyboardController } from '../a11y/keyboard-controller';
import { ShortcutsDialogComponent } from '../a11y/shortcuts-dialog.component';
import { readingOrder } from '../a11y/ordering';
import { Collaboration } from '../collab/collaboration';
import { DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { CursorsLayerComponent } from '../presence/cursors-layer.component';
import { PresenceLayerComponent } from '../presence/presence-layer.component';
import { CanvasIds } from './canvas-ids';
import { EdgeComponent } from './edge.component';
import { LabelEditorComponent } from './label-editor.component';
import { NodeComponent } from './node.component';
import { OverlayComponent } from './overlay.component';
import { OverviewComponent } from './overview.component';
import { ViewportState } from './viewport-state';

const POINTER_FOCUS: FocusOptions & { focusVisible: boolean } = {
  preventScroll: true,
  focusVisible: false,
};
const GRID_SPACING = 24;
const GRID_MIN_ZOOM = 0.4;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

@Component({
  selector: 'cs-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CursorsLayerComponent,
    EdgeComponent,
    LabelEditorComponent,
    NodeComponent,
    OverlayComponent,
    OverviewComponent,
    PresenceLayerComponent,
    ShortcutsDialogComponent,
  ],
  providers: [CanvasIds],
  host: {
    '[class.panning]': 'panning()',
    '[class.grab]': 'grabbing()',
    '[class.crosshair]': 'crosshair()',
    '[class.move]': 'moveCursor()',
  },
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--cs-canvas, #f6f7f9);
    }
    :host(.move) .surface {
      cursor: move;
    }
    :host(.crosshair) .surface {
      cursor: crosshair;
    }
    :host(.grab) .surface {
      cursor: grab;
    }
    :host(.panning) .surface {
      cursor: grabbing;
    }
    .surface {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      user-select: none;
      outline: none;
    }
    .surface:focus-visible {
      outline: 3px solid var(--cs-accent, #1f4fd8);
      outline-offset: -3px;
    }
    .grid-dot {
      fill: var(--cs-grid-dot, #c4c9d4);
    }
    .arrow {
      fill: var(--cs-edge, #5b6578);
    }
  `,
  template: `
    <svg
      #surface
      class="surface"
      role="application"
      aria-label="Diagram canvas"
      [attr.aria-describedby]="ids.hint"
      [attr.tabindex]="keyboard.tabStop() === undefined ? 0 : -1"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      (pointerleave)="onPointerLeave()"
      (wheel)="onWheel($event)"
      (dblclick)="onDoubleClick($event)"
      (keydown)="onKeyDown($event)"
      (keyup)="onKeyUp($event)"
      (contextmenu)="$event.preventDefault()"
    >
      <defs>
        <marker
          [attr.id]="ids.arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path class="arrow" d="M0 1 L10 5 L0 9 Z" />
        </marker>
        <pattern
          [attr.id]="ids.grid"
          [attr.width]="gridSpacing"
          [attr.height]="gridSpacing"
          patternUnits="userSpaceOnUse"
          [attr.patternTransform]="viewport.transform()"
        >
          <circle class="grid-dot" [attr.cx]="gridSpacing / 2" [attr.cy]="gridSpacing / 2" r="1" />
        </pattern>
      </defs>
      @if (showGrid()) {
        <rect width="100%" height="100%" [attr.fill]="ids.gridReference" />
      }
      <g [attr.transform]="viewport.transform()">
        @if (viewport.detail() === 'minimal') {
          <g cs-overview></g>
        } @else {
          <g class="edges">
            @for (id of visibleEdgeIds(); track id) {
              <g cs-edge [edgeId]="id"></g>
            }
          </g>
          <g class="nodes">
            @for (id of visibleNodeIds(); track id) {
              <g cs-node [nodeId]="id"></g>
            }
          </g>
        }
        @if (collaboration) {
          <g cs-presence></g>
          <g cs-cursors></g>
        }
        <g cs-overlay></g>
      </g>
    </svg>
    <p class="sr-only" [attr.id]="ids.hint">
      Press N to move through nodes, Alt with an arrow key to jump to a neighbour, C to connect,
      Enter to edit a label, and the question mark for all shortcuts.
    </p>
    <cs-label-editor (closed)="keyboard.restoreFocus()" />
    <cs-shortcuts-dialog />
  `,
})
export class CanvasComponent {
  protected readonly gridSpacing = GRID_SPACING;
  protected readonly viewport = inject(ViewportState);
  protected readonly controller = inject(InteractionController);
  protected readonly keyboard = inject(KeyboardController);
  protected readonly ids = inject(CanvasIds);
  private readonly session = inject(DocumentSession);
  protected readonly collaboration = inject(Collaboration, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly surface = viewChild.required<ElementRef<SVGSVGElement>>('surface');
  private readonly injector = inject(Injector);
  private spaceHeld = false;

  protected readonly showGrid = computed(() => this.viewport.zoom() >= GRID_MIN_ZOOM);
  protected readonly panning = computed(() => this.controller.state().mode === 'pan');
  protected readonly grabbing = computed(() => this.controller.tool() === 'hand');
  protected readonly crosshair = computed(() => {
    const tool = this.controller.tool();
    return (tool !== 'select' && tool !== 'hand') || this.controller.hoverHit() === 'port';
  });
  protected readonly moveCursor = computed(() => this.controller.hoverHit() === 'node');
  protected readonly visibleNodeIds = computed(
    () => {
      const graph = this.session.graph;
      graph.revision();
      const ids = graph.nodeIdsInWindow(this.viewport.window());
      const focus = this.keyboard.focus();
      if (focus?.kind !== 'node' || ids.includes(focus.id)) return ids;
      return graph.peekNode(focus.id) === undefined ? ids : [...ids, focus.id];
    },
    { equal: sameIds },
  );
  protected readonly visibleEdgeIds = computed(
    () => {
      const graph = this.session.graph;
      graph.revision();
      const ids = graph.edgeIdsInWindow(this.viewport.window());
      const focus = this.keyboard.focus();
      if (focus?.kind !== 'edge' || ids.includes(focus.id)) return ids;
      return graph.peekEdge(focus.id) === undefined ? ids : [...ids, focus.id];
    },
    { equal: sameIds },
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => {
      this.session.graph.activate(
        this.viewport.detail() === 'minimal' ? [] : this.visibleEdgeIds(),
      );
    });
    effect(() => {
      const nodes = this.visibleNodeIds();
      const focus = this.keyboard.focus();
      const minimal = this.viewport.detail() === 'minimal';
      untracked(() => {
        this.keyboard.tabStop.set(minimal ? undefined : this.pickTabStop(nodes, focus));
      });
    });
    effect(() => {
      const request = this.keyboard.focusRequest();
      if (request === undefined) return;
      afterNextRender(
        () => {
          this.focusRequested(request.target);
        },
        { injector: this.injector },
      );
    });
    afterNextRender(() => {
      this.measure();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        this.measure();
      });
      observer.observe(this.host.nativeElement);
      destroyRef.onDestroy(() => {
        observer.disconnect();
      });
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    const surface = this.surface().nativeElement;
    surface.setPointerCapture(event.pointerId);
    surface.focus(POINTER_FOCUS);
    event.preventDefault();
    this.controller.dispatch({
      type: 'pointerdown',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      button: event.button,
      screen: this.screenOf(event),
      shift: event.shiftKey,
      toggle: event.ctrlKey || event.metaKey,
      space: this.spaceHeld,
    });
  }

  protected onPointerMove(event: PointerEvent): void {
    const screen = this.screenOf(event);
    this.collaboration?.publishCursor(this.worldOf(event));
    this.controller.dispatch({ type: 'pointermove', pointerId: event.pointerId, screen });
    if (this.controller.state().mode === 'idle' && event.pointerType !== 'touch') {
      this.controller.updateHover(screen);
    }
  }

  protected onPointerLeave(): void {
    this.controller.clearHover();
    this.collaboration?.publishCursor(null);
  }

  protected onPointerUp(event: PointerEvent): void {
    this.controller.dispatch({
      type: 'pointerup',
      pointerId: event.pointerId,
      screen: this.screenOf(event),
    });
  }

  protected onPointerCancel(event: PointerEvent): void {
    this.controller.dispatch({ type: 'pointercancel', pointerId: event.pointerId });
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.controller.dispatch({
      type: 'wheel',
      screen: this.screenOf(event),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      pageSize: this.viewport.screen().height,
    });
  }

  protected onDoubleClick(event: MouseEvent): void {
    const hit = this.controller.hitTest(this.worldOf(event));
    if (hit.kind === 'node') this.controller.startLabelEdit(hit.id);
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.spaceHeld = true;
      event.preventDefault();
      return;
    }
    if (this.keyboard.handleKey(event)) event.preventDefault();
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') this.spaceHeld = false;
  }

  private pickTabStop(
    nodes: readonly string[],
    focus: ReturnType<KeyboardController['focus']>,
  ): string | undefined {
    if (focus?.kind === 'node' && nodes.includes(focus.id)) return focus.id;
    const graph = this.session.graph;
    const placed = nodes.flatMap((id) => {
      const rect = graph.nodeGrid.rectOf(id);
      return rect === undefined ? [] : [{ id, rect }];
    });
    return readingOrder(placed)[0];
  }

  private focusRequested(target: ReturnType<KeyboardController['focus']> | 'surface'): void {
    const surface = this.surface().nativeElement;
    if (target === 'surface' || target === undefined) {
      surface.focus({ preventScroll: true });
      return;
    }
    const attribute = target.kind === 'node' ? 'data-node-id' : 'data-edge-id';
    const element = surface.querySelector<SVGGElement>(`[${attribute}="${CSS.escape(target.id)}"]`);
    (element ?? surface).focus({ preventScroll: true });
  }

  private screenOf(event: MouseEvent): Vec2 {
    const bounds = this.surface().nativeElement.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  }

  private worldOf(event: MouseEvent): Vec2 {
    const screen = this.screenOf(event);
    const { x, y, zoom } = this.viewport.viewport();
    return [(screen[0] - x) / zoom, (screen[1] - y) / zoom];
  }

  private measure(): void {
    const bounds = this.host.nativeElement.getBoundingClientRect();
    this.viewport.screen.set({ width: bounds.width, height: bounds.height });
  }
}
