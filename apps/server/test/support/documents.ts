import * as Y from 'yjs';
import {
  History,
  createNode,
  deriveGraph,
  editLabel,
  moveNodes,
  type CommandContext,
  type RandomSource,
} from '@coschema/model';

function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export class Editor {
  readonly doc: Y.Doc;
  private readonly history: History;
  private readonly context: CommandContext;

  constructor(seed: number, doc = new Y.Doc()) {
    this.doc = doc;
    this.history = new History(doc);
    this.context = this.history.context(seededRandom(seed));
  }

  addNode(label: string, x = 0, y = 0): string {
    return createNode(this.context, { type: 'rect', pos: [x, y], label });
  }

  move(id: string, x: number, y: number): void {
    moveNodes(this.context, [{ id, pos: [x, y] }]);
  }

  relabel(id: string, text: string): void {
    editLabel(this.context, id, text);
  }

  get labels(): string[] {
    return deriveGraph(this.doc)
      .nodes.map((node) => node.label)
      .sort();
  }
}

export function graphOf(doc: Y.Doc): string {
  return JSON.stringify(deriveGraph(doc));
}

export function stateVectorKey(doc: Y.Doc): string {
  return JSON.stringify(
    [...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()].sort(
      ([left], [right]) => left - right,
    ),
  );
}
