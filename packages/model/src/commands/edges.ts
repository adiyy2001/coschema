import * as Y from 'yjs';
import { readNode } from '../graph';
import { createId, type EdgeId } from '../ids';
import { hasPort, type Vec2 } from '../node-types';
import { EDGE_KEYS, getEdges, getNodes, type EdgeInit } from '../schema';
import { assertFinitePoint, runInTransaction, type CommandContext } from './context';

function copyWaypoints(waypoints: readonly Vec2[]): [number, number][] {
  for (const point of waypoints) assertFinitePoint(point, 'waypoint');
  return waypoints.map((point) => [point[0], point[1]]);
}

export function connect(context: CommandContext, init: EdgeInit): EdgeId | undefined {
  const waypoints = copyWaypoints(init.waypoints ?? []);
  return runInTransaction(context, () => {
    const nodes = getNodes(context.doc);
    const yEdges = getEdges(context.doc);
    const ySource = nodes.get(init.source);
    const yTarget = nodes.get(init.target);
    if (ySource === undefined || yTarget === undefined || init.source === init.target) {
      return undefined;
    }
    const source = readNode(init.source, ySource);
    const target = readNode(init.target, yTarget);
    if (!hasPort(source.type, init.sourcePort) || !hasPort(target.type, init.targetPort)) {
      return undefined;
    }
    const id = init.id ?? createId(context.random);
    if (yEdges.has(id)) throw new Error(`edge ${id} already exists`);
    const yEdge = new Y.Map<unknown>();
    yEdge.set(EDGE_KEYS.source, init.source);
    yEdge.set(EDGE_KEYS.target, init.target);
    yEdge.set(EDGE_KEYS.sourcePort, init.sourcePort);
    yEdge.set(EDGE_KEYS.targetPort, init.targetPort);
    yEdge.set(EDGE_KEYS.waypoints, waypoints);
    yEdges.set(id, yEdge);
    return id;
  });
}

export function deleteEdges(context: CommandContext, ids: readonly EdgeId[]): number {
  return runInTransaction(context, () => {
    const edges = getEdges(context.doc);
    let removed = 0;
    for (const id of new Set(ids)) {
      if (!edges.has(id)) continue;
      edges.delete(id);
      removed += 1;
    }
    return removed;
  });
}

export function setWaypoints(
  context: CommandContext,
  id: EdgeId,
  waypoints: readonly Vec2[],
): void {
  const copied = copyWaypoints(waypoints);
  runInTransaction(context, () => {
    getEdges(context.doc).get(id)?.set(EDGE_KEYS.waypoints, copied);
  });
}
