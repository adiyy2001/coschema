import {
  History,
  connect,
  createGraphStore,
  createNode,
  deleteEdges,
  deleteNodes,
  editLabel,
  moveNodes,
  resizeNode,
  setStyle,
  type GraphDelta,
  type GraphNode,
  type NodeId,
} from '@coschema/model';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../testing/seeded-random';
import type { ChangeNote } from './announcer';
import { describeDelta, nodeName, shapeName } from './describe-change';

function setup() {
  const doc = new Y.Doc();
  const history = new History(doc);
  const store = createGraphStore(doc);
  const context = history.context(seededRandom(7));
  const deltas: GraphDelta[] = [];
  store.subscribe((delta) => deltas.push(delta));
  const describe = (index = deltas.length - 1): ChangeNote[] =>
    describeDelta(deltas[index] as GraphDelta, {
      actor: 'Anna',
      at: 7,
      lookupNode: (id: NodeId): GraphNode | undefined => store.getNode(id),
    });
  return { context, deltas, describe };
}

describe('nodeName', () => {
  it('uses the label, trimmed and collapsed', () => {
    expect(nodeName({ label: '  Pump   3 ', type: 'rect' })).toBe('Pump 3');
  });

  it('shortens a very long label', () => {
    const name = nodeName({ label: 'x'.repeat(100), type: 'rect' });
    expect(name).toHaveLength(40);
    expect(name.endsWith('…')).toBe(true);
  });

  it('names an unlabelled node after its shape', () => {
    expect(nodeName({ label: '', type: 'rounded' })).toBe('unnamed rounded rectangle');
    expect(shapeName('diamond')).toBe('diamond');
    expect(shapeName('ellipse')).toBe('ellipse');
  });
});

describe('describeDelta', () => {
  it('describes a created node', () => {
    const { context, describe } = setup();
    const id = createNode(context, { type: 'rect', pos: [0, 0], label: 'Pump 3' });
    expect(describe()).toEqual([
      { actor: 'Anna', kind: 'added', at: 7, subjects: [{ id, name: 'Pump 3' }] },
    ]);
  });

  it('describes a move, a rename and a style change separately', () => {
    const { context, describe } = setup();
    const id = createNode(context, { type: 'rect', pos: [0, 0], label: 'Pump 2' });
    moveNodes(context, [{ id, pos: [24, 0] }]);
    expect(describe().map((entry) => [entry.kind, entry.subjects[0]?.name])).toEqual([
      ['moved', 'Pump 2'],
    ]);
    editLabel(context, id, 'Pump 3');
    const [renamed] = describe();
    expect(renamed?.kind).toBe('renamed');
    expect(renamed?.subjects[0]).toEqual({ id, name: 'Pump 3', previousName: 'Pump 2' });
    setStyle(context, [id], { fill: '#ffffff' });
    expect(describe().map((entry) => entry.kind)).toEqual(['restyled']);
    resizeNode(context, id, { size: [200, 80] });
    expect(describe().map((entry) => entry.kind)).toEqual(['restyled']);
  });

  it('describes a deleted node by its last label and skips the edges that went with it', () => {
    const { context, describe } = setup();
    const a = createNode(context, { type: 'rect', pos: [0, 0], label: 'A' });
    const b = createNode(context, { type: 'rect', pos: [200, 0], label: 'B' });
    connect(context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    deleteNodes(context, [b]);
    const notes = describe();
    expect(
      notes.map((entry) => [entry.kind, entry.subjects.map((subject) => subject.name)]),
    ).toEqual([['deleted', ['B']]]);
  });

  it('describes a connection with the names of both ends', () => {
    const { context, describe } = setup();
    const a = createNode(context, { type: 'rect', pos: [0, 0], label: 'Pump 1' });
    const b = createNode(context, { type: 'ellipse', pos: [200, 0] });
    connect(context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    expect(describe()[0]?.subjects[0]?.name).toBe('Pump 1 to unnamed ellipse');
  });

  it('describes a removed connection', () => {
    const { context, describe } = setup();
    const a = createNode(context, { type: 'rect', pos: [0, 0] });
    const b = createNode(context, { type: 'rect', pos: [200, 0] });
    const edge = connect(context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    deleteEdges(context, [edge ?? '']);
    expect(describe().map((entry) => entry.kind)).toEqual(['disconnected']);
  });

  it('reports nothing for a node the delta has no previous record of', () => {
    const { context, deltas } = setup();
    const id = createNode(context, { type: 'rect', pos: [0, 0] });
    moveNodes(context, [{ id, pos: [5, 5] }]);
    const delta = deltas[1] as GraphDelta;
    const stripped: GraphDelta = { ...delta, previousNodes: new Map() };
    const notes = describeDelta(stripped, { actor: 'Anna', at: 0, lookupNode: () => undefined });
    expect(notes).toEqual([]);
  });

  it('falls back to a generic name when an endpoint is unknown', () => {
    const { context, deltas } = setup();
    const a = createNode(context, { type: 'rect', pos: [0, 0] });
    const b = createNode(context, { type: 'rect', pos: [200, 0] });
    connect(context, { source: a, target: b, sourcePort: 'e', targetPort: 'w' });
    const notes = describeDelta(deltas[deltas.length - 1] as GraphDelta, {
      actor: 'Anna',
      at: 0,
      lookupNode: () => undefined,
    });
    expect(notes[0]?.subjects[0]?.name).toBe('a node to a node');
  });
});
