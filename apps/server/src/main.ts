import { Pool } from 'pg';
import { ConfigError, parseConfig, type Config } from './config';
import { createLogger, describeError } from './logger';
import { migrate } from './persistence/migrate';
import { MemoryStore } from './persistence/memory-store';
import { PostgresStore } from './persistence/postgres-store';
import type { DocumentStore } from './persistence/store';
import { createApp } from './server';

const logger = createLogger({
  write: (line) => {
    process.stdout.write(`${line}\n`);
  },
  now: () => new Date(),
});

async function createStore(config: Config): Promise<DocumentStore> {
  if (config.store === 'memory') {
    logger.warn('using the in-memory store, nothing survives a restart');
    return new MemoryStore();
  }
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  pool.on('error', (error) => {
    logger.error('idle database client failed', describeError(error));
  });
  const applied = await migrate(pool);
  logger.info('migrations checked', { applied });
  return new PostgresStore(pool);
}

async function run(): Promise<void> {
  const config = parseConfig(process.env);
  const store = await createStore(config);
  const app = createApp({ config, store, logger });
  const address = await app.listen();
  logger.info('listening', {
    host: address.address,
    port: address.port,
    store: config.store,
    devTokens: config.devTokens,
  });
  let signalled = false;
  const shutdown = (signal: string): void => {
    if (signalled) {
      logger.warn('second signal, exiting now', { signal });
      process.exit(1);
    }
    signalled = true;
    logger.info('shutting down', { signal });
    const deadline = setTimeout(() => {
      logger.error('shutdown deadline passed', { deadlineMs: config.shutdownMs });
      process.exit(1);
    }, config.shutdownMs);
    deadline.unref();
    app.stop().then(
      (summary) => {
        logger.info('shutdown complete', { ...summary });
        process.exit(summary.failed === 0 ? 0 : 1);
      },
      (error: unknown) => {
        logger.error('shutdown failed', describeError(error));
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

run().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    logger.error('invalid configuration', { problems: error.problems });
  } else {
    logger.error('startup failed', describeError(error));
  }
  process.exit(1);
});
