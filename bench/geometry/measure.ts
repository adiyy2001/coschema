import type { Rect, Route, RouteRequest } from '@coschema/geometry';
import {
  RouteCache,
  SpatialGrid,
  routeEdge,
  rectsIntersect,
  screenToWorld,
  visibleWorldRect,
} from '@coschema/geometry';
import { round, summarize, type Summary } from '../lib/stats';
import { mulberry32, type Scene, type SceneEdge } from './scene';

interface RoutingResult {
  readonly edges: number;
  readonly fallbackRoutes: number;
  readonly totalMs: readonly number[];
  readonly perEdgeMicroseconds: Summary;
}

interface CullingResult {
  readonly zoom: number;
  readonly queries: number;
  readonly meanVisibleNodes: number;
  readonly gridMicroseconds: Summary;
  readonly linearScanMicroseconds: Summary;
}

export interface SceneResult {
  readonly nodes: number;
  readonly edges: number;
  readonly gridBuildMs: readonly number[];
  readonly coldRouting: RoutingResult;
  readonly cachedRoutingMs: readonly number[];
  readonly dragRerouteMs: Summary;
  readonly dragMissesPerMove: number;
  readonly culling: readonly CullingResult[];
}

const SCREEN = { width: 1920, height: 1080 };
const ZOOMS: readonly number[] = [1, 0.5, 0.25, 0.1];

function nowMicroseconds(): number {
  return Number(process.hrtime.bigint()) / 1000;
}

function buildGrid(scene: Scene): SpatialGrid<string> {
  const grid = new SpatialGrid<string>();
  for (const node of scene.nodes) grid.insert(node.id, node.rect);
  return grid;
}

function requestFor(edge: SceneEdge, grid: SpatialGrid<string>): RouteRequest {
  const source = grid.rectOf(edge.source);
  const target = grid.rectOf(edge.target);
  if (source === undefined || target === undefined) throw new Error(`edge ${edge.id} has no node`);
  return {
    source: { id: edge.source, rect: source, port: edge.sourcePort },
    target: { id: edge.target, rect: target, port: edge.targetPort },
    waypoints: [],
  };
}

function routeAll(scene: Scene, grid: SpatialGrid<string>): RoutingResult {
  const times: number[] = [];
  let fallbackRoutes = 0;
  const started = nowMicroseconds();
  for (const edge of scene.edges) {
    const request = requestFor(edge, grid);
    const before = nowMicroseconds();
    const route: Route = routeEdge(request, grid);
    times.push(nowMicroseconds() - before);
    if (route.fallback) fallbackRoutes += 1;
  }
  return {
    edges: scene.edges.length,
    fallbackRoutes,
    totalMs: [round((nowMicroseconds() - started) / 1000)],
    perEdgeMicroseconds: summarize(times),
  };
}

function measureCold(scene: Scene, grid: SpatialGrid<string>, runs: number): RoutingResult {
  routeAll(scene, grid);
  const results = Array.from({ length: runs }, () => routeAll(scene, grid));
  const first = results[0];
  if (first === undefined) throw new Error('no runs');
  const best = results.reduce((left, right) =>
    (left.totalMs[0] ?? 0) <= (right.totalMs[0] ?? 0) ? left : right,
  );
  return {
    edges: first.edges,
    fallbackRoutes: first.fallbackRoutes,
    totalMs: results.map((result) => result.totalMs[0] ?? 0),
    perEdgeMicroseconds: best.perEdgeMicroseconds,
  };
}

function measureCached(scene: Scene, grid: SpatialGrid<string>, runs: number): number[] {
  const cache = new RouteCache();
  for (const edge of scene.edges) cache.route(edge.id, requestFor(edge, grid), grid);
  return Array.from({ length: runs }, () => {
    const started = nowMicroseconds();
    for (const edge of scene.edges) cache.route(edge.id, requestFor(edge, grid), grid);
    return round((nowMicroseconds() - started) / 1000);
  });
}

function measureDrag(
  scene: Scene,
  moves: number,
  seed: number,
): { readonly summary: Summary; readonly missesPerMove: number } {
  const grid = buildGrid(scene);
  const cache = new RouteCache();
  const next = mulberry32(seed);
  for (const edge of scene.edges) cache.route(edge.id, requestFor(edge, grid), grid);
  const edgesOf = new Map<string, SceneEdge[]>();
  for (const edge of scene.edges) {
    for (const nodeId of [edge.source, edge.target]) {
      const list = edgesOf.get(nodeId) ?? [];
      list.push(edge);
      edgesOf.set(nodeId, list);
    }
  }
  const times: number[] = [];
  const missesBefore = cache.stats().misses;
  for (let move = 0; move < moves; move += 1) {
    const node = scene.nodes[Math.floor(next() * scene.nodes.length)];
    if (node === undefined) continue;
    const current = grid.rectOf(node.id) ?? node.rect;
    const started = nowMicroseconds();
    grid.move(node.id, { ...current, x: current.x + 16, y: current.y + 8 });
    for (const edge of edgesOf.get(node.id) ?? []) {
      cache.route(edge.id, requestFor(edge, grid), grid);
    }
    times.push((nowMicroseconds() - started) / 1000);
  }
  return {
    summary: summarize(times),
    missesPerMove: round((cache.stats().misses - missesBefore) / moves),
  };
}

function measureCulling(scene: Scene, queries: number, seed: number): CullingResult[] {
  const grid = buildGrid(scene);
  const everything: { readonly id: string; readonly rect: Rect }[] = scene.nodes.map((node) => ({
    id: node.id,
    rect: node.rect,
  }));
  return ZOOMS.map((zoom) => {
    const next = mulberry32(seed + Math.round(zoom * 1000));
    const gridTimes: number[] = [];
    const scanTimes: number[] = [];
    let visible = 0;
    for (let query = 0; query < queries + 200; query += 1) {
      const origin = screenToWorld({ x: 0, y: 0, zoom }, [
        next() * scene.bounds.width * zoom,
        next() * scene.bounds.height * zoom,
      ]);
      const area = visibleWorldRect({ x: -origin[0] * zoom, y: -origin[1] * zoom, zoom }, SCREEN);
      const before = nowMicroseconds();
      const hits = grid.query(area);
      const middle = nowMicroseconds();
      const scanned = everything.filter((entry) => rectsIntersect(entry.rect, area));
      const after = nowMicroseconds();
      if (hits.length !== scanned.length) throw new Error('grid and linear scan disagree');
      if (query >= 200) {
        gridTimes.push(middle - before);
        scanTimes.push(after - middle);
        visible += hits.length;
      }
    }
    return {
      zoom,
      queries,
      meanVisibleNodes: round(visible / queries, 1),
      gridMicroseconds: summarize(gridTimes),
      linearScanMicroseconds: summarize(scanTimes),
    };
  });
}

export function measureScene(
  scene: Scene,
  runs: number,
  queries: number,
  moves: number,
  seed: number,
): SceneResult {
  const gridBuildMs = Array.from({ length: runs }, () => {
    const started = nowMicroseconds();
    buildGrid(scene);
    return round((nowMicroseconds() - started) / 1000);
  });
  const grid = buildGrid(scene);
  const drag = measureDrag(scene, moves, seed);
  return {
    nodes: scene.nodes.length,
    edges: scene.edges.length,
    gridBuildMs,
    coldRouting: measureCold(scene, grid, runs),
    cachedRoutingMs: measureCached(scene, grid, runs),
    dragRerouteMs: drag.summary,
    dragMissesPerMove: drag.missesPerMove,
    culling: measureCulling(scene, queries, seed),
  };
}
