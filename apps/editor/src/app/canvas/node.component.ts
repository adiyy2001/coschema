import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
} from '@angular/core';
import type { NodeId } from '@coschema/model';
import { KeyboardController } from '../a11y/keyboard-controller';
import { nodeName, shapeName } from '../a11y/describe-change';
import { DocumentSession } from '../core/document-session';
import { SelectionState } from '../interaction/selection-state';
import { DEFAULT_FONT_SIZE, ROUNDED_RADIUS, diamondPoints, fittedLabel } from './node-shape';
import { ViewportState } from './viewport-state';

const RING_GAP = 6;

@Component({
  selector: 'g[cs-node]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    'aria-roledescription': 'diagram node',
    '[attr.transform]': 'transform()',
    '[attr.data-node-id]': 'nodeId()',
    '[attr.tabindex]': 'tabindex()',
    '[attr.aria-label]': 'accessibleName()',
    '[class.selected]': 'selected()',
    '(focus)': 'onFocus()',
  },
  styles: `
    .shape {
      fill: var(--cs-node-fill, #ffffff);
      stroke: var(--cs-node-stroke, #3b4252);
      stroke-width: 1.5;
    }
    :host(.selected) .shape {
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 2.5;
    }
    :host {
      outline: none;
    }
    .ring {
      display: none;
      fill: none;
      vector-effect: non-scaling-stroke;
      pointer-events: none;
    }
    .ring.halo {
      stroke: var(--cs-canvas, #f6f7f9);
      stroke-width: 7;
    }
    .ring.band {
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 4;
    }
    :host(:focus-visible) .ring {
      display: block;
    }
    .label {
      fill: var(--cs-node-text, #1b1f2a);
      font-family: system-ui, sans-serif;
      pointer-events: none;
      user-select: none;
    }
  `,
  template: `
    @let current = node();
    @if (current) {
      @switch (current.type) {
        @case ('ellipse') {
          <svg:ellipse
            class="shape"
            [attr.cx]="current.size[0] / 2"
            [attr.cy]="current.size[1] / 2"
            [attr.rx]="current.size[0] / 2"
            [attr.ry]="current.size[1] / 2"
            [style.fill]="current.style.fill ?? null"
            [style.stroke]="current.style.stroke ?? null"
            [style.stroke-width]="current.style.strokeWidth ?? null"
          />
        }
        @case ('diamond') {
          <svg:polygon
            class="shape"
            [attr.points]="diamondPoints()"
            [style.fill]="current.style.fill ?? null"
            [style.stroke]="current.style.stroke ?? null"
            [style.stroke-width]="current.style.strokeWidth ?? null"
          />
        }
        @default {
          <svg:rect
            class="shape"
            [attr.width]="current.size[0]"
            [attr.height]="current.size[1]"
            [attr.rx]="current.type === 'rounded' ? roundedRadius : 0"
            [style.fill]="current.style.fill ?? null"
            [style.stroke]="current.style.stroke ?? null"
            [style.stroke-width]="current.style.strokeWidth ?? null"
          />
        }
      }
      @if (showLabel()) {
        <svg:text
          class="label"
          aria-hidden="true"
          text-anchor="middle"
          dominant-baseline="central"
          [attr.x]="current.size[0] / 2"
          [attr.y]="current.size[1] / 2"
          [attr.font-size]="fontSize()"
        >
          {{ labelText() }}
        </svg:text>
      }
      <svg:rect
        class="ring halo"
        rx="4"
        [attr.x]="-ringGap"
        [attr.y]="-ringGap"
        [attr.width]="current.size[0] + ringGap * 2"
        [attr.height]="current.size[1] + ringGap * 2"
      />
      <svg:rect
        class="ring band"
        rx="4"
        [attr.x]="-ringGap"
        [attr.y]="-ringGap"
        [attr.width]="current.size[0] + ringGap * 2"
        [attr.height]="current.size[1] + ringGap * 2"
      />
    }
  `,
})
export class NodeComponent {
  readonly nodeId = input.required<NodeId>();
  protected readonly roundedRadius = ROUNDED_RADIUS;
  protected readonly ringGap = RING_GAP;
  private readonly session = inject(DocumentSession);
  private readonly keyboard = inject(KeyboardController);
  private readonly host = inject<ElementRef<SVGGElement>>(ElementRef);
  private readonly selection = inject(SelectionState);
  private readonly viewport = inject(ViewportState);

  protected readonly node = computed(() => this.session.graph.node(this.nodeId())());
  protected readonly tabindex = computed(() =>
    this.keyboard.tabStop() === this.nodeId() ? 0 : -1,
  );
  protected readonly accessibleName = computed(() => {
    const current = this.node();
    return current === undefined ? null : `${nodeName(current)}, ${shapeName(current.type)}`;
  });
  protected readonly selected = computed(() => this.selection.hasNode(this.nodeId()));
  protected readonly transform = computed(() => {
    const current = this.node();
    return current === undefined ? null : `translate(${current.pos[0]} ${current.pos[1]})`;
  });
  protected readonly fontSize = computed(() => this.node()?.style.fontSize ?? DEFAULT_FONT_SIZE);
  protected readonly showLabel = computed(() => {
    const current = this.node();
    return current !== undefined && current.label !== '' && this.viewport.detail() === 'full';
  });
  protected readonly labelText = computed(() => {
    const current = this.node();
    return current === undefined ? '' : fittedLabel(current);
  });
  protected readonly diamondPoints = computed(() => {
    const current = this.node();
    return current === undefined ? '' : diamondPoints(current.size);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (globalThis.document.activeElement !== this.host.nativeElement) return;
      queueMicrotask(() => {
        this.keyboard.focusFallback();
      });
    });
  }

  protected onFocus(): void {
    this.keyboard.adopt({ kind: 'node', id: this.nodeId() });
  }
}
