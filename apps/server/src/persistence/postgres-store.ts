import type { Pool, PoolClient } from 'pg';
import { foldIntoSnapshot, totalBytes } from './fold';
import type { CompactionResult, DocumentStore, StoredRoom } from './store';

interface SnapshotRow {
  snapshot: Buffer;
  up_to_seq: string;
}

interface UpdateRow {
  seq: string;
  update: Buffer;
}

export interface PostgresStoreOptions {
  readonly afterCompactionRead?: () => Promise<void>;
}

export class PostgresStore implements DocumentStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: PostgresStoreOptions = {},
  ) {}

  async load(roomId: string): Promise<StoredRoom> {
    return this.inTransaction('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', async (client) => {
      const snapshotRow = await this.readSnapshot(client, roomId);
      const upToSeq = snapshotRow === undefined ? '0' : snapshotRow.up_to_seq;
      const rows = await client.query<UpdateRow>(
        'SELECT seq, update FROM doc_updates WHERE room_id = $1 AND seq > $2 ORDER BY seq',
        [roomId, upToSeq],
      );
      const updates = rows.rows.map((row) => new Uint8Array(row.update));
      return {
        snapshot: snapshotRow === undefined ? undefined : new Uint8Array(snapshotRow.snapshot),
        updates,
        logRows: updates.length,
        logBytes: totalBytes(updates),
      };
    });
  }

  async append(roomId: string, update: Uint8Array): Promise<void> {
    await this.pool.query('INSERT INTO doc_updates (room_id, update) VALUES ($1, $2)', [
      roomId,
      update,
    ]);
  }

  async compact(roomId: string): Promise<CompactionResult | undefined> {
    return this.inTransaction('BEGIN', async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [roomId]);
      const snapshotRow = await this.readSnapshot(client, roomId);
      const upToSeq = snapshotRow === undefined ? '0' : snapshotRow.up_to_seq;
      const ceiling = await client.query<{ max: string | null }>(
        'SELECT max(seq) AS max FROM doc_updates WHERE room_id = $1',
        [roomId],
      );
      const maxSeq = ceiling.rows[0]?.max ?? null;
      if (maxSeq === null || BigInt(maxSeq) <= BigInt(upToSeq)) return undefined;
      const rows = await client.query<UpdateRow>(
        'SELECT seq, update FROM doc_updates WHERE room_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq',
        [roomId, upToSeq, maxSeq],
      );
      await this.options.afterCompactionRead?.();
      const updates = rows.rows.map((row) => new Uint8Array(row.update));
      const previous = snapshotRow === undefined ? undefined : new Uint8Array(snapshotRow.snapshot);
      const snapshot = foldIntoSnapshot(previous, updates);
      await client.query(
        `INSERT INTO doc_snapshots (room_id, snapshot, up_to_seq) VALUES ($1, $2, $3)
         ON CONFLICT (room_id) DO UPDATE
           SET snapshot = EXCLUDED.snapshot, up_to_seq = EXCLUDED.up_to_seq, updated_at = now()`,
        [roomId, snapshot, maxSeq],
      );
      await client.query('DELETE FROM doc_updates WHERE room_id = $1 AND seq <= $2', [
        roomId,
        maxSeq,
      ]);
      return {
        rows: updates.length,
        logBytes: totalBytes(updates),
        previousSnapshotBytes: previous?.byteLength ?? 0,
        snapshotBytes: snapshot.byteLength,
      };
    });
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async readSnapshot(client: PoolClient, roomId: string): Promise<SnapshotRow | undefined> {
    const result = await client.query<SnapshotRow>(
      'SELECT snapshot, up_to_seq FROM doc_snapshots WHERE room_id = $1',
      [roomId],
    );
    return result.rows[0];
  }

  private async inTransaction<T>(
    begin: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(begin);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
