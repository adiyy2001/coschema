import { parseArgs } from 'node:util';

export type StoreChoice = 'postgres' | 'memory';

export interface LoadOptions {
  readonly rooms: number;
  readonly clientsPerRoom: number;
  readonly opsPerSecondPerClient: number;
  readonly windows: number;
  readonly windowSeconds: number;
  readonly warmupSeconds: number;
  readonly workers: number;
  readonly store: StoreChoice;
  readonly output: string;
}

export const DEFAULT_OPTIONS: LoadOptions = {
  rooms: 50,
  clientsPerRoom: 10,
  opsPerSecondPerClient: 4,
  windows: 5,
  windowSeconds: 6,
  warmupSeconds: 4,
  workers: 4,
  store: 'postgres',
  output: 'load',
};

function positive(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

export function parseOptions(argv: readonly string[]): LoadOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      rooms: { type: 'string' },
      clients: { type: 'string' },
      rate: { type: 'string' },
      windows: { type: 'string' },
      'window-seconds': { type: 'string' },
      warmup: { type: 'string' },
      workers: { type: 'string' },
      store: { type: 'string' },
      output: { type: 'string' },
    },
  });
  const store = values.store ?? DEFAULT_OPTIONS.store;
  if (store !== 'postgres' && store !== 'memory')
    throw new Error('--store must be postgres or memory');
  return {
    rooms: Math.floor(positive('rooms', values.rooms, DEFAULT_OPTIONS.rooms)),
    clientsPerRoom: Math.floor(positive('clients', values.clients, DEFAULT_OPTIONS.clientsPerRoom)),
    opsPerSecondPerClient: positive('rate', values.rate, DEFAULT_OPTIONS.opsPerSecondPerClient),
    windows: Math.floor(positive('windows', values.windows, DEFAULT_OPTIONS.windows)),
    windowSeconds: positive(
      'window-seconds',
      values['window-seconds'],
      DEFAULT_OPTIONS.windowSeconds,
    ),
    warmupSeconds: positive('warmup', values.warmup, DEFAULT_OPTIONS.warmupSeconds),
    workers: Math.floor(positive('workers', values.workers, DEFAULT_OPTIONS.workers)),
    store,
    output: values.output ?? DEFAULT_OPTIONS.output,
  };
}
