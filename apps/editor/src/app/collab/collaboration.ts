import {
  DestroyRef,
  Injectable,
  InjectionToken,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { visibleWorldRect, type Vec2, type Viewport } from '@coschema/geometry';
import { createWebSocketTransport, systemClock, type Clock, type Transport } from '@coschema/sync';
import { ViewportState } from '../canvas/viewport-state';
import { DocumentSession } from '../core/document-session';
import { RANDOM } from '../core/random';
import { SelectionState } from '../interaction/selection-state';
import { followStep } from '../presence/follow';
import { PresenceStore } from '../presence/presence-store';
import {
  CollaborationSession,
  defaultPersistence,
  type PersistenceFactory,
} from './collaboration-session';
import { FETCH_JSON, socketUrl, tokenProviderFor, type ConnectionTarget } from './connection';
import {
  loadIdentity,
  renameIdentity,
  saveIdentity,
  type Identity,
  type KeyValueStorage,
} from './identity';

export const COLLAB_TARGET = new InjectionToken<ConnectionTarget>('COLLAB_TARGET');

export const COLLAB_STORAGE = new InjectionToken<KeyValueStorage | undefined>('COLLAB_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.localStorage;
    } catch {
      return undefined;
    }
  },
});

export const COLLAB_PERSISTENCE = new InjectionToken<PersistenceFactory | undefined>(
  'COLLAB_PERSISTENCE',
  { providedIn: 'root', factory: defaultPersistence },
);

export type TransportFactory = (target: ConnectionTarget) => Transport;

export const COLLAB_TRANSPORT = new InjectionToken<TransportFactory>('COLLAB_TRANSPORT', {
  providedIn: 'root',
  factory: () => (target) => createWebSocketTransport(socketUrl(target)),
});

export const COLLAB_CLOCK = new InjectionToken<Clock>('COLLAB_CLOCK', {
  providedIn: 'root',
  factory: () => systemClock,
});

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

@Injectable()
export class Collaboration {
  private readonly documents = inject(DocumentSession);
  private readonly viewport = inject(ViewportState);
  private readonly selection = inject(SelectionState);
  private readonly storage = inject(COLLAB_STORAGE);
  private readonly identitySignal = signal<Identity>(loadIdentity(this.storage, inject(RANDOM)));
  readonly target = inject(COLLAB_TARGET);
  readonly identity = this.identitySignal.asReadonly();
  readonly following = signal<number | null>(null);
  readonly session: CollaborationSession;
  readonly presence: PresenceStore;
  private lastApplied: Viewport | undefined;

  constructor() {
    const random = inject(RANDOM);
    const fetchJson = inject(FETCH_JSON);
    const openTransport = inject(COLLAB_TRANSPORT);
    const query = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION_QUERY) : undefined;
    this.session = new CollaborationSession({
      doc: this.documents.doc,
      room: this.target.room,
      connect: () => openTransport(this.target),
      tokens: tokenProviderFor(this.target, this.identitySignal(), fetchJson),
      clock: inject(COLLAB_CLOCK),
      random,
      ...(this.storage === undefined ? {} : { storage: this.storage }),
      ...optionalPersistence(inject(COLLAB_PERSISTENCE)),
      prepare: () => {
        this.documents.prepare();
      },
      onFirstSync: () => {
        this.documents.seedIfNeverSeeded();
      },
    });
    this.presence = new PresenceStore(
      this.session.awareness,
      this.identitySignal(),
      query?.matches ?? false,
    );
    const onMotionChange = (event: MediaQueryListEvent): void => {
      this.presence.setReducedMotion(event.matches);
    };
    query?.addEventListener('change', onMotionChange);
    this.bindPresence();
    this.bindFollow();
    void this.session.start();
    inject(DestroyRef).onDestroy(() => {
      query?.removeEventListener('change', onMotionChange);
      this.presence.destroy();
      this.session.destroy();
    });
  }

  rename(rawName: string): void {
    const next = renameIdentity(this.identitySignal(), rawName);
    if (next === this.identitySignal()) return;
    this.identitySignal.set(next);
    saveIdentity(this.storage, next);
    this.presence.setUser(next);
  }

  follow(clientId: number | null): void {
    this.lastApplied = undefined;
    this.following.set(clientId);
    this.presence.setFollowing(clientId);
  }

  toggleFollow(clientId: number): void {
    this.follow(this.following() === clientId ? null : clientId);
  }

  publishCursor(world: Vec2 | null): void {
    this.presence.setCursor(world === null ? null : { x: world[0], y: world[1] });
  }

  private bindPresence(): void {
    effect(() => {
      const nodes = this.selection.selection().nodes;
      untracked(() => {
        this.presence.setSelection(nodes);
      });
    });
    effect(() => {
      const rect = visibleWorldRect(this.viewport.viewport(), this.viewport.screen());
      untracked(() => {
        this.presence.setViewport(rect.width > 0 && rect.height > 0 ? rect : null);
      });
    });
  }

  private bindFollow(): void {
    effect(() => {
      const target = this.following();
      const peers = this.presence.peers();
      const current = this.viewport.viewport();
      const screen = this.viewport.screen();
      if (target === null) return;
      const peer = peers.find((candidate) => candidate.clientId === target);
      untracked(() => {
        if (peer === undefined) {
          this.follow(null);
          return;
        }
        if (peer.following === this.presence.localClientId) return;
        const step = followStep({
          lastApplied: this.lastApplied,
          current,
          peerRect: peer.viewport ?? undefined,
          screen,
        });
        if (step.kind === 'stop') this.follow(null);
        if (step.kind === 'apply') {
          this.lastApplied = step.viewport;
          this.viewport.viewport.set(step.viewport);
        }
      });
    });
  }
}

function optionalPersistence(factory: PersistenceFactory | undefined): {
  persistence?: PersistenceFactory;
} {
  return factory === undefined ? {} : { persistence: factory };
}
