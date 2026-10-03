import { deriveGraph } from '@coschema/model';
import {
  aliveNodeIds,
  checkInvariants,
  graphKey,
  stateVectorKey,
  type InvariantFailure,
} from './invariants';
import type { Scenario } from './scenario';
import { VirtualClockOverflowError } from './virtual-clock';
import { World, type Faults, type SimClient } from './world';

export type RunPhase = 'convergence' | 'undo-storm' | 'redo-storm';

export interface RunFailure extends InvariantFailure {
  readonly phase: RunPhase;
}

export interface RunOptions {
  readonly keepTrace?: boolean;
  readonly faults?: Faults;
  readonly eventBudget?: number;
  readonly undoStorm?: boolean;
}

export interface RunStats {
  readonly messagesSent: number;
  readonly messagesDelivered: number;
  readonly messagesDuplicated: number;
  readonly messagesLost: number;
  readonly messagesPartitioned: number;
  readonly connects: number;
  readonly loggedUpdates: number;
}

export interface RunResult {
  readonly seed: number;
  readonly ok: boolean;
  readonly failures: readonly RunFailure[];
  readonly traceHash: string;
  readonly traceLines: readonly string[];
  readonly virtualMs: number;
  readonly stats: RunStats;
}

export const DEFAULT_EVENT_BUDGET = 400_000;
const MAX_STORM_STEPS = 10_000;

function tagged(phase: RunPhase, failures: readonly InvariantFailure[]): RunFailure[] {
  return failures.map((failure) => ({ ...failure, phase }));
}

function stormClient(world: World, seed: number): SimClient | undefined {
  const start = Math.abs(Math.trunc(seed)) % world.clients.length;
  for (let offset = 0; offset < world.clients.length; offset += 1) {
    const client = world.clients[(start + offset) % world.clients.length];
    if (client !== undefined && !world.isZombie(client)) return client;
  }
  return undefined;
}

function drain(client: SimClient, direction: 'undo' | 'redo'): void {
  for (let guard = 0; guard < MAX_STORM_STEPS; guard += 1) {
    const available = direction === 'undo' ? client.history.canUndo : client.history.canRedo;
    if (!available) return;
    if (direction === 'undo') client.history.undo();
    else client.history.redo();
  }
}

function runStorm(world: World, scenario: Scenario): RunFailure[] {
  const client = stormClient(world, scenario.seed);
  if (client === undefined) return [];
  const failures: RunFailure[] = [];
  const foreign = [...aliveNodeIds(world)].filter((id) => world.createdBy.get(id) !== client.index);
  drain(client, 'undo');
  world.settle();
  failures.push(...tagged('undo-storm', checkInvariants(world)));
  const survivors = aliveNodeIds(world);
  for (const id of foreign) {
    if (!survivors.has(id)) {
      failures.push({
        phase: 'undo-storm',
        invariant: 'undo-keeps-foreign-nodes',
        detail: `client ${client.index} undoing everything removed node ${id} created by client ${world.createdBy.get(id) ?? 'unknown'}`,
      });
    }
  }
  world.trace.event('undo-storm', client.index, stateVectorKey(world.hub.doc));
  if (failures.length > 0) return failures;
  drain(client, 'redo');
  world.settle();
  failures.push(...tagged('redo-storm', checkInvariants(world)));
  return failures;
}

function execute(world: World, scenario: Scenario, options: RunOptions): RunFailure[] {
  scenario.steps.forEach((step, position) => {
    world.applyStep(step, position);
  });
  world.heal();
  const failures = tagged('convergence', checkInvariants(world));
  world.trace.event(
    'final',
    stateVectorKey(world.hub.doc),
    graphKey(deriveGraph(world.hub.doc)),
    failures.length,
  );
  if (failures.length > 0 || options.undoStorm === false) return failures;
  return runStorm(world, scenario);
}

function statsOf(world: World): RunStats {
  const totals = {
    messagesSent: 0,
    messagesDelivered: 0,
    messagesDuplicated: 0,
    messagesLost: 0,
    messagesPartitioned: 0,
    connects: 0,
    loggedUpdates: world.persistedLog.length,
  };
  for (const client of world.clients) {
    const stats = client.link.stats;
    totals.messagesSent += stats.sent;
    totals.messagesDelivered += stats.delivered;
    totals.messagesDuplicated += stats.duplicated;
    totals.messagesLost += stats.droppedByLoss;
    totals.messagesPartitioned += stats.droppedByPartition + stats.droppedByOffline;
    totals.connects += stats.connects;
  }
  return totals;
}

export function runScenario(scenario: Scenario, options: RunOptions = {}): RunResult {
  const world = new World(scenario, {
    keepTrace: options.keepTrace ?? false,
    faults: options.faults ?? {},
    eventBudget: options.eventBudget ?? DEFAULT_EVENT_BUDGET,
  });
  let failures: RunFailure[];
  try {
    failures = execute(world, scenario, options);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    failures = [
      {
        phase: 'convergence',
        invariant: error instanceof VirtualClockOverflowError ? 'quiescence' : 'no-errors',
        detail,
      },
    ];
  }
  world.trace.event('failures', failures.length);
  return {
    seed: scenario.seed,
    ok: failures.length === 0,
    failures,
    traceHash: world.trace.digest(),
    traceLines: world.trace.lines,
    virtualMs: world.clock.now(),
    stats: statsOf(world),
  };
}
