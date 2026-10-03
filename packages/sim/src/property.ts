import fc from 'fast-check';
import { DEFAULT_SHAPE, scenarioArbitrary, type ScenarioShape } from './arbitraries';
import { runScenario, type RunResult } from './run-scenario';
import type { Scenario } from './scenario';
import type { Faults } from './world';

export interface PropertyOptions {
  readonly numRuns: number;
  readonly seed?: number;
  readonly shape?: ScenarioShape;
  readonly faults?: Faults;
  readonly undoStorm?: boolean;
}

export interface PropertyFailure {
  readonly scenario: Scenario;
  readonly result: RunResult;
  readonly shrinks: number;
}

export interface PropertyOutcome {
  readonly ok: boolean;
  readonly runnerSeed: number;
  readonly runs: number;
  readonly failure: PropertyFailure | undefined;
}

export function checkConvergence(options: PropertyOptions): PropertyOutcome {
  const run = (scenario: Scenario): RunResult =>
    runScenario(scenario, { faults: options.faults ?? {}, undoStorm: options.undoStorm ?? true });
  const details = fc.check(
    fc.property(scenarioArbitrary(options.shape ?? DEFAULT_SHAPE), (scenario) => run(scenario).ok),
    {
      numRuns: options.numRuns,
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    },
  );
  const counterexample = details.counterexample?.[0];
  return {
    ok: !details.failed,
    runnerSeed: details.seed,
    runs: details.numRuns,
    failure:
      counterexample === undefined
        ? undefined
        : { scenario: counterexample, result: run(counterexample), shrinks: details.numShrinks },
  };
}

export function formatPropertyFailure(outcome: PropertyOutcome): string {
  const failure = outcome.failure;
  if (failure === undefined) return `convergence held for ${outcome.runs} runs`;
  const problems = failure.result.failures
    .map((entry) => `  ${entry.phase} ${entry.invariant}: ${entry.detail}`)
    .join('\n');
  return [
    `convergence failed seed=${failure.scenario.seed} runner-seed=${outcome.runnerSeed}`,
    `shrunk in ${failure.shrinks} steps to ${failure.scenario.clients} clients and ${failure.scenario.steps.length} steps`,
    problems,
    `replay: SIM_SEED=${outcome.runnerSeed} pnpm test:sim`,
    JSON.stringify(failure.scenario),
  ].join('\n');
}
