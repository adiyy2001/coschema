import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
} from '@angular/core';
import type { EdgeId } from '@coschema/model';
import { nodeName } from '../a11y/describe-change';
import { KeyboardController } from '../a11y/keyboard-controller';
import { DocumentSession } from '../core/document-session';
import { SelectionState } from '../interaction/selection-state';
import { CanvasIds } from './canvas-ids';
import { routePath } from './route-path';

@Component({
  selector: 'g[cs-edge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    'aria-roledescription': 'diagram connection',
    tabindex: '-1',
    '[attr.data-edge-id]': 'edgeId()',
    '[attr.aria-label]': 'accessibleName()',
    '[class.selected]': 'selected()',
    '[class.fallback]': 'fallback()',
    '(focus)': 'onFocus()',
  },
  styles: `
    :host {
      outline: none;
    }
    .line {
      fill: none;
      stroke: var(--cs-edge, #5b6578);
      stroke-width: 1.5;
    }
    :host(.selected) .line {
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 2.5;
    }
    :host(.fallback) .line {
      stroke-dasharray: 6 4;
    }
    .ring {
      display: none;
      fill: none;
      vector-effect: non-scaling-stroke;
      pointer-events: none;
    }
    .ring.halo {
      stroke: var(--cs-canvas, #f6f7f9);
      stroke-width: 9;
    }
    .ring.band {
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 5;
    }
    :host(:focus-visible) .ring {
      display: block;
    }
  `,
  template: `
    @if (path(); as d) {
      <svg:path class="ring halo" [attr.d]="d" />
      <svg:path class="ring band" [attr.d]="d" />
      <svg:path class="line" [attr.d]="d" [attr.marker-end]="ids.arrowReference" />
    }
  `,
})
export class EdgeComponent {
  readonly edgeId = input.required<EdgeId>();
  protected readonly ids = inject(CanvasIds);
  private readonly session = inject(DocumentSession);
  private readonly selection = inject(SelectionState);
  private readonly keyboard = inject(KeyboardController);
  private readonly host = inject<ElementRef<SVGGElement>>(ElementRef);

  private readonly route = computed(() => this.session.graph.route(this.edgeId())());
  protected readonly path = computed(() => {
    const route = this.route();
    return route === undefined ? '' : routePath(route.points);
  });
  protected readonly fallback = computed(() => this.route()?.fallback ?? false);
  protected readonly selected = computed(() => this.selection.hasEdge(this.edgeId()));
  protected readonly accessibleName = computed(() => {
    const edge = this.session.graph.edge(this.edgeId())();
    if (edge === undefined) return null;
    const source = this.session.graph.node(edge.source)();
    const target = this.session.graph.node(edge.target)();
    const from = source === undefined ? 'a node' : nodeName(source);
    const to = target === undefined ? 'a node' : nodeName(target);
    return `Connection from ${from} to ${to}`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (globalThis.document.activeElement !== this.host.nativeElement) return;
      queueMicrotask(() => {
        this.keyboard.focusFallback();
      });
    });
  }

  protected onFocus(): void {
    this.keyboard.adopt({ kind: 'edge', id: this.edgeId() });
  }
}
