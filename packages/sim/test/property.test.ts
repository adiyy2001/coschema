import { describe, expect, it } from 'vitest';
import { checkConvergence, formatPropertyFailure } from '../src/property';

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

const RUNS = envNumber('SIM_RUNS') ?? 40;
const RUNNER_SEED = envNumber('SIM_SEED');

describe('convergence property', () => {
  it(`holds for ${RUNS} generated scenarios`, () => {
    const outcome = checkConvergence({
      numRuns: RUNS,
      ...(RUNNER_SEED === undefined ? {} : { seed: RUNNER_SEED }),
    });
    expect(formatPropertyFailure(outcome)).toBe(`convergence held for ${RUNS} runs`);
    expect(outcome.ok).toBe(true);
    expect(outcome.failure).toBeUndefined();
  });

  it('is deterministic for a runner seed', () => {
    const first = checkConvergence({ numRuns: 5, seed: 99 });
    const second = checkConvergence({ numRuns: 5, seed: 99 });
    expect(first.runnerSeed).toBe(99);
    expect(second).toEqual(first);
  });
});

describe('convergence property with an injected bug', () => {
  const outcome = checkConvergence({
    numRuns: 100,
    seed: 4242,
    faults: { loseLogEntry: 2 },
    shape: { minClients: 2, maxClients: 5, minSteps: 20, maxSteps: 60 },
  });

  it('fails and shrinks the scenario', () => {
    expect(outcome.ok).toBe(false);
    expect(outcome.failure).toBeDefined();
    expect(outcome.failure?.shrinks).toBeGreaterThan(0);
    expect(outcome.failure?.result.ok).toBe(false);
    expect(outcome.failure?.scenario.steps.length).toBeLessThan(60 + 12);
  });

  it('prints the seeds, the broken invariant and a replay command', () => {
    const text = formatPropertyFailure(outcome);
    const seed = outcome.failure?.scenario.seed;
    expect(text).toContain(`seed=${String(seed)}`);
    expect(text).toContain('runner-seed=4242');
    expect(text).toContain('persisted-log-replays');
    expect(text).toContain('SIM_SEED=4242 pnpm test:sim');
  });

  it('fails the same way when replayed with the same runner seed', () => {
    const again = checkConvergence({
      numRuns: 100,
      seed: 4242,
      faults: { loseLogEntry: 2 },
      shape: { minClients: 2, maxClients: 5, minSteps: 20, maxSteps: 60 },
    });
    expect(again.failure?.scenario).toEqual(outcome.failure?.scenario);
  });
});
