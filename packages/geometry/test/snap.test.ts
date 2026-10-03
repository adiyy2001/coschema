import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src';
import {
  snapMovementToGrid,
  snapPointToGrid,
  snapToAlignment,
  snapToGrid,
  snapWithinThreshold,
} from '../src';

describe('grid snapping', () => {
  it('rounds to the nearest multiple', () => {
    expect(snapToGrid(13, 8)).toBe(16);
    expect(snapToGrid(11, 8)).toBe(8);
    expect(snapToGrid(-13, 8)).toBe(-16);
    expect(snapPointToGrid([3, 5], 8)).toEqual([0, 8]);
  });

  it('never returns negative zero', () => {
    expect(Object.is(snapToGrid(-1, 8), 0)).toBe(true);
  });

  it('leaves the value alone for a grid size that is not positive', () => {
    expect(snapToGrid(13.3, 0)).toBe(13.3);
    expect(snapToGrid(13.3, -4)).toBe(13.3);
  });

  it('is idempotent and lands on a multiple', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10000, max: 10000, noNaN: true }),
        fc.integer({ min: 1, max: 64 }),
        (value, grid) => {
          const snapped = snapToGrid(value, grid);
          expect(snapToGrid(snapped, grid)).toBe(snapped);
          expect(Math.abs(snapped - value)).toBeLessThanOrEqual(grid / 2 + 1e-9);
          expect(Math.abs(snapped / grid - Math.round(snapped / grid))).toBeLessThan(1e-9);
        },
      ),
    );
  });
});

describe('threshold snapping', () => {
  it('snaps only inside the threshold', () => {
    expect(snapWithinThreshold(15, 8, 2)).toBe(16);
    expect(snapWithinThreshold(12, 8, 2)).toBe(12);
    expect(snapWithinThreshold(10, 8, 2)).toBe(8);
  });
});

describe('movement of a selection', () => {
  const selection: Rect[] = [
    { x: 13, y: 21, width: 40, height: 40 },
    { x: 93, y: 61, width: 40, height: 40 },
  ];

  it('snaps the top left of the selection and keeps every relative offset', () => {
    const delta = snapMovementToGrid(selection, [5, 6], 8);
    const moved = selection.map((rect) => ({ x: rect.x + delta[0], y: rect.y + delta[1] }));
    expect(moved[0]).toEqual({ x: 16, y: 24 });
    expect((moved[1]?.x ?? 0) - (moved[0]?.x ?? 0)).toBe(80);
    expect((moved[1]?.y ?? 0) - (moved[0]?.y ?? 0)).toBe(40);
  });

  it('puts the bounds on the grid for any delta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        (dx, dy) => {
          const delta = snapMovementToGrid(selection, [dx, dy], 8);
          expect((((13 + delta[0]) % 8) + 8) % 8).toBe(0);
          expect((((21 + delta[1]) % 8) + 8) % 8).toBe(0);
        },
      ),
    );
  });

  it('returns the delta unchanged for an empty selection', () => {
    expect(snapMovementToGrid([], [3, 4], 8)).toEqual([3, 4]);
    expect(snapToAlignment([], [3, 4], [])).toEqual({ delta: [3, 4], guides: [] });
  });
});

describe('alignment snapping', () => {
  const others: Rect[] = [{ x: 200, y: 100, width: 100, height: 60 }];
  const moving: Rect[] = [{ x: 0, y: 0, width: 100, height: 60 }];

  it('snaps an edge to an edge of another node and reports the guide', () => {
    const result = snapToAlignment(moving, [203, 97], others, 6);
    expect(result.delta).toEqual([200, 100]);
    expect(result.guides).toEqual([
      { axis: 'x', position: 200 },
      { axis: 'y', position: 100 },
    ]);
  });

  it('snaps centres', () => {
    const result = snapToAlignment(
      moving,
      [201, 0],
      [{ x: 150, y: 400, width: 100, height: 60 }],
      6,
    );
    expect(result.delta[0]).toBe(200);
  });

  it('does nothing outside the threshold', () => {
    const result = snapToAlignment(moving, [120, 20], others, 6);
    expect(result).toEqual({ delta: [120, 20], guides: [] });
  });

  it('snaps one axis only when only one is in range', () => {
    const result = snapToAlignment(moving, [100, 20], others, 6);
    expect(result.delta).toEqual([100, 20]);
    const aligned = snapToAlignment(moving, [203, 20], others, 6);
    expect(aligned.delta).toEqual([200, 20]);
    expect(aligned.guides).toEqual([{ axis: 'x', position: 200 }]);
  });

  it('picks the closest of several candidates', () => {
    const crowded: Rect[] = [
      { x: 205, y: 0, width: 10, height: 10 },
      { x: 202, y: 300, width: 10, height: 10 },
    ];
    const result = snapToAlignment(moving, [200, 0], crowded, 6);
    expect(result.delta[0]).toBe(202);
  });

  it('uses the default threshold', () => {
    expect(snapToAlignment(moving, [195, 0], others).delta[0]).toBe(200);
  });
});
