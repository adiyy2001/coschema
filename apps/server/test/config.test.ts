import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_DEV_ORIGINS, DEFAULT_DEV_SECRET, parseConfig } from '../src/config';

function problemsOf(env: Record<string, string>): readonly string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe('parseConfig', () => {
  it('uses safe development defaults', () => {
    const config = parseConfig({});
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 4218,
      production: false,
      jwtSecret: DEFAULT_DEV_SECRET,
      devTokens: false,
      store: 'memory',
      idleMs: 60_000,
      compactRows: 500,
      batchMs: 50,
    });
    expect(config.allowedOrigins).toEqual(DEFAULT_DEV_ORIGINS);
  });

  it('reads every variable', () => {
    const config = parseConfig({
      COSCHEMA_HOST: '0.0.0.0',
      COSCHEMA_PORT: '9000',
      COSCHEMA_JWT_SECRET: 'x'.repeat(32),
      COSCHEMA_DEV_TOKENS: '1',
      COSCHEMA_STORE: 'postgres',
      DATABASE_URL: 'postgres://u:p@db:5432/d',
      COSCHEMA_IDLE_MS: '1000',
      COSCHEMA_COMPACT_ROWS: '10',
      COSCHEMA_COMPACT_BYTES: '2048',
      COSCHEMA_ALLOWED_ORIGINS: 'https://app.example.com/, http://localhost:4200',
      COSCHEMA_MAX_PAYLOAD_BYTES: '65536',
      COSCHEMA_AUTH_TIMEOUT_MS: '250',
      COSCHEMA_BATCH_MS: '20',
      COSCHEMA_SHUTDOWN_MS: '2000',
    });
    expect(config).toMatchObject({
      host: '0.0.0.0',
      port: 9000,
      devTokens: true,
      store: 'postgres',
      databaseUrl: 'postgres://u:p@db:5432/d',
      idleMs: 1000,
      compactRows: 10,
      compactBytes: 2048,
      maxPayloadBytes: 65_536,
      authTimeoutMs: 250,
      batchMs: 20,
      shutdownMs: 2000,
    });
    expect(config.allowedOrigins).toEqual(['https://app.example.com', 'http://localhost:4200']);
  });

  it('keeps the wildcard origin as it is', () => {
    expect(parseConfig({ COSCHEMA_ALLOWED_ORIGINS: '*' }).allowedOrigins).toEqual(['*']);
  });

  it('treats empty values as unset', () => {
    const config = parseConfig({
      COSCHEMA_PORT: '',
      COSCHEMA_JWT_SECRET: '',
      COSCHEMA_ALLOWED_ORIGINS: ' ',
      DATABASE_URL: '',
    });
    expect(config.port).toBe(4218);
    expect(config.databaseUrl).toBeUndefined();
  });

  it('requires a secret and origins in production', () => {
    expect(problemsOf({ NODE_ENV: 'production' })).toEqual([
      'COSCHEMA_JWT_SECRET is required in production',
      'COSCHEMA_ALLOWED_ORIGINS is required in production',
    ]);
  });

  it('accepts a complete production environment', () => {
    const config = parseConfig({
      NODE_ENV: 'production',
      COSCHEMA_JWT_SECRET: 's'.repeat(24),
      COSCHEMA_ALLOWED_ORIGINS: 'https://app.example.com',
    });
    expect(config.production).toBe(true);
  });

  it('rejects a short secret', () => {
    expect(problemsOf({ COSCHEMA_JWT_SECRET: 'short' })).toEqual([
      'COSCHEMA_JWT_SECRET must be at least 16 characters',
    ]);
  });

  it('requires a database url for the postgres store', () => {
    expect(problemsOf({ COSCHEMA_STORE: 'postgres' })).toEqual([
      'DATABASE_URL is required when COSCHEMA_STORE is postgres',
    ]);
  });

  it('rejects an unknown store', () => {
    expect(problemsOf({ COSCHEMA_STORE: 'redis' })).toEqual([
      'COSCHEMA_STORE must be memory or postgres',
    ]);
  });

  it('collects every problem at once', () => {
    const problems = problemsOf({
      COSCHEMA_PORT: 'abc',
      COSCHEMA_IDLE_MS: '0',
      COSCHEMA_DEV_TOKENS: 'yes',
      COSCHEMA_ALLOWED_ORIGINS: 'not a url',
      COSCHEMA_BATCH_MS: '1.5',
    });
    expect(problems).toEqual([
      'COSCHEMA_PORT must be an integer from 0 to 65535',
      'COSCHEMA_DEV_TOKENS must be 0 or 1',
      'COSCHEMA_IDLE_MS must be an integer from 1 to 86400000',
      'COSCHEMA_ALLOWED_ORIGINS has an invalid origin: not a url',
      'COSCHEMA_BATCH_MS must be an integer from 1 to 60000',
    ]);
  });

  it('describes the problems in the error message', () => {
    expect(() => parseConfig({ COSCHEMA_PORT: '-1' })).toThrow(
      'invalid configuration: COSCHEMA_PORT must be an integer from 0 to 65535',
    );
  });
});
