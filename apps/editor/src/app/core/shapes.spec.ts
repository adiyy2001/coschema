import type { GraphNode } from '@coschema/model';
import { describe, expect, it } from 'vitest';
import { distanceToPolyline, distanceToSegment, nodeContainsPoint, nodeRect } from './shapes';

function node(type: GraphNode['type']): GraphNode {
  return { id: 'n', type, pos: [100, 50], size: [100, 60], z: 'a', style: {}, label: '' };
}

describe('nodeRect', () => {
  it('turns position and size into a rectangle', () => {
    expect(nodeRect(node('rect'))).toEqual({ x: 100, y: 50, width: 100, height: 60 });
  });
});

describe('nodeContainsPoint', () => {
  it('accepts every point of a rectangle and a rounded rectangle', () => {
    expect(nodeContainsPoint(node('rect'), [101, 51])).toBe(true);
    expect(nodeContainsPoint(node('rounded'), [199, 109])).toBe(true);
    expect(nodeContainsPoint(node('rect'), [99, 80])).toBe(false);
  });

  it('rejects the corners of an ellipse and a diamond', () => {
    expect(nodeContainsPoint(node('ellipse'), [150, 80])).toBe(true);
    expect(nodeContainsPoint(node('ellipse'), [102, 52])).toBe(false);
    expect(nodeContainsPoint(node('diamond'), [150, 80])).toBe(true);
    expect(nodeContainsPoint(node('diamond'), [110, 56])).toBe(false);
    expect(nodeContainsPoint(node('diamond'), [150, 52])).toBe(true);
  });
});

describe('distances', () => {
  it('measures to the nearest point of a segment', () => {
    expect(distanceToSegment([5, 5], [0, 0], [10, 0])).toBe(5);
    expect(distanceToSegment([-3, 4], [0, 0], [10, 0])).toBe(5);
    expect(distanceToSegment([13, 4], [0, 0], [10, 0])).toBe(5);
  });

  it('handles a segment of zero length', () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it('takes the closest segment of a polyline and is infinite for fewer than two points', () => {
    expect(
      distanceToPolyline(
        [10, 3],
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ),
    ).toBe(0 + 0);
    expect(
      distanceToPolyline(
        [4, 2],
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ),
    ).toBe(2);
    expect(distanceToPolyline([1, 1], [[0, 0]])).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToPolyline([1, 1], [])).toBe(Number.POSITIVE_INFINITY);
  });
});
