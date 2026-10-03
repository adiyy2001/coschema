import { ChangeDetectionStrategy, Component, inject, afterNextRender } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { clampZoom } from '@coschema/geometry';
import { CanvasComponent } from '../canvas/canvas.component';
import { ViewportState } from '../canvas/viewport-state';
import { benchSeed } from '../core/bench-scene';
import { DOCUMENT_SEED, DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';

const DEFAULT_BENCH_NODES = 5000;
const BENCH_MARGIN = 40;

@Component({
  selector: 'cs-bench-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasComponent],
  providers: [
    DocumentSession,
    ViewportState,
    SelectionState,
    InteractionController,
    {
      provide: DOCUMENT_SEED,
      useFactory: () => {
        const requested = Number(
          inject(ActivatedRoute).snapshot.queryParamMap.get('nodes') ?? DEFAULT_BENCH_NODES,
        );
        return benchSeed(Number.isFinite(requested) ? requested : DEFAULT_BENCH_NODES);
      },
    },
  ],
  styles: `
    :host {
      display: block;
      position: fixed;
      inset: 0;
    }
  `,
  template: '<cs-canvas />',
})
export class BenchPageComponent {
  private readonly session = inject(DocumentSession);
  private readonly viewport = inject(ViewportState);
  private readonly requestedZoom = Number(
    inject(ActivatedRoute).snapshot.queryParamMap.get('zoom') ?? Number.NaN,
  );

  constructor() {
    afterNextRender(() => {
      const bounds = this.session.graph.contentBounds();
      if (bounds === undefined || !Number.isFinite(this.requestedZoom)) {
        this.viewport.fit(bounds);
        return;
      }
      const zoom = clampZoom(this.requestedZoom);
      this.viewport.viewport.set({
        x: BENCH_MARGIN - bounds.x * zoom,
        y: BENCH_MARGIN - bounds.y * zoom,
        zoom,
      });
    });
  }
}
