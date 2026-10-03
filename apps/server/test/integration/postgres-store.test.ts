import * as Y from 'yjs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../src/persistence/migrate';
import { MIGRATIONS } from '../../src/persistence/migrations';
import { PostgresStore } from '../../src/persistence/postgres-store';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/database';
import { Editor, graphOf, stateVectorKey } from '../support/documents';

let database: IsolatedDatabase;

beforeAll(async () => {
  database = await createIsolatedDatabase(inject('adminDatabaseUrl'));
});

afterAll(async () => {
  await database.drop();
});

function collect(editor: Editor): Uint8Array[] {
  const updates: Uint8Array[] = [];
  editor.doc.on('update', (update: Uint8Array) => updates.push(update));
  return updates;
}

function rebuild(snapshot: Uint8Array | undefined, updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  if (snapshot !== undefined) Y.applyUpdate(doc, snapshot);
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc;
}

async function count(sql: string, room: string): Promise<number> {
  const result = await database.pool.query<{ count: string }>(sql, [room]);
  return Number(result.rows[0]?.count ?? 0);
}

const logRows = (room: string): Promise<number> =>
  count('SELECT count(*) FROM doc_updates WHERE room_id = $1', room);
const snapshotRows = (room: string): Promise<number> =>
  count('SELECT count(*) FROM doc_snapshots WHERE room_id = $1', room);

async function fillRoom(store: PostgresStore, room: string, seed: number): Promise<Editor> {
  const editor = new Editor(seed);
  const updates = collect(editor);
  const id = editor.addNode('start');
  const other = editor.addNode('other', 40, 40);
  for (let step = 0; step < 60; step += 1) editor.move(id, step, step * 2);
  editor.relabel(other, 'a longer label for the other node');
  editor.addNode('doomed');
  for (const update of updates) await store.append(room, update);
  return editor;
}

describe('migrations', () => {
  it('apply once and do nothing the second time', async () => {
    const fresh = await createIsolatedDatabase(inject('adminDatabaseUrl'), { migrated: false });
    try {
      expect(await migrate(fresh.pool)).toEqual(MIGRATIONS.map((migration) => migration.id));
      expect(await migrate(fresh.pool)).toEqual([]);
      const tables = await fresh.pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name`,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'doc_snapshots',
        'doc_updates',
        'schema_migrations',
      ]);
    } finally {
      await fresh.drop();
    }
  });

  it('are safe when several servers start at once', async () => {
    const fresh = await createIsolatedDatabase(inject('adminDatabaseUrl'), { migrated: false });
    try {
      const pools = [
        fresh.pool,
        new Pool({ connectionString: fresh.url }),
        new Pool({ connectionString: fresh.url }),
      ];
      const outcomes = await Promise.all(pools.map((pool) => migrate(pool)));
      const applied = outcomes.flat();
      expect(applied.sort()).toEqual(MIGRATIONS.map((migration) => migration.id).sort());
      await Promise.all(pools.slice(1).map((pool) => pool.end()));
    } finally {
      await fresh.drop();
    }
  });

  it('roll back a failing migration and leave no trace of it', async () => {
    const fresh = await createIsolatedDatabase(inject('adminDatabaseUrl'), { migrated: false });
    try {
      const broken = [
        { id: '001_ok', sql: 'CREATE TABLE ok (id int)' },
        { id: '002_broken', sql: 'CREATE TABLE half (id int); SELECT * FROM missing_table' },
      ];
      await expect(migrate(fresh.pool, broken)).rejects.toThrow('missing_table');
      const applied = await fresh.pool.query<{ id: string }>('SELECT id FROM schema_migrations');
      expect(applied.rows.map((row) => row.id)).toEqual(['001_ok']);
      const half = await fresh.pool.query(`SELECT to_regclass('half') AS found`);
      expect(half.rows[0]).toEqual({ found: null });
    } finally {
      await fresh.drop();
    }
  });
});

describe('PostgresStore', () => {
  it('loads an unknown room as empty', async () => {
    const store = new PostgresStore(database.pool);
    expect(await store.load('nobody')).toEqual({
      snapshot: undefined,
      updates: [],
      logRows: 0,
      logBytes: 0,
    });
    expect(await store.compact('nobody')).toBeUndefined();
  });

  it('answers ping', async () => {
    await expect(new PostgresStore(database.pool).ping()).resolves.toBeUndefined();
  });

  it('appends rows in order and loads them back', async () => {
    const store = new PostgresStore(database.pool);
    const editor = await fillRoom(store, 'append-room', 1);
    const stored = await store.load('append-room');
    expect(stored.snapshot).toBeUndefined();
    expect(stored.logRows).toBe(await logRows('append-room'));
    expect(graphOf(rebuild(undefined, stored.updates))).toBe(graphOf(editor.doc));
  });

  it('compaction preserves the document and replaces the log with a smaller snapshot', async () => {
    const store = new PostgresStore(database.pool);
    const editor = await fillRoom(store, 'compact-room', 2);
    const before = await store.load('compact-room');
    expect(before.logRows).toBeGreaterThan(50);
    const result = await store.compact('compact-room');
    expect(result?.rows).toBe(before.logRows);
    expect(result?.snapshotBytes).toBeLessThan(before.logBytes);
    expect(await logRows('compact-room')).toBe(0);
    expect(await snapshotRows('compact-room')).toBe(1);
    const after = await store.load('compact-room');
    expect(after.updates).toHaveLength(0);
    expect(after.snapshot?.byteLength).toBe(result?.snapshotBytes);
    const restored = rebuild(after.snapshot, after.updates);
    expect(stateVectorKey(restored)).toBe(stateVectorKey(editor.doc));
    expect(graphOf(restored)).toBe(graphOf(editor.doc));
  });

  it('compacts again on top of an existing snapshot', async () => {
    const store = new PostgresStore(database.pool);
    const editor = new Editor(3);
    const updates = collect(editor);
    const id = editor.addNode('first');
    await store.append('twice-room', updates[0] ?? new Uint8Array());
    await store.compact('twice-room');
    editor.move(id, 9, 9);
    editor.addNode('second');
    for (const update of updates.slice(1)) await store.append('twice-room', update);
    const loaded = await store.load('twice-room');
    expect(loaded.snapshot).toBeDefined();
    expect(loaded.logRows).toBe(updates.length - 1);
    const result = await store.compact('twice-room');
    expect(result?.previousSnapshotBytes).toBeGreaterThan(0);
    const final = await store.load('twice-room');
    expect(graphOf(rebuild(final.snapshot, final.updates))).toBe(graphOf(editor.doc));
    expect(await store.compact('twice-room')).toBeUndefined();
  });

  it('keeps an append that lands while a compaction is in flight', async () => {
    const editor = new Editor(4);
    const updates = collect(editor);
    editor.addNode('before');
    let started: () => void = () => undefined;
    let proceed: () => void = () => undefined;
    const compactionRead = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const store = new PostgresStore(database.pool, {
      afterCompactionRead: async () => {
        started();
        await gate;
      },
    });
    await store.append('race-room', updates[0] ?? new Uint8Array());
    const compaction = store.compact('race-room');
    await compactionRead;
    editor.addNode('during');
    await store.append('race-room', updates[1] ?? new Uint8Array());
    proceed();
    expect((await compaction)?.rows).toBe(1);
    const loaded = await store.load('race-room');
    expect(loaded.logRows).toBe(1);
    expect(graphOf(rebuild(loaded.snapshot, loaded.updates))).toBe(graphOf(editor.doc));
    expect(await logRows('race-room')).toBe(1);
  });

  it('loses nothing when appends and compactions run at the same time', async () => {
    const store = new PostgresStore(database.pool);
    const editor = new Editor(5);
    const updates = collect(editor);
    const id = editor.addNode('busy');
    for (let step = 0; step < 80; step += 1) editor.move(id, step, step);
    const state = { writing: true };
    const compactor = (async () => {
      while (state.writing) await store.compact('stress-room');
    })();
    for (const update of updates) await store.append('stress-room', update);
    state.writing = false;
    await compactor;
    const loaded = await store.load('stress-room');
    const restored = rebuild(loaded.snapshot, loaded.updates);
    expect(stateVectorKey(restored)).toBe(stateVectorKey(editor.doc));
    expect(graphOf(restored)).toBe(graphOf(editor.doc));
  });

  it('serializes compactions of one room under the advisory lock', async () => {
    const store = new PostgresStore(database.pool);
    await fillRoom(store, 'lock-room', 6);
    const results = await Promise.all([
      store.compact('lock-room'),
      store.compact('lock-room'),
      store.compact('lock-room'),
    ]);
    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
    expect(await snapshotRows('lock-room')).toBe(1);
  });

  it('keeps rooms apart', async () => {
    const store = new PostgresStore(database.pool);
    const left = await fillRoom(store, 'left-room', 7);
    await fillRoom(store, 'right-room', 8);
    await store.compact('right-room');
    const loaded = await store.load('left-room');
    expect(loaded.snapshot).toBeUndefined();
    expect(graphOf(rebuild(undefined, loaded.updates))).toBe(graphOf(left.doc));
  });

  it('rolls back and reports a failed append', async () => {
    const broken = new Pool({ connectionString: 'postgres://nobody:wrong@127.0.0.1:1/none' });
    broken.on('error', () => undefined);
    const store = new PostgresStore(broken);
    await expect(store.append('room', new Uint8Array([1]))).rejects.toThrow();
    await expect(store.load('room')).rejects.toThrow();
    await broken.end();
  });

  it('closes its pool', async () => {
    const pool = new Pool({ connectionString: database.url });
    const store = new PostgresStore(pool);
    await store.ping();
    await store.close();
    await expect(pool.query('SELECT 1')).rejects.toThrow();
  });
});
