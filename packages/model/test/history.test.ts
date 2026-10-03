import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  History,
  connect,
  createNode,
  deleteNodes,
  deriveGraph,
  editLabel,
  findViolations,
  moveNodes,
  setStyle,
  translateNodes,
  type GraphNode,
  type HistoryState,
  type NodeId,
} from '../src';
import { REMOTE_ORIGIN, createClient, syncPair, type TestClient } from './support';

function pair(prepare: (client: TestClient) => void): { alice: TestClient; bob: TestClient } {
  const alice = createClient(1);
  const bob = createClient(2);
  prepare(alice);
  syncPair(alice, bob);
  alice.history.clear();
  return { alice, bob };
}

function node(client: TestClient, id: NodeId): GraphNode | undefined {
  return deriveGraph(client.doc).nodes.find((entry) => entry.id === id);
}

function singleNode(client: TestClient): void {
  createNode(client.context, { id: 'n', type: 'rect', pos: [0, 0], label: 'Pump' });
}

function expectConverged(left: TestClient, right: TestClient): void {
  syncPair(left, right);
  expect(deriveGraph(left.doc)).toEqual(deriveGraph(right.doc));
  expect(findViolations(deriveGraph(left.doc))).toEqual([]);
}

describe('History: the eight tricky cases of ADR 0008', () => {
  it('1. undoing my move after a remote label edit keeps the label', () => {
    const { alice, bob } = pair(singleNode);
    moveNodes(alice.context, [{ id: 'n', pos: [100, 100] }]);
    editLabel(bob.context, 'n', 'Pump 3');
    syncPair(alice, bob);
    expect(alice.history.undo()).toBe(true);
    expect(node(alice, 'n')).toMatchObject({ pos: [0, 0], label: 'Pump 3' });
    expectConverged(alice, bob);
    expect(node(bob, 'n')).toMatchObject({ pos: [0, 0], label: 'Pump 3' });
  });

  it('2. undoing my move after a remote move of the same node changes nothing', () => {
    const { alice, bob } = pair(singleNode);
    moveNodes(alice.context, [{ id: 'n', pos: [100, 100] }]);
    syncPair(alice, bob);
    moveNodes(bob.context, [{ id: 'n', pos: [-40, 70] }]);
    syncPair(alice, bob);
    expect(alice.history.undo()).toBe(false);
    expect(alice.history.state).toMatchObject({ canUndo: false, canRedo: false });
    expect(node(alice, 'n')?.pos).toEqual([-40, 70]);
    expectConverged(alice, bob);
    expect(node(bob, 'n')?.pos).toEqual([-40, 70]);
  });

  it('3. undoing my create after someone moved the node removes the node everywhere', () => {
    const { alice, bob } = pair(() => undefined);
    createNode(alice.context, { id: 'n', type: 'rect', pos: [0, 0] });
    syncPair(alice, bob);
    moveNodes(bob.context, [{ id: 'n', pos: [5, 5] }]);
    syncPair(alice, bob);
    alice.history.undo();
    expectConverged(alice, bob);
    expect(deriveGraph(alice.doc).nodes).toEqual([]);
    expect(deriveGraph(bob.doc).nodes).toEqual([]);
  });

  it('4. undoing my delete brings back the node, its label, its edges and an edge added meanwhile', () => {
    const { alice, bob } = pair((client) => {
      createNode(client.context, { id: 'x', type: 'rect', pos: [0, 0] });
      createNode(client.context, { id: 'y', type: 'rect', pos: [300, 0], label: 'Valve' });
      connect(client.context, {
        id: 'e1',
        source: 'x',
        target: 'y',
        sourcePort: 'e',
        targetPort: 'w',
      });
    });
    deleteNodes(alice.context, ['y']);
    connect(bob.context, {
      id: 'e2',
      source: 'x',
      target: 'y',
      sourcePort: 's',
      targetPort: 's',
    });
    syncPair(alice, bob);
    expect(deriveGraph(alice.doc).edges).toEqual([]);
    expect(alice.history.undo()).toBe(true);
    expectConverged(alice, bob);
    const graph = deriveGraph(alice.doc);
    expect(graph.nodes.map((entry) => entry.id).sort()).toEqual(['x', 'y']);
    expect(node(alice, 'y')?.label).toBe('Valve');
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual(['e1', 'e2']);
  });

  it('5. redo after a remote edit keeps the remote edit', () => {
    const { alice, bob } = pair(singleNode);
    moveNodes(alice.context, [{ id: 'n', pos: [100, 100] }]);
    alice.history.undo();
    editLabel(bob.context, 'n', 'Pump 3');
    syncPair(alice, bob);
    expect(alice.history.redo()).toBe(true);
    expect(node(alice, 'n')).toMatchObject({ pos: [100, 100], label: 'Pump 3' });
    expectConverged(alice, bob);
  });

  it('6. remote, IndexedDB like and untagged origins never land on the stack', () => {
    const { alice, bob } = pair(singleNode);
    class IndexeddbPersistence {
      readonly name = 'indexeddb';
    }
    const persistence = new IndexeddbPersistence();
    moveNodes(bob.context, [{ id: 'n', pos: [1, 1] }]);
    Y.applyUpdate(alice.doc, Y.encodeStateAsUpdate(bob.doc), REMOTE_ORIGIN);
    const stored = new Y.Doc();
    stored.clientID = 77;
    Y.applyUpdate(stored, Y.encodeStateAsUpdate(bob.doc));
    editLabel({ ...bob.context, doc: stored }, 'n', 'from disk');
    Y.applyUpdate(alice.doc, Y.encodeStateAsUpdate(stored), persistence);
    alice.doc.transact(() => {
      alice.doc.getMap('meta').set('untagged', true);
    });
    alice.doc.transact(() => {
      alice.doc.getMap('meta').set('string-origin', true);
    }, 'sync-provider');
    expect(alice.history.canUndo).toBe(false);
    expect(alice.history.undo()).toBe(false);
    expect(node(alice, 'n')).toMatchObject({ pos: [1, 1], label: 'from disk' });
  });

  it('7. typing in one label from two clients, then undo, removes only my characters', () => {
    const { alice, bob } = pair((client) => {
      createNode(client.context, { id: 'n', type: 'rect', pos: [0, 0], label: 'X' });
    });
    editLabel(alice.context, 'n', 'XAAA');
    editLabel(bob.context, 'n', 'XBBB');
    syncPair(alice, bob);
    expect(['XAAABBB', 'XBBBAAA']).toContain(node(alice, 'n')?.label);
    alice.history.undo();
    expect(node(alice, 'n')?.label).toBe('XBBB');
    expectConverged(alice, bob);
    expect(bob.history.undo()).toBe(true);
    expectConverged(alice, bob);
    expect(node(alice, 'n')?.label).toBe('X');
  });

  it('8. undo and redo after a reconnect merge work on my own edits only', () => {
    const { alice, bob } = pair(singleNode);
    moveNodes(alice.context, [{ id: 'n', pos: [10, 10] }]);
    setStyle(alice.context, ['n'], { fill: '#abcdef' });
    editLabel(bob.context, 'n', 'Pump 9');
    createNode(bob.context, { id: 'm', type: 'ellipse', pos: [50, 50] });
    syncPair(alice, bob);
    expect(alice.history.undo()).toBe(true);
    expect(node(alice, 'n')).toMatchObject({ pos: [10, 10], style: {}, label: 'Pump 9' });
    expect(alice.history.undo()).toBe(true);
    expect(node(alice, 'n')).toMatchObject({ pos: [0, 0], label: 'Pump 9' });
    expect(alice.history.redo()).toBe(true);
    expect(alice.history.redo()).toBe(true);
    expect(node(alice, 'n')).toMatchObject({
      pos: [10, 10],
      style: { fill: '#abcdef' },
      label: 'Pump 9',
    });
    expect(node(alice, 'm')).toBeDefined();
    expectConverged(alice, bob);
  });
});

describe('History: gestures', () => {
  it('makes a whole drag one undo step', () => {
    const { alice } = pair(singleNode);
    const gesture = alice.history.beginGesture();
    for (let step = 1; step <= 30; step += 1) {
      translateNodes(alice.context, ['n'], 2, 1);
    }
    gesture.end();
    expect(node(alice, 'n')?.pos).toEqual([60, 30]);
    expect(alice.history.state.undoDepth).toBe(1);
    alice.history.undo();
    expect(node(alice, 'n')?.pos).toEqual([0, 0]);
    expect(alice.history.canUndo).toBe(false);
    alice.history.redo();
    expect(node(alice, 'n')?.pos).toEqual([60, 30]);
  });

  it('keeps two gestures in a row apart', () => {
    const { alice } = pair(singleNode);
    alice.history.run(() => {
      translateNodes(alice.context, ['n'], 10, 0);
      translateNodes(alice.context, ['n'], 10, 0);
    });
    alice.history.run(() => {
      translateNodes(alice.context, ['n'], 0, 5);
    });
    expect(alice.history.state.undoDepth).toBe(2);
    alice.history.undo();
    expect(node(alice, 'n')?.pos).toEqual([20, 0]);
    alice.history.undo();
    expect(node(alice, 'n')?.pos).toEqual([0, 0]);
  });

  it('makes every local command outside a gesture its own step', () => {
    const { alice } = pair(singleNode);
    translateNodes(alice.context, ['n'], 1, 0);
    translateNodes(alice.context, ['n'], 1, 0);
    translateNodes(alice.context, ['n'], 1, 0);
    expect(alice.history.state.undoDepth).toBe(3);
  });

  it('makes a label editing session one step', () => {
    const { alice } = pair(singleNode);
    alice.history.run(() => {
      for (const text of ['Pump 1', 'Pump 12', 'Pump 123']) editLabel(alice.context, 'n', text);
    });
    expect(alice.history.state.undoDepth).toBe(1);
    alice.history.undo();
    expect(node(alice, 'n')?.label).toBe('Pump');
  });

  it('returns the value of run and closes the gesture when the work throws', () => {
    const { alice } = pair(singleNode);
    expect(alice.history.run(() => 42)).toBe(42);
    expect(() =>
      alice.history.run(() => {
        translateNodes(alice.context, ['n'], 1, 1);
        throw new Error('pointer lost');
      }),
    ).toThrow('pointer lost');
    translateNodes(alice.context, ['n'], 1, 1);
    expect(alice.history.state.undoDepth).toBe(2);
  });

  it('keeps writes together while any nested gesture is open and ends one only once', () => {
    const { alice } = pair(singleNode);
    const outer = alice.history.beginGesture();
    const inner = alice.history.beginGesture();
    translateNodes(alice.context, ['n'], 1, 0);
    inner.end();
    inner.end();
    translateNodes(alice.context, ['n'], 1, 0);
    outer.end();
    expect(alice.history.state.undoDepth).toBe(1);
  });

  it('puts a gesture that spans several kinds of change on one step', () => {
    const { alice } = pair(singleNode);
    alice.history.run(() => {
      moveNodes(alice.context, [{ id: 'n', pos: [5, 5] }]);
      setStyle(alice.context, ['n'], { fill: '#fff' });
      createNode(alice.context, { id: 'copy', type: 'rect', pos: [9, 9] });
    });
    alice.history.undo();
    expect(deriveGraph(alice.doc).nodes.map((entry) => entry.id)).toEqual(['n']);
    expect(node(alice, 'n')).toMatchObject({ pos: [0, 0], style: {} });
  });
});

describe('History: state and lifecycle', () => {
  it('reports depth and availability and notifies on every change', () => {
    const { alice } = pair(singleNode);
    const states: HistoryState[] = [];
    alice.history.subscribe((state) => states.push(state));
    translateNodes(alice.context, ['n'], 1, 0);
    alice.history.undo();
    alice.history.redo();
    alice.history.undo();
    expect(states.at(0)).toMatchObject({ canUndo: true, canRedo: false, undoDepth: 1 });
    expect(states.at(-1)).toMatchObject({ canUndo: false, canRedo: true, redoDepth: 1 });
    expect(states.length).toBeGreaterThanOrEqual(4);
  });

  it('drops the redo stack after a new local edit', () => {
    const { alice } = pair(singleNode);
    translateNodes(alice.context, ['n'], 1, 0);
    alice.history.undo();
    expect(alice.history.canRedo).toBe(true);
    translateNodes(alice.context, ['n'], 0, 1);
    expect(alice.history.canRedo).toBe(false);
    expect(alice.history.redo()).toBe(false);
  });

  it('answers false when there is nothing to undo or redo', () => {
    const alice = createClient(1);
    expect(alice.history.undo()).toBe(false);
    expect(alice.history.redo()).toBe(false);
  });

  it('clears both stacks', () => {
    const { alice } = pair(singleNode);
    translateNodes(alice.context, ['n'], 1, 0);
    alice.history.undo();
    alice.history.clear();
    expect(alice.history.state).toEqual({
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
    });
  });

  it('stops listeners and tracking after destroy', () => {
    const alice = createClient(1);
    const seen: HistoryState[] = [];
    const unsubscribe = alice.history.subscribe((state) => seen.push(state));
    createNode(alice.context, { type: 'rect', pos: [0, 0] });
    unsubscribe();
    createNode(alice.context, { type: 'rect', pos: [0, 0] });
    expect(seen).toHaveLength(1);
    alice.history.destroy();
    createNode(alice.context, { type: 'rect', pos: [0, 0] });
    expect(alice.history.canUndo).toBe(true);
    expect(alice.history.state.undoDepth).toBe(2);
  });

  it('uses the origin it was given and lets two histories share a document without sharing steps', () => {
    const doc = new Y.Doc();
    const first = new History(doc, { origin: { who: 'first' } });
    const second = new History(doc);
    const random = () => 0.5;
    createNode(first.context(random), { id: 'a', type: 'rect', pos: [0, 0] });
    expect(first.canUndo).toBe(true);
    expect(second.canUndo).toBe(false);
  });
});
