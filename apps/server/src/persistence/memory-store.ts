import { foldIntoSnapshot, totalBytes } from './fold';
import type { CompactionResult, DocumentStore, StoredRoom } from './store';

interface LogRow {
  readonly seq: number;
  readonly update: Uint8Array;
}

interface RoomRecord {
  snapshot: Uint8Array | undefined;
  upToSeq: number;
  nextSeq: number;
  log: LogRow[];
}

export class MemoryStore implements DocumentStore {
  private readonly rooms = new Map<string, RoomRecord>();

  load(roomId: string): Promise<StoredRoom> {
    const record = this.rooms.get(roomId);
    if (record === undefined) {
      return Promise.resolve({ snapshot: undefined, updates: [], logRows: 0, logBytes: 0 });
    }
    const updates = record.log.map((row) => row.update.slice());
    return Promise.resolve({
      snapshot: record.snapshot?.slice(),
      updates,
      logRows: updates.length,
      logBytes: totalBytes(updates),
    });
  }

  append(roomId: string, update: Uint8Array): Promise<void> {
    const record = this.recordFor(roomId);
    record.log.push({ seq: record.nextSeq, update: update.slice() });
    record.nextSeq += 1;
    return Promise.resolve();
  }

  compact(roomId: string): Promise<CompactionResult | undefined> {
    const record = this.rooms.get(roomId);
    if (record === undefined || record.log.length === 0) return Promise.resolve(undefined);
    const rows = record.log;
    const updates = rows.map((row) => row.update);
    const logBytes = totalBytes(updates);
    const previousSnapshotBytes = record.snapshot?.byteLength ?? 0;
    const snapshot = foldIntoSnapshot(record.snapshot, updates);
    const last = rows[rows.length - 1];
    record.snapshot = snapshot;
    record.upToSeq = last?.seq ?? record.upToSeq;
    record.log = record.log.filter((row) => row.seq > record.upToSeq);
    return Promise.resolve({
      rows: rows.length,
      logBytes,
      previousSnapshotBytes,
      snapshotBytes: snapshot.byteLength,
    });
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  private recordFor(roomId: string): RoomRecord {
    const existing = this.rooms.get(roomId);
    if (existing !== undefined) return existing;
    const created: RoomRecord = { snapshot: undefined, upToSeq: 0, nextSeq: 1, log: [] };
    this.rooms.set(roomId, created);
    return created;
  }
}
