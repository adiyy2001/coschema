import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NODE_SIZES,
  MIN_NODE_SIZE,
  NODE_KEYS,
  connect,
  createNode,
  deleteEdges,
  deleteNodes,
  deriveGraph,
  editLabel,
  findViolations,
  getEdges,
  getLabelText,
  getNodes,
  moveNodes,
  reorderNode,
  reorderNodes,
  replaceLabelRange,
  resizeNode,
  setStyle,
  setWaypoints,
  translateNodes,
  type NodeId,
} from '../src';
import { createClient, type TestClient } from './support';

function nodeIdsInOrder(client: TestClient): NodeId[] {
  return deriveGraph(client.doc).nodes.map((node) => node.id);
}

function labelOf(client: TestClient, id: NodeId): string {
  return deriveGraph(client.doc).nodes.find((node) => node.id === id)?.label ?? '';
}

function twoNodes(client: TestClient): [NodeId, NodeId] {
  const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
  const b = createNode(client.context, { type: 'ellipse', pos: [300, 0] });
  return [a, b];
}

describe('createNode', () => {
  it('writes the node with defaults, a label text and an empty style map', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'diamond', pos: [10, 20], label: 'Valve' });
    const yNode = getNodes(client.doc).get(id);
    expect(yNode?.get(NODE_KEYS.type)).toBe('diamond');
    expect(yNode?.get(NODE_KEYS.pos)).toEqual([10, 20]);
    expect(yNode?.get(NODE_KEYS.size)).toEqual([...DEFAULT_NODE_SIZES.diamond]);
    expect(yNode?.get(NODE_KEYS.label)).toBeInstanceOf(Y.Text);
    expect(yNode?.get(NODE_KEYS.style)).toBeInstanceOf(Y.Map);
    expect(deriveGraph(client.doc).nodes[0]?.label).toBe('Valve');
  });

  it('stacks new nodes in front of the existing ones', () => {
    const client = createClient(1);
    const ids = Array.from({ length: 20 }, () =>
      createNode(client.context, { type: 'rect', pos: [0, 0] }),
    );
    expect(nodeIdsInOrder(client)).toEqual(ids);
  });

  it('keeps an explicit id, z and style', () => {
    const client = createClient(1);
    createNode(client.context, {
      id: 'fixed',
      type: 'rect',
      pos: [0, 0],
      z: 'M',
      style: { fill: '#fff', strokeWidth: 2 },
    });
    const node = deriveGraph(client.doc).nodes[0];
    expect(node?.id).toBe('fixed');
    expect(node?.z).toBe('M');
    expect(node?.style).toEqual({ fill: '#fff', strokeWidth: 2 });
  });

  it('clamps sizes on write', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0], size: [1, 1] });
    expect(getNodes(client.doc).get(id)?.get(NODE_KEYS.size)).toEqual([
      MIN_NODE_SIZE,
      MIN_NODE_SIZE,
    ]);
  });

  it('refuses a duplicate id and a non finite position', () => {
    const client = createClient(1);
    createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0] });
    expect(() => createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0] })).toThrow(
      'already exists',
    );
    expect(() => createNode(client.context, { type: 'rect', pos: [Number.NaN, 0] })).toThrow(
      RangeError,
    );
    expect(getNodes(client.doc).size).toBe(1);
  });

  it('is deterministic for one random source', () => {
    const first = createClient(1, 42);
    const second = createClient(2, 42);
    const a = createNode(first.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(second.context, { type: 'rect', pos: [0, 0] });
    expect(a).toBe(b);
    expect(deriveGraph(first.doc)).toEqual(deriveGraph(second.doc));
  });
});

describe('move, resize and style', () => {
  it('moves nodes to absolute positions and ignores unknown ids', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    moveNodes(client.context, [
      { id: a, pos: [5, 6] },
      { id: b, pos: [7, 8] },
      { id: 'missing', pos: [1, 1] },
    ]);
    expect(deriveGraph(client.doc).nodes.map((node) => node.pos)).toEqual([
      [5, 6],
      [7, 8],
    ]);
    expect(getNodes(client.doc).has('missing')).toBe(false);
  });

  it('translates nodes by a delta', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    translateNodes(client.context, [a, b, a], 10, -5);
    expect(deriveGraph(client.doc).nodes.map((node) => node.pos)).toEqual([
      [10, -5],
      [310, -5],
    ]);
  });

  it('rejects non finite moves before writing anything', () => {
    const client = createClient(1);
    const [a] = twoNodes(client);
    expect(() =>
      moveNodes(client.context, [
        { id: a, pos: [1, 1] },
        { id: a, pos: [Number.POSITIVE_INFINITY, 0] },
      ]),
    ).toThrow(RangeError);
    expect(deriveGraph(client.doc).nodes[0]?.pos).toEqual([0, 0]);
    expect(() => translateNodes(client.context, [a], Number.NaN, 0)).toThrow(RangeError);
  });

  it('resizes with an optional new position and clamps', () => {
    const client = createClient(1);
    const [a] = twoNodes(client);
    resizeNode(client.context, a, { size: [200, 100], pos: [-20, -10] });
    expect(deriveGraph(client.doc).nodes[0]).toMatchObject({ size: [200, 100], pos: [-20, -10] });
    resizeNode(client.context, a, { size: [2, 2] });
    expect(deriveGraph(client.doc).nodes[0]).toMatchObject({
      size: [MIN_NODE_SIZE, MIN_NODE_SIZE],
      pos: [-20, -10],
    });
    resizeNode(client.context, 'missing', { size: [50, 50] });
    expect(() => resizeNode(client.context, a, { size: [Number.NaN, 1] })).toThrow(RangeError);
    expect(() => resizeNode(client.context, a, { size: [20, 20], pos: [Number.NaN, 1] })).toThrow(
      RangeError,
    );
  });

  it('merges style patches and removes a key with null', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    setStyle(client.context, [a, b], { fill: '#111', stroke: '#222' });
    setStyle(client.context, [a], { fill: '#333', strokeWidth: 3 });
    setStyle(client.context, [b], { stroke: null });
    const [first, second] = deriveGraph(client.doc).nodes;
    expect(first?.style).toEqual({ fill: '#333', stroke: '#222', strokeWidth: 3 });
    expect(second?.style).toEqual({ fill: '#111' });
  });

  it('creates the style map when an older node has none', () => {
    const client = createClient(1);
    const [a] = twoNodes(client);
    getNodes(client.doc).get(a)?.delete(NODE_KEYS.style);
    setStyle(client.context, [a], { fontSize: 14 });
    expect(deriveGraph(client.doc).nodes[0]?.style).toEqual({ fontSize: 14 });
  });

  it('merges concurrent style changes to different keys', () => {
    const left = createClient(1);
    const right = createClient(2);
    const [a] = twoNodes(left);
    right.doc.transact(() => undefined);
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    setStyle(left.context, [a], { fill: '#aaa' });
    setStyle(right.context, [a], { stroke: '#bbb' });
    Y.applyUpdate(left.doc, Y.encodeStateAsUpdate(right.doc));
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    expect(deriveGraph(left.doc).nodes[0]?.style).toEqual({ fill: '#aaa', stroke: '#bbb' });
    expect(deriveGraph(right.doc)).toEqual(deriveGraph(left.doc));
  });
});

describe('labels', () => {
  it('touches only the changed characters', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0], label: 'Pump 3' });
    const label = getNodes(client.doc).get(id)?.get(NODE_KEYS.label);
    if (!(label instanceof Y.Text)) throw new Error('label is not a text');
    const deltas: unknown[] = [];
    label.observe((event) => deltas.push(event.delta));
    editLabel(client.context, id, 'Pump 4');
    expect(deltas).toEqual([[{ retain: 5 }, { delete: 1 }, { insert: '4' }]]);
    editLabel(client.context, id, 'Pump 4');
    expect(deltas).toHaveLength(1);
    expect(labelOf(client, id)).toBe('Pump 4');
  });

  it('exposes the shared text of a label', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0], label: 'Pump 3' });
    expect(getLabelText(client.doc, id)?.toJSON()).toBe('Pump 3');
    expect(getLabelText(client.doc, 'missing')).toBeUndefined();
    getNodes(client.doc).get(id)?.delete(NODE_KEYS.label);
    expect(getLabelText(client.doc, id)).toBeUndefined();
  });

  it('ignores unknown nodes and nodes without a label text', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0] });
    editLabel(client.context, 'missing', 'x');
    replaceLabelRange(client.context, 'missing', 0, 0, 'x');
    getNodes(client.doc).get(id)?.delete(NODE_KEYS.label);
    editLabel(client.context, id, 'x');
    replaceLabelRange(client.context, id, 0, 0, 'x');
    expect(labelOf(client, id)).toBe('');
  });

  it('replaces a range and clamps its bounds', () => {
    const client = createClient(1);
    const id = createNode(client.context, { type: 'rect', pos: [0, 0], label: 'abcdef' });
    replaceLabelRange(client.context, id, 1, 2, 'XY');
    expect(labelOf(client, id)).toBe('aXYdef');
    replaceLabelRange(client.context, id, -5, 100, '');
    expect(labelOf(client, id)).toBe('');
    replaceLabelRange(client.context, id, 50, 1, 'end');
    expect(labelOf(client, id)).toBe('end');
  });

  it('merges concurrent edits at different places', () => {
    const left = createClient(1);
    const right = createClient(2);
    const id = createNode(left.context, { type: 'rect', pos: [0, 0], label: 'Pump 3' });
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    editLabel(left.context, id, 'Main Pump 3');
    editLabel(right.context, id, 'Pump 3 north');
    Y.applyUpdate(left.doc, Y.encodeStateAsUpdate(right.doc));
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    expect(labelOf(left, id)).toBe('Main Pump 3 north');
    expect(labelOf(right, id)).toBe('Main Pump 3 north');
  });
});

describe('z order', () => {
  function threeNodes(client: TestClient): [NodeId, NodeId, NodeId] {
    const ids = [0, 1, 2].map(() => createNode(client.context, { type: 'rect', pos: [0, 0] }));
    return [ids[0] ?? '', ids[1] ?? '', ids[2] ?? ''];
  }

  it('moves one node to an index among the others', () => {
    const client = createClient(1);
    const [a, b, c] = threeNodes(client);
    reorderNode(client.context, c, 0);
    expect(nodeIdsInOrder(client)).toEqual([c, a, b]);
    reorderNode(client.context, c, 1);
    expect(nodeIdsInOrder(client)).toEqual([a, c, b]);
    reorderNode(client.context, a, 99);
    expect(nodeIdsInOrder(client)).toEqual([c, b, a]);
    reorderNode(client.context, b, -4);
    expect(nodeIdsInOrder(client)).toEqual([b, c, a]);
    reorderNode(client.context, 'missing', 0);
  });

  it('writes the z of the moved node only', () => {
    const client = createClient(1);
    const [a, b, c] = threeNodes(client);
    const zOf = (id: NodeId): string | undefined =>
      deriveGraph(client.doc).nodes.find((node) => node.id === id)?.z;
    const [zA, zB, zC] = [zOf(a), zOf(b), zOf(c)];
    reorderNode(client.context, c, 0);
    expect(zOf(a)).toBe(zA);
    expect(zOf(b)).toBe(zB);
    expect(zOf(c)).not.toBe(zC);
  });

  it('brings a selection to the front and keeps its relative order', () => {
    const client = createClient(1);
    const [a, b, c] = threeNodes(client);
    reorderNodes(client.context, [a, b], 'front');
    expect(nodeIdsInOrder(client)).toEqual([c, a, b]);
    reorderNodes(client.context, [b, a], 'front');
    expect(nodeIdsInOrder(client)).toEqual([c, a, b]);
  });

  it('sends a selection to the back and keeps its relative order', () => {
    const client = createClient(1);
    const [a, b, c] = threeNodes(client);
    reorderNodes(client.context, [b, c], 'back');
    expect(nodeIdsInOrder(client)).toEqual([b, c, a]);
  });

  it('copes with an empty selection, unknown ids and a full selection', () => {
    const client = createClient(1);
    const [a, b, c] = threeNodes(client);
    reorderNodes(client.context, [], 'front');
    reorderNodes(client.context, ['missing'], 'back');
    reorderNodes(client.context, [a, b, c], 'front');
    reorderNodes(client.context, [a, b, c], 'back');
    expect(nodeIdsInOrder(client)).toEqual([a, b, c]);
  });

  it('survives neighbours with equal keys', () => {
    const client = createClient(1);
    createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0], z: 'M' });
    createNode(client.context, { id: 'b', type: 'rect', pos: [0, 0], z: 'M' });
    createNode(client.context, { id: 'c', type: 'rect', pos: [0, 0], z: 'Z' });
    reorderNode(client.context, 'c', 1);
    expect(nodeIdsInOrder(client).sort()).toEqual(['a', 'b', 'c']);
    expect(findViolations(deriveGraph(client.doc))).toEqual([]);
  });

  it('lets two clients reorder concurrently and still agree', () => {
    const left = createClient(1);
    const right = createClient(2);
    const [a, b, c] = threeNodes(left);
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    reorderNode(left.context, c, 0);
    reorderNode(right.context, a, 2);
    Y.applyUpdate(left.doc, Y.encodeStateAsUpdate(right.doc));
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc));
    expect(nodeIdsInOrder(left)).toEqual(nodeIdsInOrder(right));
    expect(new Set(nodeIdsInOrder(left))).toEqual(new Set([a, b, c]));
  });
});

describe('edges and deletion', () => {
  it('connects two nodes and stores the edge fields', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    const id = connect(client.context, {
      source: a,
      target: b,
      sourcePort: 'e',
      targetPort: 'w',
      waypoints: [[150, 0]],
    });
    expect(id).toBeDefined();
    expect(deriveGraph(client.doc).edges).toEqual([
      {
        id,
        source: a,
        target: b,
        sourcePort: 'e',
        targetPort: 'w',
        waypoints: [[150, 0]],
      },
    ]);
  });

  it('refuses connections that could never be valid', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    expect(
      connect(client.context, { source: a, target: a, sourcePort: 'e', targetPort: 'w' }),
    ).toBeUndefined();
    expect(
      connect(client.context, { source: a, target: 'missing', sourcePort: 'e', targetPort: 'w' }),
    ).toBeUndefined();
    expect(
      connect(client.context, { source: 'missing', target: b, sourcePort: 'e', targetPort: 'w' }),
    ).toBeUndefined();
    expect(
      connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'ne' }),
    ).toBeUndefined();
    expect(getEdges(client.doc).size).toBe(0);
  });

  it('refuses a duplicate edge id and bad waypoints', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    const init = { id: 'e1', source: a, target: b, sourcePort: 'e', targetPort: 'w' } as const;
    connect(client.context, init);
    expect(() => connect(client.context, init)).toThrow('already exists');
    expect(() =>
      connect(client.context, { ...init, id: 'e2', waypoints: [[Number.NaN, 0]] }),
    ).toThrow(RangeError);
  });

  it('deletes edges by id and counts them', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    const e1 = connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    const e2 = connect(client.context, { source: b, target: a, sourcePort: 'w', targetPort: 'e' });
    expect(deleteEdges(client.context, [e1 ?? '', 'missing', e1 ?? ''])).toBe(1);
    expect(deriveGraph(client.doc).edges.map((edge) => edge.id)).toEqual([e2]);
  });

  it('sets waypoints on an existing edge only', () => {
    const client = createClient(1);
    const [a, b] = twoNodes(client);
    const id = connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    setWaypoints(client.context, id ?? '', [
      [1, 2],
      [3, 4],
    ]);
    setWaypoints(client.context, 'missing', [[1, 1]]);
    expect(deriveGraph(client.doc).edges[0]?.waypoints).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(() => setWaypoints(client.context, id ?? '', [[Number.NaN, 1]])).toThrow(RangeError);
  });

  it('deletes a node together with its edges in one transaction', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [200, 0] });
    const c = createNode(client.context, { type: 'rect', pos: [400, 0] });
    connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    connect(client.context, { source: c, target: b, sourcePort: 'w', targetPort: 'e' });
    const kept = connect(client.context, {
      source: a,
      target: c,
      sourcePort: 's',
      targetPort: 's',
    });
    let transactions = 0;
    client.doc.on('afterTransaction', () => {
      transactions += 1;
    });
    expect(deleteNodes(client.context, [b, 'missing', b])).toBe(1);
    expect(transactions).toBe(1);
    expect(nodeIdsInOrder(client)).toEqual([a, c]);
    expect(getEdges(client.doc).size).toBe(1);
    expect(deriveGraph(client.doc).edges.map((edge) => edge.id)).toEqual([kept]);
  });

  it('does nothing when no listed node exists', () => {
    const client = createClient(1);
    twoNodes(client);
    let transactions = 0;
    client.doc.on('afterTransaction', () => {
      transactions += 1;
    });
    expect(deleteNodes(client.context, ['missing'])).toBe(0);
    expect(deleteNodes(client.context, [])).toBe(0);
    expect(transactions).toBe(2);
  });
});

describe('transaction origin', () => {
  it('tags every command with the origin of the context', () => {
    const client = createClient(1);
    const origins = new Set<unknown>();
    client.doc.on('beforeTransaction', (transaction: Y.Transaction) => {
      origins.add(transaction.origin);
    });
    const [a, b] = twoNodes(client);
    moveNodes(client.context, [{ id: a, pos: [1, 1] }]);
    connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    deleteNodes(client.context, [a]);
    expect([...origins]).toEqual([client.history.origin]);
  });
});
