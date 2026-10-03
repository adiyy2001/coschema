import { NODE_KEYS, createNode, getNodes, moveNodes, type CommandContext } from '@coschema/model';
import { SyncClient, createWebSocketTransport, systemClock } from '@coschema/sync';
import * as Y from 'yjs';
import { SampleBuffer } from '../lib/stats';

export interface LoadClient {
  readonly room: number;
  readonly index: number;
  readonly doc: Y.Doc;
  readonly sync: SyncClient;
  readonly nodeId: string;
  sequence: number;
  pendingSince: number | undefined;
  timer: NodeJS.Timeout | undefined;
}

export interface Collectors {
  recording: boolean;
  readonly delivery: SampleBuffer;
  readonly acknowledgement: SampleBuffer;
  operations: number;
  deliveries: number;
  disconnects: number;
  denials: number;
}

export function createCollectors(): Collectors {
  return {
    recording: false,
    delivery: new SampleBuffer(),
    acknowledgement: new SampleBuffer(),
    operations: 0,
    deliveries: 0,
    disconnects: 0,
    denials: 0,
  };
}

function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

function observeDeliveries(doc: Y.Doc, collectors: Collectors): void {
  getNodes(doc).observeDeep((events, transaction) => {
    if (transaction.local || !collectors.recording) return;
    const received = epochNow();
    for (const event of events) {
      if (!event.keys.has(NODE_KEYS.pos) || !(event.target instanceof Y.Map)) continue;
      const position = event.target.get(NODE_KEYS.pos) as readonly [number, number] | undefined;
      if (position === undefined) continue;
      collectors.delivery.push(received - position[0]);
      collectors.deliveries += 1;
    }
  });
}

function trackAcknowledgements(client: LoadClient, collectors: Collectors): void {
  let lastStatus = client.sync.currentStatus;
  client.sync.subscribe((snapshot) => {
    if (snapshot.pendingCount === 0 && client.pendingSince !== undefined) {
      if (collectors.recording) collectors.acknowledgement.push(epochNow() - client.pendingSince);
      client.pendingSince = undefined;
    }
    if (lastStatus === 'online' && snapshot.status !== 'online') {
      if (snapshot.status === 'denied') collectors.denials += 1;
      else collectors.disconnects += 1;
    }
    lastStatus = snapshot.status;
  });
}

export function createLoadClient(
  room: number,
  index: number,
  wsUrl: string,
  token: string,
  collectors: Collectors,
): LoadClient {
  const doc = new Y.Doc();
  const sync = new SyncClient({
    doc,
    connect: () => createWebSocketTransport(`${wsUrl}/rooms/bench-${room}`),
    getToken: () => token,
    clock: systemClock,
    random: Math.random,
  });
  const client: LoadClient = {
    room,
    index,
    doc,
    sync,
    nodeId: `r${room}c${index}`.padEnd(16, '0'),
    sequence: 0,
    pendingSince: undefined,
    timer: undefined,
  };
  observeDeliveries(doc, collectors);
  trackAcknowledgements(client, collectors);
  return client;
}

function contextFor(client: LoadClient): CommandContext {
  return { doc: client.doc, origin: client, random: Math.random };
}

export function createOwnNode(client: LoadClient): void {
  createNode(contextFor(client), {
    id: client.nodeId,
    type: 'rect',
    pos: [0, client.index * 80],
    label: `client ${client.index}`,
  });
}

function applyOperation(client: LoadClient, collectors: Collectors): void {
  const now = epochNow();
  client.sequence += 1;
  client.pendingSince ??= now;
  moveNodes(contextFor(client), [{ id: client.nodeId, pos: [now, client.sequence] }]);
  if (collectors.recording) collectors.operations += 1;
}

export function startOperations(
  client: LoadClient,
  collectors: Collectors,
  opsPerSecond: number,
): void {
  const intervalMs = 1000 / opsPerSecond;
  const schedule = (delay: number): void => {
    client.timer = setTimeout(() => {
      applyOperation(client, collectors);
      schedule(intervalMs * (0.5 + Math.random()));
    }, delay);
  };
  schedule(Math.random() * intervalMs);
}

export function stopOperations(client: LoadClient): void {
  if (client.timer !== undefined) clearTimeout(client.timer);
  client.timer = undefined;
}

export function roomConverged(clients: readonly LoadClient[]): boolean {
  const reference = JSON.stringify(
    [...Y.decodeStateVector(Y.encodeStateVector(clients[0]?.doc ?? new Y.Doc()))].sort(),
  );
  return clients.every(
    (client) =>
      JSON.stringify([...Y.decodeStateVector(Y.encodeStateVector(client.doc))].sort()) ===
      reference,
  );
}
