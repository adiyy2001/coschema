import type { RandomSource } from '@coschema/model';
import {
  CLOSE_ABNORMAL,
  CLOSE_NORMAL,
  Emitter,
  type Clock,
  type Transport,
  type Unsubscribe,
} from '@coschema/sync';
import { LINK_PROFILES, validateLinkConfig, type LinkConfig } from './config';

export type LinkDirection = 'up' | 'down';

export type LinkEventKind =
  | 'open'
  | 'close'
  | 'send'
  | 'deliver'
  | 'duplicate'
  | 'drop-loss'
  | 'drop-partition'
  | 'drop-offline'
  | 'drop-closed';

export interface LinkEvent {
  readonly time: number;
  readonly kind: LinkEventKind;
  readonly direction: LinkDirection;
  readonly bytes: Uint8Array | undefined;
}

export interface LinkStats {
  sent: number;
  delivered: number;
  duplicated: number;
  droppedByLoss: number;
  droppedByPartition: number;
  droppedByOffline: number;
  droppedBecauseClosed: number;
  connects: number;
}

export interface SimulatedLinkOptions {
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly accept: (transport: Transport) => void;
  readonly config?: LinkConfig;
  readonly onEvent?: (event: LinkEvent) => void;
}

class LinkEnd implements Transport {
  closed = false;
  opened = false;
  peer: LinkEnd | undefined;
  private readonly openEvents = new Emitter<[]>();
  private readonly messageEvents = new Emitter<[Uint8Array]>();
  private readonly closeEvents = new Emitter<[number, string]>();

  constructor(
    private readonly link: SimulatedLink,
    readonly direction: LinkDirection,
  ) {}

  send(data: Uint8Array): void {
    this.link.transmit(this, data);
  }

  close(code = CLOSE_NORMAL, reason = ''): void {
    this.link.closeFrom(this, code, reason);
  }

  onOpen(handler: () => void): Unsubscribe {
    return this.openEvents.subscribe(handler);
  }

  onMessage(handler: (data: Uint8Array) => void): Unsubscribe {
    return this.messageEvents.subscribe(handler);
  }

  onClose(handler: (code: number, reason: string) => void): Unsubscribe {
    return this.closeEvents.subscribe(handler);
  }

  emitOpen(): void {
    if (this.closed || this.opened) return;
    this.opened = true;
    this.openEvents.emit();
  }

  emitMessage(data: Uint8Array): void {
    this.messageEvents.emit(data);
  }

  emitClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeEvents.emit(code, reason);
  }
}

interface LinkConnection {
  readonly client: LinkEnd;
  readonly server: LinkEnd;
}

export class SimulatedLink {
  readonly stats: LinkStats = {
    sent: 0,
    delivered: 0,
    duplicated: 0,
    droppedByLoss: 0,
    droppedByPartition: 0,
    droppedByOffline: 0,
    droppedBecauseClosed: 0,
    connects: 0,
  };
  private config: LinkConfig;
  private isOffline = false;
  private isPartitioned = false;
  private readonly connections = new Set<LinkConnection>();
  private readonly heldNotifications: (() => void)[] = [];

  constructor(private readonly options: SimulatedLinkOptions) {
    this.config = validateLinkConfig(options.config ?? LINK_PROFILES.clean);
  }

  get currentConfig(): LinkConfig {
    return this.config;
  }

  get offline(): boolean {
    return this.isOffline;
  }

  get partitioned(): boolean {
    return this.isPartitioned;
  }

  get openConnectionCount(): number {
    return this.connections.size;
  }

  configure(config: LinkConfig): void {
    this.config = validateLinkConfig(config);
  }

  setPartitioned(partitioned: boolean): void {
    if (this.isPartitioned === partitioned) return;
    this.isPartitioned = partitioned;
    if (!partitioned) this.releaseHeldNotifications();
  }

  setOffline(offline: boolean): void {
    if (this.isOffline === offline) return;
    this.isOffline = offline;
    if (!offline) {
      this.releaseHeldNotifications();
      return;
    }
    for (const connection of [...this.connections]) {
      this.finish(connection, CLOSE_ABNORMAL, 'offline', connection.client);
    }
  }

  connect(): Transport {
    this.stats.connects += 1;
    const connection: LinkConnection = {
      client: new LinkEnd(this, 'up'),
      server: new LinkEnd(this, 'down'),
    };
    connection.client.peer = connection.server;
    connection.server.peer = connection.client;
    if (this.isOffline) {
      this.later(0, () => {
        connection.client.emitClose(CLOSE_ABNORMAL, 'offline');
      });
      return connection.client;
    }
    this.connections.add(connection);
    this.later(this.travelTime(), () => {
      if (this.blocked() || connection.client.closed) return;
      this.options.accept(connection.server);
      this.later(this.travelTime(), () => {
        if (this.blocked() || connection.client.closed) return;
        this.emit('open', 'down', undefined);
        connection.client.emitOpen();
      });
    });
    return connection.client;
  }

  closeAll(): void {
    for (const connection of [...this.connections]) {
      this.finish(connection, CLOSE_NORMAL, 'link closed', connection.client);
    }
  }

  transmit(from: LinkEnd, data: Uint8Array): void {
    const direction = from.direction;
    if (from.closed) {
      this.stats.droppedBecauseClosed += 1;
      this.emit('drop-closed', direction, data);
      return;
    }
    this.stats.sent += 1;
    this.emit('send', direction, data);
    if (this.isOffline) {
      this.stats.droppedByOffline += 1;
      this.emit('drop-offline', direction, data);
      return;
    }
    if (this.isPartitioned) {
      this.stats.droppedByPartition += 1;
      this.emit('drop-partition', direction, data);
      return;
    }
    const random = this.options.random;
    if (random() < this.config.lossRate) {
      this.stats.droppedByLoss += 1;
      this.emit('drop-loss', direction, data);
      return;
    }
    const copy = data.slice();
    this.later(this.messageDelay(), () => {
      this.arrive(from, copy);
    });
    if (random() < this.config.duplicateRate) {
      this.stats.duplicated += 1;
      this.emit('duplicate', direction, data);
      this.later(this.messageDelay() + this.travelTime(), () => {
        this.arrive(from, copy);
      });
    }
  }

  closeFrom(end: LinkEnd, code: number, reason: string): void {
    if (end.closed) return;
    const connection = [...this.connections].find(
      (candidate) => candidate.client === end || candidate.server === end,
    );
    if (connection === undefined) {
      end.emitClose(code, reason);
      return;
    }
    this.finish(connection, code, reason, end);
  }

  private finish(
    connection: LinkConnection,
    code: number,
    reason: string,
    initiator: LinkEnd,
  ): void {
    this.connections.delete(connection);
    const other = initiator === connection.client ? connection.server : connection.client;
    this.emit('close', initiator.direction, undefined);
    this.later(0, () => {
      initiator.emitClose(code, reason);
    });
    const notify = (): void => {
      other.emitClose(code, reason);
    };
    this.later(this.travelTime(), () => {
      if (this.isPartitioned) this.heldNotifications.push(notify);
      else notify();
    });
  }

  private arrive(from: LinkEnd, data: Uint8Array): void {
    const target = from.peer;
    if (this.isOffline) {
      this.stats.droppedByOffline += 1;
      this.emit('drop-offline', from.direction, data);
      return;
    }
    if (this.isPartitioned) {
      this.stats.droppedByPartition += 1;
      this.emit('drop-partition', from.direction, data);
      return;
    }
    if (target === undefined || target.closed || from.closed) {
      this.stats.droppedBecauseClosed += 1;
      this.emit('drop-closed', from.direction, data);
      return;
    }
    this.stats.delivered += 1;
    this.emit('deliver', from.direction, data);
    target.emitMessage(data);
  }

  private blocked(): boolean {
    return this.isOffline || this.isPartitioned;
  }

  private travelTime(): number {
    return this.config.latencyMs + this.options.random() * this.config.jitterMs;
  }

  private messageDelay(): number {
    const random = this.options.random;
    const base = this.travelTime();
    if (random() < this.config.reorderRate) return base + random() * this.config.reorderDelayMs;
    return base;
  }

  private later(delayMs: number, task: () => void): void {
    this.options.clock.setTimeout(task, delayMs);
  }

  private releaseHeldNotifications(): void {
    for (const notify of this.heldNotifications.splice(0)) this.later(this.travelTime(), notify);
  }

  private emit(kind: LinkEventKind, direction: LinkDirection, bytes: Uint8Array | undefined): void {
    this.options.onEvent?.({ time: this.options.clock.now(), kind, direction, bytes });
  }
}
