import {
  deriveGraph,
  findViolations,
  getNodes,
  initializeDocument,
  type CommandContext,
} from '@coschema/model';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../testing/seeded-random';
import { starterDiagram } from '../core/starter-diagram';
import { applyMess, type MessTarget } from './mess';

function replica(random: () => number, origin: string): { doc: Y.Doc; target: MessTarget } {
  const doc = new Y.Doc();
  const context: CommandContext = { doc, origin, random };
  return {
    doc,
    target: {
      context,
      nodeIds: () => [...getNodes(doc).keys()],
      labelOf: (id) => deriveGraph(doc).nodes.find((node) => node.id === id)?.label,
    },
  };
}

function exchange(left: Y.Doc, right: Y.Doc): void {
  const toRight = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
  const toLeft = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
  Y.applyUpdate(right, toRight);
  Y.applyUpdate(left, toLeft);
}

describe('applyMess', () => {
  it('edits the same nodes on both sides and the replicas still converge', () => {
    const ada = replica(seededRandom(1), 'ada');
    initializeDocument(ada.doc);
    starterDiagram(ada.target.context);
    const bruno = replica(seededRandom(2), 'bruno');
    exchange(ada.doc, bruno.doc);
    expect(getNodes(bruno.doc).size).toBe(7);
    const adaEdits = applyMess(ada.target, 'Ada', seededRandom(3));
    const brunoEdits = applyMess(bruno.target, 'Bruno', seededRandom(4));
    expect(adaEdits).toBe(3);
    expect(brunoEdits).toBe(3);
    exchange(ada.doc, bruno.doc);
    expect(getNodes(ada.doc).size).toBe(9);
    expect(Y.encodeStateAsUpdate(ada.doc)).toEqual(Y.encodeStateAsUpdate(bruno.doc));
    expect(findViolations(deriveGraph(ada.doc))).toEqual([]);
    const labels = deriveGraph(ada.doc).nodes.map((node) => node.label);
    expect(labels.some((label) => label.includes('Ada'))).toBe(true);
    expect(labels.some((label) => label.includes('Bruno'))).toBe(true);
  });

  it('does nothing to nodes that are not there and still adds a node', () => {
    const lone = replica(seededRandom(5), 'lone');
    initializeDocument(lone.doc);
    expect(applyMess(lone.target, 'Solo', seededRandom(6))).toBe(1);
    expect(getNodes(lone.doc).size).toBe(1);
  });
});
