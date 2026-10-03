import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../src/persistence/migrate';

export interface IsolatedDatabase {
  readonly url: string;
  readonly pool: Pool;
  drop(): Promise<void>;
}

export async function createIsolatedDatabase(
  adminUrl: string,
  options: { migrated?: boolean } = {},
): Promise<IsolatedDatabase> {
  const name = `test_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 10 });
  if (options.migrated ?? true) await migrate(pool);
  return {
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end();
      const dropper = new Pool({ connectionString: adminUrl, max: 1 });
      await dropper.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await dropper.end();
    },
  };
}
