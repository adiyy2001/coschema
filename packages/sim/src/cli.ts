import { parseArgs } from 'node:util';
import { scenarioFromSeed } from './seeds';
import {
  EMPTY_STATS,
  addStats,
  formatFailure,
  formatDuration,
  formatSingleRun,
  formatSummary,
  type SeedFailure,
  type StopReason,
  type SimReport,
} from './report';
import { runScenario, type RunStats } from './run-scenario';
import type { Faults } from './world';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => number;
  readonly isoNow: () => string;
  readonly writeJson: (path: string, value: unknown) => void;
  readonly nodeVersion: string;
}

export const DEFAULT_RESULTS_PATH = 'bench/results/sim.json';
export const OVER_BUDGET_EXIT_CODE = 3;
const MAX_PRINTED_FAILURES = 10;
const PROGRESS_EVERY = 1000;

const USAGE = [
  'usage: pnpm sim --seeds <count> [--from <seed>] [--out <file>] [--budget <seconds>] [--bail]',
  '       pnpm sim --seed <seed> [--verbose]',
  '       add --inject lose-log or --inject zombie to prove the simulator catches a bug',
].join('\n');

interface Options {
  readonly seeds: number | undefined;
  readonly seed: number | undefined;
  readonly from: number;
  readonly verbose: boolean;
  readonly out: string;
  readonly budgetSeconds: number | undefined;
  readonly storm: boolean;
  readonly bail: boolean;
  readonly faults: Faults;
}

const INJECTED_FAULTS: Readonly<Record<string, Faults>> = {
  'lose-log': { loseLogEntry: 1 },
  zombie: { zombieClient: { client: 0, afterStep: 6 } },
};

function parseFaults(name: string | undefined): Faults {
  if (name === undefined) return {};
  const faults = INJECTED_FAULTS[name];
  if (faults === undefined) {
    throw new RangeError(`--inject must be one of ${Object.keys(INJECTED_FAULTS).join(', ')}`);
  }
  return faults;
}

function parseCount(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
  return parsed;
}

function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      seeds: { type: 'string' },
      seed: { type: 'string' },
      from: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      out: { type: 'string' },
      budget: { type: 'string' },
      'no-storm': { type: 'boolean', default: false },
      bail: { type: 'boolean', default: false },
      inject: { type: 'string' },
    },
    strict: true,
  });
  return {
    seeds: parseCount('--seeds', values.seeds),
    seed: parseCount('--seed', values.seed),
    from: parseCount('--from', values.from) ?? 1,
    verbose: values.verbose,
    out: values.out ?? DEFAULT_RESULTS_PATH,
    budgetSeconds: parseCount('--budget', values.budget),
    storm: !values['no-storm'],
    bail: values.bail,
    faults: parseFaults(values.inject),
  };
}

function runSingle(options: Options, seed: number, io: CliIo): number {
  const result = runScenario(scenarioFromSeed(seed), {
    keepTrace: options.verbose,
    undoStorm: options.storm,
    faults: options.faults,
  });
  for (const line of formatSingleRun(result, options.verbose)) io.out(line);
  return result.ok ? 0 : 1;
}

function runMany(options: Options, count: number, io: CliIo): number {
  const started = io.now();
  const deadline =
    options.budgetSeconds === undefined ? undefined : started + options.budgetSeconds * 1000;
  const failedSeeds: SeedFailure[] = [];
  let totals: RunStats = EMPTY_STATS;
  let virtualMs = 0;
  let completed = 0;
  let stoppedEarly: StopReason | undefined;
  while (completed < count && stoppedEarly === undefined) {
    const seed = options.from + completed;
    const result = runScenario(scenarioFromSeed(seed), {
      undoStorm: options.storm,
      faults: options.faults,
    });
    completed += 1;
    totals = addStats(totals, result.stats);
    virtualMs += result.virtualMs;
    if (!result.ok) {
      const failure = { seed, failures: result.failures };
      failedSeeds.push(failure);
      if (failedSeeds.length <= MAX_PRINTED_FAILURES) io.out(formatFailure(failure));
      if (options.bail) stoppedEarly = 'bail';
    }
    if (completed % PROGRESS_EVERY === 0 && completed < count) {
      io.err(`${completed}/${count} seeds, ${failedSeeds.length} failed`);
    }
    if (stoppedEarly === undefined && completed < count && deadline !== undefined) {
      if (io.now() > deadline) stoppedEarly = 'budget';
    }
  }
  const durationMs = io.now() - started;
  const report: SimReport = {
    seeds: completed,
    requested: count,
    stoppedEarly,
    from: options.from,
    failed: failedSeeds.length,
    failedSeeds,
    durationMs: Math.round(durationMs),
    seedsPerSecond: durationMs > 0 ? Math.round((completed / durationMs) * 1000 * 10) / 10 : 0,
    totals,
    virtualMs: Math.round(virtualMs),
    generatedAt: io.isoNow(),
    node: io.nodeVersion,
  };
  if (failedSeeds.length > MAX_PRINTED_FAILURES) {
    io.out(`... and ${failedSeeds.length - MAX_PRINTED_FAILURES} more failing seeds`);
  }
  io.out(formatSummary(report));
  io.writeJson(options.out, report);
  if (failedSeeds.length > 0) return 1;
  if (stoppedEarly === 'budget') {
    io.err(
      `over budget: stopped after ${completed} of ${count} seeds, the ${options.budgetSeconds}s allowed ran out`,
    );
    return OVER_BUDGET_EXIT_CODE;
  }
  if (deadline !== undefined && io.now() > deadline) {
    io.err(
      `over budget: ${formatDuration(durationMs)} is more than the ${options.budgetSeconds}s allowed`,
    );
    return OVER_BUDGET_EXIT_CODE;
  }
  return 0;
}

export function runCli(argv: readonly string[], io: CliIo): number {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(USAGE);
    return 2;
  }
  if (options.seed !== undefined) return runSingle(options, options.seed, io);
  if (options.seeds !== undefined) return runMany(options, options.seeds, io);
  io.err(USAGE);
  return 2;
}
