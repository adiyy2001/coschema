import { Injectable, computed, inject, signal } from '@angular/core';
import {
  IDENTITY_VIEWPORT,
  fitRect,
  viewportTransform,
  visibleWorldRect,
  windowsEqual,
  type Rect,
  type ScreenSize,
  type Viewport,
} from '@coschema/geometry';
import { DocumentSession } from '../core/document-session';
import { detailForZoom } from './detail';

const FIT_PADDING = 64;

@Injectable()
export class ViewportState {
  private readonly session = inject(DocumentSession);
  readonly viewport = signal<Viewport>(IDENTITY_VIEWPORT);
  readonly screen = signal<ScreenSize>({ width: 0, height: 0 });
  readonly transform = computed(() => viewportTransform(this.viewport()));
  readonly zoom = computed(() => this.viewport().zoom);
  readonly detail = computed(() => detailForZoom(this.viewport().zoom));
  readonly worldRect = computed(() => visibleWorldRect(this.viewport(), this.screen()));
  readonly window = computed(() => this.session.graph.nodeGrid.visibleWindow(this.worldRect()), {
    equal: windowsEqual,
  });

  fit(bounds: Rect | undefined): void {
    if (bounds === undefined) {
      this.viewport.set(IDENTITY_VIEWPORT);
      return;
    }
    this.viewport.set(fitRect(bounds, this.screen(), FIT_PADDING));
  }
}
