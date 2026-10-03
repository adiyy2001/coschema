import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { KeyboardController } from './keyboard-controller';

interface Shortcut {
  readonly keys: readonly string[];
  readonly action: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['Tab'], action: 'Move into the canvas and out of it again.' },
  { keys: ['N', 'P'], action: 'Focus the next or previous node, then the connections.' },
  { keys: ['Alt', 'Arrow keys'], action: 'Focus the nearest node in that direction.' },
  {
    keys: ['Arrow keys'],
    action:
      'Move the focused node by one grid step, or by ten with Shift. Pan the view if nothing is focused.',
  },
  {
    keys: ['Enter', 'F2'],
    action: 'Edit the label of the focused node. Enter or Escape finishes.',
  },
  {
    keys: ['C'],
    action:
      'Connect the focused node. Pick a target with the arrow keys or N and P, press Enter to connect or Escape to cancel.',
  },
  { keys: ['Delete', 'Backspace'], action: 'Delete the focused node or connection.' },
  { keys: ['Ctrl+Z', 'Ctrl+Shift+Z'], action: 'Undo or redo your own changes.' },
  { keys: ['Escape'], action: 'Clear the selection or cancel what is in progress.' },
  { keys: ['?'], action: 'Open this list.' },
];

@Component({
  selector: 'cs-shortcuts-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      width: min(560px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      overflow: auto;
      padding: 18px 22px;
      border: 1px solid var(--cs-border, #d5d9e2);
      border-radius: 10px;
      background: var(--cs-toolbar, #ffffff);
      color: var(--cs-text, #1b1f2a);
      box-shadow: 0 18px 48px rgba(20, 24, 36, 0.28);
    }
    dialog::backdrop {
      background: rgba(20, 24, 36, 0.45);
    }
    h2 {
      margin: 0 0 4px;
      font-size: 17px;
    }
    p {
      margin: 0 0 12px;
      color: var(--cs-muted, #4f5a6e);
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    th,
    td {
      padding: 7px 8px;
      border-top: 1px solid var(--cs-border, #d5d9e2);
      text-align: left;
      vertical-align: top;
    }
    th {
      width: 38%;
      font-weight: 400;
    }
    kbd {
      display: inline-block;
      margin: 0 4px 2px 0;
      padding: 1px 6px;
      border: 1px solid var(--cs-border, #aab1c2);
      border-radius: 4px;
      background: var(--cs-canvas, #f6f7f9);
      font: inherit;
      font-size: 12px;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 14px;
    }
    button {
      padding: 8px 14px;
      border: 1px solid var(--cs-accent, #1f4fd8);
      border-radius: 6px;
      background: var(--cs-accent, #1f4fd8);
      color: #ffffff;
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 3px solid var(--cs-accent-text, #1a3fae);
      outline-offset: 2px;
    }
  `,
  template: `
    <dialog #dialog aria-label="Keyboard shortcuts" (close)="onClosed()" (cancel)="onClosed()">
      <h2>Keyboard shortcuts</h2>
      <p>Single-letter shortcuts work while the canvas has focus.</p>
      <table>
        <tbody>
          @for (shortcut of shortcuts; track shortcut.action) {
            <tr>
              <th scope="row">
                @for (key of shortcut.keys; track key) {
                  <kbd>{{ key }}</kbd>
                }
              </th>
              <td>{{ shortcut.action }}</td>
            </tr>
          }
        </tbody>
      </table>
      <div class="actions">
        <button type="button" data-action="shortcuts-close" (click)="dismiss()">Close</button>
      </div>
    </dialog>
  `,
})
export class ShortcutsDialogComponent {
  protected readonly shortcuts = SHORTCUTS;
  private readonly keyboard = inject(KeyboardController);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const wanted = this.keyboard.helpOpen();
      const element = this.dialog().nativeElement;
      if (wanted && !element.open) element.showModal();
      if (!wanted && element.open) element.close();
    });
  }

  protected dismiss(): void {
    this.dialog().nativeElement.close();
  }

  protected onClosed(): void {
    if (!this.keyboard.helpOpen()) return;
    this.keyboard.helpOpen.set(false);
    this.keyboard.restoreFocus();
  }
}
