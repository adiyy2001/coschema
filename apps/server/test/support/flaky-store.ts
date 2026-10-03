import { MemoryStore } from '../../src/persistence/memory-store';
import type { CompactionResult, StoredRoom } from '../../src/persistence/store';

export class FlakyStore extends MemoryStore {
  failLoad = false;
  failAppend = false;
  failCompact = false;
  compactGate: Promise<void> | undefined;
  readonly compactCalls: string[] = [];
  appendCount = 0;

  override async load(roomId: string): Promise<StoredRoom> {
    if (this.failLoad) throw new Error('database unreachable');
    return super.load(roomId);
  }

  override async append(roomId: string, update: Uint8Array): Promise<void> {
    if (this.failAppend) throw new Error('disk full');
    this.appendCount += 1;
    await super.append(roomId, update);
  }

  override async compact(roomId: string): Promise<CompactionResult | undefined> {
    this.compactCalls.push(roomId);
    if (this.compactGate !== undefined) await this.compactGate;
    if (this.failCompact) throw new Error('compaction failed');
    return super.compact(roomId);
  }
}
