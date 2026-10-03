import { fingerprintEntries } from './fingerprint';
import type { ObstacleSource } from './obstacles';
import type { Route, RouteOptions, RouteRequest } from './route';
import { DEFAULT_ROUTE_OPTIONS, routeEdge } from './route';

interface CacheEntry {
  readonly requestKey: string;
  readonly obstacleKey: string;
  readonly route: Route;
}

export interface RouteCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
}

function requestKey(request: RouteRequest, options: RouteOptions): string {
  const endpoint = (value: RouteRequest['source']): string =>
    `${value.id}:${value.port}:${value.rect.x},${value.rect.y},${value.rect.width},${value.rect.height}`;
  const waypoints = request.waypoints.map((point) => `${point[0]},${point[1]}`).join(';');
  return `${endpoint(request.source)}|${endpoint(request.target)}|${waypoints}|${options.margin},${options.stubLength},${options.bendPenalty}`;
}

function obstacleKey(route: Route, source: ObstacleSource): string {
  return route.dependencies.map((area) => fingerprintEntries(source.query(area))).join('/');
}

export class RouteCache {
  private readonly entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly options: RouteOptions = DEFAULT_ROUTE_OPTIONS) {}

  route(edgeId: string, request: RouteRequest, source: ObstacleSource): Route {
    const key = requestKey(request, this.options);
    const cached = this.entries.get(edgeId);
    if (cached?.requestKey === key && cached.obstacleKey === obstacleKey(cached.route, source)) {
      this.hits += 1;
      return cached.route;
    }
    this.misses += 1;
    const route = routeEdge(request, source, this.options);
    this.entries.set(edgeId, {
      requestKey: key,
      obstacleKey: obstacleKey(route, source),
      route,
    });
    return route;
  }

  invalidate(edgeId: string): boolean {
    return this.entries.delete(edgeId);
  }

  retain(liveEdgeIds: ReadonlySet<string>): void {
    for (const edgeId of [...this.entries.keys()]) {
      if (!liveEdgeIds.has(edgeId)) this.entries.delete(edgeId);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): RouteCacheStats {
    return { hits: this.hits, misses: this.misses, size: this.entries.size };
  }
}
