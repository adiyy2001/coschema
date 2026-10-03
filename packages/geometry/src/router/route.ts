import type { Rect } from '../rect';
import { boundsOfPoints, boundsOfRects, inflateRect, segmentCrossesInterior } from '../rect';
import type { Vec2 } from '../vec';
import { findPath } from './astar';
import { clipRect, compareRects, relaxObstacles, type ObstacleSource } from './obstacles';
import type { Direction } from './ports';
import {
  DIRECTION_VECTORS,
  isHorizontal,
  oppositeDirection,
  portDirection,
  portPoint,
  stubPoint,
} from './ports';
import { simplifyPath } from './simplify';
import { buildSparseGrid, type GridObstacle } from './sparse-grid';

export interface RouteEndpoint {
  readonly id: string;
  readonly rect: Rect;
  readonly port: string;
}

export interface RouteRequest {
  readonly source: RouteEndpoint;
  readonly target: RouteEndpoint;
  readonly waypoints: readonly Vec2[];
}

export interface RouteOptions {
  readonly margin: number;
  readonly stubLength: number;
  readonly bendPenalty: number;
}

export interface Route {
  readonly points: readonly Vec2[];
  readonly fallback: boolean;
  readonly bounds: Rect;
  readonly dependencies: readonly Rect[];
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  margin: 12,
  stubLength: 12,
  bendPenalty: 24,
};

const WINDOW_PADDING_FACTORS: readonly number[] = [8, 64];
const EVERYTHING: Rect = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 };

interface LegRequest {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly startDirection: Direction | undefined;
  readonly endDirection: Direction | undefined;
}

interface LegResult {
  readonly points: readonly Vec2[] | undefined;
  readonly dependency: Rect;
}

interface RoutingContext {
  readonly source: ObstacleSource;
  readonly ownRects: readonly Rect[];
  readonly ownIds: ReadonlySet<string>;
  readonly options: RouteOptions;
}

function tryWindow(
  leg: LegRequest,
  window: Rect,
  context: RoutingContext,
): readonly Vec2[] | undefined {
  const { options } = context;
  const entries = context.source.query(inflateRect(window, options.margin));
  const raw = [
    ...context.ownRects,
    ...entries.filter((entry) => !context.ownIds.has(entry.id)).map((entry) => entry.rect),
  ];
  const relaxed = relaxObstacles(raw, options.margin, [leg.from, leg.to]);
  if (relaxed === undefined) return undefined;
  const obstacles = relaxed
    .map((item) => clipRect(item, window))
    .filter((item): item is GridObstacle => item !== undefined)
    .sort(compareRects);
  const grid = buildSparseGrid(
    [window.x, window.x + window.width, leg.from[0], leg.to[0]],
    [window.y, window.y + window.height, leg.from[1], leg.to[1]],
    obstacles,
  );
  return findPath({
    grid,
    start: leg.from,
    end: leg.to,
    startDirection: leg.startDirection,
    endDirection: leg.endDirection,
    bendPenalty: options.bendPenalty,
  })?.points;
}

function routeLeg(leg: LegRequest, context: RoutingContext): LegResult {
  const base = boundsOfPoints([leg.from, leg.to]) ?? { x: 0, y: 0, width: 0, height: 0 };
  for (const factor of WINDOW_PADDING_FACTORS) {
    const window = inflateRect(base, context.options.margin * factor);
    const points = tryWindow(leg, window, context);
    const dependency = inflateRect(window, context.options.margin);
    if (points !== undefined) return { points, dependency };
  }
  const everything = context.source.query(EVERYTHING).map((entry) => entry.rect);
  const reach = boundsOfRects([...everything, ...context.ownRects, base]) ?? base;
  const window = inflateRect(reach, context.options.margin * 4);
  return { points: tryWindow(leg, window, context), dependency: EVERYTHING };
}

function cornerPoints(from: Vec2, to: Vec2, horizontalFirst: boolean): Vec2[] {
  if (from[0] === to[0] || from[1] === to[1]) return [];
  return [horizontalFirst ? [to[0], from[1]] : [from[0], to[1]]];
}

function fallbackPath(
  anchors: readonly Vec2[],
  startDirection: Direction,
  arrivalDirection: Direction,
): Vec2[] {
  const path: Vec2[] = [];
  let horizontalFirst = isHorizontal(startDirection);
  anchors.forEach((point, index) => {
    const previous = anchors[index - 1];
    if (previous === undefined) {
      path.push(point);
      return;
    }
    const last = index === anchors.length - 1;
    const corners = cornerPoints(
      previous,
      point,
      last ? !isHorizontal(arrivalDirection) : horizontalFirst,
    );
    path.push(...corners, point);
    if (corners.length > 0) horizontalFirst = !horizontalFirst;
  });
  return path;
}

function stubsAreClear(
  stubs: readonly (readonly [Vec2, Vec2])[],
  context: RoutingContext,
): boolean {
  return stubs.every(([from, to]) => {
    const area = boundsOfPoints([from, to]) ?? { x: 0, y: 0, width: 0, height: 0 };
    return context.source
      .query(area)
      .filter((entry) => !context.ownIds.has(entry.id))
      .every((entry) => !segmentCrossesInterior(from, to, entry.rect));
  });
}

function effectiveStubLength(
  sourceAnchor: Vec2,
  targetAnchor: Vec2,
  sourceDirection: Direction,
  targetDirection: Direction,
  stubLength: number,
): number {
  if (targetDirection !== oppositeDirection(sourceDirection)) return stubLength;
  const vector = DIRECTION_VECTORS[sourceDirection] ?? [1, 0];
  const gap =
    (targetAnchor[0] - sourceAnchor[0]) * vector[0] +
    (targetAnchor[1] - sourceAnchor[1]) * vector[1];
  return gap > 0 && gap < stubLength * 2 ? gap / 2 : stubLength;
}

export function routeEdge(
  request: RouteRequest,
  source: ObstacleSource,
  options: RouteOptions = DEFAULT_ROUTE_OPTIONS,
): Route {
  const sourceAnchor = portPoint(request.source.rect, request.source.port);
  const targetAnchor = portPoint(request.target.rect, request.target.port);
  const sourceDirection = portDirection(request.source.port);
  const targetDirection = portDirection(request.target.port);
  const stubLength = effectiveStubLength(
    sourceAnchor,
    targetAnchor,
    sourceDirection,
    targetDirection,
    options.stubLength,
  );
  const sourceStub = stubPoint(sourceAnchor, sourceDirection, stubLength);
  const targetStub = stubPoint(targetAnchor, targetDirection, stubLength);
  const arrivalDirection = oppositeDirection(targetDirection);
  const context: RoutingContext = {
    source,
    ownRects: [request.source.rect, request.target.rect],
    ownIds: new Set([request.source.id, request.target.id]),
    options,
  };

  const chain: Vec2[] = [sourceStub, ...request.waypoints, targetStub];
  const dependencies: Rect[] = [
    boundsOfPoints([sourceAnchor, sourceStub]) ?? request.source.rect,
    boundsOfPoints([targetAnchor, targetStub]) ?? request.target.rect,
  ];
  const stubs = [
    [sourceAnchor, sourceStub],
    [targetStub, targetAnchor],
  ] as const;

  const legs: Vec2[][] = [];
  let routed = stubsAreClear(stubs, context);
  for (let index = 1; routed && index < chain.length; index += 1) {
    const from = chain[index - 1];
    const to = chain[index];
    if (from === undefined || to === undefined) continue;
    const result = routeLeg(
      {
        from,
        to,
        startDirection: index === 1 ? sourceDirection : undefined,
        endDirection: index === chain.length - 1 ? arrivalDirection : undefined,
      },
      context,
    );
    dependencies.push(result.dependency);
    if (result.points === undefined) routed = false;
    else legs.push([...result.points]);
  }

  const points = routed
    ? simplifyPath([sourceAnchor, ...legs.flat(), targetAnchor])
    : simplifyPath([
        sourceAnchor,
        ...fallbackPath(chain, sourceDirection, arrivalDirection),
        targetAnchor,
      ]);
  const bounds = boundsOfPoints(points) ?? request.source.rect;
  return { points, fallback: !routed, bounds, dependencies };
}
