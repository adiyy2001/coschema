import type { ProviderToken } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { createNode, moveNodes } from '@coschema/model';
import {
  RoomHub,
  SyncClient,
  createMemoryPair,
  systemClock,
  type MemoryPair,
  type RoomHubOptions,
} from '@coschema/sync';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewportState } from '../canvas/viewport-state';
import {
  COLLAB_PERSISTENCE,
  COLLAB_STORAGE,
  COLLAB_TRANSPORT,
  Collaboration,
} from '../collab/collaboration';
import { FETCH_JSON, type FetchLike } from '../collab/connection';
import { IDENTITY_KEY, type KeyValueStorage } from '../collab/identity';
import { mulberry32 } from '../core/bench-scene';
import { DocumentSession } from '../core/document-session';
import { FRAME_SCHEDULER } from '../core/frame-scheduler';
import { RANDOM } from '../core/random';
import { SelectionState } from '../interaction/selection-state';
import { PresenceStore } from '../presence/presence-store';
import { settle, stubLayout } from '../testing/dom';
import { ManualFrames } from '../testing/manual-frames';
import { PAGE_NAVIGATION } from './page-navigation';
import { RoomPageComponent } from './room-page.component';

class Network {
  readonly pairs: MemoryPair[] = [];

  settle(): void {
    for (let round = 0; round < 1000; round += 1) {
      const busy = this.pairs.filter((pair) => pair.queued > 0);
      if (busy.length === 0) return;
      for (const pair of busy) pair.flush();
    }
    throw new Error('network did not settle');
  }
}

function memoryStorage(): KeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

interface Remote {
  readonly client: SyncClient;
  readonly doc: Y.Doc;
  readonly presence: PresenceStore;
}

interface Room {
  readonly fixture: ComponentFixture<RoomPageComponent>;
  readonly root: HTMLElement;
  readonly hub: RoomHub;
  readonly network: Network;
  readonly frames: ManualFrames;
  readonly storage: ReturnType<typeof memoryStorage>;
  readonly opened: string[];
  readonly restore: () => void;
  pump(): Promise<void>;
  remote(name: string, color: string): Promise<Remote>;
  injected<T>(token: ProviderToken<T>): T;
}

const remotes: Remote[] = [];

async function mountRoom(
  options: {
    hub?: Partial<RoomHubOptions>;
    prefill?: boolean;
  } = {},
): Promise<Room> {
  const restore = stubLayout(1000, 600);
  const frames = new ManualFrames();
  const hub = new RoomHub({ clock: systemClock, ...options.hub });
  const network = new Network();
  const storage = memoryStorage();
  const opened: string[] = [];
  const fetchJson: FetchLike = () =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: 'token' }) });
  const connect = () => {
    const pair = createMemoryPair();
    network.pairs.push(pair);
    hub.accept(pair.server);
    return pair.client;
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: FRAME_SCHEDULER, useValue: frames.schedule },
      { provide: RANDOM, useValue: mulberry32(21) },
      { provide: COLLAB_STORAGE, useValue: storage },
      { provide: COLLAB_PERSISTENCE, useValue: undefined },
      { provide: COLLAB_TRANSPORT, useValue: connect },
      { provide: FETCH_JSON, useValue: fetchJson },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ room: 'plant' }) } },
      },
      {
        provide: PAGE_NAVIGATION,
        useValue: {
          search: '?server=http://127.0.0.1:4318',
          open: (path: string) => {
            opened.push(path);
          },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(RoomPageComponent);
  document.body.append(fixture.nativeElement as HTMLElement);
  const pump = async (): Promise<void> => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      network.settle();
    }
    await settle(fixture);
  };
  await pump();
  return {
    fixture,
    root: fixture.nativeElement as HTMLElement,
    hub,
    network,
    frames,
    storage,
    opened,
    restore,
    pump,
    remote: async (name, color) => {
      const doc = new Y.Doc();
      const client = new SyncClient({
        doc,
        connect,
        getToken: () => 'token',
        clock: systemClock,
        random: () => 0,
      });
      const presence = new PresenceStore(client.awareness, { name, color }, false);
      client.start();
      const entry: Remote = { client, doc, presence };
      remotes.push(entry);
      await pump();
      return entry;
    },
    injected: (token) => fixture.debugElement.injector.get(token),
  };
}

async function until(room: Room, check: () => void): Promise<void> {
  await vi.waitFor(
    async () => {
      await room.pump();
      room.frames.tick();
      check();
    },
    { timeout: 2000, interval: 20 },
  );
}

function buttonFor(root: HTMLElement, selector: string): HTMLButtonElement {
  const button = root.querySelector(selector);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing ${selector}`);
  return button;
}

afterEach(() => {
  for (const remote of remotes.splice(0)) {
    remote.presence.destroy();
    remote.client.destroy();
    remote.doc.destroy();
  }
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RoomPageComponent', () => {
  it('connects to the room, seeds the starter diagram and shows the connection', async () => {
    const room = await mountRoom();
    expect(room.root.querySelector('[data-connection]')?.getAttribute('data-state')).toBe('online');
    await until(room, () => {
      expect(room.root.textContent).toContain('7 nodes, 7 edges');
    });
    expect(room.hub.doc.getMap('nodes').size).toBe(7);
    expect(room.injected(Collaboration).target.room).toBe('plant');
    room.restore();
  });

  it('does not seed a second time when someone else already worked in the room', async () => {
    const room = await mountRoom();
    const second = await room.remote('Bob', '#1c7ed6');
    expect(second.doc.getMap('nodes').size).toBe(7);
    expect(room.hub.doc.getMap('nodes').size).toBe(7);
    room.restore();
  });

  it('lists a remote person, outlines their selection and draws their cursor', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    await until(room, () => {
      expect(room.root.querySelectorAll('[data-action="follow"]')).toHaveLength(1);
    });
    expect(room.root.querySelector('[data-action="follow"]')?.textContent).toContain('Bob');
    remote.presence.setSelection(['pump-a', 'pump-b']);
    remote.presence.setCursor({ x: 300, y: 200 });
    await until(room, () => {
      expect(room.root.querySelectorAll('g[cs-presence] rect.outline')).toHaveLength(2);
      const cursor = room.root.querySelector('[data-cursor]');
      expect(cursor?.getAttribute('visibility')).toBe('visible');
    });
    expect(room.root.querySelector('g[cs-presence]')?.textContent).toContain('Bob');
    expect(room.root.querySelector('[data-cursor]')?.getAttribute('transform')).toContain(
      'translate(300 200)',
    );
    remote.presence.setCursor(null);
    await until(room, () => {
      expect(room.root.querySelector('[data-cursor]')?.getAttribute('visibility')).toBe('hidden');
    });
    room.restore();
  });

  it('draws the viewport of a remote person only while it does not cover our own', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    remote.presence.setViewport({ x: 600, y: 300, width: 800, height: 500 });
    await until(room, () => {
      expect(room.root.querySelectorAll('g[cs-presence] rect.frame')).toHaveLength(1);
    });
    remote.presence.setViewport({ x: -1000, y: -1000, width: 4000, height: 4000 });
    await until(room, () => {
      expect(room.root.querySelectorAll('g[cs-presence] rect.frame')).toHaveLength(0);
    });
    room.restore();
  });

  it('follows a person until the viewport is moved by hand', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    const collaboration = room.injected(Collaboration);
    const viewport = room.injected(ViewportState);
    await until(room, () => {
      expect(room.root.querySelectorAll('[data-action="follow"]')).toHaveLength(1);
    });
    remote.presence.setViewport({ x: 100, y: 100, width: 500, height: 300 });
    await until(room, () => {
      expect(collaboration.presence.peers()[0]?.viewport).not.toBeNull();
    });
    const follow = buttonFor(room.root, '[data-action="follow"]');
    follow.click();
    await until(room, () => {
      expect(follow.getAttribute('aria-pressed')).toBe('true');
      expect(follow.textContent).toContain('following');
      expect(viewport.viewport().zoom).toBeCloseTo(2, 5);
    });
    await until(room, () => {
      expect(remote.presence.peer(collaboration.presence.localClientId)?.following).toBeNull();
      expect(collaboration.session.awareness.getLocalState()).toMatchObject({
        following: collaboration.presence.peers()[0]?.clientId,
      });
    });
    remote.presence.setViewport({ x: 400, y: 100, width: 500, height: 300 });
    await until(room, () => {
      expect(viewport.viewport().x).toBeCloseTo(-800 + 0, 0);
    });
    viewport.viewport.update((current) => ({ ...current, x: current.x + 40 }));
    await until(room, () => {
      expect(follow.getAttribute('aria-pressed')).toBe('false');
    });
    const afterStop = viewport.viewport();
    remote.presence.setViewport({ x: 900, y: 900, width: 500, height: 300 });
    await until(room, () => {
      expect(collaboration.presence.peers()[0]?.viewport?.x).toBe(900);
    });
    expect(viewport.viewport()).toBe(afterStop);
    room.restore();
  });

  it('stops following when the person leaves and does not follow someone who follows us', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    const collaboration = room.injected(Collaboration);
    const viewport = room.injected(ViewportState);
    await until(room, () => {
      expect(collaboration.presence.peers()).toHaveLength(1);
    });
    remote.presence.setViewport({ x: 100, y: 100, width: 500, height: 300 });
    remote.presence.setFollowing(collaboration.presence.localClientId);
    await until(room, () => {
      expect(collaboration.presence.peers()[0]?.following).toBe(
        collaboration.presence.localClientId,
      );
    });
    const before = viewport.viewport();
    collaboration.toggleFollow(collaboration.presence.peers()[0]?.clientId ?? -1);
    await until(room, () => {
      expect(collaboration.following()).not.toBeNull();
    });
    expect(viewport.viewport()).toBe(before);
    remote.client.destroy();
    remote.presence.destroy();
    await until(room, () => {
      expect(collaboration.presence.peers()).toHaveLength(0);
      expect(collaboration.following()).toBeNull();
    });
    room.restore();
  });

  it('publishes the local selection, viewport and cursor', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    const collaboration = room.injected(Collaboration);
    room.injected(SelectionState).set({ nodes: ['alarm'], edges: [] });
    collaboration.publishCursor([12, 34]);
    await until(room, () => {
      const peer = remote.presence.peer(collaboration.presence.localClientId);
      expect(peer?.selection).toEqual(['alarm']);
      expect(peer?.viewport?.width).toBe(1000);
    });
    collaboration.publishCursor(null);
    room.restore();
  });

  it('renames the person and remembers the name', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    const collaboration = room.injected(Collaboration);
    collaboration.rename('  Zofia  ');
    expect(collaboration.identity().name).toBe('Zofia');
    expect(room.storage.values.get(IDENTITY_KEY)).toContain('Zofia');
    await until(room, () => {
      expect(remote.presence.peer(collaboration.presence.localClientId)?.user.name).toBe('Zofia');
    });
    collaboration.rename('   ');
    expect(collaboration.identity().name).toBe('Zofia');
    room.restore();
  });

  it('switches to offline by hand, counts edits and sends them when back online', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    const toggle = buttonFor(room.root, '[data-action="offline-toggle"]');
    expect(toggle.textContent).toContain('Work offline');
    toggle.click();
    await until(room, () => {
      expect(room.root.querySelector('[data-connection]')?.getAttribute('data-state')).toBe(
        'offline',
      );
      expect(toggle.textContent).toContain('Go online');
    });
    expect(room.root.querySelector('[data-connection]')?.textContent).toContain('Offline');
    const session = room.injected(DocumentSession);
    createNode(session.context, { id: 'extra', type: 'rect', pos: [0, 0], label: 'Extra' });
    await until(room, () => {
      expect(room.root.querySelector('[data-pending]')?.textContent).toContain(
        '1 change waiting to sync',
      );
    });
    expect(remote.doc.getMap('nodes').has('extra')).toBe(false);
    toggle.click();
    await until(room, () => {
      expect(room.root.querySelector('[data-connection]')?.getAttribute('data-state')).toBe(
        'online',
      );
      expect(room.root.querySelector('[data-pending]')).toBeNull();
      expect(remote.doc.getMap('nodes').has('extra')).toBe(true);
    });
    room.restore();
  });

  it('shows the access problem and hides the offline controls when the room refuses the token', async () => {
    const room = await mountRoom({
      hub: { authenticate: () => ({ ok: false, reason: 'bad token' }) },
    });
    await until(room, () => {
      expect(room.root.querySelector('[data-connection]')?.getAttribute('data-state')).toBe(
        'denied',
      );
    });
    expect(room.root.textContent).toContain('Access denied');
    expect(room.root.querySelector('[data-denied]')).not.toBeNull();
    expect(room.root.querySelector('[data-action="offline-toggle"]')).toBeNull();
    room.restore();
  });

  it('opens the dialog from the identity chip, renames and moves to another room', async () => {
    const room = await mountRoom();
    buttonFor(room.root, '[data-action="identity"]').click();
    await settle(room.fixture);
    const dialog = room.root.querySelector('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    const name = room.root.querySelector('input[name="name"]');
    const roomField = room.root.querySelector('input[name="room"]');
    if (!(name instanceof HTMLInputElement) || !(roomField instanceof HTMLInputElement)) {
      throw new Error('dialog fields missing');
    }
    expect(roomField.value).toBe('plant');
    name.value = 'Ola';
    roomField.value = 'Boiler House 2';
    buttonFor(room.root, '[data-action="join-submit"]').click();
    await settle(room.fixture);
    expect(room.injected(Collaboration).identity().name).toBe('Ola');
    expect(room.opened).toEqual(['/r/Boiler-House-2?server=http://127.0.0.1:4318']);
    expect(dialog?.hasAttribute('open')).toBe(false);
    room.restore();
  });

  it('keeps the dialog open and explains a room name that cannot be used', async () => {
    const room = await mountRoom();
    buttonFor(room.root, '[data-action="identity"]').click();
    await settle(room.fixture);
    const roomField = room.root.querySelector('input[name="room"]');
    if (!(roomField instanceof HTMLInputElement)) throw new Error('room field missing');
    roomField.value = '///';
    buttonFor(room.root, '[data-action="join-submit"]').click();
    await settle(room.fixture);
    expect(room.root.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(room.root.querySelector('#join-error')?.textContent).toContain('letters, digits');
    expect(room.opened).toEqual([]);
    buttonFor(room.root, '[data-action="join-cancel"]').click();
    await settle(room.fixture);
    expect(room.root.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    room.restore();
  });

  it('stays in the same room when only the name changes', async () => {
    const room = await mountRoom();
    buttonFor(room.root, '[data-action="identity"]').click();
    await settle(room.fixture);
    const name = room.root.querySelector('input[name="name"]');
    if (!(name instanceof HTMLInputElement)) throw new Error('name field missing');
    name.value = 'Marta';
    buttonFor(room.root, '[data-action="join-submit"]').click();
    await settle(room.fixture);
    expect(room.opened).toEqual([]);
    expect(room.injected(Collaboration).identity().name).toBe('Marta');
    room.restore();
  });

  it('announces what a remote person changed in the live region, and nothing for the first sync', async () => {
    const room = await mountRoom();
    const remote = await room.remote('Bob', '#1c7ed6');
    const region = room.root.querySelector('[data-live-region]');
    await until(room, () => {
      expect(room.root.querySelectorAll('[data-action="follow"]')).toHaveLength(1);
    });
    expect(region?.textContent.trim()).toBe('');
    moveNodes({ doc: remote.doc, origin: 'remote-test', random: mulberry32(5) }, [
      { id: 'pump-a', pos: [640, 520] },
    ]);
    await vi.waitFor(
      async () => {
        await room.pump();
        room.frames.tick();
        expect(region?.textContent).toContain('Bob moved');
        expect(region?.textContent).toContain('Pump A');
      },
      { timeout: 3000, interval: 25 },
    );
    room.restore();
  });
});
