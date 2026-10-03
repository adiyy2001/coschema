import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { panBy, normalizeWheel, zoomByFactorAround } from '@coschema/geometry';
import { DocumentSession } from '../core/document-session';
import { EdgeComponent } from './edge.component';
import { NodeComponent } from './node.component';
import { OverviewComponent } from './overview.component';
import { ViewportState } from './viewport-state';

const GRID_SPACING = 24;
const GRID_MIN_ZOOM = 0.4;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

@Component({
  selector: 'cs-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EdgeComponent, NodeComponent, OverviewComponent],
  host: { class: 'canvas-host' },
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--cs-canvas, #f6f7f9);
    }
    .surface {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      user-select: none;
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
      (wheel)="onWheel($event)"
    >
      <defs>
        <marker
          id="cs-arrow"
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
          id="cs-grid"
          [attr.width]="gridSpacing"
          [attr.height]="gridSpacing"
          patternUnits="userSpaceOnUse"
          [attr.patternTransform]="viewport.transform()"
        >
          <circle class="grid-dot" [attr.cx]="gridSpacing / 2" [attr.cy]="gridSpacing / 2" r="1" />
        </pattern>
      </defs>
      @if (showGrid()) {
        <rect width="100%" height="100%" fill="url(#cs-grid)" />
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
      </g>
    </svg>
  `,
})
export class CanvasComponent {
  protected readonly gridSpacing = GRID_SPACING;
  protected readonly viewport = inject(ViewportState);
  private readonly session = inject(DocumentSession);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly surface = viewChild.required<ElementRef<SVGSVGElement>>('surface');

  protected readonly showGrid = computed(() => this.viewport.zoom() >= GRID_MIN_ZOOM);
  protected readonly visibleNodeIds = computed(
    () => {
      this.session.graph.revision();
      return this.session.graph.nodeIdsInWindow(this.viewport.window());
    },
    { equal: sameIds },
  );
  protected readonly visibleEdgeIds = computed(
    () => {
      this.session.graph.revision();
      return this.session.graph.edgeIdsInWindow(this.viewport.window());
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

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const bounds = this.surface().nativeElement.getBoundingClientRect();
    const screen: readonly [number, number] = [
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ];
    const action = normalizeWheel(event, bounds.height);
    const current = this.viewport.viewport();
    this.viewport.viewport.set(
      action.kind === 'zoom'
        ? zoomByFactorAround(current, screen, action.factor)
        : panBy(current, action.delta),
    );
  }

  private measure(): void {
    const bounds = this.host.nativeElement.getBoundingClientRect();
    this.viewport.screen.set({ width: bounds.width, height: bounds.height });
  }
}
