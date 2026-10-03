import { parseArgs } from 'node:util';

export interface PanOptions {
  readonly nodes: number;
  readonly zooms: readonly number[];
  readonly runs: number;
  readonly durationMs: number;
  readonly port: number;
  readonly output: string;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_PAN_OPTIONS: PanOptions = {
  nodes: 5000,
  zooms: [1, 0.75, 0.5, 0.35, 0.25, 0.2, 0.1, 0.05],
  runs: 3,
  durationMs: 4000,
  port: 4319,
  output: 'pan',
  width: 1280,
  height: 720,
};

function positiveNumber(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

export function parsePanOptions(argv: readonly string[]): PanOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      nodes: { type: 'string' },
      zooms: { type: 'string' },
      runs: { type: 'string' },
      duration: { type: 'string' },
      port: { type: 'string' },
      output: { type: 'string' },
    },
  });
  return {
    ...DEFAULT_PAN_OPTIONS,
    nodes: positiveNumber('nodes', values.nodes, DEFAULT_PAN_OPTIONS.nodes),
    zooms:
      values.zooms === undefined
        ? DEFAULT_PAN_OPTIONS.zooms
        : values.zooms.split(',').map((part) => positiveNumber('zooms', part, 1)),
    runs: positiveNumber('runs', values.runs, DEFAULT_PAN_OPTIONS.runs),
    durationMs: positiveNumber('duration', values.duration, DEFAULT_PAN_OPTIONS.durationMs),
    port: positiveNumber('port', values.port, DEFAULT_PAN_OPTIONS.port),
    output: values.output ?? DEFAULT_PAN_OPTIONS.output,
  };
}
