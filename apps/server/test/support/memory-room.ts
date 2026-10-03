import { SyncClient, createMemoryPair, type MemoryPair } from '@coschema/sync';
import * as Y from 'yjs';
import type { Clock } from '@coschema/sync';
import type { RoomManager } from '../../src/rooms/room-manager';
import { settle } from './manual-clock';

export interface MemoryClient {
  readonly doc: Y.Doc;
  readonly client: SyncClient;
  readonly pairs: MemoryPair[];
  readonly closeCodes: number[];
}

export function memoryToken(room: string): string {
  return `ok:${room}`;
}

export function connectMemoryClient(
  manager: RoomManager,
  room: string,
  clock: Clock,
  options: { token?: string; doc?: Y.Doc } = {},
): MemoryClient {
  const doc = options.doc ?? new Y.Doc();
  const pairs: MemoryPair[] = [];
  const closeCodes: number[] = [];
  const client = new SyncClient({
    doc,
    connect: () => {
      const pair = createMemoryPair();
      pairs.push(pair);
      pair.client.onClose((code) => closeCodes.push(code));
      manager.join(room, pair.server).catch(() => undefined);
      return pair.client;
    },
    getToken: () => options.token ?? memoryToken(room),
    clock,
    random: () => 0.5,
  });
  client.start();
  return { doc, client, pairs, closeCodes };
}

export async function pump(clients: readonly MemoryClient[], rounds = 30): Promise<void> {
  await settle(2);
  for (let round = 0; round < rounds; round += 1) {
    for (const entry of clients) for (const pair of entry.pairs) pair.flush();
    await settle(2);
  }
}
