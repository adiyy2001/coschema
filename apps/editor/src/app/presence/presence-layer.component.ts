import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DocumentSession } from '../core/document-session';
import { ViewportState } from '../canvas/viewport-state';
import { dashFor } from './peers';
import { PresenceStore } from './presence-store';
import {
  TAG_FONT_PIXELS,
  TAG_HEIGHT_PIXELS,
  readableTextColor,
  tagLabel,
  tagWidthPixels,
} from './tag';
import { shouldShowIndicator } from './viewport-indicator';

const SELECTION_MARGIN_PIXELS = 5;
const MAX_OUTLINES_PER_PEER = 60;

interface Outline {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly dash: string;
}

interface Tag {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly label: string;
  readonly color: string;
  readonly text: string;
}

interface Frame {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

@Component({
  selector: 'g[cs-presence]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', 'pointer-events': 'none' },
  styles: `
    .outline {
      fill: none;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .frame {
      stroke-width: 1.5;
      stroke-dasharray: 8 6;
      vector-effect: non-scaling-stroke;
      fill-opacity: 0.04;
    }
    .tag-text {
      font-family: system-ui, sans-serif;
      font-weight: 600;
      dominant-baseline: central;
    }
  `,
  template: `
    @for (frame of frames(); track frame.key) {
      <svg:rect
        class="frame"
        [attr.x]="frame.x"
        [attr.y]="frame.y"
        [attr.width]="frame.width"
        [attr.height]="frame.height"
        [attr.stroke]="frame.color"
        [attr.fill]="frame.color"
      />
    }
    @for (outline of outlines(); track outline.key) {
      <svg:rect
        class="outline"
        [attr.x]="outline.x"
        [attr.y]="outline.y"
        [attr.width]="outline.width"
        [attr.height]="outline.height"
        [attr.stroke]="outline.color"
        [attr.stroke-dasharray]="outline.dash || null"
        rx="3"
      />
    }
    @for (tag of tags(); track tag.key) {
      <svg:g [attr.transform]="'translate(' + tag.x + ' ' + tag.y + ') scale(' + scale() + ')'">
        <svg:rect
          [attr.width]="tag.width"
          [attr.height]="tagHeight"
          rx="4"
          [attr.fill]="tag.color"
        />
        <svg:text
          class="tag-text"
          x="5"
          [attr.y]="tagHeight / 2"
          [attr.font-size]="tagFont"
          [attr.fill]="tag.text"
        >
          {{ tag.label }}
        </svg:text>
      </svg:g>
    }
  `,
})
export class PresenceLayerComponent {
  protected readonly tagHeight = TAG_HEIGHT_PIXELS;
  protected readonly tagFont = TAG_FONT_PIXELS;
  private readonly store = inject(PresenceStore);
  private readonly session = inject(DocumentSession);
  private readonly viewport = inject(ViewportState);

  protected readonly scale = computed(() => 1 / this.viewport.zoom());

  private readonly placed = computed(() => {
    const margin = SELECTION_MARGIN_PIXELS / this.viewport.zoom();
    const outlines: Outline[] = [];
    const tags: Tag[] = [];
    for (const peer of this.store.peers()) {
      let anchored = false;
      for (const id of peer.selection.slice(0, MAX_OUTLINES_PER_PEER)) {
        const node = this.session.graph.node(id)();
        if (node === undefined) continue;
        const x = node.pos[0] - margin;
        const y = node.pos[1] - margin;
        outlines.push({
          key: `${peer.clientId}:${id}`,
          x,
          y,
          width: node.size[0] + margin * 2,
          height: node.size[1] + margin * 2,
          color: peer.user.color,
          dash: dashFor(peer.clientId),
        });
        if (!anchored) {
          anchored = true;
          tags.push({
            key: `selection:${peer.clientId}`,
            x,
            y: y - (TAG_HEIGHT_PIXELS + 2) / this.viewport.zoom(),
            width: tagWidthPixels(peer.user.name),
            label: tagLabel(peer.user.name),
            color: peer.user.color,
            text: readableTextColor(peer.user.color),
          });
        }
      }
    }
    return { outlines, tags };
  });

  protected readonly outlines = computed(() => this.placed().outlines);

  protected readonly frames = computed<readonly Frame[]>(() => {
    const own = this.viewport.worldRect();
    return this.store
      .peers()
      .flatMap((peer) =>
        peer.viewport !== null && shouldShowIndicator(peer.viewport, own)
          ? [{ key: `viewport:${peer.clientId}`, ...peer.viewport, color: peer.user.color }]
          : [],
      );
  });

  protected readonly tags = computed<readonly Tag[]>(() => {
    const frameTags = this.store.peers().flatMap((peer): Tag[] =>
      peer.viewport !== null && shouldShowIndicator(peer.viewport, this.viewport.worldRect())
        ? [
            {
              key: `viewport:${peer.clientId}`,
              x: peer.viewport.x,
              y: peer.viewport.y,
              width: tagWidthPixels(`${peer.user.name} view`),
              label: tagLabel(`${peer.user.name} view`),
              color: peer.user.color,
              text: readableTextColor(peer.user.color),
            },
          ]
        : [],
    );
    return [...this.placed().tags, ...frameTags];
  });
}
