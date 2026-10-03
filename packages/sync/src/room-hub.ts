import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createAwareness } from './awareness';
import type { Clock, TimerHandle } from './clock';
import {
  MalformedFrameError,
  MessageType,
  decodeAuthToken,
  decodeEnvelope,
  encodeAck,
  encodeAuthDenied,
  encodeAwarenessOf,
  encodeSyncStep1,
  encodeUpdate,
  readSyncFrame,
} from './messages';
import {
  CLOSE_INVALID_DATA,
  CLOSE_NORMAL,
  CLOSE_UNAUTHORIZED,
  type Transport,
  type Unsubscribe,
} from './transport';

export type AuthResult =
  | { readonly ok: true; readonly identity?: unknown }
  | { readonly ok: false; readonly reason: string };

export type Authenticator = (token: string) => AuthResult | Promise<AuthResult>;

export interface RoomHubOptions {
  readonly clock: Clock;
  readonly doc?: Y.Doc;
  readonly authenticate?: Authenticator;
  readonly authTimeoutMs?: number;
  readonly onUpdate?: (
    update: Uint8Array,
    connection: HubConnection | undefined,
  ) => void | Promise<void>;
  readonly onError?: (error: unknown, connection: HubConnection | undefined) => void;
}

export const DEFAULT_AUTH_TIMEOUT_MS = 5000;
export const MAX_QUEUED_FRAMES_BEFORE_AUTH = 256;
export const CLOSE_GOING_AWAY = 1001;

type ConnectionState = 'awaiting-auth' | 'authenticating' | 'ready' | 'closed';

const LOAD_ORIGIN = { kind: 'hub-load' };

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value;
}

export class HubConnection {
  state: ConnectionState = 'awaiting-auth';
  identity: unknown;
  authTimer: TimerHandle | undefined;
  readonly queuedFrames: Uint8Array[] = [];
  readonly controlledClients = new Set<number>();
  readonly subscriptions: Unsubscribe[] = [];

  constructor(
    readonly id: number,
    readonly transport: Transport,
  ) {}

  get isReady(): boolean {
    return this.state === 'ready';
  }
}

interface WaitingAck {
  readonly connection: HubConnection;
  readonly token: number;
  readonly needed: number;
}

export class RoomHub {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  private readonly connections = new Set<HubConnection>();
  private readonly controllers = new Map<number, HubConnection>();
  private readonly waitingAcks: WaitingAck[] = [];
  private readonly authenticate: Authenticator;
  private readonly authTimeoutMs: number;
  private nextConnectionId = 1;
  private appliedCount = 0;
  private persistedCount = 0;
  private persistedVector: Uint8Array;
  private persistenceChain: Promise<void> = Promise.resolve();
  private persistenceBroken = false;
  private destroyed = false;

  constructor(private readonly options: RoomHubOptions) {
    this.doc = options.doc ?? new Y.Doc();
    this.awareness = createAwareness(this.doc);
    this.authenticate = options.authenticate ?? (() => ({ ok: true }));
    this.authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS;
    this.persistedVector = Y.encodeStateVector(this.doc);
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  get readyConnectionCount(): number {
    let ready = 0;
    for (const connection of this.connections) if (connection.isReady) ready += 1;
    return ready;
  }

  get hasPersistenceFailure(): boolean {
    return this.persistenceBroken;
  }

  get persistedStateVector(): Uint8Array {
    return this.persistedVector;
  }

  accept(transport: Transport): HubConnection {
    const connection = new HubConnection(this.nextConnectionId, transport);
    this.nextConnectionId += 1;
    this.connections.add(connection);
    connection.subscriptions.push(
      transport.onMessage((data) => {
        this.receive(connection, data);
      }),
      transport.onClose(() => {
        this.release(connection);
      }),
    );
    connection.authTimer = this.options.clock.setTimeout(() => {
      this.deny(connection, 'authentication timed out');
    }, this.authTimeoutMs);
    return connection;
  }

  loadUpdate(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, LOAD_ORIGIN);
  }

  close(connection: HubConnection, code = CLOSE_NORMAL, reason = ''): void {
    if (connection.state === 'closed') return;
    this.release(connection);
    connection.transport.close(code, reason);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const connection of [...this.connections]) {
      this.close(connection, CLOSE_GOING_AWAY, 'room closed');
    }
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.awareness.destroy();
  }

  private receive(connection: HubConnection, data: Uint8Array): void {
    switch (connection.state) {
      case 'closed':
        return;
      case 'authenticating':
        if (connection.queuedFrames.length >= MAX_QUEUED_FRAMES_BEFORE_AUTH) {
          this.deny(connection, 'too many frames before authentication');
          return;
        }
        connection.queuedFrames.push(data);
        return;
      case 'awaiting-auth':
        this.receiveFirstFrame(connection, data);
        return;
      case 'ready':
        this.dispatch(connection, data);
    }
  }

  private receiveFirstFrame(connection: HubConnection, data: Uint8Array): void {
    let token: string;
    try {
      const envelope = decodeEnvelope(data);
      if (envelope.type !== MessageType.auth) {
        this.deny(connection, 'the first message must authenticate');
        return;
      }
      token = decodeAuthToken(envelope.decoder);
    } catch (error) {
      this.deny(connection, 'malformed authentication message');
      this.options.onError?.(error, connection);
      return;
    }
    connection.state = 'authenticating';
    let outcome: AuthResult | Promise<AuthResult>;
    try {
      outcome = this.authenticate(token);
    } catch {
      outcome = { ok: false, reason: 'authentication failed' };
    }
    if (isThenable(outcome)) {
      outcome.then(
        (result) => {
          this.finishAuth(connection, result);
        },
        () => {
          this.finishAuth(connection, { ok: false, reason: 'authentication failed' });
        },
      );
    } else {
      this.finishAuth(connection, outcome);
    }
  }

  private finishAuth(connection: HubConnection, result: AuthResult): void {
    if (connection.state !== 'authenticating') return;
    if (!result.ok) {
      this.deny(connection, result.reason);
      return;
    }
    this.clearAuthTimer(connection);
    connection.identity = result.identity;
    connection.state = 'ready';
    this.sendTo(connection, encodeSyncStep1(this.doc));
    const known = [...this.awareness.getStates().keys()];
    if (known.length > 0) this.sendTo(connection, encodeAwarenessOf(this.awareness, known));
    const queued = connection.queuedFrames.splice(0);
    for (const frame of queued) {
      if (this.isClosed(connection)) break;
      this.dispatch(connection, frame);
    }
  }

  private deny(connection: HubConnection, reason: string): void {
    if (connection.state === 'closed') return;
    this.sendTo(connection, encodeAuthDenied(reason));
    this.close(connection, CLOSE_UNAUTHORIZED, reason);
  }

  private dispatch(connection: HubConnection, data: Uint8Array): void {
    try {
      const envelope = decodeEnvelope(data);
      switch (envelope.type) {
        case MessageType.sync: {
          const { reply } = readSyncFrame(envelope.decoder, this.doc, connection);
          if (reply !== undefined) this.sendTo(connection, reply);
          return;
        }
        case MessageType.awareness:
          awarenessProtocol.applyAwarenessUpdate(this.awareness, envelope.update, connection);
          return;
        case MessageType.queryAwareness: {
          const known = [...this.awareness.getStates().keys()];
          if (known.length > 0) this.sendTo(connection, encodeAwarenessOf(this.awareness, known));
          return;
        }
        case MessageType.flush:
          this.requestAck(connection, envelope.token);
          return;
        case MessageType.auth:
        case MessageType.ack:
          return;
      }
    } catch (error) {
      this.options.onError?.(error, connection);
      if (error instanceof MalformedFrameError) {
        this.close(connection, CLOSE_INVALID_DATA, error.message);
      }
    }
  }

  private requestAck(connection: HubConnection, token: number): void {
    if (this.persistenceBroken) return;
    if (this.persistedCount >= this.appliedCount) {
      this.sendTo(connection, encodeAck({ token, stateVector: this.persistedVector }));
      return;
    }
    this.waitingAcks.push({ connection, token, needed: this.appliedCount });
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN) return;
    const connection = origin instanceof HubConnection ? origin : undefined;
    this.appliedCount += 1;
    const count = this.appliedCount;
    const vector = Y.encodeStateVector(this.doc);
    this.broadcast(encodeUpdate(update), connection);
    this.persist(update, connection, count, vector);
  };

  private persist(
    update: Uint8Array,
    connection: HubConnection | undefined,
    count: number,
    vector: Uint8Array,
  ): void {
    const handler = this.options.onUpdate;
    if (handler === undefined) {
      this.markPersisted(count, vector);
      return;
    }
    let outcome: void | Promise<void>;
    try {
      outcome = handler(update, connection);
    } catch (error) {
      this.failPersistence(error, connection);
      return;
    }
    if (!isThenable(outcome)) {
      this.markPersisted(count, vector);
      return;
    }
    this.persistenceChain = this.persistenceChain
      .then(() => outcome)
      .then(
        () => {
          this.markPersisted(count, vector);
        },
        (error: unknown) => {
          this.failPersistence(error, connection);
        },
      );
  }

  private failPersistence(error: unknown, connection: HubConnection | undefined): void {
    this.persistenceBroken = true;
    this.waitingAcks.length = 0;
    this.options.onError?.(error, connection);
  }

  private markPersisted(count: number, vector: Uint8Array): void {
    if (this.persistenceBroken) return;
    this.persistedCount = count;
    this.persistedVector = vector;
    const remaining: WaitingAck[] = [];
    for (const waiting of this.waitingAcks) {
      if (waiting.needed <= count) {
        this.sendTo(waiting.connection, encodeAck({ token: waiting.token, stateVector: vector }));
      } else {
        remaining.push(waiting);
      }
    }
    this.waitingAcks.length = 0;
    this.waitingAcks.push(...remaining);
  }

  private readonly onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const source = origin instanceof HubConnection ? origin : undefined;
    if (source !== undefined) this.trackControl(source, change);
    const changed = [...change.added, ...change.updated, ...change.removed];
    if (changed.length === 0) return;
    this.broadcast(encodeAwarenessOf(this.awareness, changed), source);
  };

  private trackControl(
    source: HubConnection,
    change: { added: number[]; updated: number[]; removed: number[] },
  ): void {
    for (const clientId of [...change.added, ...change.updated]) {
      const previous = this.controllers.get(clientId);
      if (previous !== undefined && previous !== source)
        previous.controlledClients.delete(clientId);
      this.controllers.set(clientId, source);
      source.controlledClients.add(clientId);
    }
    for (const clientId of change.removed) {
      if (this.controllers.get(clientId) === source) this.controllers.delete(clientId);
      source.controlledClients.delete(clientId);
    }
  }

  private broadcast(frame: Uint8Array, except: HubConnection | undefined): void {
    for (const connection of [...this.connections]) {
      if (connection !== except && connection.isReady) this.sendTo(connection, frame);
    }
  }

  private sendTo(connection: HubConnection, frame: Uint8Array): void {
    if (connection.state === 'closed') return;
    try {
      connection.transport.send(frame);
    } catch (error) {
      this.options.onError?.(error, connection);
      this.close(connection, CLOSE_INVALID_DATA, 'send failed');
    }
  }

  private isClosed(connection: HubConnection): boolean {
    return connection.state === 'closed';
  }

  private clearAuthTimer(connection: HubConnection): void {
    if (connection.authTimer === undefined) return;
    this.options.clock.clearTimeout(connection.authTimer);
    connection.authTimer = undefined;
  }

  private release(connection: HubConnection): void {
    if (connection.state === 'closed') return;
    connection.state = 'closed';
    this.clearAuthTimer(connection);
    for (const unsubscribe of connection.subscriptions.splice(0)) unsubscribe();
    this.connections.delete(connection);
    connection.queuedFrames.length = 0;
    for (let index = this.waitingAcks.length - 1; index >= 0; index -= 1) {
      if (this.waitingAcks[index]?.connection === connection) this.waitingAcks.splice(index, 1);
    }
    const owned = [...connection.controlledClients].filter(
      (clientId) => this.controllers.get(clientId) === connection,
    );
    connection.controlledClients.clear();
    for (const clientId of owned) this.controllers.delete(clientId);
    if (owned.length > 0 && !this.destroyed) {
      awarenessProtocol.removeAwarenessStates(this.awareness, owned, connection);
    }
  }
}
