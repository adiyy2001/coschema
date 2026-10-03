import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/persistence/memory-store';
import { Editor, graphOf, stateVectorKey } from './support/documents';

function collect(editor: Editor): Uint8Array[] {
  const updates: Uint8Array[] = [];
  editor.doc.on('update', (update: Uint8Array) => updates.push(update));
  return updates;
}

function replay(snapshot: Uint8Array | undefined, updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot !== undefined) Y.applyUpdate(doc, snapshot);
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

describe('MemoryStore', () => {
  it('loads an unknown room as empty', async () => {
    const stored = await new MemoryStore().load('nothing');
    expect(stored).toEqual({ snapshot: undefined, updates: [], logRows: 0, logBytes: 0 });
  });

  it('loads what was appended, in order, as copies', async () => {
    const store = new MemoryStore();
    const editor = new Editor(1);
    const updates = collect(editor);
    editor.addNode('a');
    editor.addNode('b');
    for (const update of updates) await store.append('room', update);
    const stored = await store.load('room');
    expect(stored.logRows).toBe(2);
    expect(stored.logBytes).toBe(updates.reduce((sum, update) => sum + update.length, 0));
    stored.updates[0]?.fill(0);
    const again = await store.load('room');
    expect(graphOf(replay(again.snapshot, again.updates))).toBe(graphOf(editor.doc));
  });

  it('keeps rooms apart', async () => {
    const store = new MemoryStore();
    const editor = new Editor(2);
    const updates = collect(editor);
    editor.addNode('a');
    await store.append('one', updates[0] ?? new Uint8Array());
    expect((await store.load('two')).logRows).toBe(0);
  });

  it('compacts the log into a snapshot without changing the document', async () => {
    const store = new MemoryStore();
    const editor = new Editor(3);
    const updates = collect(editor);
    const id = editor.addNode('start');
    for (let step = 0; step < 40; step += 1) editor.move(id, step, step);
    editor.relabel(id, 'renamed');
    for (const update of updates) await store.append('room', update);
    const before = await store.load('room');
    const result = await store.compact('room');
    expect(result?.rows).toBe(before.logRows);
    expect(result?.snapshotBytes).toBeLessThan(result?.logBytes ?? 0);
    const after = await store.load('room');
    expect(after.logRows).toBe(0);
    expect(after.snapshot).toBeDefined();
    const restored = replay(after.snapshot, after.updates);
    expect(stateVectorKey(restored)).toBe(stateVectorKey(editor.doc));
    expect(graphOf(restored)).toBe(graphOf(editor.doc));
  });

  it('keeps appends that arrive after a compaction and compacts them next time', async () => {
    const store = new MemoryStore();
    const editor = new Editor(4);
    const updates = collect(editor);
    editor.addNode('a');
    await store.append('room', updates[0] ?? new Uint8Array());
    await store.compact('room');
    editor.addNode('b');
    await store.append('room', updates[1] ?? new Uint8Array());
    const loaded = await store.load('room');
    expect(loaded.logRows).toBe(1);
    const second = await store.compact('room');
    expect(second?.previousSnapshotBytes).toBeGreaterThan(0);
    const final = await store.load('room');
    expect(graphOf(replay(final.snapshot, final.updates))).toBe(graphOf(editor.doc));
  });

  it('has nothing to compact for an empty log', async () => {
    const store = new MemoryStore();
    expect(await store.compact('missing')).toBeUndefined();
    const editor = new Editor(5);
    const updates = collect(editor);
    editor.addNode('a');
    await store.append('room', updates[0] ?? new Uint8Array());
    await store.compact('room');
    expect(await store.compact('room')).toBeUndefined();
  });

  it('answers ping and close', async () => {
    const store = new MemoryStore();
    await expect(store.ping()).resolves.toBeUndefined();
    await expect(store.close()).resolves.toBeUndefined();
  });
});
