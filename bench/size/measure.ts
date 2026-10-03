import { deriveGraph } from '@coschema/model';
import { gzipSync } from 'node:zlib';
import * as Y from 'yjs';
import type { DocumentStore } from '../../apps/server/src/persistence/store';
import { round } from '../lib/stats';
import { recordSession } from './session';

export const LOAD_REPEATS = 5;

export interface SizeMeasurement {
  readonly nodes: number;
  readonly edges: number;
  readonly updates: number;
  readonly before: { readonly rows: number; readonly bytes: number; readonly loadMs: number };
  readonly after: { readonly rows: number; readonly bytes: number; readonly loadMs: number };
  readonly encodedStateBytes: number;
  readonly encodedStateGzipBytes: number;
  readonly graphJsonBytes: number;
  readonly compactionMs: number;
  readonly bytesRatio: number;
  readonly loadedNodes: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function timedLoad(
  store: DocumentStore,
  room: string,
): Promise<{ loadMs: number; nodes: number; rows: number; bytes: number }> {
  const samples: number[] = [];
  let nodes = 0;
  let rows = 0;
  let bytes = 0;
  for (let run = 0; run < LOAD_REPEATS; run += 1) {
    const started = performance.now();
    const stored = await store.load(room);
    const doc = new Y.Doc();
    if (stored.snapshot !== undefined) Y.applyUpdate(doc, stored.snapshot);
    for (const update of stored.updates) Y.applyUpdate(doc, update);
    samples.push(performance.now() - started);
    nodes = deriveGraph(doc).nodes.length;
    rows = stored.updates.length + (stored.snapshot === undefined ? 0 : 1);
    bytes =
      stored.updates.reduce((total, update) => total + update.byteLength, 0) +
      (stored.snapshot?.byteLength ?? 0);
    doc.destroy();
  }
  return { loadMs: round(median(samples), 2), nodes, rows, bytes };
}

export async function measureSize(
  store: DocumentStore,
  nodeCount: number,
  seed: number,
): Promise<SizeMeasurement> {
  const session = recordSession(nodeCount, seed);
  const room = `size-${nodeCount}`;
  for (const update of session.updates) await store.append(room, update);
  const before = await timedLoad(store, room);
  const started = performance.now();
  const compaction = await store.compact(room);
  const compactionMs = round(performance.now() - started, 2);
  if (compaction === undefined) throw new Error('nothing was compacted');
  const after = await timedLoad(store, room);
  const encoded = Y.encodeStateAsUpdate(session.doc);
  const graphJson = JSON.stringify(deriveGraph(session.doc));
  return {
    nodes: session.nodes,
    edges: session.edges,
    updates: session.updates.length,
    before: { rows: before.rows, bytes: before.bytes, loadMs: before.loadMs },
    after: { rows: after.rows, bytes: after.bytes, loadMs: after.loadMs },
    encodedStateBytes: encoded.byteLength,
    encodedStateGzipBytes: gzipSync(encoded).byteLength,
    graphJsonBytes: Buffer.byteLength(graphJson),
    compactionMs,
    bytesRatio: round(before.bytes / after.bytes, 2),
    loadedNodes: after.nodes,
  };
}
