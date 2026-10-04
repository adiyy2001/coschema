import { execFileSync } from 'node:child_process';
import { startTestDatabase, type TestDatabase } from '../../scripts/test-database';
import { describeHardware } from '../lib/hardware';
import { round, summarize } from '../lib/stats';
import {
  combineWindows,
  everyWorker,
  spawnGenerators,
  type GeneratorWorker,
} from './generator-pool';
import type { LoadOptions } from './options';
import { fetchMetrics, sampleProcess, startServer, type RunningServer } from './server-probe';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WindowResult {
  readonly seconds: number;
  readonly operations: number;
  readonly opsPerSecond: number;
  readonly deliveries: number;
  readonly deliveryP50Ms: number;
  readonly deliveryP95Ms: number;
  readonly deliveryP99Ms: number;
  readonly serverCpuPercent: number;
  readonly serverRssMiB: number;
  readonly generatorBusiestWorker: number;
}

export interface LoadSummary {
  readonly operationsPerSecond: number;
  readonly deliveryP95Ms: number;
  readonly deliveryP99Ms: number;
  readonly acknowledgementP95Ms: number;
  readonly serverCpuPercentOfOneCore: number;
  readonly busiestGeneratorUtilization: number;
  readonly disconnects: number;
}

export interface LoadRun {
  readonly result: object;
  readonly summary: LoadSummary;
  readonly converged: boolean;
}

async function measureWindow(
  options: LoadOptions,
  server: RunningServer,
  workers: readonly GeneratorWorker[],
  allDelivery: Float64Array[],
  allAcknowledgement: Float64Array[],
): Promise<WindowResult & { disconnects: number; denials: number; loopDelayP99Ms: number }> {
  await everyWorker(workers, { type: 'begin-window' }, 'began');
  const before = await sampleProcess(server.pid);
  const started = performance.now();
  await sleep(options.windowSeconds * 1000);
  const reports = await everyWorker(workers, { type: 'end-window' }, 'window');
  const seconds = (performance.now() - started) / 1000;
  const after = await sampleProcess(server.pid);
  const combined = combineWindows(reports);
  allDelivery.push(combined.delivery);
  allAcknowledgement.push(combined.acknowledgement);
  const summary = summarize(combined.delivery);
  return {
    seconds: round(seconds),
    operations: combined.operations,
    opsPerSecond: round(combined.operations / seconds),
    deliveries: combined.delivery.length,
    deliveryP50Ms: summary.p50,
    deliveryP95Ms: summary.p95,
    deliveryP99Ms: summary.p99,
    serverCpuPercent: round(((after.cpuSeconds - before.cpuSeconds) / seconds) * 100),
    serverRssMiB: round(after.rssMiB),
    generatorBusiestWorker: round(combined.maxUtilization, 3),
    disconnects: combined.disconnects,
    denials: combined.denials,
    loopDelayP99Ms: round(combined.maxLoopDelayP99Ms),
  };
}

function concatenate(parts: readonly Float64Array[]): Float64Array {
  const merged = new Float64Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function postgresVersion(): string | undefined {
  try {
    return execFileSync('docker', ['exec', 'coschema-test-pg', 'postgres', '--version'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

export async function runLoad(options: LoadOptions): Promise<LoadRun> {
  let database: TestDatabase | undefined;
  let server: RunningServer | undefined;
  let workers: GeneratorWorker[] = [];
  try {
    if (options.store === 'postgres') database = await startTestDatabase();
    server = await startServer({ store: options.store, databaseUrl: database?.url });
    console.log(`server pid ${server.pid} on ${server.httpUrl}, store ${options.store}`);
    workers = spawnGenerators(options, { wsUrl: server.wsUrl, httpUrl: server.httpUrl });
    const ready = await everyWorker(workers, { type: 'connect' }, 'ready');
    const clientCount = ready.reduce((sum, reply) => sum + reply.clients, 0);
    console.log(
      `${clientCount} clients synced in ${options.rooms} rooms on ${workers.length} workers`,
    );
    await everyWorker(workers, { type: 'start' }, 'started');
    await sleep(options.warmupSeconds * 1000);

    const generatorBefore = process.cpuUsage();
    const serverBefore = await sampleProcess(server.pid);
    const metricsBefore = await fetchMetrics(server);
    const measureStarted = performance.now();
    const allDelivery: Float64Array[] = [];
    const allAcknowledgement: Float64Array[] = [];
    const windows: Awaited<ReturnType<typeof measureWindow>>[] = [];
    for (let index = 0; index < options.windows; index += 1) {
      const result = await measureWindow(options, server, workers, allDelivery, allAcknowledgement);
      windows.push(result);
      console.log(
        `window ${index + 1}/${options.windows}: ${result.opsPerSecond} ops/s, p95 ${result.deliveryP95Ms} ms, server cpu ${result.serverCpuPercent}%, busiest generator ${result.generatorBusiestWorker}`,
      );
    }
    const measureSeconds = (performance.now() - measureStarted) / 1000;
    const generatorUsage = process.cpuUsage(generatorBefore);
    const serverAfter = await sampleProcess(server.pid);
    const metricsAfter = await fetchMetrics(server);
    const stopped = await everyWorker(workers, { type: 'stop' }, 'stopped');
    const rooms = stopped.reduce((sum, reply) => sum + reply.rooms, 0);
    const convergedRooms = stopped.reduce((sum, reply) => sum + reply.convergedRooms, 0);

    const totalOperations = windows.reduce((sum, window) => sum + window.operations, 0);
    const delivery = summarize(concatenate(allDelivery));
    const acknowledgement = summarize(concatenate(allAcknowledgement));
    const updatesApplied =
      (metricsAfter['updates_applied_total'] ?? 0) - (metricsBefore['updates_applied_total'] ?? 0);
    const result = {
      generatedAt: new Date().toISOString(),
      hardware: describeHardware(),
      postgres: options.store === 'postgres' ? postgresVersion() : undefined,
      configuration: {
        store: options.store,
        rooms: options.rooms,
        clientsPerRoom: options.clientsPerRoom,
        clients: clientCount,
        generatorWorkers: workers.length,
        targetOpsPerSecondPerClient: options.opsPerSecondPerClient,
        warmupSeconds: options.warmupSeconds,
        windows: options.windows,
        windowSeconds: options.windowSeconds,
        batchWindowMs: 50,
      },
      results: {
        operations: totalOperations,
        opsPerSecond: round(totalOperations / measureSeconds),
        serverAppliedOpsPerSecond: round(updatesApplied / measureSeconds),
        deliveries: delivery.samples,
        deliveriesPerSecond: round(delivery.samples / measureSeconds),
        latencyMs: {
          description:
            'from the write in one client to the observer callback in another client of the same room',
          p50: delivery.p50,
          p95: delivery.p95,
          p99: delivery.p99,
          mean: delivery.mean,
          max: delivery.max,
        },
        acknowledgementMs: {
          description: 'from the first unacknowledged write of a client to its persistence ack',
          samples: acknowledgement.samples,
          p50: acknowledgement.p50,
          p95: acknowledgement.p95,
          p99: acknowledgement.p99,
          max: acknowledgement.max,
        },
        windows: windows.map((window) => ({
          seconds: window.seconds,
          operations: window.operations,
          opsPerSecond: window.opsPerSecond,
          deliveries: window.deliveries,
          deliveryP50Ms: window.deliveryP50Ms,
          deliveryP95Ms: window.deliveryP95Ms,
          deliveryP99Ms: window.deliveryP99Ms,
          serverCpuPercent: window.serverCpuPercent,
          serverRssMiB: window.serverRssMiB,
          generatorBusiestWorker: window.generatorBusiestWorker,
        })),
        p95SpreadMs: {
          min: Math.min(...windows.map((window) => window.deliveryP95Ms)),
          max: Math.max(...windows.map((window) => window.deliveryP95Ms)),
        },
        convergedRooms,
        rooms,
        disconnects: windows.reduce((sum, window) => sum + window.disconnects, 0),
        denials: windows.reduce((sum, window) => sum + window.denials, 0),
        server: {
          cpuPercentOfOneCore: round(
            ((serverAfter.cpuSeconds - serverBefore.cpuSeconds) / measureSeconds) * 100,
          ),
          rssMiB: round(serverAfter.rssMiB),
          peakRssMiB: round(serverAfter.peakRssMiB),
          counters: metricsAfter,
        },
        loadGenerator: {
          processCpuPercentOfOneCore: round(
            ((generatorUsage.user + generatorUsage.system) / 1e6 / measureSeconds) * 100,
          ),
          busiestWorkerEventLoopUtilization: Math.max(
            ...windows.map((window) => window.generatorBusiestWorker),
          ),
          worstEventLoopDelayP99Ms: Math.max(...windows.map((window) => window.loopDelayP99Ms)),
        },
      },
      notes: [
        'The load generator runs in worker threads of one Node process, each worker owning whole rooms. Its event loop utilization is reported next to the latency, so a saturated generator is visible.',
        'The server runs as a separate process on the same machine. The numbers describe this machine and this run only.',
      ],
    };
    console.log(
      `ops/s ${result.results.opsPerSecond}, delivery p50 ${delivery.p50} ms, p95 ${delivery.p95} ms, p99 ${delivery.p99} ms`,
    );
    console.log(`rooms converged ${convergedRooms}/${rooms}`);
    const summary: LoadSummary = {
      operationsPerSecond: result.results.opsPerSecond,
      deliveryP95Ms: delivery.p95,
      deliveryP99Ms: delivery.p99,
      acknowledgementP95Ms: acknowledgement.p95,
      serverCpuPercentOfOneCore: result.results.server.cpuPercentOfOneCore,
      busiestGeneratorUtilization: result.results.loadGenerator.busiestWorkerEventLoopUtilization,
      disconnects: result.results.disconnects,
    };
    return { result, summary, converged: convergedRooms === rooms };
  } finally {
    await Promise.all(workers.map((worker) => worker.shutdown().catch(() => undefined)));
    if (server !== undefined) {
      const code = await server.stop();
      console.log(`server exited with ${code}`);
    }
    if (database !== undefined) await database.stop();
  }
}
