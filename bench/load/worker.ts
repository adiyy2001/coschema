import { monitorEventLoopDelay, performance as perfHooks } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { fetchToken } from './server-probe';
import type { WorkerCommand, WorkerReply, WorkerSetup } from './protocol';
import {
  createCollectors,
  createLoadClient,
  createOwnNode,
  roomConverged,
  startOperations,
  stopOperations,
  type LoadClient,
} from './workload';

const setup = workerData as WorkerSetup;
const port = parentPort;
if (port === null) throw new Error('the load worker needs a parent');

const collectors = createCollectors();
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
const clients: LoadClient[] = [];
const CONNECT_BATCH = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await sleep(50);
  }
}

function reply(message: WorkerReply, transfer: ArrayBuffer[] = []): void {
  port?.postMessage(message, transfer);
}

async function connect(): Promise<void> {
  const server = {
    httpUrl: setup.httpUrl,
    wsUrl: setup.wsUrl,
    pid: 0,
    logs: [],
    stop: () => Promise.resolve(null),
  };
  for (const room of setup.roomIds) {
    for (let index = 0; index < setup.options.clientsPerRoom; index += 1) {
      const token = await fetchToken(server, `bench-${room}`, `client ${index}`);
      clients.push(createLoadClient(room, index, setup.wsUrl, token, collectors));
    }
  }
  for (let offset = 0; offset < clients.length; offset += CONNECT_BATCH) {
    for (const client of clients.slice(offset, offset + CONNECT_BATCH)) client.sync.start();
    await sleep(100);
  }
  await waitFor(
    () => clients.every((client) => client.sync.isSynced),
    'every client to sync',
    90_000,
  );
  for (const client of clients) createOwnNode(client);
  await waitFor(
    () => clients.every((client) => client.sync.pendingCount === 0),
    'the setup acks',
    90_000,
  );
  reply({ type: 'ready', clients: clients.length });
}

let utilizationAtWindowStart = perfHooks.eventLoopUtilization();

function beginWindow(): void {
  collectors.delivery.clear();
  collectors.acknowledgement.clear();
  collectors.operations = 0;
  collectors.disconnects = 0;
  collectors.denials = 0;
  loopDelay.reset();
  loopDelay.enable();
  utilizationAtWindowStart = perfHooks.eventLoopUtilization();
  collectors.recording = true;
  reply({ type: 'began' });
}

function endWindow(): void {
  collectors.recording = false;
  const utilization = perfHooks.eventLoopUtilization(utilizationAtWindowStart).utilization;
  loopDelay.disable();
  const delivery = collectors.delivery.snapshot();
  const acknowledgement = collectors.acknowledgement.snapshot();
  reply(
    {
      type: 'window',
      delivery,
      acknowledgement,
      operations: collectors.operations,
      disconnects: collectors.disconnects,
      denials: collectors.denials,
      eventLoopUtilization: utilization,
      eventLoopDelayP99Ms: loopDelay.percentile(99) / 1e6,
    },
    [delivery.buffer as ArrayBuffer, acknowledgement.buffer as ArrayBuffer],
  );
}

async function stop(): Promise<void> {
  for (const client of clients) stopOperations(client);
  await waitFor(
    () => clients.every((client) => client.sync.pendingCount === 0),
    'the final acks',
    90_000,
  );
  await sleep(1000);
  const rooms = new Map<number, LoadClient[]>();
  for (const client of clients) rooms.set(client.room, [...(rooms.get(client.room) ?? []), client]);
  const groups = [...rooms.values()];
  reply({
    type: 'stopped',
    rooms: groups.length,
    convergedRooms: groups.filter((group) => roomConverged(group)).length,
  });
}

async function handle(command: WorkerCommand): Promise<void> {
  switch (command.type) {
    case 'connect':
      await connect();
      return;
    case 'start':
      for (const client of clients) {
        startOperations(client, collectors, setup.options.opsPerSecondPerClient);
      }
      reply({ type: 'started' });
      return;
    case 'begin-window':
      beginWindow();
      return;
    case 'end-window':
      endWindow();
      return;
    case 'stop':
      await stop();
      return;
    case 'shutdown':
      for (const client of clients) {
        stopOperations(client);
        client.sync.destroy();
      }
      process.exit(0);
  }
}

port.on('message', (command: WorkerCommand) => {
  handle(command).catch((error: unknown) => {
    reply({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  });
});
