import {
  History,
  colorForIndex,
  createGraphStore,
  type CommandContext,
  type GraphStore,
  type NodeId,
  type PresenceUser,
} from '@coschema/model';
import { RoomHub, SyncClient, createAwareness } from '@coschema/sync';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { LINK_PROFILES, SimulatedLink, type LinkEvent } from './link';
import { applyOperation } from './operations';
import { Prng } from './prng';
import { clientOf, describeStep, type NetworkAction, type Scenario, type Step } from './scenario';
import { Trace } from './trace';
import { VirtualClock } from './virtual-clock';

export interface Faults {
  readonly zombieClient?: { readonly client: number; readonly afterStep: number };
  readonly loseLogEntry?: number;
}

export interface WorldOptions {
  readonly keepTrace: boolean;
  readonly faults: Faults;
  readonly eventBudget: number;
}

export interface SimClient {
  readonly index: number;
  readonly doc: Y.Doc;
  readonly history: History;
  readonly store: GraphStore;
  readonly sync: SyncClient;
  readonly link: SimulatedLink;
  readonly awareness: Awareness;
  readonly context: CommandContext;
  readonly user: PresenceUser;
}

export const FIRST_CLIENT_ID = 1;
export const HUB_CLIENT_ID = 0;
export const ROOM_GUID = 'sim-room';

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export class World {
  readonly clock = new VirtualClock();
  readonly trace: Trace;
  readonly errors: string[] = [];
  readonly persistedLog: Uint8Array[] = [];
  readonly createdBy = new Map<NodeId, number>();
  readonly hub: RoomHub;
  readonly clients: SimClient[];
  private readonly zombies = new Set<number>();
  private logAttempts = 0;

  constructor(
    readonly scenario: Scenario,
    readonly options: WorldOptions,
  ) {
    this.trace = new Trace(options.keepTrace);
    const prng = Prng.fromSeed(scenario.seed);
    const hubDoc = new Y.Doc({ guid: ROOM_GUID });
    hubDoc.clientID = HUB_CLIENT_ID;
    this.hub = new RoomHub({
      clock: this.clock,
      doc: hubDoc,
      onUpdate: (update) => {
        this.persist(update);
      },
      onError: (error) => {
        this.errors.push(`hub: ${describeError(error)}`);
      },
    });
    this.clients = Array.from({ length: scenario.clients }, (_, index) =>
      this.createClient(index, prng),
    );
    for (const client of this.clients) client.sync.start();
  }

  applyStep(step: Step, position: number): void {
    this.trace.event('step', position, this.clock.now(), describeStep(step));
    this.applyZombieFault(position);
    if (step.kind === 'advance') {
      this.clock.advance(step.ms);
      return;
    }
    const client = this.clients[clientOf(step, this.clients.length) ?? 0];
    if (client === undefined) return;
    if (step.kind === 'network') {
      this.applyNetwork(client, step.action);
      return;
    }
    try {
      const result = applyOperation(client, step.operation, {
        created: (id) => {
          this.createdBy.set(id, client.index);
        },
      });
      this.trace.event('result', client.index, result);
    } catch (error) {
      this.errors.push(`step ${position} (${describeStep(step)}): ${describeError(error)}`);
    }
  }

  heal(): void {
    for (const client of this.clients) {
      client.link.configure(LINK_PROFILES.clean);
      client.link.setPartitioned(false);
      client.link.setOffline(false);
    }
    for (const client of this.clients) this.reconnect(client);
    this.settle();
  }

  settle(): void {
    const processed = this.clock.runUntilIdle(this.options.eventBudget);
    this.trace.event('settled', this.clock.now(), processed);
  }

  isZombie(client: SimClient): boolean {
    return this.zombies.has(client.index);
  }

  reconnect(client: SimClient): void {
    if (this.isZombie(client)) return;
    client.sync.reconnect();
  }

  private applyNetwork(client: SimClient, action: NetworkAction): void {
    switch (action.type) {
      case 'degrade':
        client.link.configure(LINK_PROFILES[action.profile]);
        return;
      case 'partition':
        client.link.setPartitioned(true);
        return;
      case 'unpartition':
        client.link.setPartitioned(false);
        return;
      case 'offline':
        client.link.setOffline(true);
        return;
      case 'online':
        client.link.setOffline(false);
        return;
      case 'reconnect':
        this.reconnect(client);
        return;
    }
  }

  private applyZombieFault(position: number): void {
    const fault = this.options.faults.zombieClient;
    if (fault === undefined || position < fault.afterStep) return;
    const client = this.clients[fault.client];
    if (client === undefined || this.zombies.has(client.index)) return;
    this.zombies.add(client.index);
    client.sync.stop();
  }

  private persist(update: Uint8Array): void {
    const attempt = this.logAttempts;
    this.logAttempts += 1;
    if (this.options.faults.loseLogEntry === attempt) return;
    this.persistedLog.push(update.slice());
  }

  private createClient(index: number, prng: Prng): SimClient {
    const doc = new Y.Doc({ guid: ROOM_GUID });
    doc.clientID = FIRST_CLIENT_ID + index;
    const history = new History(doc);
    const store = createGraphStore(doc);
    const awareness = createAwareness(doc);
    const link = new SimulatedLink({
      clock: this.clock,
      random: prng.split(`link-${index}`).source(),
      accept: (transport) => {
        this.hub.accept(transport);
      },
      onEvent: (event) => {
        this.recordLinkEvent(index, event);
      },
    });
    const sync = new SyncClient({
      doc,
      awareness,
      connect: () => link.connect(),
      getToken: () => `token-${index}`,
      clock: this.clock,
      random: prng.split(`backoff-${index}`).source(),
      onError: (error) => {
        this.errors.push(`client ${index}: ${describeError(error)}`);
      },
    });
    const user: PresenceUser = { name: `user-${index}`, color: colorForIndex(index) };
    return {
      index,
      doc,
      history,
      store,
      sync,
      link,
      awareness,
      context: history.context(prng.split(`commands-${index}`).source()),
      user,
    };
  }

  private recordLinkEvent(index: number, event: LinkEvent): void {
    if (event.kind === 'send') return;
    this.trace.event('link', index, event.kind, event.direction, event.time, event.bytes);
  }
}
