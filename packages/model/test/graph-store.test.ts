import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NODE_KEYS,
  NODE_TYPES,
  connect,
  createGraphStore,
  createNode,
  deleteEdges,
  deleteNodes,
  deriveGraph,
  editLabel,
  findViolations,
  getMeta,
  moveNodes,
  reorderNode,
  setStyle,
  setWaypoints,
  getNodes,
  type EdgeId,
  type GraphChange,
  type GraphDelta,
  type GraphEdge,
  type GraphNode,
  type NodeId,
  type NodeType,
  type PortId,
} from '../src';
import { REMOTE_ORIGIN, createClient, syncPair, type TestClient } from './support';

function collectDeltas(client: TestClient): GraphDelta[] {
  const deltas: GraphDelta[] = [];
  client.store.subscribe((delta) => deltas.push(delta));
  return deltas;
}

describe('GraphStore', () => {
  it('starts from the content already in the document', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [200, 0] });
    connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    const late = createGraphStore(client.doc);
    expect(late.getGraph()).toEqual(deriveGraph(client.doc));
    expect(late.nodeCount).toBe(2);
    expect(late.edgeCount).toBe(1);
    late.destroy();
  });

  it('reports a created node as added', () => {
    const client = createClient(1);
    const deltas = collectDeltas(client);
    const id = createNode(client.context, { type: 'rect', pos: [1, 2] });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.addedNodes.map((node) => node.id)).toEqual([id]);
    expect(client.store.getNode(id)?.pos).toEqual([1, 2]);
  });

  it('reports moves, label edits and style changes as updates of one node', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0], label: 'a' });
    const deltas = collectDeltas(client);
    moveNodes(client.context, [{ id, pos: [9, 9] }]);
    editLabel(client.context, id, 'ab');
    setStyle(client.context, [id], { fill: '#fff' });
    expect(deltas.map((delta) => delta.updatedNodes.map((node) => node.id))).toEqual([
      [id],
      [id],
      [id],
    ]);
    expect(client.store.getNode(id)).toMatchObject({
      pos: [9, 9],
      label: 'ab',
      style: { fill: '#fff' },
    });
  });

  it('hands over the previous record of updated and removed nodes', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0], label: 'a' });
    const deltas = collectDeltas(client);
    editLabel(client.context, id, 'ab');
    deleteNodes(client.context, [id]);
    expect(deltas[0]?.previousNodes.get(id)?.label).toBe('a');
    expect(deltas[1]?.previousNodes.get(id)?.label).toBe('ab');
    const created = collectDeltas(client);
    createNode(client.context, { type: 'rect', pos: [0, 0] });
    expect(created[0]?.previousNodes.size).toBe(0);
  });

  it('tells a local change from a remote one and names the author', () => {
    const left = createClient(11);
    const right = createClient(22);
    const changes: GraphChange[] = [];
    right.store.subscribe((_, change) => changes.push(change));
    const id = createNode(left.context, { type: 'rect', pos: [0, 0] });
    syncPair(left, right);
    moveNodes(left.context, [{ id, pos: [4, 4] }]);
    syncPair(left, right);
    createNode(right.context, { type: 'rect', pos: [9, 9] });
    expect(changes.map((change) => [change.local, change.authors])).toEqual([
      [false, [11]],
      [false, [11]],
      [true, [22]],
    ]);
    expect(changes[0]?.origin).toBe(REMOTE_ORIGIN);
    expect(changes[2]?.origin).toBe(right.history.origin);
  });

  it('reports no author for a remote deletion that creates nothing', () => {
    const left = createClient(11);
    const right = createClient(22);
    const id = createNode(left.context, { type: 'rect', pos: [0, 0] });
    syncPair(left, right);
    const changes: GraphChange[] = [];
    right.store.subscribe((_, change) => changes.push(change));
    deleteNodes(left.context, [id]);
    syncPair(left, right);
    expect(changes.map((change) => change.authors)).toEqual([[]]);
  });

  it('keeps the identity of nodes that did not change', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const before = client.store.getNode(a);
    moveNodes(client.context, [{ id: b, pos: [5, 5] }]);
    expect(client.store.getNode(a)).toBe(before);
  });

  it('does not notify for writes that change nothing visible', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [3, 3] });
    const deltas = collectDeltas(client);
    getMeta(client.doc).set('note', 'x');
    moveNodes(client.context, [{ id, pos: [3, 3] }]);
    editLabel(client.context, id, '');
    expect(deltas).toEqual([]);
  });

  it('removes edges together with a deleted node in one delta', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [200, 0] });
    const edge = connect(client.context, {
      source: a,
      target: b,
      sourcePort: 'e',
      targetPort: 'w',
    });
    const deltas = collectDeltas(client);
    deleteNodes(client.context, [b]);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.removedNodes).toEqual([b]);
    expect(deltas[0]?.removedEdges).toEqual([edge]);
    expect(client.store.edgeCount).toBe(0);
  });

  it('shows and hides an edge as its endpoint appears and disappears remotely', () => {
    const left = createClient(1);
    const right = createClient(2);
    const a = createNode(left.context, { type: 'rect', pos: [0, 0] });
    syncPair(left, right);
    const b = createNode(left.context, { type: 'rect', pos: [200, 0] });
    const edge = connect(left.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    const deltas = collectDeltas(right);
    syncPair(left, right);
    expect(deltas.flatMap((delta) => delta.addedEdges.map((entry) => entry.id))).toEqual([edge]);
    deleteNodes(right.context, [b]);
    expect(right.store.edgeCount).toBe(0);
    expect(right.store.getGraph()).toEqual(deriveGraph(right.doc));
  });

  it('hides edges when a node type change removes their port', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [200, 0] });
    const edge = connect(client.context, {
      source: a,
      target: b,
      sourcePort: 'ne',
      targetPort: 'nw',
    });
    expect(client.store.getEdge(edge ?? '')).toBeDefined();
    const deltas = collectDeltas(client);
    client.doc.transact(() => {
      getNodes(client.doc).get(b)?.set(NODE_KEYS.type, 'ellipse');
    });
    expect(deltas[0]?.removedEdges).toEqual([edge]);
    expect(client.store.getGraph()).toEqual(deriveGraph(client.doc));
  });

  it('updates an edge when its waypoints change and removes it when deleted', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [200, 0] });
    const edge =
      connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' }) ?? '';
    const deltas = collectDeltas(client);
    setWaypoints(client.context, edge, [[100, 50]]);
    expect(deltas[0]?.updatedEdges.map((entry) => entry.waypoints)).toEqual([[[100, 50]]]);
    deleteEdges(client.context, [edge]);
    expect(deltas[1]?.removedEdges).toEqual([edge]);
  });

  it('caches the graph until something changes', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const first = client.store.getGraph();
    expect(client.store.getGraph()).toBe(first);
    moveNodes(client.context, [{ id, pos: [1, 1] }]);
    expect(client.store.getGraph()).not.toBe(first);
  });

  it('stops notifying after unsubscribe and destroy', () => {
    const client = createClient(1);
    const seen: GraphDelta[] = [];
    const unsubscribe = client.store.subscribe((delta) => seen.push(delta));
    createNode(client.context, { type: 'rect', pos: [0, 0] });
    unsubscribe();
    createNode(client.context, { type: 'rect', pos: [0, 0] });
    expect(seen).toHaveLength(1);
    const other = createGraphStore(client.doc);
    other.destroy();
    other.destroy();
    createNode(client.context, { type: 'rect', pos: [0, 0] });
    expect(other.nodeCount).toBe(2);
    expect(client.store.nodeCount).toBe(3);
  });
});

type Operation =
  | { kind: 'create'; type: NodeType; x: number; y: number }
  | { kind: 'move'; pick: number; x: number; y: number }
  | { kind: 'delete'; pick: number }
  | { kind: 'connect'; from: number; to: number; fromPort: number; toPort: number }
  | { kind: 'deleteEdge'; pick: number }
  | { kind: 'label'; pick: number; text: string }
  | { kind: 'reorder'; pick: number; index: number }
  | { kind: 'style'; pick: number; fill: string }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'sync' };

const PORT_NAMES: readonly PortId[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

const operationArbitrary: fc.Arbitrary<{ target: 0 | 1; operation: Operation }> = fc.record({
  target: fc.constantFrom<0 | 1>(0, 1),
  operation: fc.oneof(
    fc.record({
      kind: fc.constant('create' as const),
      type: fc.constantFrom(...NODE_TYPES),
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
    }),
    fc.record({
      kind: fc.constant('move' as const),
      pick: fc.nat(100),
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
    }),
    fc.record({ kind: fc.constant('delete' as const), pick: fc.nat(100) }),
    fc.record({
      kind: fc.constant('connect' as const),
      from: fc.nat(100),
      to: fc.nat(100),
      fromPort: fc.nat(7),
      toPort: fc.nat(7),
    }),
    fc.record({ kind: fc.constant('deleteEdge' as const), pick: fc.nat(100) }),
    fc.record({
      kind: fc.constant('label' as const),
      pick: fc.nat(100),
      text: fc.string({ maxLength: 8 }),
    }),
    fc.record({ kind: fc.constant('reorder' as const), pick: fc.nat(100), index: fc.nat(10) }),
    fc.record({
      kind: fc.constant('style' as const),
      pick: fc.nat(100),
      fill: fc.constantFrom('#111111', '#eeeeee'),
    }),
    fc.record({ kind: fc.constant('undo' as const) }),
    fc.record({ kind: fc.constant('redo' as const) }),
    fc.record({ kind: fc.constant('sync' as const) }),
  ),
});

function pickFrom<T>(items: readonly T[], pick: number): T | undefined {
  return items.length === 0 ? undefined : items[pick % items.length];
}

function applyOperation(client: TestClient, other: TestClient, operation: Operation): void {
  const graph = deriveGraph(client.doc);
  const nodeIds = graph.nodes.map((node) => node.id);
  switch (operation.kind) {
    case 'create':
      createNode(client.context, { type: operation.type, pos: [operation.x, operation.y] });
      return;
    case 'move': {
      const id = pickFrom(nodeIds, operation.pick);
      if (id !== undefined) moveNodes(client.context, [{ id, pos: [operation.x, operation.y] }]);
      return;
    }
    case 'delete': {
      const id = pickFrom(nodeIds, operation.pick);
      if (id !== undefined) deleteNodes(client.context, [id]);
      return;
    }
    case 'connect': {
      const source = pickFrom(nodeIds, operation.from);
      const target = pickFrom(nodeIds, operation.to);
      if (source === undefined || target === undefined) return;
      connect(client.context, {
        source,
        target,
        sourcePort: PORT_NAMES[operation.fromPort] ?? 'e',
        targetPort: PORT_NAMES[operation.toPort] ?? 'w',
      });
      return;
    }
    case 'deleteEdge': {
      const id = pickFrom(
        graph.edges.map((edge) => edge.id),
        operation.pick,
      );
      if (id !== undefined) deleteEdges(client.context, [id]);
      return;
    }
    case 'label': {
      const id = pickFrom(nodeIds, operation.pick);
      if (id !== undefined) editLabel(client.context, id, operation.text);
      return;
    }
    case 'reorder': {
      const id = pickFrom(nodeIds, operation.pick);
      if (id !== undefined) reorderNode(client.context, id, operation.index);
      return;
    }
    case 'style': {
      const id = pickFrom(nodeIds, operation.pick);
      if (id !== undefined) setStyle(client.context, [id], { fill: operation.fill });
      return;
    }
    case 'undo':
      client.history.undo();
      return;
    case 'redo':
      client.history.redo();
      return;
    case 'sync':
      syncPair(client, other);
      return;
  }
}

class ShadowGraph {
  readonly nodes = new Map<NodeId, GraphNode>();
  readonly edges = new Map<EdgeId, GraphEdge>();

  constructor(client: TestClient) {
    for (const node of client.store.getGraph().nodes) this.nodes.set(node.id, node);
    for (const edge of client.store.getGraph().edges) this.edges.set(edge.id, edge);
    client.store.subscribe((delta) => {
      for (const node of [...delta.addedNodes, ...delta.updatedNodes])
        this.nodes.set(node.id, node);
      for (const id of delta.removedNodes) this.nodes.delete(id);
      for (const edge of [...delta.addedEdges, ...delta.updatedEdges])
        this.edges.set(edge.id, edge);
      for (const id of delta.removedEdges) this.edges.delete(id);
    });
  }

  matches(client: TestClient): boolean {
    const graph = client.store.getGraph();
    return (
      graph.nodes.length === this.nodes.size &&
      graph.edges.length === this.edges.size &&
      graph.nodes.every((node) => this.nodes.get(node.id) === node) &&
      graph.edges.every((edge) => this.edges.get(edge.id) === edge)
    );
  }
}

describe('GraphStore equals deriveGraph', () => {
  it('after any sequence of local commands, remote updates, undo and redo', () => {
    fc.assert(
      fc.property(
        fc.array(operationArbitrary, { minLength: 1, maxLength: 60 }),
        fc.integer(),
        (steps, seed) => {
          const subject = createClient(1, seed);
          const peer = createClient(2, seed + 1);
          const shadow = new ShadowGraph(subject);
          for (const { target, operation } of steps) {
            const [actor, other] = target === 0 ? [subject, peer] : [peer, subject];
            applyOperation(actor, other, operation);
            expect(subject.store.getGraph()).toEqual(deriveGraph(subject.doc));
            expect(peer.store.getGraph()).toEqual(deriveGraph(peer.doc));
            expect(shadow.matches(subject)).toBe(true);
          }
          syncPair(subject, peer);
          expect(subject.store.getGraph()).toEqual(peer.store.getGraph());
          expect(findViolations(subject.store.getGraph())).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});
