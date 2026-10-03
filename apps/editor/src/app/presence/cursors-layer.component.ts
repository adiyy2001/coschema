import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { ViewportState } from '../canvas/viewport-state';
import { FRAME_SCHEDULER } from '../core/frame-scheduler';
import { PresenceStore } from './presence-store';
import {
  TAG_FONT_PIXELS,
  TAG_HEIGHT_PIXELS,
  readableTextColor,
  tagLabel,
  tagWidthPixels,
} from './tag';

const POINTER_PATH = 'M0 0 L0 16.5 L4.3 12.6 L7.1 19 L9.9 17.8 L7.1 11.5 L12.6 11.2 Z';
const GRACE_FRAMES = 3;

interface CursorView {
  readonly clientId: number;
  readonly color: string;
  readonly label: string;
  readonly text: string;
  readonly width: number;
}

@Component({
  selector: 'g[cs-cursors]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', 'pointer-events': 'none' },
  styles: `
    .pointer {
      stroke: #ffffff;
      stroke-width: 1.4;
      stroke-linejoin: round;
    }
    .tag-text {
      font-family: system-ui, sans-serif;
      font-weight: 600;
      dominant-baseline: central;
      pointer-events: none;
    }
  `,
  template: `
    @for (cursor of cursors(); track cursor.clientId) {
      <svg:g class="cursor" visibility="hidden" [attr.data-cursor]="cursor.clientId">
        <svg:path class="pointer" [attr.d]="pointer" [attr.fill]="cursor.color" />
        <svg:g transform="translate(11 17)">
          <svg:rect
            [attr.width]="cursor.width"
            [attr.height]="tagHeight"
            rx="4"
            [attr.fill]="cursor.color"
          />
          <svg:text
            class="tag-text"
            [attr.x]="5"
            [attr.y]="tagHeight / 2"
            [attr.font-size]="tagFont"
            [attr.fill]="cursor.text"
          >
            {{ cursor.label }}
          </svg:text>
        </svg:g>
      </svg:g>
    }
  `,
})
export class CursorsLayerComponent {
  protected readonly pointer = POINTER_PATH;
  protected readonly tagHeight = TAG_HEIGHT_PIXELS;
  protected readonly tagFont = TAG_FONT_PIXELS;
  private readonly store = inject(PresenceStore);
  private readonly viewport = inject(ViewportState);
  private readonly schedule = inject(FRAME_SCHEDULER);
  private readonly host = inject<ElementRef<SVGGElement>>(ElementRef);
  private cancelFrame: (() => void) | undefined;
  private graceFrames = 0;

  protected readonly cursors = computed<readonly CursorView[]>(() =>
    this.store.peers().map((peer) => ({
      clientId: peer.clientId,
      color: peer.user.color,
      label: tagLabel(peer.user.name),
      text: readableTextColor(peer.user.color),
      width: tagWidthPixels(peer.user.name),
    })),
  );

  constructor() {
    const stopWatching = this.store.watchCursors(() => {
      this.requestFrame();
    });
    effect(() => {
      this.cursors();
      this.viewport.zoom();
      this.requestFrame();
    });
    inject(DestroyRef).onDestroy(() => {
      stopWatching();
      this.cancelFrame?.();
    });
  }

  private requestFrame(): void {
    this.graceFrames = GRACE_FRAMES;
    if (this.cancelFrame !== undefined) return;
    this.cancelFrame = this.schedule(() => {
      this.cancelFrame = undefined;
      this.draw();
    });
  }

  private draw(): void {
    const positions = this.store.cursorPositions(performance.now());
    const scale = 1 / this.viewport.zoom();
    for (const element of this.host.nativeElement.querySelectorAll('[data-cursor]')) {
      const position = positions.get(Number(element.getAttribute('data-cursor')));
      if (position === undefined) {
        element.setAttribute('visibility', 'hidden');
        continue;
      }
      element.setAttribute('transform', `translate(${position.x} ${position.y}) scale(${scale})`);
      element.setAttribute('visibility', 'visible');
    }
    this.graceFrames -= 1;
    if (this.store.animating || this.graceFrames > 0) {
      this.cancelFrame = this.schedule(() => {
        this.cancelFrame = undefined;
        this.draw();
      });
    }
  }
}
