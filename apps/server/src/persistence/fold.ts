import * as Y from 'yjs';

export function foldIntoSnapshot(
  snapshot: Uint8Array | undefined,
  updates: readonly Uint8Array[],
): Uint8Array {
  const doc = new Y.Doc();
  try {
    if (snapshot !== undefined) Y.applyUpdate(doc, snapshot);
    doc.transact(() => {
      for (const update of updates) Y.applyUpdate(doc, update);
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

export function totalBytes(updates: readonly Uint8Array[]): number {
  let total = 0;
  for (const update of updates) total += update.byteLength;
  return total;
}
