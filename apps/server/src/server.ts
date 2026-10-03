import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { systemClock, type Clock } from '@coschema/sync';
import { createTokenVerifier } from './auth';
import type { Config } from './config';
import { Gateway } from './gateway';
import { handleHttp } from './http';
import { describeError, type Logger } from './logger';
import { Metrics } from './metrics';
import type { DocumentStore } from './persistence/store';
import { RoomManager, type ShutdownSummary } from './rooms/room-manager';

const BATCH_MAX_BYTES = 256 * 1024;
const SOCKET_GRACE_MS = 1000;

export interface AppOptions {
  readonly config: Config;
  readonly store: DocumentStore;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly now?: () => Date;
  readonly heartbeatMs?: number;
}

export interface App {
  readonly server: Server;
  readonly manager: RoomManager;
  readonly metrics: Metrics;
  listen(): Promise<AddressInfo>;
  stop(): Promise<ShutdownSummary>;
}

export function createApp(options: AppOptions): App {
  const { config, store, logger } = options;
  const clock = options.clock ?? systemClock;
  const now = options.now ?? (() => new Date());
  const metrics = new Metrics();
  const manager = new RoomManager({
    store,
    clock,
    metrics,
    logger,
    verifyToken: createTokenVerifier({ secret: config.jwtSecret, now }),
    idleMs: config.idleMs,
    settings: {
      batchMs: config.batchMs,
      batchMaxBytes: BATCH_MAX_BYTES,
      compactRows: config.compactRows,
      compactBytes: config.compactBytes,
      authTimeoutMs: config.authTimeoutMs,
    },
  });
  const gateway = new Gateway({
    manager,
    logger,
    allowedOrigins: config.allowedOrigins,
    maxPayloadBytes: config.maxPayloadBytes,
    ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
  });
  const httpOptions = {
    metrics,
    store,
    allowedOrigins: config.allowedOrigins,
    devTokens: config.devTokens,
    sign: { secret: config.jwtSecret, now },
    isDraining: () => manager.isDraining,
  };
  const server = createServer((request, response) => {
    handleHttp(request, response, httpOptions).catch((error: unknown) => {
      logger.error('request failed', describeError(error));
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.on('upgrade', (request, socket, head) => {
    gateway.upgrade(request, socket, head);
  });
  let stopping: Promise<ShutdownSummary> | undefined;
  return {
    server,
    manager,
    metrics,
    listen: () =>
      new Promise<AddressInfo>((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          gateway.start();
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('server has no address'));
            return;
          }
          resolve(address);
        });
      }),
    stop: () => {
      stopping ??= stopApp();
      return stopping;
    },
  };

  async function stopApp(): Promise<ShutdownSummary> {
    const stopped = new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    server.closeIdleConnections();
    const summary = await manager.shutdown();
    await gateway.close(SOCKET_GRACE_MS);
    server.closeAllConnections();
    await stopped;
    await store.close();
    return summary;
  }
}
