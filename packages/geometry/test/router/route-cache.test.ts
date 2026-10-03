import { describe, expect, it } from 'vitest';
import type { Rect, RouteRequest } from '../../src';
import { RouteCache } from '../../src';
import { nodeRect, sceneOf } from '../helpers';

function between(source: Rect, target: Rect): RouteRequest {
  return {
    source: { id: 'source', rect: source, port: 'e' },
    target: { id: 'target', rect: target, port: 'w' },
    waypoints: [],
  };
}

describe('RouteCache', () => {
  const source = nodeRect(0, 0);
  const target = nodeRect(500, 0);

  it('returns the cached route when nothing around it changed', () => {
    const scene = sceneOf({ source, target, other: nodeRect(2000, 2000) });
    const cache = new RouteCache();
    const first = cache.route('edge', between(source, target), scene.grid);
    const second = cache.route('edge', between(source, target), scene.grid);
    expect(second).toBe(first);
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, size: 1 });
  });

  it('keeps the route when a node moves far outside its window', () => {
    const scene = sceneOf({ source, target, far: nodeRect(5000, 5000) });
    const cache = new RouteCache();
    const first = cache.route('edge', between(source, target), scene.grid);
    scene.grid.move('far', nodeRect(6000, 6000));
    expect(cache.route('edge', between(source, target), scene.grid)).toBe(first);
  });

  it('routes again when a node moves into the window', () => {
    const scene = sceneOf({ source, target, blocker: nodeRect(4000, 0) });
    const cache = new RouteCache();
    const first = cache.route('edge', between(source, target), scene.grid);
    expect(first.points).toHaveLength(2);
    scene.grid.move('blocker', nodeRect(240, -20, 80, 104));
    const second = cache.route('edge', between(source, target), scene.grid);
    expect(second).not.toBe(first);
    expect(second.points.length).toBeGreaterThan(2);
    expect(cache.stats().misses).toBe(2);
  });

  it('routes again when a node in the window is removed', () => {
    const scene = sceneOf({ source, target, blocker: nodeRect(240, -20, 80, 104) });
    const cache = new RouteCache();
    const first = cache.route('edge', between(source, target), scene.grid);
    scene.grid.remove('blocker');
    const second = cache.route('edge', between(source, target), scene.grid);
    expect(second).not.toBe(first);
    expect(second.points).toHaveLength(2);
  });

  it('routes again when the request changes', () => {
    const scene = sceneOf({ source, target });
    const cache = new RouteCache();
    const first = cache.route('edge', between(source, target), scene.grid);
    const withWaypoint = { ...between(source, target), waypoints: [[250, 200]] as const };
    const second = cache.route('edge', withWaypoint, scene.grid);
    expect(second).not.toBe(first);
  });

  it('forgets edges on invalidate, retain and clear', () => {
    const scene = sceneOf({ source, target });
    const cache = new RouteCache();
    cache.route('one', between(source, target), scene.grid);
    cache.route('two', between(source, target), scene.grid);
    cache.route('three', between(source, target), scene.grid);
    expect(cache.invalidate('one')).toBe(true);
    expect(cache.invalidate('one')).toBe(false);
    cache.retain(new Set(['two']));
    expect(cache.stats().size).toBe(1);
    cache.clear();
    expect(cache.stats().size).toBe(0);
  });

  it('uses its own options', () => {
    const scene = sceneOf({ source, target: nodeRect(500, 300) });
    const cache = new RouteCache({ margin: 4, stubLength: 4, bendPenalty: 100 });
    const route = cache.route('edge', between(source, nodeRect(500, 300)), scene.grid);
    const defaults = new RouteCache().route(
      'edge',
      between(source, nodeRect(500, 300)),
      scene.grid,
    );
    expect(route.points[route.points.length - 2]?.[0]).toBe(496);
    expect(defaults.points[defaults.points.length - 2]?.[0]).toBe(488);
  });
});
