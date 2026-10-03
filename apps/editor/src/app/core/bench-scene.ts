import { NODE_TYPES, connect, createNode, type CommandContext } from '@coschema/model';
import type { DocumentSeed } from './document-session';

const PITCH_X = 240;
const PITCH_Y = 150;
const SIZES: readonly (readonly [number, number])[] = [
  [120, 64],
  [120, 72],
  [112, 84],
  [160, 64],
];
const DEFAULT_SEED = 20261003;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function benchSeed(nodeCount: number, seed = DEFAULT_SEED): DocumentSeed {
  return (context: CommandContext) => {
    const next = mulberry32(seed);
    const columns = Math.max(2, Math.ceil(Math.sqrt(nodeCount * 1.6)));
    context.doc.transact(() => {
      for (let index = 0; index < nodeCount; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const size = SIZES[Math.floor(next() * SIZES.length)] ?? [120, 64];
        createNode(context, {
          id: `n${index}`,
          type: NODE_TYPES[index % NODE_TYPES.length] ?? 'rect',
          pos: [
            column * PITCH_X + Math.floor(next() * 60) - 30,
            row * PITCH_Y + Math.floor(next() * 40) - 20,
          ],
          size,
          label: `Node ${index}`,
        });
      }
      let edgeCount = 0;
      const link = (
        from: number,
        to: number,
        sourcePort: 'e' | 's',
        targetPort: 'w' | 'n',
      ): void => {
        if (to >= nodeCount) return;
        connect(context, {
          id: `e${edgeCount}`,
          source: `n${from}`,
          target: `n${to}`,
          sourcePort,
          targetPort,
        });
        edgeCount += 1;
      };
      for (let index = 0; index < nodeCount; index += 1) {
        const column = index % columns;
        if (column < columns - 1 && next() < 0.8) link(index, index + 1, 'e', 'w');
        if (next() < 0.6) link(index, index + columns, 's', 'n');
        if (column < columns - 3 && next() < 0.1) link(index, index + 3, 'e', 'w');
      }
    }, context.origin);
  };
}
