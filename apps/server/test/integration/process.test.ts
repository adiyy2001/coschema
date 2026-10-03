import { spawn } from 'node:child_process';
import * as Y from 'yjs';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { connectClient, until, type TestClient } from '../support/app';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/database';
import { Editor, graphOf } from '../support/documents';
import { countRows } from '../support/postgres-app';
import { startServerProcess, type ServerProcess } from '../support/server-process';

let database: IsolatedDatabase;
const processes: ServerProcess[] = [];
const clients: TestClient[] = [];

beforeAll(async () => {
  database = await createIsolatedDatabase(inject('adminDatabaseUrl'));
});

afterAll(async () => {
  await database.drop();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const server of processes.splice(0)) {
    server.signal('SIGKILL');
    await server.exited;
  }
});

async function launch(env: Record<string, string> = {}): Promise<ServerProcess> {
  const server = await startServerProcess({
    bundle: inject('serverBundle'),
    databaseUrl: database.url,
    env,
  });
  processes.push(server);
  return server;
}

async function join(
  server: ServerProcess,
  room: string,
  name: string,
  doc?: Y.Doc,
): Promise<TestClient> {
  const client = await connectClient(server.wsUrl, room, {
    name,
    ...(doc === undefined ? {} : { doc }),
  });
  clients.push(client);
  await until(() => client.client.isSynced, `${name} to sync`);
  return client;
}

function loadedGraph(snapshot: Uint8Array | undefined, updates: readonly Uint8Array[]): string {
  const doc = new Y.Doc();
  if (snapshot !== undefined) Y.applyUpdate(doc, snapshot);
  for (const update of updates) Y.applyUpdate(doc, update);
  return graphOf(doc);
}

describe('the production bundle', () => {
  it('applies the migrations, answers /healthz and shuts down on SIGTERM with exit code 0', async () => {
    const server = await launch();
    const response = await fetch(`${server.httpUrl}/healthz`);
    expect(await response.text()).toBe('ok\n');
    expect((await fetch(`${server.httpUrl}/readyz`)).status).toBe(200);
    server.signal('SIGTERM');
    expect(await server.exited).toEqual({ code: 0, signal: null });
    expect(server.logs.some((line) => line.includes('shutdown complete'))).toBe(true);
  });

  it('exits with a readable error when the configuration is wrong', async () => {
    const child = spawn(process.execPath, [inject('serverBundle')], {
      env: { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve) => {
      child.on('exit', (exitCode) => resolve(exitCode));
    });
    expect(code).toBe(1);
    expect(output).toContain('COSCHEMA_JWT_SECRET is required in production');
  });

  it('exits when the database cannot be reached', async () => {
    await expect(
      startServerProcess({
        bundle: inject('serverBundle'),
        databaseUrl: 'postgres://nobody:wrong@127.0.0.1:1/none',
      }),
    ).rejects.toThrow('exited at startup');
  });

  it('flushes a pending batch on SIGTERM so a restart finds the document intact', async () => {
    const first = await launch({ COSCHEMA_BATCH_MS: '30000' });
    const anna = await join(first, 'term-room', 'Anna');
    const ben = await join(first, 'term-room', 'Ben');
    const editor = new Editor(1, anna.doc);
    const id = editor.addNode('written just before SIGTERM');
    editor.move(id, 12, 34);
    await until(() => new Editor(2, ben.doc).labels.length === 1, 'the edit to reach Ben');
    expect(anna.client.pendingCount).toBeGreaterThan(0);
    expect(await countRows(database, 'doc_updates', 'term-room')).toBe(0);
    const expected = graphOf(anna.doc);

    first.signal('SIGTERM');
    expect(await first.exited).toEqual({ code: 0, signal: null });
    expect(await countRows(database, 'doc_updates', 'term-room')).toBe(1);
    anna.stop();
    ben.stop();

    const second = await launch();
    const reader = await join(second, 'term-room', 'Carl');
    expect(graphOf(reader.doc)).toBe(expected);
  });

  it('closes open sockets with 1001 on SIGTERM', async () => {
    const server = await launch();
    const anna = await join(server, 'going-away', 'Anna');
    server.signal('SIGTERM');
    await server.exited;
    expect(anna.client.currentStatus).not.toBe('online');
  });

  it('keeps everything that was acknowledged when the process is killed hard', async () => {
    const first = await launch();
    const anna = await join(first, 'kill-room', 'Anna');
    const editor = new Editor(3, anna.doc);
    const id = editor.addNode('acknowledged');
    for (let step = 0; step < 25; step += 1) {
      editor.move(id, step, step);
      editor.addNode(`node ${step}`, step * 10, step * 10);
      await until(() => anna.client.pendingCount === 0, `ack of step ${step}`);
    }
    const expected = graphOf(anna.doc);
    first.signal('SIGKILL');
    expect((await first.exited).signal).toBe('SIGKILL');
    anna.stop();

    const second = await launch();
    const reader = await join(second, 'kill-room', 'Ben');
    expect(graphOf(reader.doc)).toBe(expected);
  });

  it('lets a client that never got its ack deliver the update again after a hard kill', async () => {
    const first = await launch({ COSCHEMA_BATCH_MS: '30000' });
    const anna = await join(first, 'unacked-room', 'Anna');
    new Editor(4, anna.doc).addNode('not yet persisted');
    await until(() => anna.client.pendingCount > 0, 'the edit to be pending');
    await new Promise((resolve) => setTimeout(resolve, 100));
    first.signal('SIGKILL');
    await first.exited;
    expect(await countRows(database, 'doc_updates', 'unacked-room')).toBe(0);
    expect(anna.client.pendingCount).toBeGreaterThan(0);

    const second = await launch({ COSCHEMA_PORT: new URL(first.httpUrl).port });
    await until(
      () => anna.client.isSynced && anna.client.pendingCount === 0,
      'Anna to resend and be acked',
      15000,
    );
    const stored = await (async () => {
      const result = await database.pool.query<{ update: Buffer }>(
        'SELECT update FROM doc_updates WHERE room_id = $1 ORDER BY seq',
        ['unacked-room'],
      );
      return result.rows.map((row) => new Uint8Array(row.update));
    })();
    expect(loadedGraph(undefined, stored)).toBe(graphOf(anna.doc));
    expect(second.pid).not.toBe(first.pid);
  });
});
