type StoreKind = 'memory' | 'postgres';

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly production: boolean;
  readonly jwtSecret: string;
  readonly devTokens: boolean;
  readonly store: StoreKind;
  readonly databaseUrl: string | undefined;
  readonly idleMs: number;
  readonly compactRows: number;
  readonly compactBytes: number;
  readonly allowedOrigins: readonly string[];
  readonly maxPayloadBytes: number;
  readonly authTimeoutMs: number;
  readonly batchMs: number;
  readonly shutdownMs: number;
}

export const DEFAULT_DEV_SECRET = 'coschema-development-secret-do-not-use-in-production';

export const DEFAULT_DEV_ORIGINS: readonly string[] = [4217, 4280, 4317, 4318].flatMap((port) => [
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]);

const DEFAULTS = {
  host: '127.0.0.1',
  port: 4218,
  idleMs: 60_000,
  compactRows: 500,
  compactBytes: 4 * 1024 * 1024,
  maxPayloadBytes: 8 * 1024 * 1024,
  authTimeoutMs: 5000,
  batchMs: 50,
  shutdownMs: 10_000,
} as const;

export type Environment = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`invalid configuration: ${problems.join('; ')}`);
    this.name = 'ConfigError';
  }
}

function readInteger(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  problems: string[],
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    problems.push(`${name} must be an integer from ${minimum} to ${maximum}`);
    return fallback;
  }
  return value;
}

function readFlag(env: Environment, name: string, problems: string[]): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '' || raw === '0') return false;
  if (raw === '1') return true;
  problems.push(`${name} must be 0 or 1`);
  return false;
}

function readOrigins(env: Environment, production: boolean, problems: string[]): string[] {
  const raw = env['COSCHEMA_ALLOWED_ORIGINS'];
  if (raw === undefined || raw.trim() === '') {
    if (production) problems.push('COSCHEMA_ALLOWED_ORIGINS is required in production');
    return [...DEFAULT_DEV_ORIGINS];
  }
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const normalized: string[] = [];
  for (const origin of origins) {
    if (origin === '*') normalized.push(origin);
    else if (URL.canParse(origin)) normalized.push(new URL(origin).origin);
    else problems.push(`COSCHEMA_ALLOWED_ORIGINS has an invalid origin: ${origin}`);
  }
  return normalized;
}

function readStore(env: Environment, problems: string[]): StoreKind {
  const raw = env['COSCHEMA_STORE'] ?? 'memory';
  if (raw === 'memory' || raw === 'postgres') return raw;
  problems.push('COSCHEMA_STORE must be memory or postgres');
  return 'memory';
}

function readSecret(env: Environment, production: boolean, problems: string[]): string {
  const secret = env['COSCHEMA_JWT_SECRET'];
  if (secret === undefined || secret === '') {
    if (production) problems.push('COSCHEMA_JWT_SECRET is required in production');
    return DEFAULT_DEV_SECRET;
  }
  if (secret.length < 16) problems.push('COSCHEMA_JWT_SECRET must be at least 16 characters');
  return secret;
}

export function parseConfig(env: Environment): Config {
  const problems: string[] = [];
  const production = env['NODE_ENV'] === 'production';
  const store = readStore(env, problems);
  const databaseUrl = env['DATABASE_URL'] === '' ? undefined : env['DATABASE_URL'];
  if (store === 'postgres' && databaseUrl === undefined) {
    problems.push('DATABASE_URL is required when COSCHEMA_STORE is postgres');
  }
  const config: Config = {
    host: env['COSCHEMA_HOST'] ?? DEFAULTS.host,
    port: readInteger(env, 'COSCHEMA_PORT', DEFAULTS.port, 0, 65_535, problems),
    production,
    jwtSecret: readSecret(env, production, problems),
    devTokens: readFlag(env, 'COSCHEMA_DEV_TOKENS', problems),
    store,
    databaseUrl,
    idleMs: readInteger(env, 'COSCHEMA_IDLE_MS', DEFAULTS.idleMs, 1, 86_400_000, problems),
    compactRows: readInteger(env, 'COSCHEMA_COMPACT_ROWS', DEFAULTS.compactRows, 1, 1e7, problems),
    compactBytes: readInteger(
      env,
      'COSCHEMA_COMPACT_BYTES',
      DEFAULTS.compactBytes,
      1,
      2 ** 31 - 1,
      problems,
    ),
    allowedOrigins: readOrigins(env, production, problems),
    maxPayloadBytes: readInteger(
      env,
      'COSCHEMA_MAX_PAYLOAD_BYTES',
      DEFAULTS.maxPayloadBytes,
      1024,
      256 * 1024 * 1024,
      problems,
    ),
    authTimeoutMs: readInteger(
      env,
      'COSCHEMA_AUTH_TIMEOUT_MS',
      DEFAULTS.authTimeoutMs,
      1,
      60_000,
      problems,
    ),
    batchMs: readInteger(env, 'COSCHEMA_BATCH_MS', DEFAULTS.batchMs, 1, 60_000, problems),
    shutdownMs: readInteger(
      env,
      'COSCHEMA_SHUTDOWN_MS',
      DEFAULTS.shutdownMs,
      100,
      600_000,
      problems,
    ),
  };
  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
