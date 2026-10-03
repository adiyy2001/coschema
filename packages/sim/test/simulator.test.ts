import { describe, expect, it } from 'vitest';
import { runScenario } from '../src/run-scenario';
import type { Scenario, Step } from '../src/scenario';
import { scenarioFromSeed } from '../src/seeds';
import { VirtualClockOverflowError } from '../src/virtual-clock';
import { World } from '../src/world';

const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1);

function createStep(client: number, label: string): Step {
  return {
    kind: 'operation',
    client,
    operation: { type: 'create', nodeType: 'rect', x: client * 10, y: 0, label },
  };
}

const TWO_CLIENTS: Scenario = {
  seed: 7,
  clients: 2,
  steps: [
    createStep(0, 'a'),
    createStep(1, 'b'),
    { kind: 'advance', ms: 500 },
    { kind: 'network', client: 0, action: { type: 'partition' } },
    createStep(0, 'offline edit'),
    { kind: 'advance', ms: 200 },
    { kind: 'network', client: 0, action: { type: 'unpartition' } },
    { kind: 'network', client: 1, action: { type: 'offline' } },
    createStep(1, 'while away'),
    { kind: 'network', client: 1, action: { type: 'online' } },
    { kind: 'network', client: 1, action: { type: 'degrade', profile: 'chaotic' } },
    { kind: 'network', client: 1, action: { type: 'reconnect' } },
  ],
};

describe('scenario generation', () => {
  it('derives the same scenario from the same seed and different ones from different seeds', () => {
    expect(scenarioFromSeed(11)).toEqual(scenarioFromSeed(11));
    expect(scenarioFromSeed(11)).not.toEqual(scenarioFromSeed(12));
    expect(scenarioFromSeed(11).seed).toBe(11);
  });

  it('stays within two to eight clients', () => {
    const counts = SEEDS.map((seed) => scenarioFromSeed(seed).clients);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...counts)).toBeLessThanOrEqual(8);
    expect(new Set(counts).size).toBeGreaterThan(3);
  });

  it('covers every kind of operation and network action', () => {
    const operations = new Set<string>();
    const actions = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) {
      for (const step of scenarioFromSeed(seed).steps) {
        if (step.kind === 'operation') operations.add(step.operation.type);
        if (step.kind === 'network') actions.add(step.action.type);
      }
    }
    expect([...operations].sort()).toEqual(
      [
        'connect',
        'create',
        'delete',
        'disconnect',
        'drag',
        'edit-label',
        'move',
        'presence',
        'redo',
        'reorder',
        'reorder-many',
        'resize',
        'style',
        'undo',
      ].sort(),
    );
    expect([...actions].sort()).toEqual(
      ['degrade', 'offline', 'online', 'partition', 'reconnect', 'unpartition'].sort(),
    );
  });
});

describe('runScenario', () => {
  it('converges on a hand written scenario with partitions and offline edits', () => {
    const result = runScenario(TWO_CLIENTS);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.loggedUpdates).toBeGreaterThan(0);
    expect(result.stats.messagesSent).toBeGreaterThan(0);
  });

  it.each(SEEDS)('converges to one valid graph for seed %i', (seed) => {
    const result = runScenario(scenarioFromSeed(seed));
    expect(result.failures).toEqual([]);
  });

  it('produces the same trace hash and trace lines on every run of one seed', () => {
    const scenario = scenarioFromSeed(1);
    const first = runScenario(scenario, { keepTrace: true });
    const second = runScenario(scenario, { keepTrace: true });
    expect(first.traceHash).toBe(second.traceHash);
    expect(first.traceLines).toEqual(second.traceLines);
    expect(first.traceLines.length).toBeGreaterThan(50);
    expect(runScenario(scenarioFromSeed(2)).traceHash).not.toBe(first.traceHash);
  });

  it('gives the same hash whether or not lines are kept', () => {
    const scenario = scenarioFromSeed(3);
    expect(runScenario(scenario).traceHash).toBe(
      runScenario(scenario, { keepTrace: true }).traceHash,
    );
    expect(runScenario(scenario).traceLines).toEqual([]);
  });

  it('can skip the undo storm', () => {
    const scenario = scenarioFromSeed(4);
    const withStorm = runScenario(scenario, { keepTrace: true });
    const without = runScenario(scenario, { keepTrace: true, undoStorm: false });
    expect(withStorm.traceLines.some((line) => line.startsWith('undo-storm'))).toBe(true);
    expect(without.traceLines.some((line) => line.startsWith('undo-storm'))).toBe(false);
    expect(without.ok).toBe(true);
  });
});

describe('fault injection', () => {
  it('fails with the persisted log invariant when a log entry is lost', () => {
    const failing = SEEDS.map((seed) =>
      runScenario(scenarioFromSeed(seed), { faults: { loseLogEntry: 1 } }),
    ).filter((result) => !result.ok);
    expect(failing.length).toBeGreaterThan(SEEDS.length / 2);
    const first = failing[0];
    expect(first?.failures.map((failure) => failure.invariant)).toContain('persisted-log-replays');
    expect(first?.seed).toBeGreaterThan(0);
  });

  it('reports a client that silently stopped syncing as a divergence', () => {
    const results = SEEDS.map((seed) =>
      runScenario(scenarioFromSeed(seed), {
        faults: { zombieClient: { client: 0, afterStep: 6 } },
      }),
    );
    expect(results.some((result) => !result.ok)).toBe(true);
  });

  it('turns an exhausted event budget into a quiescence failure', () => {
    const result = runScenario(scenarioFromSeed(1), { eventBudget: 5 });
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.invariant).toBe('quiescence');
    expect(result.failures[0]?.detail).toContain(VirtualClockOverflowError.name);
  });
});

describe('World', () => {
  it('marks a client as a zombie once the fault triggers and never reconnects it', () => {
    const world = new World(TWO_CLIENTS, {
      keepTrace: false,
      faults: { zombieClient: { client: 0, afterStep: 1 } },
      eventBudget: 100_000,
    });
    const client = world.clients[0];
    if (client === undefined) throw new Error('missing client');
    world.applyStep({ kind: 'advance', ms: 100 }, 0);
    expect(world.isZombie(client)).toBe(false);
    world.applyStep({ kind: 'advance', ms: 100 }, 1);
    expect(world.isZombie(client)).toBe(true);
    world.reconnect(client);
    world.heal();
    expect(client.sync.currentStatus).toBe('stopped');
  });

  it('wraps client indexes that are out of range', () => {
    const world = new World(TWO_CLIENTS, { keepTrace: false, faults: {}, eventBudget: 100_000 });
    world.applyStep(createStep(5, 'wrapped'), 0);
    world.heal();
    expect(world.errors).toEqual([]);
    expect(world.createdBy.size).toBe(1);
  });
});
