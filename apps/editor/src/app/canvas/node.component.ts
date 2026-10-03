import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { NodeId } from '@coschema/model';
import { DocumentSession } from '../core/document-session';
import { SelectionState } from '../interaction/selection-state';
import { fitLabel } from './fit-label';
import { ViewportState } from './viewport-state';

const DEFAULT_FONT_SIZE = 14;
const LABEL_PADDING = 10;
const ROUNDED_RADIUS = 10;

@Component({
  selector: 'g[cs-node]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.transform]': 'transform()',
    '[attr.data-node-id]': 'nodeId()',
    '[class.selected]': 'selected()',
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
          text-anchor="middle"
          dominant-baseline="central"
          [attr.x]="current.size[0] / 2"
          [attr.y]="current.size[1] / 2"
          [attr.font-size]="fontSize()"
        >
          {{ labelText() }}
        </svg:text>
      }
    }
  `,
})
export class NodeComponent {
  readonly nodeId = input.required<NodeId>();
  protected readonly roundedRadius = ROUNDED_RADIUS;
  private readonly session = inject(DocumentSession);
  private readonly selection = inject(SelectionState);
  private readonly viewport = inject(ViewportState);

  protected readonly node = computed(() => this.session.graph.node(this.nodeId())());
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
    if (current === undefined) return '';
    return fitLabel(current.label, current.size[0] - LABEL_PADDING * 2, this.fontSize());
  });
  protected readonly diamondPoints = computed(() => {
    const current = this.node();
    if (current === undefined) return '';
    const [width, height] = current.size;
    return `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
  });
}
