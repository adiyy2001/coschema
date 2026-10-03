import { parseArgs } from 'node:util';

export interface GeometryOptions {
  readonly sizes: readonly number[];
  readonly runs: number;
  readonly seed: number;
  readonly queries: number;
  readonly moves: number;
  readonly output: string;
}

export const DEFAULT_GEOMETRY_OPTIONS: GeometryOptions = {
  sizes: [100, 1000, 5000],
  runs: 5,
  seed: 20261003,
  queries: 2000,
  moves: 200,
  output: 'geometry',
};

function positiveInteger(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`--${name} must be a positive integer`);
  return value;
}

export function parseGeometryOptions(argv: readonly string[]): GeometryOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      sizes: { type: 'string' },
      runs: { type: 'string' },
      seed: { type: 'string' },
      queries: { type: 'string' },
      moves: { type: 'string' },
      output: { type: 'string' },
    },
  });
  const sizes =
    values.sizes === undefined
      ? DEFAULT_GEOMETRY_OPTIONS.sizes
      : values.sizes.split(',').map((part) => positiveInteger('sizes', part, 0));
  return {
    sizes,
    runs: positiveInteger('runs', values.runs, DEFAULT_GEOMETRY_OPTIONS.runs),
    seed: positiveInteger('seed', values.seed, DEFAULT_GEOMETRY_OPTIONS.seed),
    queries: positiveInteger('queries', values.queries, DEFAULT_GEOMETRY_OPTIONS.queries),
    moves: positiveInteger('moves', values.moves, DEFAULT_GEOMETRY_OPTIONS.moves),
    output: values.output ?? DEFAULT_GEOMETRY_OPTIONS.output,
  };
}
