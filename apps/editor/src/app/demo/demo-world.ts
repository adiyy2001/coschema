import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  META_KEYS,
  PRESENCE_COLORS,
  getMeta,
  getNodes,
  initializeDocument,
  type RandomSource,
} from '@coschema/model';
import { LINK_PROFILES, type LinkConfig, type LinkProfileName } from '@coschema/sim/link';
import {
  RoomHub,
  createWebSocketTransport,
  type Clock,
  type TimerHandle,
  type Transport,
} from '@coschema/sync';
import { COLLAB_CLOCK } from '../collab/collaboration';
import { resolveTarget, socketUrl, type ConnectionTarget } from '../collab/connection';
import type { Identity } from '../collab/identity';
import { RANDOM } from '../core/random';
import { starterDiagram } from '../core/starter-diagram';
import { bridgeToServer } from './bridge';
import { DemoPane } from './demo-pane';
import { applyMess } from './mess';

export interface DemoOptions {
  readonly paneCount: number;
  readonly search: string;
}

export const DEMO_OPTIONS = new InjectionToken<DemoOptions>('DEMO_OPTIONS', {
  providedIn: 'root',
  factory: () => ({ paneCount: 2, search: globalThis.location.search }),
});

const DEMO_ROOM = 'demo';
const DEMO_TOKEN = 'demo';
const MIN_PANES = 2;
const MAX_PANES = 3;
export const POLL_INTERVAL_MS = 200;
export const MESS_OFFLINE_MS = 1800;
export const DEMO_NAMES: readonly string[] = ['Ada', 'Bruno', 'Cleo'];
const STARTING_PROFILE: LinkProfileName = 'clean';

export function paneCountFrom(search: string, fallback: number): number {
  const requested = new URLSearchParams(search).get('panes');
  const raw = Number(requested);
  if (requested === null || !Number.isInteger(raw)) return fallback;
  return Math.min(MAX_PANES, Math.max(MIN_PANES, raw));
}

export function demoIdentity(index: number): Identity {
  const name = DEMO_NAMES[index % DEMO_NAMES.length] ?? 'Guest';
  const color = PRESENCE_COLORS[index % PRESENCE_COLORS.length] ?? '#1c7ed6';
  return { id: `demo-${name.toLowerCase()}`, name, color };
}

export function usesRealServer(search: string): boolean {
  return new URLSearchParams(search).get('server') !== null;
}

function seedHub(hub: RoomHub, random: RandomSource): void {
  initializeDocument(hub.doc);
  hub.doc.transact(() => {
    starterDiagram({ doc: hub.doc, origin: 'demo-seed', random });
    getMeta(hub.doc).set(META_KEYS.seeded, true);
  });
}

function liveTarget(search: string, room: string): ConnectionTarget {
  return resolveTarget(room, search, globalThis.location);
}

function localTarget(): ConnectionTarget {
  return { room: DEMO_ROOM, httpBase: '', wsBase: '', fixedToken: DEMO_TOKEN };
}

@Injectable()
export class DemoWorld {
  private readonly clock: Clock = inject(COLLAB_CLOCK);
  private readonly random: RandomSource = inject(RANDOM);
  private readonly options = inject(DEMO_OPTIONS);
  private hub: RoomHub | undefined;
  private nextKey = 1;
  private poller: TimerHandle | undefined;
  private release: TimerHandle | undefined;
  private destroyed = false;
  readonly real = usesRealServer(this.options.search);
  readonly panes = signal<readonly DemoPane[]>([]);
  readonly messing = signal(false);
  readonly profile = signal<LinkProfileName | undefined>(STARTING_PROFILE);

  constructor() {
    this.build();
    this.schedulePoll();
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.teardown();
      if (this.poller !== undefined) this.clock.clearTimeout(this.poller);
    });
  }

  reset(): void {
    this.teardown();
    this.messing.set(false);
    this.profile.set(STARTING_PROFILE);
    this.build();
  }

  applyProfile(name: LinkProfileName): void {
    this.profile.set(name);
    const config: LinkConfig = LINK_PROFILES[name];
    for (const pane of this.panes()) pane.applyConfig(config);
  }

  makeMess(): void {
    if (this.messing()) return;
    const panes = this.panes();
    this.messing.set(true);
    const wasOffline = panes.map((pane) => pane.offline());
    for (const pane of panes) pane.setOffline(true);
    for (const pane of panes) {
      const session = pane.session();
      if (session === undefined) continue;
      applyMess(
        {
          context: session.context,
          nodeIds: () => [...getNodes(session.doc).keys()],
          labelOf: (id) => session.graph.committedNode(id)?.label,
        },
        pane.identity.name,
        this.random,
      );
    }
    this.release = this.clock.setTimeout(() => {
      this.release = undefined;
      panes.forEach((pane, index) => {
        pane.setOffline(wasOffline[index] ?? false);
      });
      this.messing.set(false);
    }, MESS_OFFLINE_MS);
  }

  private build(): void {
    const count = paneCountFrom(this.options.search, this.options.paneCount);
    const room = this.real
      ? `${DEMO_ROOM}-${Math.floor(this.random() * 1e6).toString(36)}`
      : DEMO_ROOM;
    const target = this.real ? liveTarget(this.options.search, room) : localTarget();
    let accept: (transport: Transport) => void;
    if (this.real) {
      accept = (serverEnd) => {
        bridgeToServer(serverEnd, () => createWebSocketTransport(socketUrl(target)));
      };
    } else {
      const hub = new RoomHub({ clock: this.clock });
      seedHub(hub, this.random);
      this.hub = hub;
      accept = (serverEnd) => {
        hub.accept(serverEnd);
      };
    }
    const panes = Array.from({ length: count }, (_, index) => {
      const key = this.nextKey;
      this.nextKey += 1;
      return new DemoPane({
        key,
        identity: demoIdentity(index),
        clock: this.clock,
        random: this.random,
        accept,
        config: LINK_PROFILES[STARTING_PROFILE],
        target,
      });
    });
    this.panes.set(panes);
  }

  private teardown(): void {
    if (this.release !== undefined) {
      this.clock.clearTimeout(this.release);
      this.release = undefined;
    }
    for (const pane of this.panes()) pane.link.closeAll();
    this.panes.set([]);
    this.hub?.destroy();
    this.hub = undefined;
  }

  private schedulePoll(): void {
    this.poller = this.clock.setTimeout(() => {
      if (this.destroyed) return;
      for (const pane of this.panes()) pane.refresh();
      this.schedulePoll();
    }, POLL_INTERVAL_MS);
  }
}
