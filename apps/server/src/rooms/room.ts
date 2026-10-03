import type { Authenticator, Clock, Transport } from '@coschema/sync';
import { RoomHub } from '@coschema/sync';
import { describeError, type Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { CompactionResult, DocumentStore } from '../persistence/store';
import { UpdateBatcher } from './batcher';

export interface RoomSettings {
  readonly batchMs: number;
  readonly batchMaxBytes: number;
  readonly compactRows: number;
  readonly compactBytes: number;
  readonly authTimeoutMs: number;
}

export interface RoomDependencies {
  readonly store: DocumentStore;
  readonly clock: Clock;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly settings: RoomSettings;
  readonly authenticate: (roomId: string) => Authenticator;
  readonly onFailure: (room: Room) => void;
}

class PersistenceLostError extends Error {
  constructor(roomId: string) {
    super(`updates of room ${roomId} could not be written`);
    this.name = 'PersistenceLostError';
  }
}

export class Room {
  private readonly batcher: UpdateBatcher;
  private readonly hub: RoomHub;
  private logRows: number;
  private logBytes: number;
  private compaction: Promise<void> | undefined;
  private failed = false;

  private constructor(
    readonly id: string,
    private readonly dependencies: RoomDependencies,
    logRows: number,
    logBytes: number,
  ) {
    this.logRows = logRows;
    this.logBytes = logBytes;
    const { settings, clock } = dependencies;
    this.batcher = new UpdateBatcher({
      clock,
      intervalMs: settings.batchMs,
      maxBytes: settings.batchMaxBytes,
      write: (update) => this.appendBatch(update),
    });
    this.hub = new RoomHub({
      clock,
      authenticate: dependencies.authenticate(id),
      authTimeoutMs: settings.authTimeoutMs,
      onUpdate: (update) => {
        dependencies.metrics.increment('updates_applied_total');
        return this.batcher.add(update);
      },
      onError: (error) => {
        this.reportHubError(error);
      },
    });
  }

  static async load(id: string, dependencies: RoomDependencies): Promise<Room> {
    const stored = await dependencies.store.load(id);
    const room = new Room(id, dependencies, stored.logRows, stored.logBytes);
    if (stored.snapshot !== undefined) room.hub.loadUpdate(stored.snapshot);
    for (const update of stored.updates) room.hub.loadUpdate(update);
    dependencies.metrics.increment('rooms_loaded_total');
    dependencies.logger.info('room loaded', {
      room: id,
      logRows: stored.logRows,
      snapshot: stored.snapshot !== undefined,
    });
    return room;
  }

  get hasFailed(): boolean {
    return this.failed;
  }

  get document(): RoomHub['doc'] {
    return this.hub.doc;
  }

  get pendingLogRows(): number {
    return this.logRows;
  }

  accept(transport: Transport): void {
    this.hub.accept(transport);
  }

  async shutdown(): Promise<void> {
    this.hub.destroy();
    await this.batcher.flush();
    await this.compaction;
    if (this.hub.hasPersistenceFailure) throw new PersistenceLostError(this.id);
  }

  async unload(): Promise<void> {
    this.hub.destroy();
    await this.batcher.flush();
    await this.compaction;
    if (this.hub.hasPersistenceFailure) throw new PersistenceLostError(this.id);
    await this.compactNow();
  }

  async compactNow(): Promise<CompactionResult | undefined> {
    const { store, metrics, logger } = this.dependencies;
    const result = await store.compact(this.id);
    if (result === undefined) return undefined;
    this.logRows = Math.max(0, this.logRows - result.rows);
    this.logBytes = Math.max(0, this.logBytes - result.logBytes);
    metrics.increment('compactions_total');
    logger.info('room compacted', {
      room: this.id,
      rows: result.rows,
      logBytes: result.logBytes,
      previousSnapshotBytes: result.previousSnapshotBytes,
      snapshotBytes: result.snapshotBytes,
    });
    return result;
  }

  private async appendBatch(update: Uint8Array): Promise<void> {
    const { store, metrics } = this.dependencies;
    try {
      await store.append(this.id, update);
    } catch (error) {
      metrics.increment('persistence_errors_total');
      throw error;
    }
    this.logRows += 1;
    this.logBytes += update.byteLength;
    metrics.increment('batches_flushed_total');
    metrics.increment('bytes_persisted_total', update.byteLength);
    this.compactWhenDue();
  }

  private compactWhenDue(): void {
    const { settings, logger } = this.dependencies;
    if (this.compaction !== undefined || this.failed) return;
    if (this.logRows < settings.compactRows && this.logBytes < settings.compactBytes) return;
    this.compaction = this.compactNow()
      .then(() => undefined)
      .catch((error: unknown) => {
        logger.error('compaction failed', { room: this.id, ...describeError(error) });
      })
      .finally(() => {
        this.compaction = undefined;
      });
  }

  private reportHubError(error: unknown): void {
    const { logger } = this.dependencies;
    if (this.hub.hasPersistenceFailure && !this.failed) {
      this.failed = true;
      logger.error('persistence failed, evicting room', { room: this.id, ...describeError(error) });
      this.dependencies.onFailure(this);
      return;
    }
    logger.warn('connection error', { room: this.id, ...describeError(error) });
  }
}
