import { parseArgs } from 'node:util';

export type LatencyStore = 'memory' | 'postgres';

export interface LatencyOptions {
  readonly stores: readonly LatencyStore[];
  readonly edits: number;
  readonly warmupEdits: number;
  readonly editorPort: number;
  readonly serverPort: number;
  readonly output: string;
}

const DEFAULT_OPTIONS: LatencyOptions = {
  stores: ['memory', 'postgres'],
  edits: 200,
  warmupEdits: 10,
  editorPort: 4320,
  serverPort: 4321,
  output: 'latency',
};

function whole(name: string, raw: string | undefined, fallback: number, minimum: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`--${name} must be a whole number of at least ${minimum}`);
  }
  return value;
}

function parseStores(raw: string | undefined): readonly LatencyStore[] {
  if (raw === undefined) return DEFAULT_OPTIONS.stores;
  const stores = raw.split(',').map((entry) => entry.trim());
  for (const store of stores) {
    if (store !== 'memory' && store !== 'postgres') {
      throw new Error('--stores must list memory and postgres, separated by commas');
    }
  }
  return stores as LatencyStore[];
}

export function parseLatencyOptions(argv: readonly string[]): LatencyOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      stores: { type: 'string' },
      edits: { type: 'string' },
      warmup: { type: 'string' },
      'editor-port': { type: 'string' },
      'server-port': { type: 'string' },
      output: { type: 'string' },
    },
  });
  return {
    stores: parseStores(values.stores),
    edits: whole('edits', values.edits, DEFAULT_OPTIONS.edits, 10),
    warmupEdits: whole('warmup', values.warmup, DEFAULT_OPTIONS.warmupEdits, 0),
    editorPort: whole('editor-port', values['editor-port'], DEFAULT_OPTIONS.editorPort, 1024),
    serverPort: whole('server-port', values['server-port'], DEFAULT_OPTIONS.serverPort, 1024),
    output: values.output ?? DEFAULT_OPTIONS.output,
  };
}
