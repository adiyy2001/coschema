import {
  DEFAULT_ZOOM_LIMITS,
  fitRect,
  type Rect,
  type ScreenSize,
  type Viewport,
} from '@coschema/geometry';

export interface FollowInput {
  readonly lastApplied: Viewport | undefined;
  readonly current: Viewport;
  readonly peerRect: Rect | undefined;
  readonly screen: ScreenSize;
}

export type FollowStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'apply'; readonly viewport: Viewport };

const VIEWPORT_EPSILON = 0.01;

export function sameViewport(left: Viewport, right: Viewport): boolean {
  return (
    Math.abs(left.x - right.x) < VIEWPORT_EPSILON &&
    Math.abs(left.y - right.y) < VIEWPORT_EPSILON &&
    Math.abs(left.zoom - right.zoom) < VIEWPORT_EPSILON / 100
  );
}

export function followStep(input: FollowInput): FollowStep {
  const { lastApplied, current, peerRect, screen } = input;
  if (lastApplied !== undefined && !sameViewport(lastApplied, current)) return { kind: 'stop' };
  if (peerRect === undefined || screen.width <= 0 || screen.height <= 0) return { kind: 'idle' };
  const viewport = fitRect(peerRect, screen, 0, DEFAULT_ZOOM_LIMITS, DEFAULT_ZOOM_LIMITS.max);
  return sameViewport(viewport, current) ? { kind: 'idle' } : { kind: 'apply', viewport };
}
