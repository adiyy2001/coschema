import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CanvasComponent } from '../canvas/canvas.component';
import { ViewportState } from '../canvas/viewport-state';
import { COLLAB_TARGET, Collaboration } from '../collab/collaboration';
import { normalizeRoom, resolveTarget, type ConnectionTarget } from '../collab/connection';
import { DOCUMENT_BOOTSTRAP, DOCUMENT_SEED, DocumentSession } from '../core/document-session';
import { starterDiagram } from '../core/starter-diagram';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';
import { PresenceStore } from '../presence/presence-store';
import { ToolbarComponent } from './toolbar.component';

export const DEFAULT_ROOM = 'main';

export function targetFromRoute(): ConnectionTarget {
  const raw = inject(ActivatedRoute).snapshot.paramMap.get('room') ?? '';
  const room = normalizeRoom(raw) || DEFAULT_ROOM;
  return resolveTarget(room, globalThis.location.search, globalThis.location);
}

@Component({
  selector: 'cs-room-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasComponent, ToolbarComponent],
  providers: [
    DocumentSession,
    ViewportState,
    SelectionState,
    InteractionController,
    { provide: DOCUMENT_BOOTSTRAP, useValue: 'deferred' },
    { provide: DOCUMENT_SEED, useValue: starterDiagram },
    { provide: COLLAB_TARGET, useFactory: targetFromRoute },
    Collaboration,
    { provide: PresenceStore, useFactory: () => inject(Collaboration).presence },
  ],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      position: fixed;
      inset: 0;
    }
    .stage {
      flex: 1;
      min-height: 0;
    }
  `,
  template: `
    <cs-toolbar />
    <main class="stage"><cs-canvas /></main>
  `,
})
export class RoomPageComponent {}
