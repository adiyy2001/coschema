import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LINK_PROFILE_NAMES, type LinkProfileName } from '@coschema/sim/link';
import { DemoPaneComponent } from './demo-pane.component';
import { DemoWorld } from './demo-world';

const PROFILE_LABELS: Readonly<Record<LinkProfileName, string>> = {
  clean: 'Clean',
  slow: 'Slow',
  lossy: 'Lossy',
  chaotic: 'Chaotic',
};

@Component({
  selector: 'cs-demo-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DemoPaneComponent],
  providers: [DemoWorld],
  styles: `
    :host {
      display: block;
      min-height: 100%;
      background: var(--cs-canvas);
      color: var(--cs-text);
    }
    main {
      max-width: 1500px;
      margin: 0 auto;
      padding: 20px 16px 40px;
      outline: none;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 26px;
    }
    .lead {
      max-width: 72ch;
      margin: 0 0 14px;
      color: var(--cs-muted);
      line-height: 1.5;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px;
    }
    .controls p {
      margin: 0 8px 0 0;
      font-weight: 600;
    }
    button,
    .link {
      padding: 8px 14px;
      border: 1px solid var(--cs-border);
      border-radius: 6px;
      background: var(--cs-toolbar);
      color: var(--cs-text);
      font: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    button:hover,
    .link:hover {
      background: var(--cs-hover);
    }
    button[aria-pressed='true'] {
      border-color: var(--cs-accent);
      background: var(--cs-accent-soft);
      color: var(--cs-accent-text);
      font-weight: 600;
    }
    button.primary {
      border-color: var(--cs-accent);
      background: var(--cs-accent);
      color: var(--cs-canvas);
      font-weight: 600;
    }
    button:disabled {
      opacity: 0.6;
      cursor: progress;
    }
    button:focus-visible,
    .link:focus-visible {
      outline: 3px solid var(--cs-accent-text);
      outline-offset: 2px;
    }
    .panes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 560px), 1fr));
      gap: 16px;
    }
    .spacer {
      flex: 1;
    }
  `,
  template: `
    <main id="main" tabindex="-1">
      <h1>Live collaboration demo</h1>
      <p class="lead">
        Each editor below has its own copy of the diagram and talks to one shared room through a
        simulated network. Slow a link down, add packet loss, or take an editor offline and edit on
        both sides. When the link comes back, the copies merge and end up identical.
        @if (world.real) {
          These editors are connected to the real server you pointed the page at.
        } @else {
          The room runs inside this page, so nothing leaves your browser.
        }
      </p>
      <div class="controls" role="group" aria-label="Demo controls">
        <p id="profile-label">Network for everyone</p>
        @for (name of profiles; track name) {
          <button
            type="button"
            [attr.data-profile]="name"
            [attr.aria-pressed]="world.profile() === name"
            (click)="world.applyProfile(name)"
          >
            {{ labels[name] }}
          </button>
        }
        <span class="spacer"></span>
        <button
          type="button"
          class="primary"
          data-action="make-mess"
          [disabled]="world.messing()"
          (click)="world.makeMess()"
        >
          {{ world.messing() ? 'Making a mess' : 'Make a mess' }}
        </button>
        <button type="button" data-action="reset" (click)="world.reset()">Reset</button>
        <a class="link" href="/">Solo editor</a>
      </div>
      <div class="panes">
        @for (pane of world.panes(); track pane.key) {
          <cs-demo-pane [pane]="pane" />
        }
      </div>
    </main>
  `,
})
export class DemoPageComponent {
  protected readonly world = inject(DemoWorld);
  protected readonly profiles = LINK_PROFILE_NAMES;
  protected readonly labels = PROFILE_LABELS;
}
