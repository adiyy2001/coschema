import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  EDGE_KEYS,
  FALLBACK_Z,
  MAX_NODE_SIZE,
  MIN_NODE_SIZE,
  NODE_KEYS,
  compareEdges,
  compareNodes,
  connect,
  createNode,
  deriveGraph,
  findViolations,
  getEdges,
  getNodes,
  isGraphValid,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from '../src';
import { createClient } from './support';

function plainNode(id: string, z: string): GraphNode {
  return { id, type: 'rect', pos: [0, 0], size: [100, 50], z, style: {}, label: '' };
}

function plainEdge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, sourcePort: 'e', targetPort: 'w', waypoints: [] };
}

describe('deriveGraph ordering', () => {
  it('orders nodes by z and breaks ties by id', () => {
    const client = createClient(1);
    createNode(client.context, { id: 'b', type: 'rect', pos: [0, 0], z: 'M' });
    createNode(client.context, { id: 'a', type: 'rect', pos: [0, 0], z: 'M' });
    createNode(client.context, { id: 'c', type: 'rect', pos: [0, 0], z: '5' });
    expect(deriveGraph(client.doc).nodes.map((node) => node.id)).toEqual(['c', 'a', 'b']);
  });

  it('orders edges by id', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [0, 0] });
    for (const id of ['e3', 'e1', 'e2']) {
      connect(client.context, { id, source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    }
    expect(deriveGraph(client.doc).edges.map((edge) => edge.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('compares nodes and edges with the same rules', () => {
    expect(compareNodes(plainNode('a', '1'), plainNode('b', '1'))).toBeLessThan(0);
    expect(compareNodes(plainNode('a', '2'), plainNode('b', '1'))).toBeGreaterThan(0);
    expect(compareEdges(plainEdge('a', 'x', 'y'), plainEdge('b', 'x', 'y'))).toBeLessThan(0);
  });

  it('is empty for an empty document', () => {
    expect(deriveGraph(new Y.Doc())).toEqual({ nodes: [], edges: [] });
  });
});

describe('deriveGraph reads defensively', () => {
  function foreignNode(
    client: ReturnType<typeof createClient>,
    fields: Record<string, unknown>,
  ): string {
    const yNode = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(fields)) yNode.set(key, value);
    getNodes(client.doc).set('foreign', yNode);
    return 'foreign';
  }

  it('falls back for a node with no fields at all', () => {
    const client = createClient(1);
    foreignNode(client, {});
    expect(deriveGraph(client.doc).nodes[0]).toEqual({
      id: 'foreign',
      type: 'rect',
      pos: [0, 0],
      size: [MIN_NODE_SIZE, MIN_NODE_SIZE],
      z: FALLBACK_Z,
      style: {},
      label: '',
    });
  });

  it('replaces an unknown type, bad position, bad key and bad label', () => {
    const client = createClient(1);
    foreignNode(client, {
      [NODE_KEYS.type]: 'hexagon',
      [NODE_KEYS.pos]: [Number.NaN, 4],
      [NODE_KEYS.size]: ['wide', 4],
      [NODE_KEYS.z]: 'bad-key',
      [NODE_KEYS.style]: 'red',
      [NODE_KEYS.label]: 'plain string, not a text',
    });
    expect(deriveGraph(client.doc).nodes[0]).toMatchObject({
      type: 'rect',
      pos: [0, 0],
      z: FALLBACK_Z,
      style: {},
      label: '',
    });
  });

  it('clamps sizes on read', () => {
    const client = createClient(1);
    foreignNode(client, { [NODE_KEYS.size]: [1, 999999] });
    expect(deriveGraph(client.doc).nodes[0]?.size).toEqual([MIN_NODE_SIZE, MAX_NODE_SIZE]);
  });

  it('keeps only known style keys with usable values', () => {
    const client = createClient(1);
    const style = new Y.Map<unknown>();
    style.set('fill', '#abc');
    style.set('strokeWidth', Number.POSITIVE_INFINITY);
    style.set('fontSize', 12);
    style.set('shadow', 'big');
    foreignNode(client, { [NODE_KEYS.style]: style });
    expect(deriveGraph(client.doc).nodes[0]?.style).toEqual({ fill: '#abc', fontSize: 12 });
  });

  it('ignores entries in the nodes map that are not maps', () => {
    const client = createClient(1);
    (getNodes(client.doc) as Y.Map<unknown>).set('odd', 'text');
    (getEdges(client.doc) as Y.Map<unknown>).set('odd', 4);
    expect(deriveGraph(client.doc)).toEqual({ nodes: [], edges: [] });
  });

  it('hides edges with missing or non string fields', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const edges = getEdges(client.doc);
    const make = (id: string, fields: Record<string, unknown>): void => {
      const yEdge = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(fields)) yEdge.set(key, value);
      edges.set(id, yEdge);
    };
    make('no-ports', { [EDGE_KEYS.source]: a, [EDGE_KEYS.target]: b });
    make('number-source', {
      [EDGE_KEYS.source]: 4,
      [EDGE_KEYS.target]: b,
      [EDGE_KEYS.sourcePort]: 'e',
      [EDGE_KEYS.targetPort]: 'w',
    });
    make('number-target', {
      [EDGE_KEYS.source]: a,
      [EDGE_KEYS.target]: 4,
      [EDGE_KEYS.sourcePort]: 'e',
      [EDGE_KEYS.targetPort]: 'w',
    });
    expect(deriveGraph(client.doc).edges).toEqual([]);
  });

  it('keeps only usable waypoints', () => {
    const client = createClient(1);
    const a = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const b = createNode(client.context, { type: 'rect', pos: [0, 0] });
    const id = connect(client.context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    getEdges(client.doc)
      .get(id ?? '')
      ?.set(EDGE_KEYS.waypoints, [[1, 2], [Number.NaN, 1], 'x', [1], [3, 4]]);
    expect(deriveGraph(client.doc).edges[0]?.waypoints).toEqual([
      [1, 2],
      [3, 4],
    ]);
    getEdges(client.doc)
      .get(id ?? '')
      ?.set(EDGE_KEYS.waypoints, 'nope');
    expect(deriveGraph(client.doc).edges[0]?.waypoints).toEqual([]);
  });
});

describe('findViolations', () => {
  it('accepts a clean graph', () => {
    const graph: Graph = {
      nodes: [plainNode('a', '1'), plainNode('b', '2')],
      edges: [plainEdge('e', 'a', 'b')],
    };
    expect(findViolations(graph)).toEqual([]);
    expect(isGraphValid(graph)).toBe(true);
  });

  it('reports every kind of violation', () => {
    const tiny: GraphNode = { ...plainNode('tiny', '3'), size: [1, 1] };
    const huge: GraphNode = { ...plainNode('huge', '4'), size: [99999, 99999] };
    const ellipse: GraphNode = { ...plainNode('ellipse', '5'), type: 'ellipse' };
    const graph: Graph = {
      nodes: [plainNode('a', '2'), plainNode('a', '1'), tiny, huge, ellipse],
      edges: [
        plainEdge('loop', 'a', 'a'),
        plainEdge('dangling-source', 'ghost', 'a'),
        plainEdge('dangling-target', 'a', 'ghost'),
        { ...plainEdge('bad-port', 'ellipse', 'a'), sourcePort: 'ne' },
        { ...plainEdge('bad-target-port', 'a', 'ellipse'), targetPort: 'sw' },
        plainEdge('twin', 'a', 'tiny'),
        plainEdge('twin', 'a', 'tiny'),
      ],
    };
    const text = findViolations(graph).join('\n');
    for (const expected of [
      'duplicate node id a',
      'out of order',
      'below the minimum size',
      'above the maximum size',
      'is a self-loop',
      'has no source node',
      'has no target node',
      'source port the node does not have',
      'target port the node does not have',
      'duplicate edge id twin',
    ]) {
      expect(text).toContain(expected);
    }
    expect(isGraphValid(graph)).toBe(false);
  });
});
