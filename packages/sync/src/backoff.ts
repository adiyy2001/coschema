import type { RandomSource } from '@coschema/model';

export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly factor: number;
  readonly jitter: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.5,
};

export function backoffCeiling(attempt: number, options: BackoffOptions): number {
  return Math.min(options.maxMs, options.baseMs * options.factor ** Math.max(0, attempt));
}

export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  random: RandomSource,
): number {
  const ceiling = backoffCeiling(attempt, options);
  return Math.round(ceiling * (1 - options.jitter * random()));
}
