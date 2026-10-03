import { describe, expect, it } from 'vitest';
import {
  CursorAnimator,
  DEFAULT_HALF_LIFE_MS,
  MAX_FRAME_GAP_MS,
  NOMINAL_FRAME_MS,
  approach,
  smoothingFactor,
} from './cursor-animator';

describe('smoothing', () => {
  it('covers half of the distance in one half-life', () => {
    expect(smoothingFactor(DEFAULT_HALF_LIFE_MS, DEFAULT_HALF_LIFE_MS)).toBeCloseTo(0.5, 10);
    expect(smoothingFactor(2 * DEFAULT_HALF_LIFE_MS, DEFAULT_HALF_LIFE_MS)).toBeCloseTo(0.75, 10);
  });

  it('is zero without elapsed time and one without smoothing', () => {
    expect(smoothingFactor(0, 40)).toBe(0);
    expect(smoothingFactor(-5, 40)).toBe(0);
    expect(smoothingFactor(16, 0)).toBe(1);
  });

  it('gives the same result for one long step and two short ones', () => {
    const start = { x: 0, y: 0 };
    const target = { x: 100, y: -40 };
    const once = approach(start, target, 60, 45);
    const twice = approach(approach(start, target, 30, 45), target, 30, 45);
    expect(once.x).toBeCloseTo(twice.x, 8);
    expect(once.y).toBeCloseTo(twice.y, 8);
  });

  it('lands on the target once it is closer than the settle distance', () => {
    const target = { x: 10, y: 10 };
    expect(approach({ x: 9.99, y: 10 }, target, 16, 45)).toBe(target);
  });
});

describe('CursorAnimator', () => {
  it('puts a new cursor at its first position without flying in', () => {
    const animator = new CursorAnimator();
    animator.setTarget(7, { x: 300, y: 200 });
    expect(animator.step(0).get(7)).toEqual({ x: 300, y: 200 });
    expect(animator.active).toBe(false);
  });

  it('moves toward a new target over several frames and settles', () => {
    const animator = new CursorAnimator(45);
    animator.setTarget(1, { x: 0, y: 0 });
    animator.step(0);
    animator.setTarget(1, { x: 100, y: 0 });
    expect(animator.active).toBe(true);
    let now = 0;
    let previous = 0;
    for (let frame = 0; frame < 40 && animator.active; frame += 1) {
      now += 16.7;
      const x = animator.step(now).get(1)?.x ?? Number.NaN;
      expect(x).toBeGreaterThanOrEqual(previous);
      expect(x).toBeLessThanOrEqual(100);
      previous = x;
    }
    expect(animator.step(now + 16.7).get(1)).toEqual({ x: 100, y: 0 });
    expect(animator.active).toBe(false);
  });

  it('assumes one nominal frame for the first frame after an idle period', () => {
    const animator = new CursorAnimator(50);
    animator.setTarget(1, { x: 0, y: 0 });
    animator.step(0);
    animator.setTarget(1, { x: 100, y: 0 });
    const first = animator.step(1000).get(1)?.x ?? 0;
    expect(first).toBeCloseTo(100 * smoothingFactor(NOMINAL_FRAME_MS, 50), 8);
    const second = animator.step(1050).get(1)?.x ?? 0;
    expect(second).toBeCloseTo(100 - (100 - first) * 0.5, 8);
  });

  it('caps the gap after a stalled frame', () => {
    const animator = new CursorAnimator(45);
    animator.setTarget(1, { x: 0, y: 0 });
    animator.step(0);
    animator.setTarget(1, { x: 1000, y: 0 });
    animator.step(10);
    const capped = animator.step(10 + 10_000).get(1)?.x ?? 0;
    expect(capped).toBeLessThan(1000);
    expect(capped).toBeGreaterThan(900);
    expect(smoothingFactor(MAX_FRAME_GAP_MS, 45)).toBeLessThan(1);
  });

  it('jumps straight to the target under reduced motion', () => {
    const animator = new CursorAnimator(45, true);
    animator.setTarget(1, { x: 0, y: 0 });
    animator.setTarget(1, { x: 500, y: 500 });
    expect(animator.step(0).get(1)).toEqual({ x: 500, y: 500 });
    expect(animator.active).toBe(false);
  });

  it('switches to jumping when reduced motion is turned on while a cursor is moving', () => {
    const animator = new CursorAnimator(45);
    animator.setTarget(1, { x: 0, y: 0 });
    animator.step(0);
    animator.setTarget(1, { x: 80, y: 0 });
    animator.setReducedMotion(true);
    expect(animator.step(16).get(1)).toEqual({ x: 80, y: 0 });
  });

  it('forgets a cursor when its target becomes null or it is removed', () => {
    const animator = new CursorAnimator();
    animator.setTarget(1, { x: 1, y: 1 });
    animator.setTarget(2, { x: 2, y: 2 });
    expect(animator.size).toBe(2);
    animator.setTarget(1, null);
    animator.remove(2);
    expect(animator.size).toBe(0);
    expect(animator.step(0).size).toBe(0);
  });
});
