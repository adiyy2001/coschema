import type { Rect } from './rect';
import { rectBottom, rectRight } from './rect';
import type { Vec2 } from './vec';

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export interface ZoomLimits {
  readonly min: number;
  readonly max: number;
}

export type PointerPair = readonly [Vec2, Vec2];

export const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.05, max: 4 };

const WHEEL_LINE_PIXELS = 16;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;
const WHEEL_PINCH_SENSITIVITY = 0.01;
const WHEEL_DELTA_LIMIT = 240;

export function clampZoom(zoom: number, limits: ZoomLimits = DEFAULT_ZOOM_LIMITS): number {
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

export function screenToWorld(viewport: Viewport, screen: Vec2): Vec2 {
  return [(screen[0] - viewport.x) / viewport.zoom, (screen[1] - viewport.y) / viewport.zoom];
}

export function worldToScreen(viewport: Viewport, world: Vec2): Vec2 {
  return [world[0] * viewport.zoom + viewport.x, world[1] * viewport.zoom + viewport.y];
}

export function visibleWorldRect(viewport: Viewport, screen: ScreenSize): Rect {
  const [x, y] = screenToWorld(viewport, [0, 0]);
  return { x, y, width: screen.width / viewport.zoom, height: screen.height / viewport.zoom };
}

export function viewportTransform(viewport: Viewport): string {
  return `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`;
}

export function panBy(viewport: Viewport, screenDelta: Vec2): Viewport {
  return { x: viewport.x + screenDelta[0], y: viewport.y + screenDelta[1], zoom: viewport.zoom };
}

export function zoomAround(
  viewport: Viewport,
  screenPoint: Vec2,
  targetZoom: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): Viewport {
  const zoom = clampZoom(targetZoom, limits);
  const world = screenToWorld(viewport, screenPoint);
  return { x: screenPoint[0] - world[0] * zoom, y: screenPoint[1] - world[1] * zoom, zoom };
}

export function zoomByFactorAround(
  viewport: Viewport,
  screenPoint: Vec2,
  factor: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): Viewport {
  return zoomAround(viewport, screenPoint, viewport.zoom * factor, limits);
}

export function centerOn(viewport: Viewport, world: Vec2, screen: ScreenSize): Viewport {
  return {
    x: screen.width / 2 - world[0] * viewport.zoom,
    y: screen.height / 2 - world[1] * viewport.zoom,
    zoom: viewport.zoom,
  };
}

export function fitRect(
  target: Rect,
  screen: ScreenSize,
  padding = 48,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
  maxFitZoom = 1,
): Viewport {
  const availableWidth = Math.max(1, screen.width - padding * 2);
  const availableHeight = Math.max(1, screen.height - padding * 2);
  const fitted = Math.min(
    availableWidth / Math.max(1, target.width),
    availableHeight / Math.max(1, target.height),
  );
  const zoom = clampZoom(Math.min(fitted, maxFitZoom), limits);
  return centerOn(
    { x: 0, y: 0, zoom },
    [target.x + target.width / 2, target.y + target.height / 2],
    screen,
  );
}

export function clampViewport(
  viewport: Viewport,
  screen: ScreenSize,
  worldBounds: Rect,
  minVisiblePixels = 64,
): Viewport {
  const left = worldBounds.x * viewport.zoom + viewport.x;
  const right = rectRight(worldBounds) * viewport.zoom + viewport.x;
  const top = worldBounds.y * viewport.zoom + viewport.y;
  const bottom = rectBottom(worldBounds) * viewport.zoom + viewport.y;
  const visibleX = Math.min(minVisiblePixels, right - left, screen.width);
  const visibleY = Math.min(minVisiblePixels, bottom - top, screen.height);
  let dx = 0;
  let dy = 0;
  if (right < visibleX) dx = visibleX - right;
  else if (left > screen.width - visibleX) dx = screen.width - visibleX - left;
  if (bottom < visibleY) dy = visibleY - bottom;
  else if (top > screen.height - visibleY) dy = screen.height - visibleY - top;
  if (dx === 0 && dy === 0) return viewport;
  return panBy(viewport, [dx, dy]);
}

function pairDistance(pair: PointerPair): number {
  return Math.hypot(pair[0][0] - pair[1][0], pair[0][1] - pair[1][1]);
}

function pairMidpoint(pair: PointerPair): Vec2 {
  return [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2];
}

export function pinchViewport(
  startViewport: Viewport,
  startPointers: PointerPair,
  currentPointers: PointerPair,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): Viewport {
  const startDistance = pairDistance(startPointers);
  const ratio = startDistance === 0 ? 1 : pairDistance(currentPointers) / startDistance;
  const zoom = clampZoom(startViewport.zoom * ratio, limits);
  const anchor = screenToWorld(startViewport, pairMidpoint(startPointers));
  const current = pairMidpoint(currentPointers);
  return { x: current[0] - anchor[0] * zoom, y: current[1] - anchor[1] * zoom, zoom };
}

export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey?: boolean;
}

export type WheelAction =
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'pan'; readonly delta: Vec2 };

function pixelsOf(delta: number, deltaMode: number, pageSize: number): number {
  const pixels =
    deltaMode === 1 ? delta * WHEEL_LINE_PIXELS : deltaMode === 2 ? delta * pageSize : delta;
  return Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, pixels));
}

export function normalizeWheel(input: WheelInput, pageSize = 800): WheelAction {
  const deltaX = pixelsOf(input.deltaX, input.deltaMode, pageSize);
  const deltaY = pixelsOf(input.deltaY, input.deltaMode, pageSize);
  if (input.ctrlKey) {
    return { kind: 'zoom', factor: Math.exp(-deltaY * WHEEL_PINCH_SENSITIVITY) };
  }
  if (input.metaKey === true) {
    return { kind: 'zoom', factor: Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) };
  }
  return { kind: 'pan', delta: [-deltaX, -deltaY] };
}
