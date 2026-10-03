import {
  CLOSE_UNAUTHORIZED,
  type Authenticator,
  type Clock,
  type TimerHandle,
  type Transport,
} from '@coschema/sync';
import type { TokenVerifier } from '../auth';
import { describeError, type Logger } from '../logger';
import type { Metrics } from '../metrics';
import type { DocumentStore } from '../persistence/store';
import { Room, type RoomSettings } from './room';

const CLOSE_GOING_AWAY = 1001;
const CLOSE_TRY_AGAIN_LATER = 1013;

export interface RoomManagerOptions {
  readonly store: DocumentStore;
  readonly clock: Clock;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly verifyToken: TokenVerifier;
  readonly idleMs: number;
  readonly settings: RoomSettings;
}

export interface ShutdownSummary {
  readonly rooms: number;
  readonly failed: number;
}

class RoomEntry {
  attached = 0;
  idleTimer: TimerHandle | undefined;
  closing: Promise<void> | undefined;
  room: Room | undefined;
  readonly loading: Promise<Room>;

  constructor(load: () => Promise<Room>) {
    this.loading = load().then((room) => {
      this.room = room;
      return room;
    });
  }
}

export class RoomManager {
  private readonly entries = new Map<string, RoomEntry>();
  private connections = 0;
  private draining = false;

  constructor(private readonly options: RoomManagerOptions) {
    options.metrics.setGauge('rooms', () => this.entries.size);
    options.metrics.setGauge('connections', () => this.connections);
  }

  get roomCount(): number {
    return this.entries.size;
  }

  get connectionCount(): number {
    return this.connections;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  async join(roomId: string, transport: Transport): Promise<void> {
    if (this.draining) {
      transport.close(CLOSE_GOING_AWAY, 'server shutting down');
      return;
    }
    for (;;) {
      const entry = this.entries.get(roomId);
      if (entry?.closing === undefined) {
        await this.attach(entry ?? this.create(roomId), roomId, transport);
        return;
      }
      await entry.closing;
    }
  }

  async shutdown(): Promise<ShutdownSummary> {
    this.draining = true;
    const entries = [...this.entries.values()];
    for (const entry of entries) this.cancelIdle(entry);
    const results = await Promise.allSettled(entries.map((entry) => this.shutdownEntry(entry)));
    this.entries.clear();
    return {
      rooms: entries.length,
      failed: results.filter((result) => result.status === 'rejected').length,
    };
  }

  private async shutdownEntry(entry: RoomEntry): Promise<void> {
    if (entry.closing !== undefined) {
      await entry.closing;
      return;
    }
    const room = await entry.loading;
    await room.shutdown();
  }

  private create(roomId: string): RoomEntry {
    const { store, clock, metrics, logger, verifyToken, settings } = this.options;
    const entry = new RoomEntry(() =>
      Room.load(roomId, {
        store,
        clock,
        metrics,
        logger,
        settings,
        authenticate:
          (room): Authenticator =>
          (token) =>
            this.authenticate(verifyToken, token, room),
        onFailure: (room) => {
          this.evict(room);
        },
      }),
    );
    entry.loading.catch((error: unknown) => {
      logger.error('room failed to load', { room: roomId, ...describeError(error) });
      if (this.entries.get(roomId) === entry) this.entries.delete(roomId);
    });
    this.entries.set(roomId, entry);
    return entry;
  }

  private async authenticate(verify: TokenVerifier, token: string, room: string) {
    const result = await verify(token, room);
    if (!result.ok)
      this.options.logger.debug('authentication rejected', { room, reason: result.reason });
    return result;
  }

  private async attach(entry: RoomEntry, roomId: string, transport: Transport): Promise<void> {
    entry.attached += 1;
    this.connections += 1;
    this.options.metrics.increment('connections_total');
    this.cancelIdle(entry);
    let detached = false;
    const detach = (): void => {
      if (detached) return;
      detached = true;
      entry.attached -= 1;
      this.connections -= 1;
      if (entry.attached === 0) this.scheduleIdle(entry, roomId);
    };
    const unsubscribe = transport.onClose((code) => {
      if (code === CLOSE_UNAUTHORIZED) this.options.metrics.increment('auth_failures_total');
      detach();
    });
    let room: Room;
    try {
      room = await entry.loading;
    } catch {
      transport.close(CLOSE_TRY_AGAIN_LATER, 'room unavailable');
      return;
    }
    if (this.draining) {
      transport.close(CLOSE_GOING_AWAY, 'server shutting down');
      return;
    }
    if (room.hasFailed || this.entries.get(roomId) !== entry) {
      unsubscribe();
      detach();
      await this.join(roomId, transport);
      return;
    }
    room.accept(transport);
  }

  private scheduleIdle(entry: RoomEntry, roomId: string): void {
    if (this.draining || entry.closing !== undefined) return;
    this.cancelIdle(entry);
    entry.idleTimer = this.options.clock.setTimeout(() => {
      entry.idleTimer = undefined;
      this.unload(entry, roomId);
    }, this.options.idleMs);
  }

  private cancelIdle(entry: RoomEntry): void {
    if (entry.idleTimer === undefined) return;
    this.options.clock.clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }

  private unload(entry: RoomEntry, roomId: string): void {
    if (entry.attached > 0 || entry.closing !== undefined || this.draining) return;
    const { metrics, logger } = this.options;
    entry.closing = (async () => {
      try {
        const room = await entry.loading;
        await room.unload();
        metrics.increment('rooms_unloaded_total');
        logger.info('room unloaded', { room: roomId });
      } catch (error) {
        logger.error('room unload failed', { room: roomId, ...describeError(error) });
      } finally {
        if (this.entries.get(roomId) === entry) this.entries.delete(roomId);
      }
    })();
  }

  private evict(room: Room): void {
    const entry = this.entries.get(room.id);
    if (entry?.room !== room) return;
    this.cancelIdle(entry);
    this.entries.delete(room.id);
    room.shutdown().catch(() => undefined);
  }
}
