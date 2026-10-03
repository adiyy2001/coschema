import { Worker } from 'node:worker_threads';
import type { LoadOptions } from './options';
import type { WindowReport, WorkerCommand, WorkerReply, WorkerSetup } from './protocol';

export class GeneratorWorker {
  private readonly waiting: ((reply: WorkerReply) => void)[] = [];
  private failure: Error | undefined;

  constructor(private readonly worker: Worker) {
    worker.on('message', (reply: WorkerReply) => {
      const next = this.waiting.shift();
      next?.(reply);
    });
    worker.on('error', (error: Error) => {
      this.failure = error;
      const message = error.message;
      for (const next of this.waiting.splice(0)) next({ type: 'failed', message });
    });
  }

  request(command: WorkerCommand): Promise<WorkerReply> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting.push((reply) => {
        if (reply.type === 'failed') reject(new Error(reply.message));
        else resolve(reply);
      });
      this.worker.postMessage(command);
    });
  }

  async shutdown(): Promise<void> {
    this.worker.postMessage({ type: 'shutdown' } satisfies WorkerCommand);
    await new Promise<void>((resolve) => {
      this.worker.once('exit', () => {
        resolve();
      });
    });
  }
}

function roomsForWorker(options: LoadOptions, index: number): number[] {
  const rooms: number[] = [];
  for (let room = index; room < options.rooms; room += options.workers) rooms.push(room);
  return rooms;
}

export function spawnGenerators(
  options: LoadOptions,
  urls: { readonly wsUrl: string; readonly httpUrl: string },
): GeneratorWorker[] {
  const workers: GeneratorWorker[] = [];
  for (let index = 0; index < options.workers; index += 1) {
    const roomIds = roomsForWorker(options, index);
    if (roomIds.length === 0) continue;
    const setup: WorkerSetup = { options, wsUrl: urls.wsUrl, httpUrl: urls.httpUrl, roomIds };
    workers.push(
      new GeneratorWorker(
        new Worker(new URL('./worker.ts', import.meta.url), { workerData: setup }),
      ),
    );
  }
  return workers;
}

export async function everyWorker<Reply extends WorkerReply['type']>(
  workers: readonly GeneratorWorker[],
  command: WorkerCommand,
  expected: Reply,
): Promise<Extract<WorkerReply, { type: Reply }>[]> {
  const replies = await Promise.all(workers.map((worker) => worker.request(command)));
  return replies.map((reply) => {
    if (reply.type !== expected) throw new Error(`expected ${expected}, got ${reply.type}`);
    return reply as Extract<WorkerReply, { type: Reply }>;
  });
}

export function combineWindows(reports: readonly WindowReport[]): {
  readonly delivery: Float64Array;
  readonly acknowledgement: Float64Array;
  readonly operations: number;
  readonly disconnects: number;
  readonly denials: number;
  readonly maxUtilization: number;
  readonly maxLoopDelayP99Ms: number;
} {
  const join = (parts: readonly Float64Array[]): Float64Array => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Float64Array(total);
    let offset = 0;
    for (const part of parts) {
      merged.set(part, offset);
      offset += part.length;
    }
    return merged;
  };
  return {
    delivery: join(reports.map((report) => report.delivery)),
    acknowledgement: join(reports.map((report) => report.acknowledgement)),
    operations: reports.reduce((sum, report) => sum + report.operations, 0),
    disconnects: reports.reduce((sum, report) => sum + report.disconnects, 0),
    denials: reports.reduce((sum, report) => sum + report.denials, 0),
    maxUtilization: Math.max(...reports.map((report) => report.eventLoopUtilization)),
    maxLoopDelayP99Ms: Math.max(...reports.map((report) => report.eventLoopDelayP99Ms)),
  };
}
