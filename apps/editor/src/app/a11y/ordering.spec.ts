import { describe, expect, it } from 'vitest';
import {
  edgeOrder,
  nearestInDirection,
  readingOrder,
  stepThrough,
  type PlacedNode,
} from './ordering';

function placed(id: string, x: number, y: number, width = 100, height = 60): PlacedNode {
  return { id, rect: { x, y, width, height } };
}

describe('readingOrder', () => {
  it('reads rows from top to bottom and each row from left to right', () => {
    const nodes = [
      placed('bottom-right', 400, 300),
      placed('top-right', 400, 0),
      placed('top-left', 0, 0),
      placed('bottom-left', 0, 300),
    ];
    expect(readingOrder(nodes)).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
  });

  it('keeps nodes a few pixels apart vertically in one row', () => {
    const nodes = [placed('right', 300, 24), placed('left', 0, 0)];
    expect(readingOrder(nodes)).toEqual(['left', 'right']);
  });

  it('breaks exact ties by id so the order is stable', () => {
    expect(readingOrder([placed('b', 0, 0), placed('a', 0, 0)])).toEqual(['a', 'b']);
  });
});

describe('edgeOrder', () => {
  it('follows the position of the source, then of the target, then the id', () => {
    const order = ['a', 'b', 'c'];
    const edges = [
      { id: 'e3', source: 'b', target: 'c' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e0', source: 'a', target: 'b' },
      { id: 'lost', source: 'gone', target: 'a' },
    ];
    expect(edgeOrder(edges, order)).toEqual(['e0', 'e1', 'e2', 'e3', 'lost']);
  });
});

describe('nearestInDirection', () => {
  const origin = { x: 0, y: 0, width: 100, height: 60 };

  it('picks the closest node in the requested direction', () => {
    const candidates = [placed('near', 200, 0), placed('far', 600, 0), placed('left', -300, 0)];
    expect(nearestInDirection(origin, candidates, 'right')).toBe('near');
    expect(nearestInDirection(origin, candidates, 'left')).toBe('left');
  });

  it('prefers a node in line over a nearer one that sits far to the side', () => {
    const candidates = [placed('aligned', 0, 400), placed('sideways', 300, 120)];
    expect(nearestInDirection(origin, candidates, 'down')).toBe('aligned');
  });

  it('handles up and down', () => {
    const candidates = [placed('above', 0, -200), placed('below', 0, 200)];
    expect(nearestInDirection(origin, candidates, 'up')).toBe('above');
    expect(nearestInDirection(origin, candidates, 'down')).toBe('below');
  });

  it('returns nothing when no node lies that way', () => {
    expect(nearestInDirection(origin, [placed('left', -200, 0)], 'right')).toBeUndefined();
    expect(nearestInDirection(origin, [], 'up')).toBeUndefined();
  });

  it('breaks a tie by id', () => {
    const candidates = [placed('z', 200, 60), placed('a', 200, -60)];
    expect(nearestInDirection(origin, candidates, 'right')).toBe('a');
  });
});

describe('stepThrough', () => {
  it('wraps around in both directions', () => {
    expect(stepThrough(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(stepThrough(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(stepThrough(['a', 'b', 'c'], 'a', 1)).toBe('b');
  });

  it('starts at either end when nothing is current', () => {
    expect(stepThrough(['a', 'b'], undefined, 1)).toBe('a');
    expect(stepThrough(['a', 'b'], undefined, -1)).toBe('b');
    expect(stepThrough(['a', 'b'], 'missing', 1)).toBe('a');
  });

  it('returns nothing for an empty sequence', () => {
    expect(stepThrough<string>([], undefined, 1)).toBeUndefined();
  });
});
