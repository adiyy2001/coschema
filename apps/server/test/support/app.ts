import { SyncClient, createWebSocketTransport, systemClock } from '@coschema/sync';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { signToken } from '../../src/auth';
import { parseConfig, type Config } from '../../src/config';
import { silentLogger, type Logger } from '../../src/logger';
import { MemoryStore } from '../../src/persistence/memory-store';
import type { DocumentStore } from '../../src/persistence/store';
import { createApp, type App } from '../../src/server';

export const TEST_SECRET = 'a-test-secret-with-enough-length';

export function testConfig(overrides: Readonly<Record<string, string>> = {}): Config {
  return parseConfig({
    COSCHEMA_HOST: '127.0.0.1',
    COSCHEMA_PORT: '0',
    COSCHEMA_JWT_SECRET: TEST_SECRET,
    COSCHEMA_DEV_TOKENS: '1',
    ...overrides,
  });
}

export interface RunningApp {
  readonly app: App;
  readonly store: DocumentStore;
  readonly address: AddressInfo;
  readonly httpUrl: string;
  readonly wsUrl: string;
  stop(): Promise<void>;
}

export interface StartOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly store?: DocumentStore;
  readonly logger?: Logger;
  readonly heartbeatMs?: number;
}

export async function startApp(options: StartOptions = {}): Promise<RunningApp> {
  const store = options.store ?? new MemoryStore();
  const app = createApp({
    config: testConfig(options.env),
    store,
    logger: options.logger ?? silentLogger,
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
  });
  const address = await app.listen();
  let stopped = false;
  return {
    app,
    store,
    address,
    httpUrl: `http://127.0.0.1:${address.port}`,
    wsUrl: `ws://127.0.0.1:${address.port}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await app.stop();
    },
  };
}

export function tokenFor(
  room: string,
  name = 'Tester',
  color = '#1b9e77',
  sub = `user-${name}`,
): Promise<string> {
  return signToken({ sub, name, color, room }, { secret: TEST_SECRET, now: () => new Date() });
}

export interface TestClient {
  readonly doc: Y.Doc;
  readonly client: SyncClient;
  stop(): void;
}

export async function connectClient(
  wsUrl: string,
  room: string,
  options: { doc?: Y.Doc; token?: string; name?: string } = {},
): Promise<TestClient> {
  const doc = options.doc ?? new Y.Doc();
  const token = options.token ?? (await tokenFor(room, options.name ?? 'Tester'));
  const client = new SyncClient({
    doc,
    connect: () => createWebSocketTransport(`${wsUrl}/rooms/${room}`),
    getToken: () => token,
    clock: systemClock,
    random: Math.random,
    backoff: { baseMs: 20, maxMs: 200, factor: 2, jitter: 0.1 },
  });
  client.start();
  return { doc, client, stop: () => client.destroy() };
}

export async function until(
  condition: () => boolean,
  description: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
