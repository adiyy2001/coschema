import type { RunFailure, RunResult, RunStats } from './run-scenario';

export interface SeedFailure {
  readonly seed: number;
  readonly failures: readonly RunFailure[];
}

export interface SimReport {
  readonly seeds: number;
  readonly from: number;
  readonly failed: number;
  readonly failedSeeds: readonly SeedFailure[];
  readonly durationMs: number;
  readonly seedsPerSecond: number;
  readonly totals: RunStats;
  readonly virtualMs: number;
  readonly generatedAt: string;
  readonly node: string;
}

export const EMPTY_STATS: RunStats = {
  messagesSent: 0,
  messagesDelivered: 0,
  messagesDuplicated: 0,
  messagesLost: 0,
  messagesPartitioned: 0,
  connects: 0,
  loggedUpdates: 0,
};

export function addStats(left: RunStats, right: RunStats): RunStats {
  return {
    messagesSent: left.messagesSent + right.messagesSent,
    messagesDelivered: left.messagesDelivered + right.messagesDelivered,
    messagesDuplicated: left.messagesDuplicated + right.messagesDuplicated,
    messagesLost: left.messagesLost + right.messagesLost,
    messagesPartitioned: left.messagesPartitioned + right.messagesPartitioned,
    connects: left.connects + right.connects,
    loggedUpdates: left.loggedUpdates + right.loggedUpdates,
  };
}

export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function formatSummary(report: SimReport): string {
  return `seeds=${report.seeds} failed=${report.failed} duration=${formatDuration(report.durationMs)}`;
}

export function formatFailure(failure: SeedFailure): string {
  const lines = failure.failures.map(
    (entry) => `  ${entry.phase} ${entry.invariant}: ${entry.detail}`,
  );
  return [
    `FAILED seed=${failure.seed}`,
    ...lines,
    `  replay: pnpm sim --seed ${failure.seed} --verbose`,
  ].join('\n');
}

export function formatSingleRun(result: RunResult, verbose: boolean): string[] {
  const lines = verbose ? [...result.traceLines] : [];
  lines.push(`seed=${result.seed} ok=${result.ok} virtualMs=${Math.round(result.virtualMs)}`);
  lines.push(`traceHash=${result.traceHash}`);
  if (!result.ok) lines.push(formatFailure({ seed: result.seed, failures: result.failures }));
  return lines;
}
