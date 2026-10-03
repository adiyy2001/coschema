import type { Rect } from '@coschema/geometry';

interface SceneNode {
  readonly id: string;
  readonly rect: Rect;
}

export interface SceneEdge {
  readonly id: string;
  readonly source: string;
  readonly sourcePort: string;
  readonly target: string;
  readonly targetPort: string;
}

export interface Scene {
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  readonly bounds: Rect;
}

const PITCH_X = 240;
const PITCH_Y = 150;
const SIZES: readonly (readonly [number, number])[] = [
  [120, 64],
  [120, 72],
  [112, 84],
  [160, 64],
];

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateScene(nodeCount: number, seed: number): Scene {
  const next = mulberry32(seed);
  const columns = Math.max(2, Math.ceil(Math.sqrt(nodeCount * 1.6)));
  const nodes: SceneNode[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const [width, height] = SIZES[Math.floor(next() * SIZES.length)] ?? [120, 64];
    nodes.push({
      id: `n${index}`,
      rect: {
        x: column * PITCH_X + Math.floor(next() * 60) - 30,
        y: row * PITCH_Y + Math.floor(next() * 40) - 20,
        width,
        height,
      },
    });
  }
  const edges: SceneEdge[] = [];
  const connect = (from: number, to: number, sourcePort: string, targetPort: string): void => {
    if (to >= nodeCount) return;
    edges.push({
      id: `e${edges.length}`,
      source: `n${from}`,
      sourcePort,
      target: `n${to}`,
      targetPort,
    });
  };
  for (let index = 0; index < nodeCount; index += 1) {
    const column = index % columns;
    if (column < columns - 1 && next() < 0.8) connect(index, index + 1, 'e', 'w');
    if (next() < 0.6) connect(index, index + columns, 's', 'n');
    if (column < columns - 3 && next() < 0.1) connect(index, index + 3, 'e', 'w');
  }
  const rows = Math.ceil(nodeCount / columns);
  return {
    nodes,
    edges,
    bounds: { x: -30, y: -20, width: columns * PITCH_X + 160, height: rows * PITCH_Y + 100 },
  };
}
