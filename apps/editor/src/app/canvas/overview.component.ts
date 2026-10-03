import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { Rect } from '@coschema/geometry';
import { DocumentSession } from '../core/document-session';
import { SelectionState } from '../interaction/selection-state';
import { linesPath, rectsPath } from './overview';

@Component({
  selector: 'g[cs-overview]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .overview-edges {
      fill: none;
      stroke: var(--cs-edge, #5b6578);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .overview-nodes {
      fill: var(--cs-node-fill, #ffffff);
      stroke: var(--cs-node-stroke, #3b4252);
      stroke-width: 1px;
      vector-effect: non-scaling-stroke;
    }
    .overview-selected {
      fill: none;
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 2px;
      vector-effect: non-scaling-stroke;
    }
  `,
  template: `
    <svg:path class="overview-edges" [attr.d]="edgesPath()" />
    <svg:path class="overview-nodes" [attr.d]="nodesPath()" />
    <svg:path class="overview-selected" [attr.d]="selectedPath()" />
  `,
})
export class OverviewComponent {
  private readonly session = inject(DocumentSession);
  private readonly selection = inject(SelectionState);

  protected readonly nodesPath = computed(() => {
    const graph = this.session.graph;
    graph.revision();
    const rects: Rect[] = [];
    for (const entry of graph.nodeGrid.all()) rects.push(entry.rect);
    return rectsPath(rects);
  });

  protected readonly edgesPath = computed(() => {
    const graph = this.session.graph;
    graph.revision();
    const pairs: (readonly [Rect, Rect])[] = [];
    for (const entry of graph.edgeGrid.all()) {
      const edge = graph.peekEdge(entry.id);
      const source = edge === undefined ? undefined : graph.nodeGrid.rectOf(edge.source);
      const target = edge === undefined ? undefined : graph.nodeGrid.rectOf(edge.target);
      if (source !== undefined && target !== undefined) pairs.push([source, target]);
    }
    return linesPath(pairs);
  });

  protected readonly selectedPath = computed(() => {
    const graph = this.session.graph;
    graph.revision();
    const rects: Rect[] = [];
    for (const id of this.selection.selection().nodes) {
      const rect = graph.nodeGrid.rectOf(id);
      if (rect !== undefined) rects.push(rect);
    }
    return rectsPath(rects);
  });
}
