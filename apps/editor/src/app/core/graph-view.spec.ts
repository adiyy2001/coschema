import {
  History,
  connect,
  createNode,
  deleteNodes,
  initializeDocument,
  moveNodes,
} from '@coschema/model';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManualFrames } from '../testing/manual-frames';
import { mulberry32 } from '../core/bench-scene';
import { GraphView } from './graph-view';

interface Fixture {
  readonly doc: Y.Doc;
  readonly history: History;
  readonly frames: ManualFrames;
  readonly view: GraphView;
  readonly context: ReturnType<History['context']>;
}

function setup(seed?: (context: Fixture['context']) => void): Fixture {
  const doc = new Y.Doc();
  initializeDocument(doc);
  const history = new History(doc);
  const context = history.context(mulberry32(7));
  seed?.(context);
  const frames = new ManualFrames();
  const view = new GraphView(doc, frames.schedule);
  return { doc, history, frames, view, context };
}

function twoNodes(context: Fixture['context']): void {
  createNode(context, { id: 'a', type: 'rect', pos: [0, 0], size: [100, 60], label: 'A' });
  createNode(context, { id: 'b', type: 'ellipse', pos: [400, 0], size: [100, 60], label: 'B' });
  connect(context, { id: 'e', source: 'a', target: 'b', sourcePort: 'e', targetPort: 'w' });
}

describe('GraphView', () => {
  let fixture: Fixture;

  afterEach(() => {
    fixture.view.destroy();
    fixture.history.destroy();
    fixture.doc.destroy();
  });

  describe('initial load', () => {
    beforeEach(() => {
      fixture = setup(twoNodes);
    });

    it('reads the existing graph synchronously', () => {
      const { view } = fixture;
      expect(view.nodeCount()).toBe(2);
      expect(view.edgeCount()).toBe(1);
      expect(view.revision()).toBe(1);
      expect(view.node('a')()?.label).toBe('A');
      expect(view.edge('e')()?.source).toBe('a');
      expect(view.peekNode('b')?.type).toBe('ellipse');
      expect(view.peekEdge('e')?.target).toBe('b');
      expect(view.committedNode('a')?.id).toBe('a');
    });

    it('computes routes only for activated edges', () => {
      const { view } = fixture;
      expect(view.peekRoute('e')).toBeUndefined();
      view.activate(['e']);
      expect(view.route('e')()?.points.length).toBeGreaterThanOrEqual(2);
      view.activate([]);
      expect(view.peekRoute('e')).toBeUndefined();
    });

    it('ignores activation of an unknown edge', () => {
      fixture.view.activate(['missing']);
      expect(fixture.view.peekRoute('missing')).toBeUndefined();
    });

    it('answers window, area and point queries in z order', () => {
      const { view } = fixture;
      const window = view.nodeGrid.visibleWindow({ x: -50, y: -50, width: 700, height: 200 });
      expect(view.nodeIdsInWindow(window)).toEqual(['a', 'b']);
      expect(view.edgeIdsInWindow(window)).toEqual(['e']);
      expect(view.nodeIdsInArea({ x: 398, y: 10, width: 5, height: 5 })).toEqual(['b']);
      expect(view.nodeAt([50, 30])).toBe('a');
      expect(view.nodeAt([250, 30])).toBeUndefined();
      expect(view.nodeAt([401, 1])).toBeUndefined();
    });

    it('hits an active edge near its route and nothing far from it', () => {
      const { view } = fixture;
      view.activate(['e']);
      const [first] = view.peekRoute('e')?.points ?? [];
      expect(first).toBeDefined();
      expect(view.edgeAt([250, 30], 6)).toBe('e');
      expect(view.edgeAt([250, 300], 6)).toBeUndefined();
    });

    it('reports the union of node rectangles as content bounds', () => {
      expect(fixture.view.contentBounds()).toEqual({ x: 0, y: 0, width: 500, height: 60 });
    });
  });

  describe('empty document', () => {
    it('has no content bounds and no hits', () => {
      fixture = setup();
      expect(fixture.view.contentBounds()).toBeUndefined();
      expect(fixture.view.nodeAt([0, 0])).toBeUndefined();
      expect(fixture.view.edgeAt([0, 0], 5)).toBeUndefined();
      expect(fixture.view.nodeCount()).toBe(0);
    });
  });

  describe('changes after load', () => {
    beforeEach(() => {
      fixture = setup(twoNodes);
      fixture.view.activate(['e']);
    });

    it('batches deltas into one flush per frame', () => {
      const { view, frames, context } = fixture;
      const before = view.revision();
      moveNodes(context, [{ id: 'a', pos: [10, 10] }]);
      moveNodes(context, [{ id: 'a', pos: [20, 20] }]);
      expect(frames.pending).toBe(1);
      expect(view.peekNode('a')?.pos).toEqual([0, 0]);
      frames.tick();
      expect(view.peekNode('a')?.pos).toEqual([20, 20]);
      expect(view.revision()).toBe(before + 1);
    });

    it('reroutes an active edge when an endpoint moves', () => {
      const { view, frames, context } = fixture;
      const before = view.peekRoute('e');
      moveNodes(context, [{ id: 'b', pos: [400, 300] }]);
      frames.tick();
      expect(view.peekRoute('e')).not.toBe(before);
      expect(view.peekRoute('e')?.points.at(-1)?.[1]).toBeGreaterThan(200);
    });

    it('leaves routes alone when an unrelated node is added far away', () => {
      const { view, frames, context } = fixture;
      const before = view.peekRoute('e');
      createNode(context, { id: 'far', type: 'rect', pos: [9000, 9000] });
      frames.tick();
      expect(view.peekRoute('e')).toBe(before);
      expect(view.nodeCount()).toBe(3);
    });

    it('reroutes when a new node lands on the route', () => {
      const { view, frames, context } = fixture;
      const before = view.peekRoute('e');
      createNode(context, { id: 'block', type: 'rect', pos: [200, 10], size: [60, 40] });
      frames.tick();
      expect(view.peekRoute('e')).not.toBe(before);
    });

    it('drops edges and routes when a node is deleted', () => {
      const { view, frames, context } = fixture;
      deleteNodes(context, ['b']);
      frames.tick();
      expect(view.peekNode('b')).toBeUndefined();
      expect(view.peekEdge('e')).toBeUndefined();
      expect(view.peekRoute('e')).toBeUndefined();
      expect(view.nodeCount()).toBe(1);
      expect(view.edgeCount()).toBe(0);
    });

    it('does nothing on flush without changes', () => {
      const { view } = fixture;
      const before = view.revision();
      view.flush();
      expect(view.revision()).toBe(before);
    });
  });

  describe('drag preview', () => {
    beforeEach(() => {
      fixture = setup(twoNodes);
      fixture.view.activate(['e']);
    });

    it('overrides a position without touching the document', () => {
      const { view, frames } = fixture;
      view.setPreview([{ id: 'a', pos: [50, 50] }]);
      frames.tick();
      expect(view.peekNode('a')?.pos).toEqual([50, 50]);
      expect(view.committedNode('a')?.pos).toEqual([0, 0]);
      expect(view.nodeGrid.rectOf('a')?.x).toBe(50);
    });

    it('restores the committed position when cleared', () => {
      const { view, frames } = fixture;
      view.setPreview([{ id: 'a', pos: [50, 50] }]);
      frames.tick();
      view.setPreview(undefined);
      frames.tick();
      expect(view.peekNode('a')?.pos).toEqual([0, 0]);
    });

    it('moves only the nodes of the latest preview', () => {
      const { view, frames } = fixture;
      view.setPreview([{ id: 'a', pos: [50, 50] }]);
      frames.tick();
      view.setPreview([{ id: 'b', pos: [600, 0] }]);
      frames.tick();
      expect(view.peekNode('a')?.pos).toEqual([0, 0]);
      expect(view.peekNode('b')?.pos).toEqual([600, 0]);
    });
  });

  describe('exportScene', () => {
    it('returns every node in z order and a route for every edge, active or not', () => {
      fixture = setup(twoNodes);
      const scene = fixture.view.exportScene();
      expect(scene.nodes.map((node) => node.id)).toEqual(['a', 'b']);
      expect(scene.edges).toHaveLength(1);
      expect(fixture.view.peekRoute('e')).toBeUndefined();
      const first = scene.edges[0];
      expect(first?.id).toBe('e');
      expect(first?.points.length).toBeGreaterThanOrEqual(2);
      expect(first?.points[0]?.[0]).toBeCloseTo(100, 0);
      expect(first?.points[first.points.length - 1]?.[0]).toBeCloseTo(400, 0);
      expect(first?.fallback).toBe(false);
    });

    it('is empty for an empty diagram and follows later changes', () => {
      fixture = setup();
      expect(fixture.view.exportScene()).toEqual({ nodes: [], edges: [] });
      twoNodes(fixture.context);
      expect(fixture.view.exportScene().nodes).toHaveLength(2);
      moveNodes(fixture.context, [{ id: 'b', pos: [800, 300] }]);
      fixture.frames.tick();
      const moved = fixture.view.exportScene();
      expect(moved.edges[0]?.points[moved.edges[0].points.length - 1]?.[0]).toBeCloseTo(800, 0);
    });
  });

  describe('destroy', () => {
    it('cancels the pending frame and stops listening', () => {
      fixture = setup(twoNodes);
      moveNodes(fixture.context, [{ id: 'a', pos: [5, 5] }]);
      expect(fixture.frames.pending).toBe(1);
      fixture.view.destroy();
      expect(fixture.frames.pending).toBe(0);
      moveNodes(fixture.context, [{ id: 'a', pos: [9, 9] }]);
      expect(fixture.frames.pending).toBe(0);
    });
  });
});
