import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

export interface SyncServerOptions {
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly databaseUrl?: string;
}

export interface RunningSyncServer {
  readonly url: string;
  stop(): Promise<void>;
}

const BUNDLE = resolve(import.meta.dirname, '../apps/server/dist/main.mjs');
const STARTUP_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 8000;

async function waitUntilHealthy(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`sync server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error('sync server did not become healthy');
}

export async function startSyncServer(options: SyncServerOptions): Promise<RunningSyncServer> {
  const url = `http://127.0.0.1:${options.port}`;
  const child = spawn(process.execPath, [BUNDLE], {
    env: {
      ...process.env,
      COSCHEMA_HOST: '127.0.0.1',
      COSCHEMA_PORT: String(options.port),
      COSCHEMA_DEV_TOKENS: '1',
      COSCHEMA_STORE: options.databaseUrl === undefined ? 'memory' : 'postgres',
      COSCHEMA_ALLOWED_ORIGINS: options.allowedOrigins.join(','),
      ...(options.databaseUrl === undefined ? {} : { DATABASE_URL: options.databaseUrl }),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await waitUntilHealthy(url, child);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  return {
    url,
    stop: () =>
      new Promise<void>((done) => {
        if (child.exitCode !== null) {
          done();
          return;
        }
        const forced = setTimeout(() => {
          child.kill('SIGKILL');
        }, STOP_TIMEOUT_MS);
        child.once('exit', () => {
          clearTimeout(forced);
          done();
        });
        child.kill('SIGTERM');
      }),
  };
}
