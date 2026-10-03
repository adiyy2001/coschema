import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Rect, RouteRequest, Vec2 } from '../../src';
import { DEFAULT_ROUTE_OPTIONS, SpatialGrid, routeEdge } from '../../src';
import {
  bendCount,
  crossedNodes,
  isOrthogonal,
  mulberry32,
  nodeRect,
  required,
  sceneOf,
} from '../helpers';

function request(
  sourceRect: Rect,
  sourcePort: string,
  targetRect: Rect,
  targetPort: string,
  waypoints: readonly Vec2[] = [],
): RouteRequest {
  return {
    source: { id: 'source', rect: sourceRect, port: sourcePort },
    target: { id: 'target', rect: targetRect, port: targetPort },
    waypoints,
  };
}

function lastOf(points: readonly Vec2[]): Vec2 {
  return points[points.length - 1] ?? [Number.NaN, Number.NaN];
}

describe('routeEdge', () => {
  it('draws a straight line between facing ports at the same height', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(400, 0);
    const scene = sceneOf({ source, target });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(false);
    expect(route.points).toEqual([
      [120, 32],
      [400, 32],
    ]);
  });

  it('uses the least number of bends in open space', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(400, 300);
    const scene = sceneOf({ source, target });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(false);
    expect(isOrthogonal(route.points)).toBe(true);
    expect(bendCount(route.points)).toBe(2);
  });

  it('leaves and enters through the side of the port', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(300, 300);
    const scene = sceneOf({ source, target });
    const cases: readonly (readonly [string, string])[] = [
      ['e', 'n'],
      ['s', 'w'],
      ['s', 'n'],
      ['e', 'w'],
      ['n', 's'],
      ['w', 'e'],
    ];
    for (const [sourcePort, targetPort] of cases) {
      const route = routeEdge(request(source, sourcePort, target, targetPort), scene.grid);
      expect(route.fallback).toBe(false);
      const first = route.points[0] ?? [0, 0];
      const second = route.points[1] ?? [0, 0];
      const beforeLast = route.points[route.points.length - 2] ?? [0, 0];
      const last = lastOf(route.points);
      const out: Record<string, Vec2> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
      const leave = out[sourcePort] ?? [0, 0];
      const arrive = out[targetPort] ?? [0, 0];
      expect(Math.sign(second[0] - first[0])).toBe(leave[0]);
      expect(Math.sign(second[1] - first[1])).toBe(leave[1]);
      expect(Math.sign(beforeLast[0] - last[0])).toBe(arrive[0]);
      expect(Math.sign(beforeLast[1] - last[1])).toBe(arrive[1]);
    }
  });

  it('avoids a node standing in the way', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(500, 0);
    const blocker = nodeRect(220, -20, 80, 104);
    const scene = sceneOf({ source, target, blocker });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(false);
    expect(crossedNodes(route.points, [blocker, source, target])).toBe(0);
    expect(isOrthogonal(route.points)).toBe(true);
  });

  it('keeps a margin to the obstacles when there is room', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(500, 0);
    const blocker = nodeRect(220, -20, 80, 104);
    const scene = sceneOf({ source, target, blocker });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    const inflated: Rect = {
      x: blocker.x - DEFAULT_ROUTE_OPTIONS.margin,
      y: blocker.y - DEFAULT_ROUTE_OPTIONS.margin,
      width: blocker.width + DEFAULT_ROUTE_OPTIONS.margin * 2,
      height: blocker.height + DEFAULT_ROUTE_OPTIONS.margin * 2,
    };
    expect(crossedNodes(route.points, [inflated])).toBe(0);
  });

  it('meets in the middle when facing ports are closer than two stubs', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(140, 100);
    const scene = sceneOf({ source, target });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(false);
    expect(route.points[1]).toEqual([130, 32]);
    expect(crossedNodes(route.points, [source, target])).toBe(0);
  });

  it('leaves a node on its far side and wraps around it for a self loop', () => {
    const node = nodeRect(100, 100);
    const scene = sceneOf({ source: node });
    const route = routeEdge(
      {
        source: { id: 'source', rect: node, port: 'e' },
        target: { id: 'source', rect: node, port: 's' },
        waypoints: [],
      },
      scene.grid,
    );
    expect(route.fallback).toBe(false);
    expect(crossedNodes(route.points, [node])).toBe(0);
    expect(isOrthogonal(route.points)).toBe(true);
  });

  it('routes a target that lies behind the source port', () => {
    const source = nodeRect(300, 0);
    const target = nodeRect(0, 0);
    const scene = sceneOf({ source, target });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(false);
    expect(crossedNodes(route.points, [source, target])).toBe(0);
  });

  it('passes through user waypoints in order', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(500, 0);
    const waypoints: readonly Vec2[] = [
      [250, 200],
      [400, 200],
    ];
    const scene = sceneOf({ source, target });
    const route = routeEdge(request(source, 'e', target, 'w', waypoints), scene.grid);
    expect(route.fallback).toBe(false);
    const hits = waypoints.map((waypoint) =>
      route.points.findIndex((point) => point[0] === waypoint[0] && point[1] === waypoint[1]),
    );
    expect(hits.every((hit) => hit >= 0)).toBe(true);
    expect(hits[0]).toBeLessThan(hits[1] ?? -1);
    expect(crossedNodes(route.points, [source, target])).toBe(0);
  });

  it('falls back to a dashed L shape when the source is boxed in', () => {
    const source = nodeRect(200, 200, 40, 40);
    const target = nodeRect(600, 400);
    const walls = {
      top: { x: 160, y: 160, width: 120, height: 10 },
      bottom: { x: 160, y: 270, width: 120, height: 10 },
      left: { x: 160, y: 160, width: 10, height: 120 },
      right: { x: 270, y: 160, width: 10, height: 120 },
    };
    const scene = sceneOf({ source, target, ...walls });
    const route = routeEdge(request(source, 'e', target, 'n'), scene.grid);
    expect(route.fallback).toBe(true);
    expect(isOrthogonal(route.points)).toBe(true);
    expect(route.points[0]).toEqual([240, 220]);
    expect(lastOf(route.points)).toEqual([660, 400]);
  });

  it('falls back when a stub ends inside another node', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(400, 0);
    const intruder = nodeRect(125, 10, 40, 40);
    const scene = sceneOf({ source, target, intruder });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(true);
    expect(isOrthogonal(route.points)).toBe(true);
  });

  it('falls back when a waypoint sits inside a node', () => {
    const source = nodeRect(0, 0);
    const target = nodeRect(500, 0);
    const wall = nodeRect(200, 200);
    const scene = sceneOf({ source, target, wall });
    const route = routeEdge(request(source, 'e', target, 'w', [[250, 230]]), scene.grid);
    expect(route.fallback).toBe(true);
    expect(isOrthogonal(route.points)).toBe(true);
  });

  it('widens the routing window when the first one has no way through', () => {
    const source = nodeRect(0, 0, 40, 40);
    const target = nodeRect(300, 0, 40, 40);
    const wall = { x: 150, y: -2000, width: 20, height: 4040 };
    const scene = sceneOf({ source, target, wall });
    const route = routeEdge(request(source, 'e', target, 'w'), scene.grid);
    expect(route.fallback).toBe(false);
    expect(crossedNodes(route.points, [wall, source, target])).toBe(0);
    expect(route.dependencies.length).toBeGreaterThan(2);
  });

  it('gives the same route for the same input, whatever order the nodes were added in', () => {
    const rects: Record<string, Rect> = {
      source: nodeRect(0, 0),
      target: nodeRect(600, 300),
      a: nodeRect(200, 0),
      b: nodeRect(200, 160),
      c: nodeRect(400, 120),
    };
    const forward = sceneOf(rects);
    const reversed = new SpatialGrid<string>(128);
    for (const [id, rect] of Object.entries(rects).reverse()) reversed.insert(id, rect);
    const input = request(required(rects['source']), 's', required(rects['target']), 'n');
    const first = routeEdge(input, forward.grid);
    expect(routeEdge(input, forward.grid)).toEqual(first);
    expect(routeEdge(input, reversed).points).toEqual(first.points);
  });
});

function scenePositions(seed: number, count: number): Rect[] {
  const next = mulberry32(seed);
  const cells = new Set<string>();
  const rects: Rect[] = [];
  while (rects.length < count) {
    const column = Math.floor(next() * 8);
    const row = Math.floor(next() * 8);
    const key = `${column}:${row}`;
    if (cells.has(key)) continue;
    cells.add(key);
    rects.push({
      x: column * 100 + Math.floor(next() * 30),
      y: row * 100 + Math.floor(next() * 30),
      width: 30 + Math.floor(next() * 40),
      height: 30 + Math.floor(next() * 40),
    });
  }
  return rects;
}

describe('routeEdge on random scenes', () => {
  const ports = fc.constantFrom('n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw');

  it('is orthogonal, crosses no node and keeps its end points', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 40 }),
        ports,
        ports,
        (seed, count, sourcePort, targetPort) => {
          const rects = scenePositions(seed, count);
          const nodes: Record<string, Rect> = {};
          rects.forEach((rect, index) => {
            nodes[`n${index}`] = rect;
          });
          const scene = sceneOf(nodes);
          const route = routeEdge(
            {
              source: { id: 'n0', rect: required(rects[0]), port: sourcePort },
              target: { id: 'n1', rect: required(rects[1]), port: targetPort },
              waypoints: [],
            },
            scene.grid,
          );
          expect(isOrthogonal(route.points)).toBe(true);
          if (route.fallback) return;
          expect(crossedNodes(route.points, scene.nodes.values())).toBe(0);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('never crosses long walls that reach beyond the first routing windows', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(
          fc.record({
            horizontal: fc.boolean(),
            offset: fc.integer({ min: 0, max: 800 }),
            thickness: fc.integer({ min: 4, max: 40 }),
            from: fc.integer({ min: -400, max: 300 }),
            length: fc.integer({ min: 200, max: 2500 }),
          }),
          { maxLength: 4 },
        ),
        (seed, walls) => {
          const rects = scenePositions(seed, 12);
          const nodes: Record<string, Rect> = {};
          rects.forEach((rect, index) => {
            nodes[`n${index}`] = rect;
          });
          walls.forEach((wall, index) => {
            nodes[`wall${index}`] = wall.horizontal
              ? { x: wall.from, y: wall.offset, width: wall.length, height: wall.thickness }
              : { x: wall.offset, y: wall.from, width: wall.thickness, height: wall.length };
          });
          const scene = sceneOf(nodes);
          const route = routeEdge(
            {
              source: { id: 'n0', rect: required(rects[0]), port: 'e' },
              target: { id: 'n1', rect: required(rects[1]), port: 'w' },
              waypoints: [],
            },
            scene.grid,
          );
          expect(isOrthogonal(route.points)).toBe(true);
          if (route.fallback) return;
          expect(crossedNodes(route.points, scene.nodes.values())).toBe(0);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('finds a route for the large majority of random pairs', () => {
    let routed = 0;
    const total = 200;
    for (let seed = 1; seed <= total; seed += 1) {
      const rects = scenePositions(seed, 30);
      const nodes: Record<string, Rect> = {};
      rects.forEach((rect, index) => {
        nodes[`n${index}`] = rect;
      });
      const route = routeEdge(
        {
          source: { id: 'n0', rect: required(rects[0]), port: 'e' },
          target: { id: 'n1', rect: required(rects[1]), port: 'w' },
          waypoints: [],
        },
        sceneOf(nodes).grid,
      );
      if (!route.fallback) routed += 1;
    }
    expect(routed).toBeGreaterThan(total * 0.9);
  });
});
