export interface StoredRoom {
  readonly snapshot: Uint8Array | undefined;
  readonly updates: readonly Uint8Array[];
  readonly logRows: number;
  readonly logBytes: number;
}

export interface CompactionResult {
  readonly rows: number;
  readonly logBytes: number;
  readonly previousSnapshotBytes: number;
  readonly snapshotBytes: number;
}

export interface DocumentStore {
  load(roomId: string): Promise<StoredRoom>;
  append(roomId: string, update: Uint8Array): Promise<void>;
  compact(roomId: string): Promise<CompactionResult | undefined>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
