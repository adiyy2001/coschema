import { ChangeDetectionStrategy, Component } from '@angular/core';
import { A11Y_PROVIDERS } from '../a11y/a11y-providers';
import { LiveRegionComponent } from '../a11y/live-region.component';
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
  imports: [CanvasComponent, LiveRegionComponent, ToolbarComponent],
  providers: [
    DocumentSession,
    ViewportState,
    SelectionState,
    InteractionController,
    ...A11Y_PROVIDERS,
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
      outline: none;
    }
  `,
  template: `
    <cs-toolbar />
    <main id="main" class="stage" tabindex="-1"><cs-canvas /></main>
    <cs-live-region />
  `,
})
export class EditorPageComponent {}
