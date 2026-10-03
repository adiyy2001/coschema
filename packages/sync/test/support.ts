import * as Y from 'yjs';
import {
  RoomHub,
  decodeEnvelope,
  encodeAuthToken,
  type Envelope,
  SyncClient,
  createMemoryPair,
  systemClock,
  type MemoryPair,
  type RoomHubOptions,
  type SyncClientOptions,
  type Transport,
} from '../src';

export interface FrameLog {
  readonly sent: Uint8Array[];
  readonly received: Uint8Array[];
}

export function constantRandom(value: number): () => number {
  return () => value;
}

export class MemoryNetwork {
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

export function recordClientFrames(transport: Transport, log: FrameLog): Transport {
  return {
    send: (data) => {
      log.sent.push(data.slice());
      transport.send(data);
    },
    close: (code, reason) => {
      transport.close(code, reason);
    },
    onOpen: (handler) => transport.onOpen(handler),
    onMessage: (handler) =>
      transport.onMessage((data) => {
        log.received.push(data.slice());
        handler(data);
      }),
    onClose: (handler) => transport.onClose(handler),
  };
}

export interface Harness {
  readonly hub: RoomHub;
  readonly network: MemoryNetwork;
  readonly errors: unknown[];
  connector(log?: FrameLog): () => Transport;
  client(overrides?: Partial<SyncClientOptions>, clientId?: number, log?: FrameLog): SyncClient;
}

export function createHarness(hubOptions: Partial<RoomHubOptions> = {}): Harness {
  const errors: unknown[] = [];
  const hub = new RoomHub({
    clock: systemClock,
    onError: (error) => errors.push(error),
    ...hubOptions,
  });
  const network = new MemoryNetwork();
  const connector = (log?: FrameLog) => (): Transport => {
    const pair = createMemoryPair();
    network.pairs.push(pair);
    hub.accept(pair.server);
    return log === undefined ? pair.client : recordClientFrames(pair.client, log);
  };
  let nextClientId = 100;
  return {
    hub,
    network,
    errors,
    connector,
    client: (overrides = {}, clientId, log) => {
      const doc = new Y.Doc();
      doc.clientID = clientId ?? nextClientId;
      nextClientId += 1;
      return new SyncClient({
        doc,
        connect: connector(log),
        getToken: () => 'token',
        clock: systemClock,
        random: constantRandom(0),
        onError: (error) => errors.push(error),
        ...overrides,
      });
    },
  };
}

export function setLabel(doc: Y.Doc, key: string, value: string): void {
  doc.getMap<string>('labels').set(key, value);
}

export function labelsOf(doc: Y.Doc): Record<string, string> {
  return doc.getMap<string>('labels').toJSON();
}

export interface RawPeer {
  readonly pair: MemoryPair;
  readonly received: Envelope[];
  readonly closes: { code: number; reason: string }[];
  send(frame: Uint8Array): void;
  settle(): void;
  ofType<Type extends Envelope['type']>(type: Type): Extract<Envelope, { type: Type }>[];
}

export function connectRawPeer(hub: RoomHub): RawPeer {
  const pair = createMemoryPair();
  const received: Envelope[] = [];
  const closes: { code: number; reason: string }[] = [];
  pair.client.onMessage((data) => received.push(decodeEnvelope(data)));
  pair.client.onClose((code, reason) => closes.push({ code, reason }));
  hub.accept(pair.server);
  return {
    pair,
    received,
    closes,
    send: (frame) => {
      pair.client.send(frame);
    },
    settle: () => {
      pair.flush();
    },
    ofType: (type) =>
      received.filter((envelope) => envelope.type === type) as Extract<
        Envelope,
        { type: typeof type }
      >[],
  };
}

export function authenticatedPeer(hub: RoomHub): RawPeer {
  const peer = connectRawPeer(hub);
  peer.send(encodeAuthToken('token'));
  peer.settle();
  return peer;
}

export function updatesOf(doc: Y.Doc, edits: ((doc: Y.Doc) => void)[]): Uint8Array[] {
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  for (const edit of edits) edit(doc);
  return updates;
}

export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export async function flushPromises(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}
