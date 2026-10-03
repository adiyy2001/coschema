import type { Clock, TimerHandle } from '@coschema/sync';
import * as Y from 'yjs';

export interface BatcherOptions {
  readonly clock: Clock;
  readonly intervalMs: number;
  readonly maxBytes: number;
  readonly write: (update: Uint8Array) => Promise<void>;
}

interface Batch {
  readonly updates: Uint8Array[];
  bytes: number;
  timer: TimerHandle | undefined;
  readonly settled: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function openBatch(): Batch {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const settled = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  settled.catch(() => undefined);
  return { updates: [], bytes: 0, timer: undefined, settled, resolve, reject };
}

export class UpdateBatcher {
  private current: Batch | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly options: BatcherOptions) {}

  get hasPending(): boolean {
    return this.current !== undefined;
  }

  add(update: Uint8Array): Promise<void> {
    const batch = this.current ?? this.start();
    batch.updates.push(update);
    batch.bytes += update.byteLength;
    if (batch.bytes >= this.options.maxBytes) this.release(batch);
    return batch.settled;
  }

  async flush(): Promise<void> {
    if (this.current !== undefined) this.release(this.current);
    await this.writes;
  }

  private start(): Batch {
    const batch = openBatch();
    this.current = batch;
    batch.timer = this.options.clock.setTimeout(() => {
      batch.timer = undefined;
      this.release(batch);
    }, this.options.intervalMs);
    return batch;
  }

  private release(batch: Batch): void {
    if (this.current !== batch) return;
    this.current = undefined;
    if (batch.timer !== undefined) this.options.clock.clearTimeout(batch.timer);
    batch.timer = undefined;
    this.writes = this.writes.then(async () => {
      try {
        await this.options.write(Y.mergeUpdates(batch.updates));
        batch.resolve();
      } catch (error) {
        batch.reject(error);
      }
    });
  }
}
