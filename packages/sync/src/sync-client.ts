import type { RandomSource } from '@coschema/model';
import * as awarenessProtocol from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { createAwareness } from './awareness';
import { DEFAULT_BACKOFF, backoffDelay, type BackoffOptions } from './backoff';
import type { Clock, TimerHandle } from './clock';
import { Emitter } from './emitter';
import {
  MalformedFrameError,
  MessageType,
  SYNC_STEP_1,
  SYNC_STEP_2,
  decodeAck,
  decodeAuthDenied,
  decodeEnvelope,
  encodeAuthToken,
  encodeAwarenessOf,
  encodeFlush,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeUpdate,
  readSyncFrame,
} from './messages';
import { CLOSE_UNAUTHORIZED, type Transport, type Unsubscribe } from './transport';

export type SyncStatus = 'stopped' | 'connecting' | 'syncing' | 'online' | 'waiting' | 'denied';

export interface SyncSnapshot {
  readonly status: SyncStatus;
  readonly synced: boolean;
  readonly pendingCount: number;
  readonly reconnectAttempt: number;
}

export interface SyncClientOptions {
  readonly doc: Y.Doc;
  readonly connect: () => Transport;
  readonly getToken: () => string;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly awareness?: awarenessProtocol.Awareness;
  readonly backoff?: BackoffOptions;
  readonly awarenessIntervalMs?: number;
  readonly ackTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly onError?: (error: unknown) => void;
}

export const DEFAULT_AWARENESS_INTERVAL_MS = 50;
export const DEFAULT_ACK_TIMEOUT_MS = 10_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

export class SyncClient {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private readonly changes = new Emitter<[SyncSnapshot]>();
  private readonly backoff: BackoffOptions;
  private readonly awarenessIntervalMs: number;
  private readonly ackTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private transport: Transport | undefined;
  private transportSubscriptions: Unsubscribe[] = [];
  private status: SyncStatus = 'stopped';
  private opened = false;
  private synced = false;
  private reconnectAttempt = 0;
  private localSeq = 0;
  private ackedSeq = 0;
  private lastAwarenessSent = Number.NEGATIVE_INFINITY;
  private reconnectTimer: TimerHandle | undefined;
  private connectTimer: TimerHandle | undefined;
  private ackTimer: TimerHandle | undefined;
  private awarenessTimer: TimerHandle | undefined;
  private ackProgressAtTimerStart = 0;
  private destroyed = false;

  constructor(private readonly options: SyncClientOptions) {
    this.doc = options.doc;
    this.awareness = options.awareness ?? createAwareness(options.doc);
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.awarenessIntervalMs = options.awarenessIntervalMs ?? DEFAULT_AWARENESS_INTERVAL_MS;
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  get snapshot(): SyncSnapshot {
    return {
      status: this.status,
      synced: this.synced,
      pendingCount: this.pendingCount,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  get pendingCount(): number {
    return this.localSeq - this.ackedSeq;
  }

  get isSynced(): boolean {
    return this.synced;
  }

  get currentStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (snapshot: SyncSnapshot) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  start(): void {
    if (this.destroyed) return;
    if (this.status !== 'stopped' && this.status !== 'denied') return;
    this.reconnectAttempt = 0;
    this.connectNow();
  }

  stop(): void {
    this.clearReconnectTimer();
    this.disconnect();
    this.setStatus('stopped');
  }

  reconnect(): void {
    if (this.destroyed) return;
    this.clearReconnectTimer();
    this.disconnect();
    this.reconnectAttempt = 0;
    this.connectNow();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.changes.clear();
  }

  private connectNow(): void {
    this.setStatus('connecting');
    let transport: Transport;
    try {
      transport = this.options.connect();
    } catch (error) {
      this.options.onError?.(error);
      this.scheduleReconnect();
      return;
    }
    this.transport = transport;
    this.transportSubscriptions.push(
      transport.onOpen(() => {
        this.handleOpen(transport);
      }),
      transport.onMessage((data) => {
        this.handleFrame(transport, data);
      }),
      transport.onClose((code) => {
        this.handleTransportClosed(transport, code);
      }),
    );
    this.connectTimer = this.options.clock.setTimeout(() => {
      this.connectTimer = undefined;
      this.loseConnection();
    }, this.connectTimeoutMs);
  }

  private handleOpen(transport: Transport): void {
    if (transport !== this.transport || this.opened) return;
    this.outbidHubRemoval();
    this.opened = true;
    this.setStatus('syncing');
    this.sendFrame(encodeAuthToken(this.options.getToken()));
    this.sendFrame(encodeSyncStep1(this.doc));
    if (this.awareness.getLocalState() !== null) this.sendAwarenessNow();
    this.sendFrame(encodeQueryAwareness());
    this.watchAcks();
  }

  private outbidHubRemoval(): void {
    const state = this.awareness.getLocalState();
    if (state === null) return;
    this.awareness.setLocalState(state);
    this.awareness.setLocalState(state);
  }

  private handleFrame(transport: Transport, data: Uint8Array): void {
    if (transport !== this.transport) return;
    try {
      this.process(data);
    } catch (error) {
      this.options.onError?.(error);
      if (error instanceof MalformedFrameError) this.loseConnection();
    }
  }

  private process(data: Uint8Array): void {
    const envelope = decodeEnvelope(data);
    switch (envelope.type) {
      case MessageType.sync: {
        const { messageType, reply } = readSyncFrame(envelope.decoder, this.doc, this);
        if (reply !== undefined) {
          this.sendFrame(reply);
          this.sendFlush();
        }
        if (messageType === SYNC_STEP_2) this.markSynced();
        if (messageType === SYNC_STEP_1) this.watchAcks();
        return;
      }
      case MessageType.awareness:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, envelope.update, this);
        return;
      case MessageType.ack: {
        const { token } = decodeAck(envelope.decoder);
        this.acknowledge(token);
        return;
      }
      case MessageType.auth:
        decodeAuthDenied(envelope.decoder);
        this.deny();
        return;
      case MessageType.queryAwareness:
      case MessageType.flush:
        return;
    }
  }

  private markSynced(): void {
    if (this.synced) return;
    this.synced = true;
    this.reconnectAttempt = 0;
    this.clearConnectTimer();
    this.setStatus('online');
  }

  private acknowledge(token: number): void {
    if (token <= this.ackedSeq) return;
    this.ackedSeq = Math.min(token, this.localSeq);
    this.watchAcks();
    this.publish();
  }

  private deny(): void {
    this.clearReconnectTimer();
    this.disconnect();
    this.setStatus('denied');
  }

  private handleTransportClosed(transport: Transport, code: number): void {
    if (transport !== this.transport) return;
    this.disconnect(false);
    if (code === CLOSE_UNAUTHORIZED) {
      this.setStatus('denied');
      return;
    }
    this.scheduleReconnect();
  }

  private loseConnection(): void {
    this.disconnect();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== undefined) return;
    const delay = backoffDelay(this.reconnectAttempt, this.backoff, this.options.random);
    this.reconnectAttempt += 1;
    this.setStatus('waiting');
    this.reconnectTimer = this.options.clock.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectNow();
    }, delay);
  }

  private disconnect(closeTransport = true): void {
    const transport = this.transport;
    this.transport = undefined;
    for (const unsubscribe of this.transportSubscriptions.splice(0)) unsubscribe();
    this.opened = false;
    this.synced = false;
    this.clearConnectTimer();
    this.clearAckTimer();
    this.clearAwarenessTimer();
    if (transport !== undefined && closeTransport) transport.close();
    this.removeRemoteAwareness();
  }

  private removeRemoteAwareness(): void {
    const remote = [...this.awareness.getStates().keys()].filter(
      (clientId) => clientId !== this.awareness.clientID,
    );
    if (remote.length > 0) awarenessProtocol.removeAwarenessStates(this.awareness, remote, this);
  }

  private sendFrame(frame: Uint8Array): void {
    if (this.transport === undefined || !this.opened) return;
    try {
      this.transport.send(frame);
    } catch (error) {
      this.options.onError?.(error);
      this.loseConnection();
    }
  }

  private sendFlush(): void {
    if (this.localSeq === 0) return;
    this.sendFrame(encodeFlush(this.localSeq));
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return;
    this.localSeq += 1;
    if (this.opened) {
      this.sendFrame(encodeUpdate(update));
      this.sendFlush();
      this.watchAcks();
    }
    this.publish();
  };

  private readonly onAwarenessUpdate = (change: AwarenessChange, origin: unknown): void => {
    if (origin === this) return;
    const changed = [...change.added, ...change.updated, ...change.removed];
    if (!changed.includes(this.awareness.clientID) || !this.opened) return;
    const elapsed = this.options.clock.now() - this.lastAwarenessSent;
    if (elapsed >= this.awarenessIntervalMs) {
      this.sendAwarenessNow();
    } else if (this.awarenessTimer === undefined) {
      this.awarenessTimer = this.options.clock.setTimeout(() => {
        this.awarenessTimer = undefined;
        this.sendAwarenessNow();
      }, this.awarenessIntervalMs - elapsed);
    }
  };

  private sendAwarenessNow(): void {
    this.clearAwarenessTimer();
    this.lastAwarenessSent = this.options.clock.now();
    this.sendFrame(encodeAwarenessOf(this.awareness, [this.awareness.clientID]));
  }

  private watchAcks(): void {
    this.clearAckTimer();
    if (!this.opened || this.pendingCount === 0) return;
    this.ackProgressAtTimerStart = this.ackedSeq;
    this.ackTimer = this.options.clock.setTimeout(() => {
      this.ackTimer = undefined;
      if (this.pendingCount > 0 && this.ackedSeq === this.ackProgressAtTimerStart) {
        this.loseConnection();
      } else {
        this.watchAcks();
      }
    }, this.ackTimeoutMs);
  }

  private setStatus(status: SyncStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.publish();
  }

  private publish(): void {
    this.changes.emit(this.snapshot);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === undefined) return;
    this.options.clock.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === undefined) return;
    this.options.clock.clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private clearAckTimer(): void {
    if (this.ackTimer === undefined) return;
    this.options.clock.clearTimeout(this.ackTimer);
    this.ackTimer = undefined;
  }

  private clearAwarenessTimer(): void {
    if (this.awarenessTimer === undefined) return;
    this.options.clock.clearTimeout(this.awarenessTimer);
    this.awarenessTimer = undefined;
  }
}
