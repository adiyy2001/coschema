import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DEFAULT_TOKEN_TTL_SECONDS,
  isValidColor,
  isValidName,
  signToken,
  type SignOptions,
} from './auth';
import { isOriginAllowed } from './origin';
import type { Metrics } from './metrics';
import type { DocumentStore } from './persistence/store';

const MAX_BODY_BYTES = 4096;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const PALETTE = ['#d95f02', '#1b9e77', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d'];

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

export interface HttpOptions {
  readonly metrics: Metrics;
  readonly store: DocumentStore;
  readonly allowedOrigins: readonly string[];
  readonly devTokens: boolean;
  readonly sign: SignOptions;
  readonly isDraining: () => boolean;
}

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function send(
  response: ServerResponse,
  status: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), 'application/json');
}

function applyCors(request: IncomingMessage, response: ServerResponse, options: HttpOptions): void {
  const origin = request.headers.origin;
  if (origin === undefined || !isOriginAllowed(origin, options.allowedOrigins)) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
}

interface TokenRequest {
  readonly room: string;
  readonly name: string;
  readonly color: string;
  readonly sub: string;
}

function parseTokenRequest(raw: string): TokenRequest | string {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return 'body must be JSON';
  }
  if (typeof body !== 'object' || body === null) return 'body must be an object';
  const { room, name, color, sub } = body as Record<string, unknown>;
  if (typeof room !== 'string' || !isValidRoomId(room)) return 'room is missing or invalid';
  const resolvedName = name ?? 'Guest';
  if (typeof resolvedName !== 'string' || !isValidName(resolvedName)) return 'name is invalid';
  const resolvedColor = color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)] ?? '#1b9e77';
  if (typeof resolvedColor !== 'string' || !isValidColor(resolvedColor)) return 'color is invalid';
  const resolvedSub = sub ?? randomUUID();
  if (typeof resolvedSub !== 'string' || resolvedSub === '' || resolvedSub.length > 128) {
    return 'sub is invalid';
  }
  return { room, name: resolvedName, color: resolvedColor, sub: resolvedSub };
}

async function handleDevToken(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpOptions,
): Promise<void> {
  let raw: string;
  try {
    raw = await readBody(request);
  } catch {
    sendJson(response, 413, { error: 'body too large' });
    return;
  }
  const parsed = parseTokenRequest(raw);
  if (typeof parsed === 'string') {
    sendJson(response, 400, { error: parsed });
    return;
  }
  const token = await signToken(parsed, options.sign);
  sendJson(response, 200, {
    token,
    expiresInSeconds: options.sign.ttlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS,
  });
}

async function handleReady(response: ServerResponse, options: HttpOptions): Promise<void> {
  try {
    await options.store.ping();
    send(response, 200, 'ready\n');
  } catch {
    send(response, 503, 'store unavailable\n');
  }
}

export async function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
  options: HttpOptions,
): Promise<void> {
  const method = request.method ?? 'GET';
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  applyCors(request, response, options);
  if (method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (method === 'GET' && path === '/healthz') {
    if (options.isDraining()) send(response, 503, 'shutting down\n');
    else send(response, 200, 'ok\n');
    return;
  }
  if (method === 'GET' && path === '/readyz') {
    await handleReady(response, options);
    return;
  }
  if (method === 'GET' && path === '/metrics') {
    send(response, 200, options.metrics.render(), 'text/plain; version=0.0.4');
    return;
  }
  if (method === 'POST' && path === '/dev/token' && options.devTokens) {
    await handleDevToken(request, response, options);
    return;
  }
  sendJson(response, 404, { error: 'not found' });
}
