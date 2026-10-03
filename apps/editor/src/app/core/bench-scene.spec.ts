import { History, GraphStore, initializeDocument } from '@coschema/model';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { benchSeed, mulberry32 } from './bench-scene';

function build(nodeCount: number, seed?: number): GraphStore {
  const doc = new Y.Doc();
  initializeDocument(doc);
  const history = new History(doc);
  benchSeed(nodeCount, seed)(history.context(mulberry32(1)));
  return new GraphStore(doc);
}

describe('mulberry32', () => {
  it('is deterministic and stays within the unit interval', () => {
    const first = mulberry32(5);
    const second = mulberry32(5);
    for (let index = 0; index < 50; index += 1) {
      const value = first();
      expect(value).toBe(second());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('benchSeed', () => {
  it('creates the requested number of nodes with connected edges', () => {
    const store = build(200);
    expect(store.nodeCount).toBe(200);
    expect(store.edgeCount).toBeGreaterThan(100);
    const graph = store.getGraph();
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });

  it('builds the same scene for the same seed and a different one otherwise', () => {
    const left = build(60, 3).getGraph();
    const right = build(60, 3).getGraph();
    const other = build(60, 4).getGraph();
    const positions = (graph: typeof left) => graph.nodes.map((node) => node.pos.join());
    expect(positions(left)).toEqual(positions(right));
    expect(positions(left)).not.toEqual(positions(other));
  });

  it('handles tiny scenes', () => {
    expect(build(1).nodeCount).toBe(1);
  });
});
