import { Pool } from 'pg';
import type * as Y from 'yjs';
import { PostgresStore } from '../../src/persistence/postgres-store';
import {
  connectClient,
  startApp,
  until,
  type RunningApp,
  type StartOptions,
  type TestClient,
} from './app';
import type { IsolatedDatabase } from './database';

export class AppFleet {
  private readonly apps: RunningApp[] = [];
  private readonly clients: TestClient[] = [];
  private readonly pools: Pool[] = [];

  constructor(private readonly database: IsolatedDatabase) {}

  async start(
    env: Record<string, string> = {},
    extra: Omit<StartOptions, 'env' | 'store'> = {},
  ): Promise<RunningApp> {
    const pool = new Pool({ connectionString: this.database.url, max: 5 });
    this.pools.push(pool);
    const app = await startApp({
      store: new PostgresStore(pool),
      env: { COSCHEMA_BATCH_MS: '10', ...env },
      ...extra,
    });
    this.apps.push(app);
    return app;
  }

  async join(app: RunningApp, room: string, name: string, doc?: Y.Doc): Promise<TestClient> {
    const client = await connectClient(app.wsUrl, room, {
      name,
      ...(doc === undefined ? {} : { doc }),
    });
    this.clients.push(client);
    await until(() => client.client.isSynced, `${name} to sync`);
    return client;
  }

  track(client: TestClient): TestClient {
    this.clients.push(client);
    return client;
  }

  async stopAll(): Promise<void> {
    for (const client of this.clients.splice(0)) client.stop();
    for (const app of this.apps.splice(0)) await app.stop();
    for (const pool of this.pools.splice(0)) await pool.end().catch(() => undefined);
  }
}

export async function countRows(
  database: IsolatedDatabase,
  table: 'doc_updates' | 'doc_snapshots',
  room: string,
): Promise<number> {
  const result = await database.pool.query<{ count: string }>(
    `SELECT count(*) FROM ${table} WHERE room_id = $1`,
    [room],
  );
  return Number(result.rows[0]?.count);
}
