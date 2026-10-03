import { spawn, type ChildProcess } from 'node:child_process';
import { findFreePort } from '../../../../scripts/test-database';
import { TEST_SECRET } from './app';

export interface ServerProcess {
  readonly port: number;
  readonly wsUrl: string;
  readonly httpUrl: string;
  readonly logs: string[];
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly pid: number;
  signal(signal: NodeJS.Signals): void;
}

export interface ServerProcessOptions {
  readonly bundle: string;
  readonly databaseUrl: string;
  readonly env?: Readonly<Record<string, string>>;
}

export async function startServerProcess(options: ServerProcessOptions): Promise<ServerProcess> {
  const port = await findFreePort();
  const child: ChildProcess = spawn(process.execPath, [options.bundle], {
    env: {
      PATH: process.env['PATH'] ?? '',
      COSCHEMA_HOST: '127.0.0.1',
      COSCHEMA_PORT: String(port),
      COSCHEMA_JWT_SECRET: TEST_SECRET,
      COSCHEMA_STORE: 'postgres',
      DATABASE_URL: options.databaseUrl,
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  const collect = (chunk: Buffer): void => {
    logs.push(
      ...chunk
        .toString()
        .split('\n')
        .filter((line) => line.length > 0),
    );
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error('the server process did not start');
  const running: ServerProcess = {
    port,
    wsUrl: `ws://127.0.0.1:${port}`,
    httpUrl: `http://127.0.0.1:${port}`,
    logs,
    exited,
    pid,
    signal: (signal) => {
      child.kill(signal);
    },
  };
  await waitForListening(running);
  return running;
}

async function waitForListening(server: ServerProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  const state = { exitedEarly: false };
  void server.exited.then(() => {
    state.exitedEarly = true;
  });
  while (!server.logs.some((line) => line.includes('"message":"listening"'))) {
    if (state.exitedEarly) throw new Error(`the server exited at startup:\n${server.logs.join('\n')}`);
    if (Date.now() > deadline)
      throw new Error(`the server did not start:\n${server.logs.join('\n')}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
