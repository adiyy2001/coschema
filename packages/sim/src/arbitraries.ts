import { NODE_TYPES } from '@coschema/model';
import fc from 'fast-check';
import { LINK_PROFILE_NAMES } from './link';
import {
  MAX_CLIENTS,
  MIN_CLIENTS,
  type NetworkAction,
  type Operation,
  type Scenario,
  type Step,
} from './scenario';

export interface ScenarioShape {
  readonly minClients: number;
  readonly maxClients: number;
  readonly minSteps: number;
  readonly maxSteps: number;
}

export const DEFAULT_SHAPE: ScenarioShape = {
  minClients: MIN_CLIENTS,
  maxClients: MAX_CLIENTS,
  minSteps: 30,
  maxSteps: 140,
};

const LABEL_UNITS = ['a', 'b', 'c', 'Pump', ' ', '3', 'é', '\u{1f600}'] as const;

const labelText = fc
  .array(fc.constantFrom(...LABEL_UNITS), { maxLength: 4 })
  .map((parts) => parts.join(''));

const index = fc.nat({ max: 24 });
const coordinate = fc.integer({ min: -400, max: 400 });
const delta = fc.integer({ min: -200, max: 200 });

const operation: fc.Arbitrary<Operation> = fc.oneof(
  {
    weight: 22,
    arbitrary: fc.record({
      type: fc.constant('create' as const),
      nodeType: fc.constantFrom(...NODE_TYPES),
      x: coordinate,
      y: coordinate,
      label: labelText,
    }),
  },
  {
    weight: 10,
    arbitrary: fc.record({ type: fc.constant('move' as const), node: index, dx: delta, dy: delta }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant('drag' as const),
      node: index,
      dx: delta,
      dy: delta,
      frames: fc.integer({ min: 1, max: 5 }),
    }),
  },
  { weight: 5, arbitrary: fc.record({ type: fc.constant('delete' as const), node: index }) },
  {
    weight: 14,
    arbitrary: fc.record({
      type: fc.constant('connect' as const),
      source: index,
      target: index,
      sourcePort: fc.nat({ max: 7 }),
      targetPort: fc.nat({ max: 7 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ type: fc.constant('disconnect' as const), edge: index }) },
  {
    weight: 10,
    arbitrary: fc.record({
      type: fc.constant('edit-label' as const),
      node: index,
      at: fc.nat({ max: 8 }),
      remove: fc.nat({ max: 3 }),
      insert: labelText,
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({ type: fc.constant('reorder' as const), node: index, to: index }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('reorder-many' as const),
      nodes: fc.array(index, { minLength: 1, maxLength: 4 }),
      target: fc.constantFrom('front' as const, 'back' as const),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant('style' as const),
      node: index,
      fill: fc.constantFrom('#ff0000', '#00ff00', '#0000ff', '#ffffff'),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant('resize' as const),
      node: index,
      width: fc.integer({ min: 0, max: 5000 }),
      height: fc.integer({ min: 0, max: 5000 }),
    }),
  },
  { weight: 5, arbitrary: fc.constant({ type: 'undo' as const }) },
  { weight: 5, arbitrary: fc.constant({ type: 'redo' as const }) },
  {
    weight: 4,
    arbitrary: fc.record({ type: fc.constant('presence' as const), x: coordinate, y: coordinate }),
  },
);

const networkAction: fc.Arbitrary<NetworkAction> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      type: fc.constant('degrade' as const),
      profile: fc.constantFrom(...LINK_PROFILE_NAMES),
    }),
  },
  { weight: 4, arbitrary: fc.constant({ type: 'partition' as const }) },
  { weight: 4, arbitrary: fc.constant({ type: 'unpartition' as const }) },
  { weight: 3, arbitrary: fc.constant({ type: 'offline' as const }) },
  { weight: 3, arbitrary: fc.constant({ type: 'online' as const }) },
  { weight: 2, arbitrary: fc.constant({ type: 'reconnect' as const }) },
);

function stepArbitrary(clients: number): fc.Arbitrary<Step> {
  const client = fc.nat({ max: clients - 1 });
  return fc.oneof(
    {
      weight: 62,
      arbitrary: fc.record({ kind: fc.constant('operation' as const), client, operation }),
    },
    {
      weight: 20,
      arbitrary: fc.record({
        kind: fc.constant('network' as const),
        client,
        action: networkAction,
      }),
    },
    {
      weight: 18,
      arbitrary: fc.record({
        kind: fc.constant('advance' as const),
        ms: fc.oneof(
          { weight: 3, arbitrary: fc.integer({ min: 0, max: 60 }) },
          { weight: 2, arbitrary: fc.integer({ min: 60, max: 1500 }) },
          { weight: 1, arbitrary: fc.integer({ min: 1500, max: 20_000 }) },
        ),
      }),
    },
  );
}

function preludeSteps(clients: number): Step[] {
  const creates = Array.from({ length: clients }, (_, client): Step => ({
    kind: 'operation',
    client,
    operation: { type: 'create', nodeType: 'rect', x: client * 150, y: 0, label: `n${client}` },
  }));
  const connects = Array.from({ length: clients }, (_, client): Step => ({
    kind: 'operation',
    client,
    operation: {
      type: 'connect',
      source: client,
      target: client + 1,
      sourcePort: 1,
      targetPort: 3,
    },
  }));
  return [...creates, { kind: 'advance', ms: 400 }, ...connects, { kind: 'advance', ms: 400 }];
}

export function scenarioArbitrary(shape: ScenarioShape = DEFAULT_SHAPE): fc.Arbitrary<Scenario> {
  return fc.integer({ min: shape.minClients, max: shape.maxClients }).chain((clients) =>
    fc.record({
      seed: fc.integer({ min: 0, max: 0x7fffffff }),
      clients: fc.constant(clients),
      steps: fc
        .array(stepArbitrary(clients), { minLength: shape.minSteps, maxLength: shape.maxSteps })
        .map((tail) => [...preludeSteps(clients), ...tail]),
    }),
  );
}
