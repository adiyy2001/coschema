import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  inject,
  input,
} from '@angular/core';
import { DEMO_PANE, PANE_LINK_LIMITS, type DemoPane } from './demo-pane';
import { DemoEditorComponent } from './demo-editor.component';
import { dropped, inFlight } from './link-stats';

function numberFrom(event: Event): number {
  return event.target instanceof HTMLInputElement ? event.target.valueAsNumber : Number.NaN;
}

function checkedFrom(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

@Component({
  selector: 'cs-demo-pane',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet],
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .pane {
      overflow: hidden;
      border: 1px solid var(--cs-border);
      border-radius: 10px;
      background: var(--cs-toolbar);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 6px 12px;
      padding: 10px 14px 6px;
    }
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 17px;
    }
    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 2px solid var(--cs-text);
    }
    .state {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin: 0;
      font-size: 13px;
      color: var(--cs-muted);
    }
    .state strong {
      color: var(--cs-text);
    }
    fieldset {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px 16px;
      margin: 0;
      padding: 4px 14px 12px;
      border: 0;
    }
    legend {
      padding: 0 14px;
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    label {
      display: grid;
      gap: 2px;
      font-size: 13px;
    }
    label span {
      display: flex;
      justify-content: space-between;
      color: var(--cs-muted);
    }
    output {
      color: var(--cs-text);
      font-variant-numeric: tabular-nums;
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--cs-accent);
    }
    .switch {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--cs-text);
    }
    .switch input {
      width: 18px;
      height: 18px;
      accent-color: var(--cs-accent);
    }
    input:focus-visible {
      outline: 3px solid var(--cs-accent-text);
      outline-offset: 2px;
    }
  `,
  template: `
    <section
      class="pane"
      [attr.aria-labelledby]="headingId()"
      [attr.data-pane]="pane().identity.name"
    >
      <header>
        <h2 [id]="headingId()">
          <span class="swatch" [style.background]="pane().identity.color" aria-hidden="true"></span>
          {{ pane().identity.name }}
        </h2>
        <p class="state">
          <strong data-link-state role="status">{{
            pane().offline() ? 'Offline' : 'Online'
          }}</strong>
          <span data-inflight>{{ flying() }} in flight</span>
          <span data-delivered>{{ pane().stats().delivered }} delivered</span>
          <span data-dropped>{{ lost() }} dropped</span>
        </p>
      </header>
      <fieldset>
        <legend>Simulated network for {{ pane().identity.name }}</legend>
        <label>
          <span>
            Latency
            <output data-latency-value>{{ pane().latencyMs() }} ms</output>
          </span>
          <input
            type="range"
            name="latency"
            data-latency
            [min]="limits.latencyMs.min"
            [max]="limits.latencyMs.max"
            step="10"
            [value]="pane().latencyMs()"
            (input)="pane().setLatency(numberFrom($event))"
          />
        </label>
        <label>
          <span>
            Jitter
            <output data-jitter-value>{{ pane().jitterMs() }} ms</output>
          </span>
          <input
            type="range"
            name="jitter"
            data-jitter
            [min]="limits.jitterMs.min"
            [max]="limits.jitterMs.max"
            step="10"
            [value]="pane().jitterMs()"
            (input)="pane().setJitter(numberFrom($event))"
          />
        </label>
        <label>
          <span>
            Packet loss
            <output data-loss-value>{{ pane().lossPercent() }}%</output>
          </span>
          <input
            type="range"
            name="loss"
            data-loss
            [min]="limits.lossPercent.min"
            [max]="limits.lossPercent.max"
            step="5"
            [value]="pane().lossPercent()"
            (input)="pane().setLossPercent(numberFrom($event))"
          />
        </label>
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            name="offline"
            data-link-offline
            [checked]="pane().offline()"
            (change)="pane().setOffline(checkedFrom($event))"
          />
          Network offline
        </label>
      </fieldset>
      <ng-container *ngComponentOutlet="editor; injector: paneInjector()" />
    </section>
  `,
})
export class DemoPaneComponent {
  readonly pane = input.required<DemoPane>();
  private readonly parent = inject(Injector);
  protected readonly editor = DemoEditorComponent;
  protected readonly limits = PANE_LINK_LIMITS;
  protected readonly numberFrom = numberFrom;
  protected readonly checkedFrom = checkedFrom;
  protected readonly headingId = computed(() => `demo-pane-${this.pane().key}-title`);
  protected readonly flying = computed(() => inFlight(this.pane().stats()));
  protected readonly lost = computed(() => dropped(this.pane().stats()));
  protected readonly paneInjector = computed(() =>
    Injector.create({
      providers: [{ provide: DEMO_PANE, useValue: this.pane() }],
      parent: this.parent,
    }),
  );
}
