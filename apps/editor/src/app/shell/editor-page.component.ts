import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CanvasComponent } from '../canvas/canvas.component';
import { ViewportState } from '../canvas/viewport-state';
import { DOCUMENT_SEED, DocumentSession } from '../core/document-session';
import { starterDiagram } from '../core/starter-diagram';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';
import { ToolbarComponent } from './toolbar.component';

@Component({
  selector: 'cs-editor-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasComponent, ToolbarComponent],
  providers: [
    DocumentSession,
    ViewportState,
    SelectionState,
    InteractionController,
    { provide: DOCUMENT_SEED, useValue: starterDiagram },
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
export class EditorPageComponent {}
