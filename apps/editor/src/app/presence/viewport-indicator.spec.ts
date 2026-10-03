import { describe, expect, it } from 'vitest';
import { containsRect, shouldShowIndicator } from './viewport-indicator';

const own = { x: 0, y: 0, width: 1000, height: 600 };

describe('viewport indicator', () => {
  it('shows a peer viewport that overlaps the visible area without covering it', () => {
    expect(shouldShowIndicator({ x: 600, y: 200, width: 800, height: 500 }, own)).toBe(true);
    expect(shouldShowIndicator({ x: 100, y: 100, width: 200, height: 100 }, own)).toBe(true);
  });

  it('hides a peer viewport that covers the visible area, which is what follow produces', () => {
    expect(shouldShowIndicator({ x: 0, y: 0, width: 1000, height: 600 }, own)).toBe(false);
    expect(shouldShowIndicator({ x: -500, y: -500, width: 3000, height: 3000 }, own)).toBe(false);
  });

  it('hides a peer viewport that is entirely off screen', () => {
    expect(shouldShowIndicator({ x: 2000, y: 2000, width: 300, height: 300 }, own)).toBe(false);
  });

  it('tells containment from overlap', () => {
    expect(containsRect(own, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
    expect(containsRect(own, { x: 990, y: 10, width: 50, height: 5 })).toBe(false);
  });
});
