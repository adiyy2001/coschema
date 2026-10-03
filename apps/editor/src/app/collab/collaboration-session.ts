import { signal } from '@angular/core';
import type { RandomSource } from '@coschema/model';
import {
  DEFAULT_BACKOFF,
  SyncClient,
  backoffDelay,
  createAwareness,
  type BackoffOptions,
  type Clock,
  type SyncSnapshot,
  type TimerHandle,
  type Transport,
} from '@coschema/sync';
import { IndexeddbPersistence } from 'y-indexeddb';
import type * as Y from 'yjs';
import type { TokenProvider } from './connection';
import type { KeyValueStorage } from './identity';
import { readPending, restorePending, writePending } from './pending-store';

export type ConnectionState = 'loading' | 'connecting' | 'online' | 'offline' | 'denied';

export interface DiskPersistence {
  readonly loaded: Promise<unknown>;
  destroy(): void | Promise<void>;
}

export type PersistenceFactory = (name: string, doc: Y.Doc) => DiskPersistence;

export function indexedDbPersistence(name: string, doc: Y.Doc): DiskPersistence {
  const persistence = new IndexeddbPersistence(name, doc);
  return { loaded: persistence.whenSynced, destroy: () => persistence.destroy() };
}

export function defaultPersistence(): PersistenceFactory | undefined {
  return typeof indexedDB === 'undefined' ? undefined : indexedDbPersistence;
}

export interface CollaborationOptions {
  readonly doc: Y.Doc;
  readonly room: string;
  readonly connect: () => Transport;
  readonly tokens: TokenProvider;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly storage?: KeyValueStorage;
  readonly persistence?: PersistenceFactory;
  readonly prepare: () => void;
  readonly onFirstSync: () => void;
  readonly backoff?: BackoffOptions;
  readonly onError?: (error: unknown) => void;
}

const DISK_NAME_PREFIX = 'coschema:room:';

export function stateOf(snapshot: SyncSnapshot, manuallyOffline: boolean): ConnectionState {
  switch (snapshot.status) {
    case 'online':
      return 'online';
    case 'denied':
      return 'denied';
    case 'connecting':
    case 'syncing':
      return 'connecting';
    case 'waiting':
      return 'offline';
    case 'stopped':
      return manuallyOffline ? 'offline' : 'connecting';
  }
}

export class CollaborationSession {
  readonly awareness: SyncClient['awareness'];
  readonly state = signal<ConnectionState>('loading');
  readonly pending = signal(0);
  readonly synced = signal(false);
  readonly manuallyOffline = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly diskLoaded = signal(false);
  private client: SyncClient | undefined;
  private disk: DiskPersistence | undefined;
  private token = '';
  private tokenRetry: TimerHandle | undefined;
  private tokenAttempt = 0;
  private refreshedAfterDenial = false;
  private firstSyncDone = false;
  private unsubscribe: (() => void) | undefined;
  private destroyed = false;
  private started = false;

  constructor(private readonly options: CollaborationOptions) {
    this.awareness = createAwareness(options.doc);
  }

  private get isDestroyed(): boolean {
    return this.destroyed;
  }

  get syncClient(): SyncClient | undefined {
    return this.client;
  }

  async start(): Promise<void> {
    if (this.started || this.destroyed) return;
    this.started = true;
    await this.loadDisk();
    if (this.isDestroyed) return;
    this.options.prepare();
    const stored = readPending(this.options.storage, this.options.room);
    const client = new SyncClient({
      doc: this.options.doc,
      awareness: this.awareness,
      connect: this.options.connect,
      getToken: () => this.token,
      clock: this.options.clock,
      random: this.options.random,
      initialPending: restorePending(this.options.doc, stored),
      ...(this.options.onError === undefined ? {} : { onError: this.options.onError }),
    });
    this.client = client;
    this.unsubscribe = client.subscribe((snapshot) => {
      this.apply(snapshot);
    });
    this.apply(client.snapshot);
    await this.connectWithToken();
  }

  setOffline(offline: boolean): void {
    const client = this.client;
    if (client === undefined || this.destroyed || this.manuallyOffline() === offline) return;
    this.manuallyOffline.set(offline);
    if (offline) {
      this.cancelTokenRetry();
      client.stop();
      return;
    }
    void this.connectWithToken();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelTokenRetry();
    this.unsubscribe?.();
    this.client?.destroy();
    this.awareness.destroy();
    void this.disk?.destroy();
  }

  private async loadDisk(): Promise<void> {
    const factory = this.options.persistence;
    if (factory === undefined) {
      this.diskLoaded.set(true);
      return;
    }
    try {
      this.disk = factory(`${DISK_NAME_PREFIX}${this.options.room}`, this.options.doc);
      await this.disk.loaded;
    } catch (error) {
      this.options.onError?.(error);
    }
    this.diskLoaded.set(true);
  }

  private async connectWithToken(): Promise<void> {
    const client = this.client;
    if (client === undefined || this.destroyed) return;
    try {
      const issued = await this.options.tokens.get();
      this.token = issued.token;
      this.tokenAttempt = 0;
      this.error.set(undefined);
    } catch (error) {
      this.options.onError?.(error);
      this.error.set(error instanceof Error ? error.message : 'token request failed');
      this.scheduleTokenRetry();
      return;
    }
    if (this.isDestroyed || this.manuallyOffline()) return;
    client.start();
  }

  private scheduleTokenRetry(): void {
    if (this.destroyed || this.manuallyOffline() || this.tokenRetry !== undefined) return;
    this.state.set('offline');
    const delay = backoffDelay(
      this.tokenAttempt,
      this.options.backoff ?? DEFAULT_BACKOFF,
      this.options.random,
    );
    this.tokenAttempt += 1;
    this.tokenRetry = this.options.clock.setTimeout(() => {
      this.tokenRetry = undefined;
      void this.connectWithToken();
    }, delay);
  }

  private cancelTokenRetry(): void {
    if (this.tokenRetry === undefined) return;
    this.options.clock.clearTimeout(this.tokenRetry);
    this.tokenRetry = undefined;
  }

  private apply(snapshot: SyncSnapshot): void {
    this.state.set(stateOf(snapshot, this.manuallyOffline()));
    this.synced.set(snapshot.synced);
    if (this.pending() !== snapshot.pendingCount) {
      this.pending.set(snapshot.pendingCount);
    }
    writePending(this.options.storage, this.options.room, snapshot.pendingCount);
    if (snapshot.status === 'online') this.refreshedAfterDenial = false;
    if (snapshot.synced && !this.firstSyncDone) {
      this.firstSyncDone = true;
      this.options.onFirstSync();
    }
    if (snapshot.status === 'denied') this.retryDeniedOnce();
  }

  private retryDeniedOnce(): void {
    if (!this.options.tokens.refreshable || this.refreshedAfterDenial) return;
    this.refreshedAfterDenial = true;
    queueMicrotask(() => {
      void this.connectWithToken();
    });
  }
}
