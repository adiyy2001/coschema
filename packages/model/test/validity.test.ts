import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  EDGE_KEYS,
  NODE_KEYS,
  connect,
  createNode,
  deleteEdges,
  deleteNodes,
  deriveGraph,
  editLabel,
  findViolations,
  getEdges,
  getNodes,
  initializeDocument,
  moveNodes,
  setWaypoints,
  type Graph,
  type NodeId,
} from '../src';
import {
  REMOTE_ORIGIN,
  createClient,
  pushUpdates,
  recordUpdates,
  replica,
  stateVectorOf,
  type TestClient,
} from './support';

interface Fork {
  readonly alice: TestClient;
  readonly bob: TestClient;
  readonly baseUpdate: Uint8Array;
}

function startFromBase(prepare: (client: TestClient) => void): Fork {
  const author = createClient(100);
  initializeDocument(author.doc);
  prepare(author);
  const baseUpdate = Y.encodeStateAsUpdate(author.doc);
  const alice = createClient(1);
  const bob = createClient(2);
  Y.applyUpdate(alice.doc, baseUpdate, REMOTE_ORIGIN);
  Y.applyUpdate(bob.doc, baseUpdate, REMOTE_ORIGIN);
  return { alice, bob, baseUpdate };
}

interface Merged {
  readonly graphs: Graph[];
  readonly docs: Y.Doc[];
}

function mergeEverywhere(
  fork: Fork,
  aliceEdit: (client: TestClient) => void,
  bobEdit: (client: TestClient) => void,
): Merged {
  const aliceUpdates = recordUpdates(fork.alice.doc);
  const bobUpdates = recordUpdates(fork.bob.doc);
  aliceEdit(fork.alice);
  bobEdit(fork.bob);
  pushUpdates(fork.alice.doc, fork.bob.doc);
  pushUpdates(fork.bob.doc, fork.alice.doc);
  const aliceThenBob = replica([fork.baseUpdate, ...aliceUpdates, ...bobUpdates], 3);
  const bobThenAlice = replica([fork.baseUpdate, ...bobUpdates, ...aliceUpdates], 4);
  const docs = [fork.alice.doc, fork.bob.doc, aliceThenBob, bobThenAlice];
  return { docs, graphs: docs.map((doc) => deriveGraph(doc)) };
}

function expectAllEqualAndValid(merged: Merged): Graph {
  const [reference, ...others] = merged.graphs;
  if (reference === undefined) throw new Error('no graphs');
  for (const graph of others) expect(graph).toEqual(reference);
  for (const graph of merged.graphs) expect(findViolations(graph)).toEqual([]);
  const vectors = merged.docs.map((doc) =>
    JSON.stringify([...Y.decodeStateVector(Y.encodeStateVector(doc))].sort()),
  );
  for (const vector of vectors) expect(vector).toBe(vectors[0]);
  return reference;
}

function baseWithEdge(): { ids: NodeId[]; edge: string } & {
  prepare: (client: TestClient) => void;
} {
  const ids: NodeId[] = [];
  const edge = { value: '' };
  return {
    ids,
    get edge() {
      return edge.value;
    },
    prepare: (client) => {
      ids.push(createNode(client.context, { id: 'x', type: 'rect', pos: [0, 0] }));
      ids.push(createNode(client.context, { id: 'y', type: 'rect', pos: [300, 0] }));
      edge.value =
        connect(client.context, {
          id: 'e1',
          source: 'x',
          target: 'y',
          sourcePort: 'e',
          targetPort: 'w',
        }) ?? '';
    },
  };
}

describe('brief case 1: an edge whose endpoint was deleted concurrently', () => {
  it('drops the edge when one side deletes the endpoint and the other reroutes the edge', () => {
    const base = baseWithEdge();
    const fork = startFromBase(base.prepare);
    const merged = mergeEverywhere(
      fork,
      (alice) => deleteNodes(alice.context, ['y']),
      (bob) => setWaypoints(bob.context, 'e1', [[150, 40]]),
    );
    const graph = expectAllEqualAndValid(merged);
    expect(graph.nodes.map((node) => node.id)).toEqual(['x']);
    expect(graph.edges).toEqual([]);
  });

  it('hides an edge created by the other side to the deleted endpoint', () => {
    const base = baseWithEdge();
    const fork = startFromBase((client) => {
      base.prepare(client);
      createNode(client.context, { id: 'z', type: 'rect', pos: [0, 200] });
    });
    const merged = mergeEverywhere(
      fork,
      (alice) => deleteNodes(alice.context, ['y']),
      (bob) => {
        connect(bob.context, {
          id: 'e2',
          source: 'z',
          target: 'y',
          sourcePort: 'e',
          targetPort: 'w',
        });
      },
    );
    const graph = expectAllEqualAndValid(merged);
    expect(graph.nodes.map((node) => node.id)).toEqual(['x', 'z']);
    expect(graph.edges).toEqual([]);
    expect(getEdges(fork.alice.doc).has('e2')).toBe(true);
  });

  it('keeps the document free of repair writes: no client writes after merging', () => {
    const base = baseWithEdge();
    const fork = startFromBase(base.prepare);
    const merged = mergeEverywhere(
      fork,
      (alice) => deleteNodes(alice.context, ['y']),
      (bob) => {
        connect(bob.context, {
          id: 'e2',
          source: 'x',
          target: 'y',
          sourcePort: 's',
          targetPort: 's',
        });
      },
    );
    const vectorBefore = merged.docs.map((doc) => Y.encodeStateVector(doc));
    for (const doc of merged.docs) deriveGraph(doc);
    expect(merged.docs.map((doc) => Y.encodeStateVector(doc))).toEqual(vectorBefore);
  });
});

describe('brief case 2: a node moved by two people', () => {
  it('ends with exactly one of the two positions on every replica, never a mix', () => {
    const base = baseWithEdge();
    const fork = startFromBase(base.prepare);
    const merged = mergeEverywhere(
      fork,
      (alice) => moveNodes(alice.context, [{ id: 'x', pos: [100, 200] }]),
      (bob) => moveNodes(bob.context, [{ id: 'x', pos: [-50, 30] }]),
    );
    const graph = expectAllEqualAndValid(merged);
    const position = graph.nodes.find((node) => node.id === 'x')?.pos;
    expect([
      [100, 200],
      [-50, 30],
    ]).toContainEqual(position);
  });

  it('applies a move and a resize of the same node both', () => {
    const base = baseWithEdge();
    const fork = startFromBase(base.prepare);
    const merged = mergeEverywhere(
      fork,
      (alice) => moveNodes(alice.context, [{ id: 'x', pos: [10, 10] }]),
      (bob) => {
        getNodes(bob.doc).get('x')?.set(NODE_KEYS.size, [200, 100]);
      },
    );
    const graph = expectAllEqualAndValid(merged);
    expect(graph.nodes.find((node) => node.id === 'x')).toMatchObject({
      pos: [10, 10],
      size: [200, 100],
    });
  });
});

describe('brief case 3: a label edited while its node is deleted', () => {
  it('removes the node and drops the edit on every replica', () => {
    const fork = startFromBase((client) => {
      createNode(client.context, { id: 'x', type: 'rect', pos: [0, 0], label: 'Pump 3' });
      createNode(client.context, { id: 'y', type: 'rect', pos: [300, 0] });
    });
    const merged = mergeEverywhere(
      fork,
      (alice) => editLabel(alice.context, 'x', 'Pump 3 north'),
      (bob) => deleteNodes(bob.context, ['x']),
    );
    const graph = expectAllEqualAndValid(merged);
    expect(graph.nodes.map((node) => node.id)).toEqual(['y']);
    for (const doc of merged.docs) expect(getNodes(doc).has('x')).toBe(false);
  });
});

describe('brief case 4: a connection made to a node someone else is deleting', () => {
  it('keeps the edge in the document and hides it in the derived graph', () => {
    const fork = startFromBase((client) => {
      createNode(client.context, { id: 'x', type: 'rect', pos: [0, 0] });
      createNode(client.context, { id: 'y', type: 'rect', pos: [300, 0] });
    });
    const merged = mergeEverywhere(
      fork,
      (alice) => deleteNodes(alice.context, ['y']),
      (bob) => {
        connect(bob.context, {
          id: 'e1',
          source: 'x',
          target: 'y',
          sourcePort: 'e',
          targetPort: 'w',
        });
      },
    );
    const graph = expectAllEqualAndValid(merged);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.map((node) => node.id)).toEqual(['x']);
    for (const doc of merged.docs) expect(getEdges(doc).has('e1')).toBe(true);
  });

  it('shows the edge again when the delete is undone', () => {
    const fork = startFromBase((client) => {
      createNode(client.context, { id: 'x', type: 'rect', pos: [0, 0] });
      createNode(client.context, { id: 'y', type: 'rect', pos: [300, 0] });
    });
    mergeEverywhere(
      fork,
      (alice) => deleteNodes(alice.context, ['y']),
      (bob) => {
        connect(bob.context, {
          id: 'e1',
          source: 'x',
          target: 'y',
          sourcePort: 'e',
          targetPort: 'w',
        });
      },
    );
    expect(deriveGraph(fork.alice.doc).edges).toEqual([]);
    expect(fork.alice.history.undo()).toBe(true);
    expect(deriveGraph(fork.alice.doc).edges.map((edge) => edge.id)).toEqual(['e1']);
  });
});

describe('other validity rules', () => {
  it('hides an edge whose port the node type does not have, and shows it for a type that has it', () => {
    const client = createClient(1);
    createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0] });
    createNode(client.context, { id: 'b', type: 'ellipse', pos: [0, 0] });
    const yEdge = new Y.Map<unknown>();
    yEdge.set(EDGE_KEYS.source, 'a');
    yEdge.set(EDGE_KEYS.target, 'b');
    yEdge.set(EDGE_KEYS.sourcePort, 'ne');
    yEdge.set(EDGE_KEYS.targetPort, 'ne');
    getEdges(client.doc).set('corner', yEdge);
    expect(deriveGraph(client.doc).edges).toEqual([]);
    yEdge.set(EDGE_KEYS.targetPort, 'n');
    expect(deriveGraph(client.doc).edges.map((edge) => edge.id)).toEqual(['corner']);
  });

  it('hides a self-loop written by a foreign client', () => {
    const client = createClient(1);
    createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0] });
    const yEdge = new Y.Map<unknown>();
    yEdge.set(EDGE_KEYS.source, 'a');
    yEdge.set(EDGE_KEYS.target, 'a');
    yEdge.set(EDGE_KEYS.sourcePort, 'e');
    yEdge.set(EDGE_KEYS.targetPort, 'w');
    getEdges(client.doc).set('loop', yEdge);
    expect(deriveGraph(client.doc).edges).toEqual([]);
  });

  it('clamps a size another client shrank below the minimum', () => {
    const client = createClient(1);
    createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0] });
    getNodes(client.doc).get('a')?.set(NODE_KEYS.size, [0, -5]);
    const graph = deriveGraph(client.doc);
    expect(graph.nodes[0]?.size).toEqual([16, 16]);
    expect(findViolations(graph)).toEqual([]);
  });

  it('shows an edge deleted by one side and re-pointed by the other as deleted', () => {
    const base = baseWithEdge();
    const fork = startFromBase(base.prepare);
    const merged = mergeEverywhere(
      fork,
      (alice) => deleteEdges(alice.context, ['e1']),
      (bob) => setWaypoints(bob.context, 'e1', [[1, 1]]),
    );
    expect(expectAllEqualAndValid(merged).edges).toEqual([]);
  });

  it('makes two clients that create nodes concurrently converge on all of them', () => {
    const fork = startFromBase(() => undefined);
    const merged = mergeEverywhere(
      fork,
      (alice) => createNode(alice.context, { type: 'rect', pos: [0, 0] }),
      (bob) => createNode(bob.context, { type: 'rect', pos: [0, 0] }),
    );
    expect(expectAllEqualAndValid(merged).nodes).toHaveLength(2);
    expect(stateVectorOf(fork.alice)).toBe(stateVectorOf(fork.bob));
  });
});
