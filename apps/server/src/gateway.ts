import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { isValidRoomId } from './http';
import { describeError, type Logger } from './logger';
import { isOriginAllowed } from './origin';
import type { RoomManager } from './rooms/room-manager';
import { WsTransport } from './ws-transport';

const ROOM_PATH_PATTERN = /^\/rooms\/([^/]+)$/u;
export const DEFAULT_HEARTBEAT_MS = 30_000;

export interface GatewayOptions {
  readonly manager: RoomManager;
  readonly logger: Logger;
  readonly allowedOrigins: readonly string[];
  readonly maxPayloadBytes: number;
  readonly heartbeatMs?: number;
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => {
      socket.destroy();
    },
  );
}

function roomIdFrom(request: IncomingMessage): string | undefined {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  const match = ROOM_PATH_PATTERN.exec(path);
  const encoded = match?.[1];
  if (encoded === undefined) return undefined;
  try {
    const roomId = decodeURIComponent(encoded);
    return isValidRoomId(roomId) ? roomId : undefined;
  } catch {
    return undefined;
  }
}

export class Gateway {
  private readonly sockets: WebSocketServer;
  private readonly transports = new Set<WsTransport>();
  private readonly alive = new WeakSet<WsTransport>();
  private heartbeat: NodeJS.Timeout | undefined;

  constructor(private readonly options: GatewayOptions) {
    this.sockets = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes,
      perMessageDeflate: false,
    });
  }

  get openSockets(): number {
    return this.transports.size;
  }

  start(): void {
    const interval = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.heartbeat = setInterval(() => {
      this.sweep();
    }, interval);
    this.heartbeat.unref();
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => undefined);
    if (this.options.manager.isDraining) {
      reject(socket, 503, 'Service Unavailable');
      return;
    }
    const roomId = roomIdFrom(request);
    if (roomId === undefined) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (!isOriginAllowed(request.headers.origin, this.options.allowedOrigins)) {
      this.options.logger.warn('origin rejected', { origin: request.headers.origin, room: roomId });
      reject(socket, 403, 'Forbidden');
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (webSocket) => {
      const transport = new WsTransport(webSocket);
      this.track(transport);
      this.options.manager.join(roomId, transport).catch((error: unknown) => {
        this.options.logger.error('join failed', { room: roomId, ...describeError(error) });
        transport.close(1011, 'internal error');
      });
    });
  }

  async close(graceMs: number): Promise<void> {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const deadline = Date.now() + graceMs;
    while (this.transports.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    for (const transport of [...this.transports]) transport.terminate();
    await new Promise<void>((resolve) => {
      this.sockets.close(() => {
        resolve();
      });
    });
  }

  private track(transport: WsTransport): void {
    this.transports.add(transport);
    this.alive.add(transport);
    transport.onPong(() => {
      this.alive.add(transport);
    });
    transport.onClose(() => {
      this.transports.delete(transport);
    });
  }

  private sweep(): void {
    for (const transport of this.transports) {
      if (!this.alive.has(transport)) {
        transport.terminate();
        continue;
      }
      this.alive.delete(transport);
      transport.ping();
    }
  }
}
