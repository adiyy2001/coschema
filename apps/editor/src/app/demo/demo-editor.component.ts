import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { zoomAround } from '@coschema/geometry';
import { A11Y_PROVIDERS } from '../a11y/a11y-providers';
import { LiveRegionComponent } from '../a11y/live-region.component';
import { CanvasComponent } from '../canvas/canvas.component';
import { FULL_DETAIL_ZOOM } from '../canvas/detail';
import { ViewportState } from '../canvas/viewport-state';
import {
  COLLAB_PERSISTENCE,
  COLLAB_STORAGE,
  COLLAB_TARGET,
  COLLAB_TRANSPORT,
  Collaboration,
} from '../collab/collaboration';
import { IDENTITY_KEY, type KeyValueStorage } from '../collab/identity';
import { DOCUMENT_BOOTSTRAP, DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';
import { PresenceStore } from '../presence/presence-store';
import { PAGE_NAVIGATION } from '../shell/page-navigation';
import { ToolbarComponent } from '../shell/toolbar.component';
import { DEMO_PANE } from './demo-pane';

function identityStorage(): KeyValueStorage {
  const values = new Map<string, string>([
    [IDENTITY_KEY, JSON.stringify(inject(DEMO_PANE).identity)],
  ]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

@Component({
  selector: 'cs-demo-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasComponent, LiveRegionComponent, ToolbarComponent],
  providers: [
    DocumentSession,
    ViewportState,
    SelectionState,
    InteractionController,
    ...A11Y_PROVIDERS,
    { provide: DOCUMENT_BOOTSTRAP, useValue: 'deferred' },
    { provide: COLLAB_TARGET, useFactory: () => inject(DEMO_PANE).target },
    {
      provide: COLLAB_TRANSPORT,
      useFactory: () => {
        const pane = inject(DEMO_PANE);
        return () => pane.link.connect();
      },
    },
    { provide: COLLAB_PERSISTENCE, useValue: undefined },
    { provide: COLLAB_STORAGE, useFactory: identityStorage },
    { provide: PAGE_NAVIGATION, useValue: { search: '', open: () => undefined } },
    Collaboration,
    { provide: PresenceStore, useFactory: () => inject(Collaboration).presence },
  ],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 520px;
      min-height: 0;
      position: relative;
      border-top: 1px solid var(--cs-border);
    }
    .stage {
      flex: 1;
      min-height: 0;
    }
  `,
  template: `
    <cs-toolbar />
    <div class="stage"><cs-canvas /></div>
    <cs-live-region />
  `,
})
export class DemoEditorComponent {
  constructor() {
    const pane = inject(DEMO_PANE);
    const session = inject(DocumentSession);
    const viewport = inject(ViewportState);
    const interaction = inject(InteractionController);
    const collaboration = inject(Collaboration);
    pane.session.set(session);
    let framed = false;
    effect(() => {
      const ready = collaboration.session.synced() && viewport.screen().width > 0;
      if (!ready || framed) return;
      framed = true;
      untracked(() => {
        session.graph.flush();
        interaction.fit();
        const view = viewport.viewport();
        if (view.zoom >= FULL_DETAIL_ZOOM) return;
        const screen = viewport.screen();
        viewport.viewport.set(
          zoomAround(view, [screen.width / 2, screen.height / 2], FULL_DETAIL_ZOOM),
        );
      });
    });
    inject(DestroyRef).onDestroy(() => {
      pane.session.set(undefined);
    });
  }
}
