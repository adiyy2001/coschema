import fc from 'fast-check';
import { DEFAULT_SHAPE, scenarioArbitrary, type ScenarioShape } from './arbitraries';
import type { Scenario } from './scenario';

export function scenarioFromSeed(seed: number, shape: ScenarioShape = DEFAULT_SHAPE): Scenario {
  const [scenario] = fc.sample(scenarioArbitrary(shape), { seed, numRuns: 1 });
  if (scenario === undefined) throw new Error(`no scenario for seed ${seed}`);
  return { ...scenario, seed };
}
