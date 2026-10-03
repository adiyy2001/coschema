import { spawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { findFreePort } from '../../scripts/test-database';

const SERVER_BUNDLE = resolve(import.meta.dirname, '../../apps/server/dist/main.mjs');
const BENCH_SECRET = 'bench-secret-not-used-anywhere-else';
const TICKS_PER_SECOND = 100;

export interface RunningServer {
  readonly pid: number;
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly logs: string[];
  stop(): Promise<number | null>;
}

export interface ServerOptions {
  readonly store: 'postgres' | 'memory';
  readonly databaseUrl: string | undefined;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const port = await findFreePort();
  const environment: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    COSCHEMA_HOST: '127.0.0.1',
    COSCHEMA_PORT: String(port),
    COSCHEMA_JWT_SECRET: BENCH_SECRET,
    COSCHEMA_DEV_TOKENS: '1',
    COSCHEMA_STORE: options.store,
    COSCHEMA_IDLE_MS: '600000',
  };
  if (options.databaseUrl !== undefined) environment['DATABASE_URL'] = options.databaseUrl;
  const child: ChildProcess = spawn(process.execPath, [SERVER_BUNDLE], {
    env: environment,
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
  const exited = new Promise<number | null>((resolveExit) => {
    child.on('exit', (code) => resolveExit(code));
  });
  const state = { exited: false };
  void exited.then(() => {
    state.exited = true;
  });
  const deadline = Date.now() + 30_000;
  while (!logs.some((line) => line.includes('"message":"listening"'))) {
    if (state.exited) throw new Error(`the server exited at startup:\n${logs.join('\n')}`);
    if (Date.now() > deadline) throw new Error(`the server did not start:\n${logs.join('\n')}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const pid = child.pid;
  if (pid === undefined) throw new Error('the server has no pid');
  return {
    pid,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    logs,
    stop: async () => {
      if (state.exited) return exited;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      const code = await exited;
      clearTimeout(timer);
      return code;
    },
  };
}

export interface ProcessSample {
  readonly cpuSeconds: number;
  readonly rssMiB: number;
  readonly peakRssMiB: number;
}

function kibibytesOf(status: string, field: string): number {
  const match = new RegExp(`^${field}:\\s+(\\d+) kB`, 'mu').exec(status);
  return match?.[1] === undefined ? 0 : Number(match[1]) / 1024;
}

export async function sampleProcess(pid: number): Promise<ProcessSample> {
  const [stat, status] = await Promise.all([
    readFile(`/proc/${pid}/stat`, 'utf8'),
    readFile(`/proc/${pid}/status`, 'utf8'),
  ]);
  const afterName = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const userTicks = Number(afterName[11]);
  const systemTicks = Number(afterName[12]);
  return {
    cpuSeconds: (userTicks + systemTicks) / TICKS_PER_SECOND,
    rssMiB: kibibytesOf(status, 'VmRSS'),
    peakRssMiB: kibibytesOf(status, 'VmHWM'),
  };
}

export async function fetchToken(
  server: RunningServer,
  room: string,
  name: string,
): Promise<string> {
  const response = await fetch(`${server.httpUrl}/dev/token`, {
    method: 'POST',
    body: JSON.stringify({ room, name }),
  });
  if (!response.ok) throw new Error(`token request failed with ${response.status}`);
  const body = (await response.json()) as { token: string };
  return body.token;
}

export async function fetchMetrics(server: RunningServer): Promise<Record<string, number>> {
  const text = await (await fetch(`${server.httpUrl}/metrics`)).text();
  const values: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const match = /^coschema_(\w+) (\d+)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) values[match[1]] = Number(match[2]);
  }
  return values;
}
