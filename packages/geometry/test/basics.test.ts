import { describe, expect, it } from 'vitest';
import {
  add,
  boundsOfPoints,
  boundsOfRects,
  distance,
  equalVec,
  inflateRect,
  isFiniteRect,
  isFiniteVec,
  manhattan,
  midpoint,
  rect,
  rectBottom,
  rectCenter,
  rectContainsPoint,
  rectContainsRect,
  rectFromCorners,
  rectInteriorContainsPoint,
  rectRight,
  rectsIntersect,
  rectsOverlap,
  scale,
  segmentCrossesInterior,
  subtract,
  translateRect,
  unionRects,
  vec,
} from '../src';

describe('vec', () => {
  it('does the arithmetic', () => {
    expect(vec(1, 2)).toEqual([1, 2]);
    expect(add([1, 2], [3, 4])).toEqual([4, 6]);
    expect(subtract([5, 5], [3, 4])).toEqual([2, 1]);
    expect(scale([2, 3], 2)).toEqual([4, 6]);
    expect(midpoint([0, 0], [4, 6])).toEqual([2, 3]);
    expect(distance([0, 0], [3, 4])).toBe(5);
    expect(manhattan([0, 0], [3, -4])).toBe(7);
  });

  it('compares and validates', () => {
    expect(equalVec([1, 2], [1, 2])).toBe(true);
    expect(equalVec([1, 2], [2, 1])).toBe(false);
    expect(isFiniteVec([1, 2])).toBe(true);
    expect(isFiniteVec([1, Number.NaN])).toBe(false);
    expect(isFiniteVec([Number.POSITIVE_INFINITY, 0])).toBe(false);
  });
});

describe('rect', () => {
  const box = rect(10, 20, 100, 50);

  it('exposes its edges and centre', () => {
    expect(rectRight(box)).toBe(110);
    expect(rectBottom(box)).toBe(70);
    expect(rectCenter(box)).toEqual([60, 45]);
  });

  it('builds from corners in any order', () => {
    expect(rectFromCorners([110, 70], [10, 20])).toEqual(box);
  });

  it('validates', () => {
    expect(isFiniteRect(box)).toBe(true);
    expect(isFiniteRect(rect(0, 0, -1, 1))).toBe(false);
    expect(isFiniteRect(rect(0, 0, 1, -1))).toBe(false);
    expect(isFiniteRect(rect(Number.NaN, 0, 1, 1))).toBe(false);
    expect(isFiniteRect(rect(0, Number.NaN, 1, 1))).toBe(false);
    expect(isFiniteRect(rect(0, 0, Number.POSITIVE_INFINITY, 1))).toBe(false);
    expect(isFiniteRect(rect(0, 0, 1, Number.POSITIVE_INFINITY))).toBe(false);
  });

  it('inflates, translates and unites', () => {
    expect(inflateRect(box, 5)).toEqual(rect(5, 15, 110, 60));
    expect(translateRect(box, [1, -1])).toEqual(rect(11, 19, 100, 50));
    expect(unionRects(box, rect(0, 0, 20, 20))).toEqual(rect(0, 0, 110, 70));
  });

  it('computes bounds', () => {
    expect(boundsOfRects([])).toBeUndefined();
    expect(boundsOfRects([box, rect(200, 200, 10, 10)])).toEqual(rect(10, 20, 200, 190));
    expect(boundsOfPoints([])).toBeUndefined();
    expect(
      boundsOfPoints([
        [3, 9],
        [-1, 2],
        [7, 4],
      ]),
    ).toEqual(rect(-1, 2, 8, 7));
  });

  it('tells touching from overlapping', () => {
    const neighbour = rect(110, 20, 10, 10);
    expect(rectsIntersect(box, neighbour)).toBe(true);
    expect(rectsOverlap(box, neighbour)).toBe(false);
    expect(rectsOverlap(box, rect(100, 30, 30, 10))).toBe(true);
    expect(rectsIntersect(box, rect(500, 500, 1, 1))).toBe(false);
  });

  it('contains points and rectangles', () => {
    expect(rectContainsPoint(box, [10, 20])).toBe(true);
    expect(rectContainsPoint(box, [9, 20])).toBe(false);
    expect(rectInteriorContainsPoint(box, [10, 20])).toBe(false);
    expect(rectInteriorContainsPoint(box, [11, 21])).toBe(true);
    expect(rectContainsRect(box, rect(20, 30, 10, 10))).toBe(true);
    expect(rectContainsRect(box, rect(20, 30, 200, 10))).toBe(false);
  });

  describe('segmentCrossesInterior', () => {
    it('detects horizontal and vertical crossings', () => {
      expect(segmentCrossesInterior([0, 30], [50, 30], box)).toBe(true);
      expect(segmentCrossesInterior([50, 0], [50, 40], box)).toBe(true);
      expect(segmentCrossesInterior([50, 40], [50, 0], box)).toBe(true);
    });

    it('lets a segment run along an edge or end on it', () => {
      expect(segmentCrossesInterior([0, 20], [200, 20], box)).toBe(false);
      expect(segmentCrossesInterior([10, 0], [10, 100], box)).toBe(false);
      expect(segmentCrossesInterior([0, 30], [10, 30], box)).toBe(false);
      expect(segmentCrossesInterior([50, 0], [50, 20], box)).toBe(false);
    });

    it('rejects diagonal segments', () => {
      expect(() => segmentCrossesInterior([0, 0], [1, 1], box)).toThrow(RangeError);
    });
  });
});
