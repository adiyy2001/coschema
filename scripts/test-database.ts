import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const TEST_DATABASE_CONTAINER = 'coschema-test-pg';
export const TEST_DATABASE_IMAGE = 'postgres:18.6-alpine';
const DATABASE_USER = 'coschema';
const DATABASE_PASSWORD = 'coschema';
const DATABASE_NAME = 'coschema';
const READY_TIMEOUT_MS = 90_000;

export interface TestDatabase {
  readonly url: string;
  readonly managed: boolean;
  stop(): Promise<void>;
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolve(address.port);
      });
    });
  });
}

async function docker(...args: string[]): Promise<string> {
  const { stdout } = await run('docker', args);
  return stdout.trim();
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      await docker(
        'exec',
        TEST_DATABASE_CONTAINER,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        DATABASE_USER,
        '-d',
        DATABASE_NAME,
      );
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('the test database did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export async function removeTestDatabase(): Promise<void> {
  await docker('rm', '-f', TEST_DATABASE_CONTAINER).catch(() => undefined);
}

export async function startTestDatabase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<TestDatabase> {
  const external = env['TEST_DATABASE_URL'];
  if (external !== undefined && external !== '') {
    return { url: external, managed: false, stop: () => Promise.resolve() };
  }
  await removeTestDatabase();
  const port = await findFreePort();
  await docker(
    'run',
    '-d',
    '--rm',
    '--name',
    TEST_DATABASE_CONTAINER,
    '-e',
    `POSTGRES_USER=${DATABASE_USER}`,
    '-e',
    `POSTGRES_PASSWORD=${DATABASE_PASSWORD}`,
    '-e',
    `POSTGRES_DB=${DATABASE_NAME}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    TEST_DATABASE_IMAGE,
  );
  try {
    await waitUntilReady();
  } catch (error) {
    await removeTestDatabase();
    throw error;
  }
  return {
    url: `postgres://${DATABASE_USER}:${DATABASE_PASSWORD}@127.0.0.1:${port}/${DATABASE_NAME}`,
    managed: true,
    stop: removeTestDatabase,
  };
}
