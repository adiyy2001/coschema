import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec2, Viewport } from '../src';
import {
  DEFAULT_ZOOM_LIMITS,
  IDENTITY_VIEWPORT,
  centerOn,
  clampViewport,
  clampZoom,
  fitRect,
  normalizeWheel,
  panBy,
  pinchViewport,
  screenToWorld,
  viewportTransform,
  visibleWorldRect,
  worldToScreen,
  zoomAround,
  zoomByFactorAround,
} from '../src';

const viewportArbitrary = fc.record({
  x: fc.double({ min: -5000, max: 5000, noNaN: true }),
  y: fc.double({ min: -5000, max: 5000, noNaN: true }),
  zoom: fc.double({ min: 0.05, max: 4, noNaN: true }),
});

const pointArbitrary = fc.tuple(
  fc.double({ min: -3000, max: 3000, noNaN: true }),
  fc.double({ min: -3000, max: 3000, noNaN: true }),
);

function close(actual: Vec2, expected: Vec2, digits = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

describe('screen and world coordinates', () => {
  it('round trips screen to world to screen', () => {
    fc.assert(
      fc.property(viewportArbitrary, pointArbitrary, (viewport, screen) => {
        close(worldToScreen(viewport, screenToWorld(viewport, screen)), screen, 5);
      }),
    );
  });

  it('maps the origin of the screen to the top left of the visible world rect', () => {
    const viewport: Viewport = { x: -200, y: 100, zoom: 2 };
    expect(screenToWorld(viewport, [0, 0])).toEqual([100, -50]);
    expect(visibleWorldRect(viewport, { width: 800, height: 600 })).toEqual({
      x: 100,
      y: -50,
      width: 400,
      height: 300,
    });
  });

  it('writes the SVG transform', () => {
    expect(viewportTransform({ x: 10, y: -20, zoom: 1.5 })).toBe('translate(10 -20) scale(1.5)');
  });

  it('pans by a screen delta without touching the zoom', () => {
    expect(panBy({ x: 1, y: 2, zoom: 3 }, [10, -5])).toEqual({ x: 11, y: -3, zoom: 3 });
  });
});

describe('zoomAround', () => {
  it('keeps the world point under the cursor fixed', () => {
    fc.assert(
      fc.property(
        viewportArbitrary,
        pointArbitrary,
        fc.double({ min: 0.01, max: 10, noNaN: true }),
        (viewport, cursor, targetZoom) => {
          const before = screenToWorld(viewport, cursor);
          const zoomed = zoomAround(viewport, cursor, targetZoom);
          close(screenToWorld(zoomed, cursor), before, 4);
          close(worldToScreen(zoomed, before), cursor, 4);
        },
      ),
    );
  });

  it('keeps the point fixed for a factor too, and clamps to the limits', () => {
    const cursor: Vec2 = [300, 200];
    const zoomedIn = zoomByFactorAround(IDENTITY_VIEWPORT, cursor, 100);
    expect(zoomedIn.zoom).toBe(DEFAULT_ZOOM_LIMITS.max);
    close(screenToWorld(zoomedIn, cursor), cursor);
    const zoomedOut = zoomByFactorAround(IDENTITY_VIEWPORT, cursor, 0.0001);
    expect(zoomedOut.zoom).toBe(DEFAULT_ZOOM_LIMITS.min);
    close(screenToWorld(zoomedOut, cursor), cursor);
  });

  it('respects custom limits', () => {
    expect(clampZoom(5, { min: 0.5, max: 2 })).toBe(2);
    expect(clampZoom(0.1, { min: 0.5, max: 2 })).toBe(0.5);
    expect(zoomAround(IDENTITY_VIEWPORT, [0, 0], 9, { min: 0.5, max: 2 }).zoom).toBe(2);
  });
});

describe('fitRect and centerOn', () => {
  it('centres the world point on the screen', () => {
    const viewport = centerOn({ x: 0, y: 0, zoom: 2 }, [100, 50], { width: 800, height: 600 });
    close(worldToScreen(viewport, [100, 50]), [400, 300]);
  });

  it('fits a rectangle inside the screen with padding', () => {
    const screen = { width: 1000, height: 600 };
    const target = { x: 100, y: 100, width: 2000, height: 1000 };
    const viewport = fitRect(target, screen, 50);
    const topLeft = worldToScreen(viewport, [target.x, target.y]);
    const bottomRight = worldToScreen(viewport, [
      target.x + target.width,
      target.y + target.height,
    ]);
    expect(topLeft[0]).toBeGreaterThanOrEqual(49.9);
    expect(topLeft[1]).toBeGreaterThanOrEqual(49.9);
    expect(bottomRight[0]).toBeLessThanOrEqual(950.1);
    expect(bottomRight[1]).toBeLessThanOrEqual(550.1);
  });

  it('does not zoom in past the fit zoom limit for a tiny rectangle', () => {
    const viewport = fitRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 800, height: 600 });
    expect(viewport.zoom).toBe(1);
  });

  it('copes with an empty rectangle and a tiny screen', () => {
    const viewport = fitRect({ x: 5, y: 5, width: 0, height: 0 }, { width: 10, height: 10 }, 100);
    expect(Number.isFinite(viewport.zoom)).toBe(true);
    expect(Number.isFinite(viewport.x)).toBe(true);
  });
});

describe('clampViewport', () => {
  const screen = { width: 1000, height: 800 };
  const bounds = { x: 0, y: 0, width: 2000, height: 2000 };

  it('leaves a viewport alone when the content is in view', () => {
    const viewport: Viewport = { x: -300, y: -300, zoom: 1 };
    expect(clampViewport(viewport, screen, bounds)).toBe(viewport);
  });

  it('pulls content back when it was panned off every side', () => {
    const far = clampViewport({ x: -9000, y: -9000, zoom: 1 }, screen, bounds, 64);
    expect(far.x + 2000).toBe(64);
    expect(far.y + 2000).toBe(64);
    const other = clampViewport({ x: 9000, y: 9000, zoom: 1 }, screen, bounds, 64);
    expect(other.x).toBe(1000 - 64);
    expect(other.y).toBe(800 - 64);
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(viewportArbitrary, (viewport) => {
        const once = clampViewport(viewport, screen, bounds);
        const twice = clampViewport(once, screen, bounds);
        close([twice.x, twice.y], [once.x, once.y], 6);
        expect(twice.zoom).toBe(once.zoom);
      }),
    );
  });

  it('keeps at least part of the content visible', () => {
    fc.assert(
      fc.property(viewportArbitrary, (viewport) => {
        const clamped = clampViewport(viewport, screen, bounds, 64);
        const left = bounds.x * clamped.zoom + clamped.x;
        const right = (bounds.x + bounds.width) * clamped.zoom + clamped.x;
        expect(right).toBeGreaterThanOrEqual(63.999);
        expect(left).toBeLessThanOrEqual(screen.width - 63.999);
      }),
    );
  });
});

describe('pinchViewport', () => {
  const start: Viewport = { x: 50, y: 20, zoom: 1 };
  const fingers: readonly [Vec2, Vec2] = [
    [300, 300],
    [500, 300],
  ];

  it('scales by the ratio of the finger distances', () => {
    const viewport = pinchViewport(start, fingers, [
      [200, 300],
      [600, 300],
    ]);
    expect(viewport.zoom).toBeCloseTo(2);
  });

  it('keeps the world point under the midpoint under the midpoint', () => {
    fc.assert(
      fc.property(
        viewportArbitrary,
        fc.double({ min: 0.4, max: 2.5, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        fc.double({ min: -200, max: 200, noNaN: true }),
        (initial, ratio, shiftX, shiftY) => {
          const first: readonly [Vec2, Vec2] = [
            [300, 300],
            [500, 400],
          ];
          const midpoint: Vec2 = [400, 350];
          const anchor = screenToWorld(initial, midpoint);
          const centre: Vec2 = [400 + shiftX, 350 + shiftY];
          const half: Vec2 = [(200 * ratio) / 2, (100 * ratio) / 2];
          const second: readonly [Vec2, Vec2] = [
            [centre[0] - half[0], centre[1] - half[1]],
            [centre[0] + half[0], centre[1] + half[1]],
          ];
          const result = pinchViewport(initial, first, second);
          close(worldToScreen(result, anchor), centre, 4);
        },
      ),
    );
  });

  it('pans without scaling when both fingers move together', () => {
    const viewport = pinchViewport(start, fingers, [
      [350, 330],
      [550, 330],
    ]);
    expect(viewport.zoom).toBeCloseTo(1);
    expect(viewport.x).toBeCloseTo(100);
    expect(viewport.y).toBeCloseTo(50);
  });

  it('clamps the zoom and survives two fingers on the same spot', () => {
    const wide = pinchViewport(start, fingers, [
      [-5000, 300],
      [5000, 300],
    ]);
    expect(wide.zoom).toBe(DEFAULT_ZOOM_LIMITS.max);
    const same = pinchViewport(
      start,
      [
        [300, 300],
        [300, 300],
      ],
      [
        [100, 100],
        [400, 400],
      ],
    );
    expect(same.zoom).toBe(1);
  });
});

describe('normalizeWheel', () => {
  const wheel = (overrides: Partial<Parameters<typeof normalizeWheel>[0]>) =>
    normalizeWheel({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...overrides });

  it('pans on a plain wheel, moving content against the delta', () => {
    expect(wheel({ deltaX: 10, deltaY: 40 })).toEqual({ kind: 'pan', delta: [-10, -40] });
  });

  it('converts line and page deltas to pixels', () => {
    expect(wheel({ deltaY: 3, deltaMode: 1 })).toEqual({ kind: 'pan', delta: [-0, -48] });
    expect(normalizeWheel({ deltaX: 0, deltaY: 0.5, deltaMode: 2, ctrlKey: false }, 400)).toEqual({
      kind: 'pan',
      delta: [-0, -200],
    });
  });

  it('limits a huge delta', () => {
    expect(wheel({ deltaY: 100000 })).toEqual({ kind: 'pan', delta: [-0, -240] });
    expect(wheel({ deltaY: -100000 })).toEqual({ kind: 'pan', delta: [-0, 240] });
  });

  it('zooms with the control key, scrolling up zooms in', () => {
    const zoomIn = wheel({ deltaY: -10, ctrlKey: true });
    const zoomOut = wheel({ deltaY: 10, ctrlKey: true });
    expect(zoomIn.kind).toBe('zoom');
    if (zoomIn.kind === 'zoom' && zoomOut.kind === 'zoom') {
      expect(zoomIn.factor).toBeGreaterThan(1);
      expect(zoomOut.factor).toBeLessThan(1);
      expect(zoomIn.factor * zoomOut.factor).toBeCloseTo(1);
    }
  });

  it('zooms with the meta key more gently than a pinch gesture', () => {
    const meta = wheel({ deltaY: -10, metaKey: true });
    const pinch = wheel({ deltaY: -10, ctrlKey: true });
    if (meta.kind === 'zoom' && pinch.kind === 'zoom') {
      expect(meta.factor).toBeGreaterThan(1);
      expect(meta.factor).toBeLessThan(pinch.factor);
    } else {
      expect.unreachable();
    }
  });
});
