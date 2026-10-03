import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { portAnchor, portsOf, type NodeId, type PortId } from '@coschema/model';
import { DocumentSession } from '../core/document-session';
import { InteractionController } from '../interaction/controller';
import { routePath } from './route-path';
import { ViewportState } from './viewport-state';

const PORT_RADIUS_PIXELS = 5;

interface PortHandle {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly target: boolean;
}

@Component({
  selector: 'g[cs-overlay]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .port {
      fill: var(--cs-canvas, #f6f7f9);
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .port.target {
      fill: var(--cs-accent, #1f4fd8);
    }
    .marquee {
      fill: var(--cs-accent-soft, rgba(31, 79, 216, 0.12));
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 1;
      stroke-dasharray: 4 3;
      vector-effect: non-scaling-stroke;
    }
    .connect {
      fill: none;
      stroke: var(--cs-accent, #1f4fd8);
      stroke-width: 2;
      stroke-dasharray: 6 4;
      vector-effect: non-scaling-stroke;
    }
  `,
  template: `
    @if (marquee(); as area) {
      <svg:rect
        class="marquee"
        [attr.x]="area.x"
        [attr.y]="area.y"
        [attr.width]="area.width"
        [attr.height]="area.height"
      />
    }
    @if (connectPath(); as d) {
      <svg:path class="connect" [attr.d]="d" />
    }
    @for (handle of handles(); track handle.key) {
      <svg:circle
        class="port"
        [class.target]="handle.target"
        [attr.cx]="handle.x"
        [attr.cy]="handle.y"
        [attr.r]="portRadius()"
      />
    }
  `,
})
export class OverlayComponent {
  private readonly session = inject(DocumentSession);
  private readonly controller = inject(InteractionController);
  private readonly viewport = inject(ViewportState);

  protected readonly marquee = this.controller.marquee;
  protected readonly portRadius = computed(() => PORT_RADIUS_PIXELS / this.viewport.zoom());

  protected readonly handles = computed<readonly PortHandle[]>(() => {
    if (this.viewport.detail() !== 'full') return [];
    const targetKey = this.controller.connectPreview()?.target;
    const handles: PortHandle[] = [];
    for (const id of this.controller.portNodes()) {
      const node = this.session.graph.node(id)();
      if (node === undefined) continue;
      for (const port of portsOf(node.type)) {
        const [x, y] = portAnchor(node.pos, node.size, port);
        handles.push({
          key: `${id}:${port}`,
          x,
          y,
          target: targetKey?.id === id && targetKey.port === port,
        });
      }
    }
    return handles;
  });

  protected readonly connectPath = computed(() => {
    const preview = this.controller.connectPreview();
    if (preview === undefined) return '';
    const source = this.anchorOf(preview.sourceId, preview.sourcePort);
    const end =
      preview.target === undefined
        ? preview.pointer
        : (this.anchorOf(preview.target.id, preview.target.port) ?? preview.pointer);
    return source === undefined ? '' : routePath([source, end]);
  });

  private anchorOf(id: NodeId, port: PortId): readonly [number, number] | undefined {
    const node = this.session.graph.node(id)();
    return node === undefined ? undefined : portAnchor(node.pos, node.size, port);
  }
}
