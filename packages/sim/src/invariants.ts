import { deriveGraph, findViolations, type Graph, type NodeId } from '@coschema/model';
import * as Y from 'yjs';
import { fnv1a } from './trace';
import type { SimClient, World } from './world';

export interface InvariantFailure {
  readonly invariant: string;
  readonly detail: string;
}

const DETAIL_LIMIT = 600;

function limited(text: string): string {
  return text.length <= DETAIL_LIMIT ? text : `${text.slice(0, DETAIL_LIMIT)}...`;
}

const SECOND_HASH_SEED = 0x2545f491;

function bytesKey(bytes: Uint8Array): string {
  const first = fnv1a(bytes).toString(16);
  const second = fnv1a(bytes, SECOND_HASH_SEED).toString(16);
  return `${bytes.length}:${first}:${second}`;
}

export function rawState(doc: Y.Doc): string {
  return bytesKey(Y.encodeStateAsUpdate(doc));
}

export function stateVectorKey(doc: Y.Doc): string {
  const entries = [...Y.decodeStateVector(Y.encodeStateVector(doc)).entries()];
  entries.sort((left, right) => left[0] - right[0]);
  return entries.map(([client, clock]) => `${client}:${clock}`).join(',');
}

export function canonicalState(doc: Y.Doc): string {
  const canonical = new Y.Doc({ guid: 'canonical' });
  Y.applyUpdate(canonical, Y.encodeStateAsUpdate(doc));
  return bytesKey(Y.encodeStateAsUpdate(canonical));
}

export function graphKey(graph: Graph): string {
  return JSON.stringify(graph);
}

export interface Participant {
  readonly label: string;
  readonly doc: Y.Doc;
}

function participants(world: World): Participant[] {
  return [
    { label: 'hub', doc: world.hub.doc },
    ...world.clients.map((client) => ({ label: `client ${client.index}`, doc: client.doc })),
  ];
}

function allEqual(
  invariant: string,
  entries: readonly Participant[],
  key: (doc: Y.Doc) => string,
): InvariantFailure[] {
  const [reference, ...others] = entries;
  if (reference === undefined) return [];
  const expected = key(reference.doc);
  return others.flatMap((entry) => {
    const actual = key(entry.doc);
    return actual === expected
      ? []
      : [
          {
            invariant,
            detail: limited(
              `${entry.label} differs from ${reference.label}: ${actual} versus ${expected}`,
            ),
          },
        ];
  });
}

export function checkDocuments(entries: readonly Participant[]): InvariantFailure[] {
  if (allEqual('identical-document', entries, rawState).length === 0) return [];
  return allEqual('identical-document', entries, canonicalState);
}

function checkViews(world: World): InvariantFailure[] {
  const failures: InvariantFailure[] = [];
  const reference = deriveGraph(world.hub.doc);
  const expected = graphKey(reference);
  for (const client of world.clients) {
    const derived = deriveGraph(client.doc);
    if (graphKey(derived) !== expected) {
      failures.push({
        invariant: 'identical-graph',
        detail: limited(`client ${client.index} derives ${graphKey(derived)} versus ${expected}`),
      });
    }
    if (graphKey(client.store.getGraph()) !== graphKey(derived)) {
      failures.push({
        invariant: 'store-matches-derived-graph',
        detail: limited(
          `client ${client.index} store ${graphKey(client.store.getGraph())} versus ${graphKey(derived)}`,
        ),
      });
    }
  }
  for (const violation of findViolations(reference)) {
    failures.push({ invariant: 'valid-graph', detail: violation });
  }
  return failures;
}

function checkPersistence(world: World): InvariantFailure[] {
  const replay = new Y.Doc({ guid: 'replay' });
  for (const update of world.persistedLog) Y.applyUpdate(replay, update);
  const expected = canonicalState(world.hub.doc);
  return canonicalState(replay) === expected
    ? []
    : [
        {
          invariant: 'persisted-log-replays',
          detail: `replaying ${world.persistedLog.length} logged updates gives state vector ${stateVectorKey(replay)} but the hub has ${stateVectorKey(world.hub.doc)}`,
        },
      ];
}

function checkClientsSettled(world: World): InvariantFailure[] {
  return world.clients.flatMap((client) => {
    if (world.isZombie(client)) return [];
    const failures: InvariantFailure[] = [];
    if (!client.sync.isSynced) {
      failures.push({
        invariant: 'clients-synced',
        detail: `client ${client.index} is ${client.sync.currentStatus}`,
      });
    }
    if (client.sync.pendingCount !== 0) {
      failures.push({
        invariant: 'no-pending-updates',
        detail: `client ${client.index} still counts ${client.sync.pendingCount} pending`,
      });
    }
    return failures;
  });
}

function expectedPresence(world: World): Map<number, string> {
  const expected = new Map<number, string>();
  for (const client of world.clients) {
    const state = client.awareness.getLocalState();
    if (state !== null) expected.set(client.doc.clientID, JSON.stringify(state));
  }
  return expected;
}

function presenceOf(awareness: SimClient['awareness']): Map<number, string> {
  const actual = new Map<number, string>();
  for (const [clientId, state] of awareness.getStates())
    actual.set(clientId, JSON.stringify(state));
  return actual;
}

function describePresenceGap(expected: Map<number, string>, actual: Map<number, string>): string {
  const missing = [...expected.keys()].filter((id) => actual.get(id) !== expected.get(id));
  const extra = [...actual.keys()].filter((id) => !expected.has(id));
  return `missing or stale ${missing.join(',') || 'none'}, unexpected ${extra.join(',') || 'none'}`;
}

function checkPresence(world: World): InvariantFailure[] {
  const expected = expectedPresence(world);
  const failures: InvariantFailure[] = [];
  const views: [string, SimClient['awareness']][] = [
    ['hub', world.hub.awareness],
    ...world.clients
      .filter((client) => !world.isZombie(client))
      .map((client): [string, SimClient['awareness']] => [
        `client ${client.index}`,
        client.awareness,
      ]),
  ];
  for (const [label, awareness] of views) {
    const actual = presenceOf(awareness);
    const mismatch =
      actual.size !== expected.size ||
      [...expected].some(([id, state]) => actual.get(id) !== state);
    if (mismatch) {
      failures.push({
        invariant: 'presence-converges',
        detail: `${label}: ${describePresenceGap(expected, actual)}`,
      });
    }
  }
  return failures;
}

export function checkInvariants(world: World): InvariantFailure[] {
  const failures: InvariantFailure[] = world.errors.map((error) => ({
    invariant: 'no-errors',
    detail: limited(error),
  }));
  const entries = participants(world);
  failures.push(
    ...allEqual('identical-state-vector', entries, stateVectorKey),
    ...checkDocuments(entries),
    ...checkViews(world),
    ...checkPersistence(world),
    ...checkClientsSettled(world),
    ...checkPresence(world),
  );
  return failures;
}

export function aliveNodeIds(world: World): Set<NodeId> {
  return new Set(deriveGraph(world.hub.doc).nodes.map((node) => node.id));
}
