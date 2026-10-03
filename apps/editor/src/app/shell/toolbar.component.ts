import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { KeyboardController } from '../a11y/keyboard-controller';
import { ViewportState } from '../canvas/viewport-state';
import { DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { SelectionState } from '../interaction/selection-state';
import type { Tool } from '../interaction/types';
import { CollabStatusComponent } from './collab-status.component';
import { JoinDialogComponent } from './join-dialog.component';

interface ToolButton {
  readonly tool: Tool;
  readonly label: string;
  readonly icon: string;
}

const TOOLS: readonly ToolButton[] = [
  { tool: 'select', label: 'Select', icon: 'M5 3l12 7-5.5 1.5L9 17z' },
  {
    tool: 'hand',
    label: 'Pan',
    icon: 'M8 11V5.5a1.5 1.5 0 013 0V10m0-5a1.5 1.5 0 013 0v5m0-3a1.5 1.5 0 013 0v7a5 5 0 01-5 5h-1.5a5 5 0 01-4-2L5 13.5a1.5 1.5 0 012.3-1.8L8 12.5',
  },
  { tool: 'rect', label: 'Rectangle', icon: 'M4 6h16v12H4z' },
  {
    tool: 'rounded',
    label: 'Rounded rectangle',
    icon: 'M7 6h10a3 3 0 013 3v6a3 3 0 01-3 3H7a3 3 0 01-3-3V9a3 3 0 013-3z',
  },
  {
    tool: 'ellipse',
    label: 'Ellipse',
    icon: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  },
  { tool: 'diamond', label: 'Diamond', icon: 'M12 4l8 8-8 8-8-8z' },
];

@Component({
  selector: 'cs-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CollabStatusComponent, JoinDialogComponent],
  styles: `
    :host {
      display: block;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 6px;
      padding: 6px 10px;
      background: var(--cs-toolbar, #ffffff);
      border-bottom: 1px solid var(--cs-border, #d5d9e2);
    }
    .group {
      display: flex;
      align-items: center;
      gap: 2px;
      padding-right: 8px;
      margin-right: 2px;
      border-right: 1px solid var(--cs-border, #d5d9e2);
    }
    .group:last-child {
      border-right: none;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 36px;
      height: 36px;
      padding: 0 8px;
      gap: 6px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--cs-text, #1b1f2a);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--cs-hover, #eceff5);
    }
    button:focus-visible {
      outline: 3px solid var(--cs-accent, #1f4fd8);
      outline-offset: 1px;
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    button[aria-pressed='true'] {
      background: var(--cs-accent-soft, rgba(31, 79, 216, 0.12));
      border-color: var(--cs-accent, #1f4fd8);
      color: var(--cs-accent-text, #1a3fae);
    }
    svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .zoom {
      min-width: 56px;
      font-variant-numeric: tabular-nums;
    }
    .right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 6px 12px;
      margin-left: auto;
    }
    .status {
      margin: 0;
      color: var(--cs-muted, #5b6578);
      font-size: 13px;
    }
  `,
  template: `
    <div class="bar" role="toolbar" aria-label="Editor tools">
      <div class="group" role="group" aria-label="Tools">
        @for (item of tools; track item.tool) {
          <button
            type="button"
            [attr.aria-pressed]="controller.tool() === item.tool"
            [attr.aria-label]="item.label"
            [attr.data-tool]="item.tool"
            [title]="item.label"
            (click)="controller.setTool(item.tool)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="item.icon" /></svg>
          </button>
        }
      </div>
      <div class="group" role="group" aria-label="Add">
        <button
          type="button"
          data-action="add-node"
          aria-label="Add a node"
          title="Add a node in the middle of the view"
          (click)="keyboard.addNode()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11v10H4zM19 5v6M16 8h6" /></svg>
        </button>
      </div>
      <div class="group" role="group" aria-label="History">
        <button
          type="button"
          data-action="undo"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          [disabled]="!history().canUndo"
          (click)="controller.undo()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12" transform="translate(0 -4)" />
          </svg>
        </button>
        <button
          type="button"
          data-action="redo"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          [disabled]="!history().canRedo"
          (click)="controller.redo()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 7l5 5-5 5M20 12H10a6 6 0 000 12" transform="translate(0 -4)" />
          </svg>
        </button>
        <button
          type="button"
          data-action="delete"
          aria-label="Delete selection"
          title="Delete (Del)"
          [disabled]="selection.isEmpty()"
          (click)="controller.deleteSelection()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5" />
          </svg>
        </button>
      </div>
      <div class="group" role="group" aria-label="View">
        <button
          type="button"
          data-action="zoom-out"
          aria-label="Zoom out"
          title="Zoom out"
          (click)="controller.zoomOut()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button
          type="button"
          class="zoom"
          data-action="zoom-reset"
          aria-label="Reset zoom to 100%"
          title="Reset zoom"
          (click)="controller.resetZoom()"
        >
          {{ zoomLabel() }}
        </button>
        <button
          type="button"
          data-action="zoom-in"
          aria-label="Zoom in"
          title="Zoom in"
          (click)="controller.zoomIn()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
        </button>
        <button
          type="button"
          data-action="fit"
          aria-label="Fit diagram to screen"
          title="Fit to screen"
          (click)="controller.fit()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
        <button
          type="button"
          data-action="snap"
          [attr.aria-pressed]="controller.snap().enabled"
          aria-label="Snap to grid"
          title="Snap to grid"
          (click)="controller.toggleSnap()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 4h16v16H4zM4 12h16M12 4v16" />
          </svg>
        </button>
      </div>
      <div class="right">
        <button
          type="button"
          data-action="shortcuts"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          (click)="keyboard.helpOpen.set(true)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 8h18v9H3zM7 12h.01M11 12h.01M15 12h.01M8 15h8" />
          </svg>
        </button>
        <p class="status" aria-live="off">
          {{ session.graph.nodeCount() }} nodes, {{ session.graph.edgeCount() }} edges
        </p>
        <cs-collab-status (openJoin)="joinOpen.set(true)" />
      </div>
    </div>
    <cs-join-dialog [open]="joinOpen()" (closed)="joinOpen.set(false)" />
  `,
})
export class ToolbarComponent {
  protected readonly tools = TOOLS;
  protected readonly joinOpen = signal(false);
  protected readonly controller = inject(InteractionController);
  protected readonly keyboard = inject(KeyboardController);
  protected readonly session = inject(DocumentSession);
  protected readonly selection = inject(SelectionState);
  private readonly viewport = inject(ViewportState);
  protected readonly history = this.session.historyState;
  protected readonly zoomLabel = computed(() => `${Math.round(this.viewport.zoom() * 100)}%`);
}
