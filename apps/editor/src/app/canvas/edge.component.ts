import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { EdgeId } from '@coschema/model';
import { DocumentSession } from '../core/document-session';
import { SelectionState } from '../interaction/selection-state';
import { routePath } from './route-path';

@Component({
  selector: 'g[cs-edge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-edge-id]': 'edgeId()',
    '[class.selected]': 'selected()',
    '[class.fallback]': 'fallback()',
  },
  styles: `
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
  `,
  template: `
    @if (path(); as d) {
      <svg:path class="line" [attr.d]="d" marker-end="url(#cs-arrow)" />
    }
  `,
})
export class EdgeComponent {
  readonly edgeId = input.required<EdgeId>();
  private readonly session = inject(DocumentSession);
  private readonly selection = inject(SelectionState);

  private readonly route = computed(() => this.session.graph.route(this.edgeId())());
  protected readonly path = computed(() => {
    const route = this.route();
    return route === undefined ? '' : routePath(route.points);
  });
  protected readonly fallback = computed(() => this.route()?.fallback ?? false);
  protected readonly selected = computed(() => this.selection.hasEdge(this.edgeId()));
}
