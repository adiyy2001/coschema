import { createNode, getNodes, initializeDocument } from '@coschema/model';
import { SyncClient, createWebSocketTransport, systemClock } from '@coschema/sync';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import * as Y from 'yjs';

const ROOT = resolve(import.meta.dirname, '../..');
const EDITOR = 'http://127.0.0.1:4280';
const SERVER = 'http://127.0.0.1:4218';
const ROOM = `smoke-${Date.now().toString(36)}`;
const SYNC_TIMEOUT_MS = 15_000;

function compose(...args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn('docker', ['compose', ...args], { cwd: ROOT, stdio: 'inherit' });
    child.once('error', fail);
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`docker compose ${args.join(' ')} exited with ${code}`)),
    );
  });
}

async function expectText(url: string, expected: string): Promise<void> {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok || !body.includes(expected)) {
    throw new Error(`${url} answered ${response.status} without "${expected}"`);
  }
  console.log(`ok ${url}`);
}

async function issueToken(name: string): Promise<string> {
  const response = await fetch(`${EDITOR}/api/dev/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ room: ROOM, name, color: '#1c7ed6', sub: `smoke-${name}` }),
  });
  const body = (await response.json()) as { token?: string };
  if (!response.ok || body.token === undefined) throw new Error('no token through nginx');
  return body.token;
}

async function joined(name: string): Promise<{ doc: Y.Doc; client: SyncClient }> {
  const token = await issueToken(name);
  const doc = new Y.Doc();
  const client = new SyncClient({
    doc,
    connect: () => createWebSocketTransport(`ws://127.0.0.1:4280/ws/rooms/${ROOM}`),
    getToken: () => token,
    clock: systemClock,
    random: Math.random,
  });
  client.start();
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (!client.isSynced) {
    if (Date.now() > deadline) throw new Error(`${name} did not sync through nginx`);
    await new Promise((done) => setTimeout(done, 50));
  }
  return { doc, client };
}

async function syncThroughProxy(): Promise<void> {
  const anna = await joined('Anna');
  const bartek = await joined('Bartek');
  initializeDocument(anna.doc);
  createNode(
    { doc: anna.doc, origin: 'smoke', random: Math.random },
    { id: 'smoke-node', type: 'rect', pos: [0, 0], label: 'Smoke' },
  );
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (!getNodes(bartek.doc).has('smoke-node')) {
    if (Date.now() > deadline) throw new Error('an edit did not reach the second client');
    await new Promise((done) => setTimeout(done, 50));
  }
  console.log('ok two clients synced through nginx and PostgreSQL');
  anna.client.destroy();
  bartek.client.destroy();
}

async function run(): Promise<void> {
  await compose('up', '--build', '-d', '--wait');
  await expectText(`${SERVER}/healthz`, 'ok');
  await expectText(`${EDITOR}/`, '<cs-root');
  await expectText(`${EDITOR}/r/${ROOM}`, '<cs-root');
  await syncThroughProxy();
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await compose('logs', '--tail', '60').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await compose('down', '-v').catch(() => undefined);
}
