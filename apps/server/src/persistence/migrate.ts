import type { Pool } from 'pg';
import { MIGRATIONS, type Migration } from './migrations';

const MIGRATION_LOCK_KEY = 7_141_001;

export async function migrate(
  pool: Pool,
  migrations: readonly Migration[] = MIGRATIONS,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const done = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const known = new Set(done.rows.map((row) => row.id));
    for (const migration of migrations) {
      if (known.has(migration.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(migration.id);
    }
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
  return applied;
}
