import { visibleWorldRect, type Viewport } from '@coschema/geometry';
import { describe, expect, it } from 'vitest';
import { followStep, sameViewport } from './follow';

const screen = { width: 1000, height: 600 };
const home: Viewport = { x: 0, y: 0, zoom: 1 };

describe('followStep', () => {
  it('applies a viewport that shows the peer rectangle', () => {
    const peerRect = { x: 500, y: 300, width: 800, height: 480 };
    const step = followStep({ lastApplied: undefined, current: home, peerRect, screen });
    expect(step.kind).toBe('apply');
    if (step.kind !== 'apply') return;
    const shown = visibleWorldRect(step.viewport, screen);
    expect(shown.x).toBeLessThanOrEqual(peerRect.x + 1e-6);
    expect(shown.y).toBeLessThanOrEqual(peerRect.y + 1e-6);
    expect(shown.x + shown.width).toBeGreaterThanOrEqual(peerRect.x + peerRect.width - 1e-6);
    expect(shown.y + shown.height).toBeGreaterThanOrEqual(peerRect.y + peerRect.height - 1e-6);
  });

  it('can zoom in beyond 100 percent when the peer is zoomed in', () => {
    const peerRect = { x: 0, y: 0, width: 250, height: 150 };
    const step = followStep({ lastApplied: undefined, current: home, peerRect, screen });
    expect(step.kind === 'apply' && step.viewport.zoom).toBeCloseTo(4, 6);
  });

  it('stays idle without a peer rectangle or a measured screen', () => {
    expect(
      followStep({ lastApplied: undefined, current: home, peerRect: undefined, screen }).kind,
    ).toBe('idle');
    expect(
      followStep({
        lastApplied: undefined,
        current: home,
        peerRect: { x: 0, y: 0, width: 10, height: 10 },
        screen: { width: 0, height: 0 },
      }).kind,
    ).toBe('idle');
  });

  it('stays idle once the viewport already shows the peer rectangle', () => {
    const peerRect = visibleWorldRect(home, screen);
    expect(followStep({ lastApplied: home, current: home, peerRect, screen }).kind).toBe('idle');
  });

  it('stops when the person moved the viewport away from what follow applied', () => {
    const applied: Viewport = { x: 10, y: 10, zoom: 1 };
    const moved: Viewport = { x: 60, y: 10, zoom: 1 };
    const peerRect = { x: 0, y: 0, width: 400, height: 300 };
    expect(followStep({ lastApplied: applied, current: moved, peerRect, screen }).kind).toBe(
      'stop',
    );
    const zoomed: Viewport = { x: 10, y: 10, zoom: 1.25 };
    expect(followStep({ lastApplied: applied, current: zoomed, peerRect, screen }).kind).toBe(
      'stop',
    );
  });

  it('keeps following when the peer moves and nobody touched the viewport', () => {
    const first = followStep({
      lastApplied: undefined,
      current: home,
      peerRect: { x: 0, y: 0, width: 500, height: 300 },
      screen,
    });
    if (first.kind !== 'apply') throw new Error('expected apply');
    const second = followStep({
      lastApplied: first.viewport,
      current: first.viewport,
      peerRect: { x: 900, y: 400, width: 500, height: 300 },
      screen,
    });
    expect(second.kind).toBe('apply');
  });

  it('compares viewports with a small tolerance', () => {
    expect(sameViewport(home, { x: 0.001, y: -0.001, zoom: 1 })).toBe(true);
    expect(sameViewport(home, { x: 0.5, y: 0, zoom: 1 })).toBe(false);
    expect(sameViewport(home, { x: 0, y: 0, zoom: 1.001 })).toBe(false);
  });
});
