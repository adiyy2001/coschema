import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { COLLAB_STORAGE, Collaboration } from '../collab/collaboration';
import { isValidRoom, normalizeRoom } from '../collab/connection';
import { loadIdentity, renameIdentity, saveIdentity } from '../collab/identity';
import { RANDOM } from '../core/random';
import { PAGE_NAVIGATION, roomPath } from './page-navigation';

const SUGGESTION_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

@Component({
  selector: 'cs-join-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    dialog {
      width: min(420px, calc(100vw - 32px));
      padding: 20px 22px;
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
    p.hint {
      margin: 0 0 14px;
      color: var(--cs-muted, #5b6578);
      font-size: 13px;
    }
    label {
      display: block;
      margin-top: 12px;
      font-size: 13px;
      font-weight: 600;
    }
    input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      margin-top: 4px;
      padding: 8px 10px;
      border: 1px solid var(--cs-border, #aab1c2);
      border-radius: 6px;
      background: var(--cs-canvas, #f6f7f9);
      color: inherit;
      font: inherit;
    }
    input:focus-visible,
    button:focus-visible {
      outline: 3px solid var(--cs-accent, #1f4fd8);
      outline-offset: 1px;
    }
    .error {
      margin: 6px 0 0;
      color: var(--cs-danger, #a61e3a);
      font-size: 13px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 18px;
    }
    button {
      padding: 8px 14px;
      border: 1px solid var(--cs-border, #aab1c2);
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--cs-accent, #1f4fd8);
      background: var(--cs-accent, #1f4fd8);
      color: #ffffff;
    }
  `,
  template: `
    <dialog #dialog aria-labelledby="join-title" (close)="closed.emit()" (cancel)="closed.emit()">
      <form (submit)="submit($event)" novalidate>
        <h2 id="join-title">Join a room</h2>
        <p class="hint">Everyone in the same room edits the same diagram.</p>
        <label>
          Display name
          <input #name name="name" autocomplete="nickname" maxlength="40" [value]="initialName" />
        </label>
        <label>
          Room
          <input
            #room
            name="room"
            autocomplete="off"
            maxlength="64"
            spellcheck="false"
            [value]="initialRoom"
            [attr.aria-invalid]="invalid"
            aria-describedby="join-error"
          />
        </label>
        <p id="join-error" class="error" role="alert">{{ invalid ? roomProblem : '' }}</p>
        <div class="actions">
          <button type="button" data-action="join-cancel" (click)="dismiss()">Cancel</button>
          <button type="submit" class="primary" data-action="join-submit">Join</button>
        </div>
      </form>
    </dialog>
  `,
})
export class JoinDialogComponent {
  readonly open = input.required<boolean>();
  readonly closed = output();
  protected initialName = '';
  protected initialRoom = '';
  protected invalid = false;
  protected readonly roomProblem =
    'Use letters, digits, dashes and underscores, up to 64 characters.';
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly name = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly room = viewChild.required<ElementRef<HTMLInputElement>>('room');
  private readonly collaboration = inject(Collaboration, { optional: true });
  private readonly storage = inject(COLLAB_STORAGE);
  private readonly random = inject(RANDOM);
  private readonly navigation = inject(PAGE_NAVIGATION);

  constructor() {
    effect(() => {
      const wanted = this.open();
      const element = this.dialog().nativeElement;
      if (wanted && !element.open) this.show(element);
      if (!wanted && element.open) element.close();
    });
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const room = normalizeRoom(this.room().nativeElement.value);
    if (!isValidRoom(room)) {
      this.invalid = true;
      this.room().nativeElement.focus();
      return;
    }
    this.invalid = false;
    this.saveName(this.name().nativeElement.value);
    this.dialog().nativeElement.close();
    if (this.collaboration?.target.room !== room) {
      this.navigation.open(roomPath(room, this.navigation.search));
    }
  }

  protected dismiss(): void {
    this.dialog().nativeElement.close();
  }

  private show(element: HTMLDialogElement): void {
    this.initialName = (
      this.collaboration?.identity() ?? loadIdentity(this.storage, this.random)
    ).name;
    this.initialRoom = this.collaboration?.target.room ?? this.suggestRoom();
    this.invalid = false;
    this.name().nativeElement.value = this.initialName;
    this.room().nativeElement.value = this.initialRoom;
    element.showModal();
  }

  private saveName(raw: string): void {
    if (this.collaboration !== null) {
      this.collaboration.rename(raw);
      return;
    }
    saveIdentity(this.storage, renameIdentity(loadIdentity(this.storage, this.random), raw));
  }

  private suggestRoom(): string {
    let suffix = '';
    for (let index = 0; index < 5; index += 1) {
      suffix += SUGGESTION_ALPHABET[Math.floor(this.random() * SUGGESTION_ALPHABET.length)] ?? 'a';
    }
    return `plant-${suffix}`;
  }
}
