import * as Y from 'yjs';
import {
  History,
  createGraphStore,
  type CommandContext,
  type GraphStore,
  type RandomSource,
} from '../src';

export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TestClient {
  readonly doc: Y.Doc;
  readonly history: History;
  readonly store: GraphStore;
  readonly context: CommandContext;
}

export const REMOTE_ORIGIN = { kind: 'remote' };

export function createClient(clientId: number, seed = clientId): TestClient {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const history = new History(doc);
  const store = createGraphStore(doc);
  const context = history.context(seededRandom(seed));
  return { doc, history, store, context };
}

export function pushUpdates(from: Y.Doc, to: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  Y.applyUpdate(to, update, REMOTE_ORIGIN);
}

export function syncPair(left: TestClient, right: TestClient): void {
  pushUpdates(left.doc, right.doc);
  pushUpdates(right.doc, left.doc);
}

export function syncAll(clients: readonly TestClient[]): void {
  for (let round = 0; round < 2; round += 1) {
    for (const from of clients) {
      for (const to of clients) {
        if (from !== to) pushUpdates(from.doc, to.doc);
      }
    }
  }
}

export function stateVectorOf(client: TestClient): string {
  return JSON.stringify(
    [...Y.decodeStateVector(Y.encodeStateVector(client.doc)).entries()].sort(
      (left, right) => left[0] - right[0],
    ),
  );
}

export function recordUpdates(doc: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => {
    updates.push(update);
  });
  return updates;
}

export function replica(updates: readonly Uint8Array[], clientId: number): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  for (const update of updates) Y.applyUpdate(doc, update, REMOTE_ORIGIN);
  return doc;
}
