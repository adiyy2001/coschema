import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { Collaboration } from '../collab/collaboration';
import type { ConnectionState } from '../collab/collaboration-session';
import { dashFor, initialsOf } from '../presence/peers';
import { readableTextColor } from '../presence/tag';

function connectionLabel(state: ConnectionState, manuallyOffline: boolean): string {
  switch (state) {
    case 'online':
      return 'Online';
    case 'connecting':
      return 'Connecting';
    case 'loading':
      return 'Loading';
    case 'denied':
      return 'Access denied';
    case 'offline':
      return manuallyOffline ? 'Offline' : 'Offline, retrying';
  }
}

function pendingLabel(pending: number): string {
  return pending === 1 ? '1 change waiting to sync' : `${pending} changes waiting to sync`;
}

@Component({
  selector: 'cs-collab-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      font-size: 13px;
    }
    .connection {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      padding: 4px 10px;
      border: 1px solid var(--cs-border, #d5d9e2);
      border-radius: 999px;
      font-weight: 600;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      box-sizing: border-box;
      border: 2px solid currentColor;
    }
    .connection[data-state='online'] {
      color: var(--cs-ok, #1b6e3c);
    }
    .connection[data-state='online'] .dot {
      background: currentColor;
    }
    .connection[data-state='offline'],
    .connection[data-state='denied'] {
      color: var(--cs-danger, #a61e3a);
    }
    .connection[data-state='denied'] .dot {
      border-radius: 2px;
      background: currentColor;
    }
    .connection[data-state='connecting'],
    .connection[data-state='loading'] {
      color: var(--cs-muted, #5b6578);
    }
    .connection .text {
      color: var(--cs-text, #1b1f2a);
    }
    .pending {
      margin: 0;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--cs-warn-bg, #fff1c9);
      color: var(--cs-warn-text, #5c4300);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    button {
      min-height: 32px;
      padding: 0 10px;
      border: 1px solid var(--cs-border, #aab1c2);
      border-radius: 6px;
      background: transparent;
      color: var(--cs-text, #1b1f2a);
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      background: var(--cs-hover, #eceff5);
    }
    button:focus-visible {
      outline: 3px solid var(--cs-accent, #1f4fd8);
      outline-offset: 1px;
    }
    button[aria-pressed='true'] {
      background: var(--cs-accent-soft, rgba(31, 79, 216, 0.12));
      border-color: var(--cs-accent, #1f4fd8);
    }
    .people {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .person {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px 0 4px;
      min-height: 32px;
    }
    .badge {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 700;
      border: 2px solid transparent;
    }
    .badge::before {
      content: attr(data-initials);
    }
    .person[aria-pressed='true'] .badge {
      outline: 2px solid var(--cs-text, #1b1f2a);
      outline-offset: 1px;
    }
    .follow-note {
      font-size: 11px;
      color: var(--cs-muted, #5b6578);
    }
    .hint {
      margin: 0;
      color: var(--cs-danger, #a61e3a);
    }
    .local {
      margin: 0;
      color: var(--cs-muted, #5b6578);
    }
  `,
  template: `
    @if (collaboration; as collab) {
      <ul class="people" aria-label="People in this room">
        <li>
          <button
            type="button"
            class="person"
            data-action="identity"
            [attr.aria-label]="collab.identity().name + ' (you), change name or room'"
            (click)="openJoin.emit()"
          >
            <span
              class="badge"
              [style.background]="collab.identity().color"
              [style.color]="youText()"
              [attr.data-initials]="youInitials()"
              aria-hidden="true"
            ></span>
            <span>{{ collab.identity().name }} (you)</span>
          </button>
        </li>
        @for (peer of collab.presence.peers(); track peer.clientId) {
          <li>
            <button
              type="button"
              class="person"
              data-action="follow"
              [attr.data-peer]="peer.clientId"
              [attr.aria-pressed]="collab.following() === peer.clientId"
              [attr.aria-label]="'Follow ' + peer.user.name"
              (click)="collab.toggleFollow(peer.clientId)"
            >
              <span
                class="badge"
                [style.background]="peer.user.color"
                [style.color]="textFor(peer.user.color)"
                [style.border-style]="dashFor(peer.clientId) === '' ? 'solid' : 'dashed'"
                [attr.data-initials]="initialsOf(peer.user.name)"
                aria-hidden="true"
              ></span>
              <span>{{ peer.user.name }}</span>
              @if (collab.following() === peer.clientId) {
                <span class="follow-note">following</span>
              }
            </button>
          </li>
        }
      </ul>
      <p class="connection" data-connection [attr.data-state]="state()" role="status">
        <span class="dot" aria-hidden="true"></span>
        <span class="text">{{ label() }}</span>
      </p>
      @if (state() === 'denied') {
        <p class="hint" data-denied>The server rejected the access token for this room.</p>
      } @else {
        @if (pending() > 0) {
          <p class="pending" data-pending role="status">{{ pendingText() }}</p>
        }
        <button
          type="button"
          data-action="offline-toggle"
          [attr.aria-pressed]="manuallyOffline()"
          (click)="collab.session.setOffline(!manuallyOffline())"
        >
          {{ manuallyOffline() ? 'Go online' : 'Work offline' }}
        </button>
      }
    } @else {
      <p class="local" data-connection data-state="local">Local only</p>
      <button type="button" data-action="collaborate" (click)="openJoin.emit()">Collaborate</button>
    }
  `,
})
export class CollabStatusComponent {
  readonly openJoin = output();
  protected readonly collaboration = inject(Collaboration, { optional: true });
  protected readonly dashFor = dashFor;
  protected readonly initialsOf = initialsOf;
  protected readonly textFor = readableTextColor;
  protected readonly state = computed(() => this.collaboration?.session.state() ?? 'loading');
  protected readonly manuallyOffline = computed(
    () => this.collaboration?.session.manuallyOffline() ?? false,
  );
  protected readonly pending = computed(() => this.collaboration?.session.pending() ?? 0);
  protected readonly label = computed(() => connectionLabel(this.state(), this.manuallyOffline()));
  protected readonly pendingText = computed(() => pendingLabel(this.pending()));
  protected readonly youInitials = computed(() =>
    initialsOf(this.collaboration?.identity().name ?? ''),
  );
  protected readonly youText = computed(() =>
    readableTextColor(this.collaboration?.identity().color ?? '#000000'),
  );
}
