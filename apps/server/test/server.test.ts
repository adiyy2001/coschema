import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeAuthToken, encodeUpdate, MessageType } from '@coschema/sync';
import { createTokenVerifier } from '../src/auth';
import { Editor, graphOf } from './support/documents';
import {
  TEST_SECRET,
  connectClient,
  startApp,
  tokenFor,
  until,
  type RunningApp,
  type TestClient,
} from './support/app';
import * as Y from 'yjs';

const running: RunningApp[] = [];
const clients: TestClient[] = [];

async function start(options: Parameters<typeof startApp>[0] = {}): Promise<RunningApp> {
  const app = await startApp(options);
  running.push(app);
  return app;
}

async function join(app: RunningApp, room: string, name = 'Tester'): Promise<TestClient> {
  const client = await connectClient(app.wsUrl, room, { name });
  clients.push(client);
  await until(() => client.client.isSynced, `${name} to sync`);
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.stop();
  for (const app of running.splice(0)) await app.stop();
});

interface Closed {
  readonly code: number;
  readonly frames: Uint8Array[];
}

function rawClient(
  app: RunningApp,
  path: string,
  options: { origin?: string; autoPong?: boolean } = {},
): { socket: WebSocket; closed: Promise<Closed>; opened: Promise<void> } {
  const socket = new WebSocket(`${app.wsUrl}${path}`, {
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.autoPong === undefined ? {} : { autoPong: options.autoPong }),
  });
  const frames: Uint8Array[] = [];
  socket.on('message', (data: Buffer) => frames.push(new Uint8Array(data)));
  const closed = new Promise<Closed>((resolve) => {
    socket.on('close', (code) => resolve({ code, frames }));
    socket.on('error', () => undefined);
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  return { socket, closed, opened };
}

function upgradeStatus(app: RunningApp, path: string, origin?: string): Promise<number> {
  const socket = new WebSocket(`${app.wsUrl}${path}`, origin === undefined ? {} : { origin });
  return new Promise((resolve) => {
    socket.on('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
      socket.terminate();
    });
    socket.on('open', () => {
      resolve(101);
      socket.terminate();
    });
    socket.on('error', () => undefined);
  });
}

describe('HTTP endpoints', () => {
  it('answers /healthz with ok', async () => {
    const app = await start();
    const response = await fetch(`${app.httpUrl}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok\n');
  });

  it('answers /readyz while the store works and 503 when it does not', async () => {
    const app = await start();
    expect((await fetch(`${app.httpUrl}/readyz`)).status).toBe(200);
    app.store.ping = () => Promise.reject(new Error('down'));
    expect((await fetch(`${app.httpUrl}/readyz`)).status).toBe(503);
  });

  it('serves metrics', async () => {
    const app = await start();
    const text = await (await fetch(`${app.httpUrl}/metrics`)).text();
    expect(text).toContain('coschema_rooms 0');
    expect(text).toContain('# TYPE coschema_connections gauge');
  });

  it('answers unknown paths and methods with 404', async () => {
    const app = await start();
    expect((await fetch(`${app.httpUrl}/nothing`)).status).toBe(404);
    expect((await fetch(`${app.httpUrl}/healthz`, { method: 'POST' })).status).toBe(404);
  });

  it('turns /healthz into 503 once draining starts', async () => {
    const app = await start();
    await app.app.manager.shutdown();
    expect((await fetch(`${app.httpUrl}/healthz`)).status).toBe(503);
  });

  it('mints a dev token that the verifier accepts', async () => {
    const app = await start();
    const response = await fetch(`${app.httpUrl}/dev/token`, {
      method: 'POST',
      body: JSON.stringify({ room: 'plant', name: 'Anna', color: '#d95f02', sub: 'anna' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string; expiresInSeconds: number };
    expect(body.expiresInSeconds).toBe(3600);
    const verify = createTokenVerifier({ secret: TEST_SECRET, now: () => new Date() });
    expect(await verify(body.token, 'plant')).toEqual({
      ok: true,
      identity: { sub: 'anna', name: 'Anna', color: '#d95f02', room: 'plant' },
    });
  });

  it('fills in a name, color and subject for the dev token', async () => {
    const app = await start();
    const response = await fetch(`${app.httpUrl}/dev/token`, {
      method: 'POST',
      body: JSON.stringify({ room: 'plant' }),
    });
    const { token } = (await response.json()) as { token: string };
    const verify = createTokenVerifier({ secret: TEST_SECRET, now: () => new Date() });
    const result = await verify(token, 'plant');
    expect(result.ok && (result.identity as { name: string }).name).toBe('Guest');
  });

  it.each([
    ['text that is not JSON', 'nope'],
    ['a JSON value that is not an object', '7'],
    ['a missing room', '{}'],
    ['a room with a slash', '{"room":"a/b"}'],
    ['a bad name', '{"room":"a","name":""}'],
    ['a bad color', '{"room":"a","color":"red"}'],
    ['a bad subject', '{"room":"a","sub":""}'],
  ])('rejects %s with 400', async (_label, body) => {
    const app = await start();
    const response = await fetch(`${app.httpUrl}/dev/token`, { method: 'POST', body });
    expect(response.status).toBe(400);
  });

  it('rejects a large body with 413', async () => {
    const app = await start();
    const response = await fetch(`${app.httpUrl}/dev/token`, {
      method: 'POST',
      body: JSON.stringify({ room: 'a', name: 'x'.repeat(10_000) }),
    }).catch(() => undefined);
    expect(response === undefined || response.status === 413).toBe(true);
  });

  it('does not offer dev tokens unless they are enabled', async () => {
    const app = await start({ env: { COSCHEMA_DEV_TOKENS: '0' } });
    const response = await fetch(`${app.httpUrl}/dev/token`, {
      method: 'POST',
      body: JSON.stringify({ room: 'plant' }),
    });
    expect(response.status).toBe(404);
  });

  it('adds CORS headers for allowed origins only and answers preflight', async () => {
    const app = await start({ env: { COSCHEMA_ALLOWED_ORIGINS: 'http://localhost:4217' } });
    const allowed = await fetch(`${app.httpUrl}/healthz`, {
      headers: { origin: 'http://localhost:4217' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:4217');
    const denied = await fetch(`${app.httpUrl}/healthz`, {
      headers: { origin: 'http://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${app.httpUrl}/dev/token`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:4217' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('WebSocket upgrade', () => {
  it('rejects a disallowed origin with 403 and accepts an allowed one and a missing one', async () => {
    const app = await start({ env: { COSCHEMA_ALLOWED_ORIGINS: 'http://localhost:4217' } });
    expect(await upgradeStatus(app, '/rooms/plant', 'http://evil.example')).toBe(403);
    expect(await upgradeStatus(app, '/rooms/plant', 'http://localhost:4217')).toBe(101);
    expect(await upgradeStatus(app, '/rooms/plant')).toBe(101);
  });

  it.each([
    '/',
    '/rooms',
    '/rooms/',
    '/rooms/a/b',
    '/rooms/a%20b',
    '/rooms/%E0%A4%A',
    '/other/plant',
  ])('answers %s with 404', async (path) => {
    const app = await start();
    expect(await upgradeStatus(app, path)).toBe(404);
  });

  it('rejects room ids that are too long', async () => {
    const app = await start();
    expect(await upgradeStatus(app, `/rooms/${'a'.repeat(65)}`)).toBe(404);
  });

  it('refuses upgrades while draining', async () => {
    const app = await start();
    await app.app.manager.shutdown();
    expect(await upgradeStatus(app, '/rooms/plant')).toBe(503);
  });
});

describe('authentication over a real socket', () => {
  it('rejects a bad token with 4401 and sends nothing but the denial', async () => {
    const app = await start();
    const raw = rawClient(app, '/rooms/plant');
    await raw.opened;
    raw.socket.send(encodeAuthToken('forged'));
    const closed = await raw.closed;
    expect(closed.code).toBe(4401);
    expect(closed.frames).toHaveLength(1);
    expect(decodeEnvelope(closed.frames[0] ?? new Uint8Array()).type).toBe(MessageType.auth);
    await until(
      () => app.app.metrics.count('auth_failures_total') === 1,
      'the failure to be counted',
    );
  });

  it('rejects a token for another room', async () => {
    const app = await start();
    const raw = rawClient(app, '/rooms/plant');
    await raw.opened;
    raw.socket.send(encodeAuthToken(await tokenFor('other')));
    expect((await raw.closed).code).toBe(4401);
  });

  it('rejects a first frame that is not an auth frame', async () => {
    const app = await start();
    const raw = rawClient(app, '/rooms/plant');
    await raw.opened;
    raw.socket.send(encodeUpdate(Y.encodeStateAsUpdate(new Y.Doc())));
    expect((await raw.closed).code).toBe(4401);
  });

  it('closes a socket that never authenticates', async () => {
    const app = await start({ env: { COSCHEMA_AUTH_TIMEOUT_MS: '100' } });
    const raw = rawClient(app, '/rooms/plant');
    await raw.opened;
    expect((await raw.closed).code).toBe(4401);
  });

  it('closes with 1009 on a frame over the payload limit', async () => {
    const app = await start({ env: { COSCHEMA_MAX_PAYLOAD_BYTES: '1024' } });
    const raw = rawClient(app, '/rooms/plant');
    await raw.opened;
    raw.socket.send(new Uint8Array(4096));
    const closed = await raw.closed;
    expect(closed.code).toBe(1009);
    expect(closed.frames).toHaveLength(0);
  });

  it('closes with 1003 on a text frame after authentication', async () => {
    const app = await start();
    const raw = rawClient(app, '/rooms/plant');
    await raw.opened;
    raw.socket.send(encodeAuthToken(await tokenFor('plant')));
    raw.socket.send('hello');
    expect((await raw.closed).code).toBe(1003);
  });

  it('terminates a peer that stops answering pings', async () => {
    const app = await start({ heartbeatMs: 40 });
    const raw = rawClient(app, '/rooms/plant', { autoPong: false });
    await raw.opened;
    raw.socket.send(encodeAuthToken(await tokenFor('plant')));
    expect((await raw.closed).code).toBe(1006);
  });

  it('keeps a peer that answers pings', async () => {
    const app = await start({ heartbeatMs: 40 });
    const client = await join(app, 'plant', 'Anna');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.client.currentStatus).toBe('online');
  });
});

describe('collaboration over real sockets', () => {
  it('syncs two clients in the same room and persists the edit', async () => {
    const app = await start({ env: { COSCHEMA_BATCH_MS: '10' } });
    const anna = await join(app, 'plant', 'Anna');
    const ben = await join(app, 'plant', 'Ben');
    new Editor(1, anna.doc).addNode('pump');
    await until(() => new Editor(2, ben.doc).labels.length === 1, 'the node to reach Ben');
    expect(graphOf(ben.doc)).toBe(graphOf(anna.doc));
    await until(() => anna.client.pendingCount === 0, 'the ack');
    const stored = await app.store.load('plant');
    expect(stored.logRows).toBe(1);
  });

  it('keeps rooms isolated', async () => {
    const app = await start({ env: { COSCHEMA_BATCH_MS: '10' } });
    const anna = await join(app, 'one', 'Anna');
    const ben = await join(app, 'two', 'Ben');
    new Editor(3, anna.doc).addNode('only in one');
    await until(() => anna.client.pendingCount === 0, 'the ack');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(new Editor(4, ben.doc).labels).toEqual([]);
    expect(app.app.manager.roomCount).toBe(2);
  });

  it('shows presence to the other client and removes it when the owner leaves', async () => {
    const app = await start();
    const anna = await join(app, 'plant', 'Anna');
    const ben = await join(app, 'plant', 'Ben');
    anna.client.awareness.setLocalState({ user: 'Anna' });
    await until(
      () => ben.client.awareness.getStates().has(anna.doc.clientID),
      'presence to arrive',
    );
    anna.stop();
    await until(
      () => !ben.client.awareness.getStates().has(anna.doc.clientID),
      'presence to be removed',
    );
  });

  it('refuses joins once the app has been stopped', async () => {
    const app = await start();
    const client = await join(app, 'plant', 'Anna');
    await app.stop();
    await until(() => client.client.currentStatus !== 'online', 'the client to notice');
  });
});
