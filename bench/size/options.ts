import { parseArgs } from 'node:util';

type SizeStore = 'postgres' | 'memory';

export interface SizeOptions {
  readonly sizes: readonly number[];
  readonly seed: number;
  readonly store: SizeStore;
  readonly output: string;
}

export const DEFAULT_SIZE_OPTIONS: SizeOptions = {
  sizes: [100, 1000, 5000],
  seed: 20261003,
  store: 'postgres',
  output: 'size',
};

function positiveInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return value;
}

function storeFrom(raw: string | undefined): SizeStore {
  if (raw === undefined) return DEFAULT_SIZE_OPTIONS.store;
  if (raw === 'postgres' || raw === 'memory') return raw;
  throw new Error('--store must be postgres or memory');
}

export function parseSizeOptions(argv: readonly string[]): SizeOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      sizes: { type: 'string' },
      seed: { type: 'string' },
      store: { type: 'string' },
      output: { type: 'string' },
    },
  });
  return {
    sizes:
      values.sizes === undefined
        ? DEFAULT_SIZE_OPTIONS.sizes
        : values.sizes.split(',').map((part) => positiveInteger('sizes', part)),
    seed:
      values.seed === undefined ? DEFAULT_SIZE_OPTIONS.seed : positiveInteger('seed', values.seed),
    store: storeFrom(values.store),
    output: values.output ?? DEFAULT_SIZE_OPTIONS.output,
  };
}
