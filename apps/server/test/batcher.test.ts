import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { UpdateBatcher } from '../src/rooms/batcher';
import { Editor } from './support/documents';
import { ManualClock, settle } from './support/manual-clock';

function recordUpdates(editor: Editor): Uint8Array[] {
  const updates: Uint8Array[] = [];
  editor.doc.on('update', (update: Uint8Array) => updates.push(update));
  return updates;
}

describe('UpdateBatcher', () => {
  it('merges every update of a window into one write', async () => {
    const clock = new ManualClock();
    const writes: Uint8Array[] = [];
    const batcher = new UpdateBatcher({
      clock,
      intervalMs: 50,
      maxBytes: 1_000_000,
      write: (update) => {
        writes.push(update);
        return Promise.resolve();
      },
    });
    const editor = new Editor(1);
    const updates = recordUpdates(editor);
    const first = editor.addNode('a');
    editor.move(first, 5, 5);
    editor.addNode('b');
    const settled = updates.map((update) => batcher.add(update));
    await clock.advance(49);
    expect(writes).toHaveLength(0);
    await clock.advance(1);
    await Promise.all(settled);
    expect(writes).toHaveLength(1);
    const replica = new Y.Doc();
    Y.applyUpdate(replica, writes[0] ?? new Uint8Array());
    expect(Y.encodeStateVector(replica)).toEqual(Y.encodeStateVector(editor.doc));
  });

  it('starts a new window after the previous one was written', async () => {
    const clock = new ManualClock();
    const writes: Uint8Array[] = [];
    const batcher = new UpdateBatcher({
      clock,
      intervalMs: 50,
      maxBytes: 1_000_000,
      write: (update) => {
        writes.push(update);
        return Promise.resolve();
      },
    });
    const editor = new Editor(2);
    const updates = recordUpdates(editor);
    editor.addNode('a');
    const first = batcher.add(updates[0] ?? new Uint8Array());
    await clock.advance(50);
    await first;
    editor.addNode('b');
    const second = batcher.add(updates[1] ?? new Uint8Array());
    expect(batcher.hasPending).toBe(true);
    await clock.advance(50);
    await second;
    expect(writes).toHaveLength(2);
    expect(batcher.hasPending).toBe(false);
  });

  it('writes early when the batch is large', async () => {
    const clock = new ManualClock();
    const writes: Uint8Array[] = [];
    const batcher = new UpdateBatcher({
      clock,
      intervalMs: 50,
      maxBytes: 10,
      write: (update) => {
        writes.push(update);
        return Promise.resolve();
      },
    });
    const editor = new Editor(3);
    const updates = recordUpdates(editor);
    editor.addNode('a');
    await batcher.add(updates[0] ?? new Uint8Array());
    expect(writes).toHaveLength(1);
    expect(clock.pendingTimers).toBe(0);
  });

  it('flushes on demand and waits for the write', async () => {
    const clock = new ManualClock();
    let finished = false;
    const batcher = new UpdateBatcher({
      clock,
      intervalMs: 50,
      maxBytes: 1_000_000,
      write: async () => {
        await settle(2);
        finished = true;
      },
    });
    const editor = new Editor(4);
    const updates = recordUpdates(editor);
    editor.addNode('a');
    const settled = batcher.add(updates[0] ?? new Uint8Array());
    await batcher.flush();
    expect(finished).toBe(true);
    await settled;
    expect(clock.pendingTimers).toBe(0);
  });

  it('flushing with nothing pending resolves at once', async () => {
    const batcher = new UpdateBatcher({
      clock: new ManualClock(),
      intervalMs: 50,
      maxBytes: 1,
      write: () => Promise.resolve(),
    });
    await expect(batcher.flush()).resolves.toBeUndefined();
  });

  it('rejects every caller of a failed batch and recovers for the next one', async () => {
    const clock = new ManualClock();
    let failures = 1;
    const batcher = new UpdateBatcher({
      clock,
      intervalMs: 50,
      maxBytes: 1_000_000,
      write: () => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error('disk full'));
        }
        return Promise.resolve();
      },
    });
    const editor = new Editor(5);
    const updates = recordUpdates(editor);
    editor.addNode('a');
    editor.addNode('b');
    const first = batcher.add(updates[0] ?? new Uint8Array());
    const second = batcher.add(updates[1] ?? new Uint8Array());
    const outcomes = Promise.allSettled([first, second]);
    await clock.advance(50);
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    editor.addNode('c');
    const third = batcher.add(updates[2] ?? new Uint8Array());
    await clock.advance(50);
    await expect(third).resolves.toBeUndefined();
  });

  it('keeps writes in order when one is slow', async () => {
    const clock = new ManualClock();
    const order: number[] = [];
    let call = 0;
    const batcher = new UpdateBatcher({
      clock,
      intervalMs: 50,
      maxBytes: 1_000_000,
      write: async () => {
        call += 1;
        const mine = call;
        await settle(mine === 1 ? 10 : 1);
        order.push(mine);
      },
    });
    const editor = new Editor(6);
    const updates = recordUpdates(editor);
    editor.addNode('a');
    editor.addNode('b');
    const first = batcher.add(updates[0] ?? new Uint8Array());
    await clock.advance(50);
    const second = batcher.add(updates[1] ?? new Uint8Array());
    await clock.advance(50);
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  });
});
