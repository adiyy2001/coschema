import { describe, expect, it } from 'vitest';
import {
  CARDINAL_PORTS,
  CORNER_PORTS,
  DEFAULT_NODE_SIZES,
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
  NODE_TYPES,
  clampSize,
  hasPort,
  isNodeType,
  portAnchor,
  portsOf,
} from '../src';

describe('node types', () => {
  it('recognises exactly the four types', () => {
    expect(NODE_TYPES).toEqual(['rect', 'rounded', 'ellipse', 'diamond']);
    expect(isNodeType('rect')).toBe(true);
    expect(isNodeType('hexagon')).toBe(false);
    expect(isNodeType(4)).toBe(false);
    expect(isNodeType(undefined)).toBe(false);
  });

  it('gives every type a default size inside the limits', () => {
    for (const type of NODE_TYPES) {
      const [width, height] = DEFAULT_NODE_SIZES[type];
      expect(width).toBeGreaterThanOrEqual(MIN_NODE_SIZE);
      expect(height).toBeLessThanOrEqual(MAX_NODE_SIZE);
    }
  });
});

describe('ports', () => {
  it('gives rectangles corners and the other shapes only the four sides', () => {
    expect(portsOf('rect')).toHaveLength(8);
    expect(portsOf('rounded')).toHaveLength(8);
    expect(portsOf('ellipse')).toEqual(CARDINAL_PORTS);
    expect(portsOf('diamond')).toEqual(CARDINAL_PORTS);
  });

  it('checks ports against the node type', () => {
    expect(hasPort('rect', 'ne')).toBe(true);
    expect(hasPort('ellipse', 'ne')).toBe(false);
    expect(hasPort('ellipse', 'n')).toBe(true);
    expect(hasPort('rect', 'middle')).toBe(false);
    expect(hasPort('rect', 3)).toBe(false);
  });

  it('places every port on the border of the box', () => {
    const position = [100, 50] as const;
    const size = [200, 100] as const;
    expect(portAnchor(position, size, 'n')).toEqual([200, 50]);
    expect(portAnchor(position, size, 'e')).toEqual([300, 100]);
    expect(portAnchor(position, size, 's')).toEqual([200, 150]);
    expect(portAnchor(position, size, 'w')).toEqual([100, 100]);
    for (const port of [...CARDINAL_PORTS, ...CORNER_PORTS]) {
      const [x, y] = portAnchor(position, size, port);
      const onBorder = x === 100 || x === 300 || y === 50 || y === 150;
      expect(onBorder).toBe(true);
    }
  });

  it('clamps sizes into the allowed range', () => {
    expect(clampSize([1, 1])).toEqual([MIN_NODE_SIZE, MIN_NODE_SIZE]);
    expect(clampSize([99999, 99999])).toEqual([MAX_NODE_SIZE, MAX_NODE_SIZE]);
    expect(clampSize([100, 80])).toEqual([100, 80]);
  });
});
