import { InjectionToken } from '@angular/core';

export interface ConnectionTarget {
  readonly room: string;
  readonly httpBase: string;
  readonly wsBase: string;
  readonly fixedToken: string | undefined;
}

export interface LocationLike {
  readonly protocol: string;
  readonly host: string;
}

export const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
export const SAME_ORIGIN_HTTP_PREFIX = '/api';
export const SAME_ORIGIN_WS_PREFIX = '/ws';

export function isValidRoom(room: string): boolean {
  return ROOM_PATTERN.test(room);
}

export function normalizeRoom(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
}

function parseServer(raw: string | null): URL | undefined {
  if (raw === null || raw === '') return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/u, '');
}

export function resolveTarget(
  room: string,
  search: string,
  location: LocationLike,
): ConnectionTarget {
  const params = new URLSearchParams(search);
  const fixedToken = params.get('token') ?? undefined;
  const server = parseServer(params.get('server'));
  if (server !== undefined) {
    const httpBase = trimSlash(server.origin);
    return { room, httpBase, wsBase: httpBase.replace(/^http/u, 'ws'), fixedToken };
  }
  const secure = location.protocol === 'https:';
  return {
    room,
    httpBase: `${secure ? 'https' : 'http'}://${location.host}${SAME_ORIGIN_HTTP_PREFIX}`,
    wsBase: `${secure ? 'wss' : 'ws'}://${location.host}${SAME_ORIGIN_WS_PREFIX}`,
    fixedToken,
  };
}

export function socketUrl(target: ConnectionTarget): string {
  return `${target.wsBase}/rooms/${encodeURIComponent(target.room)}`;
}

export function tokenUrl(target: ConnectionTarget): string {
  return `${target.httpBase}/dev/token`;
}

export interface IssuedToken {
  readonly token: string;
}

export interface TokenProvider {
  readonly refreshable: boolean;
  get(): Promise<IssuedToken>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function fixedTokenProvider(token: string): TokenProvider {
  return { refreshable: false, get: () => Promise.resolve({ token }) };
}

export function devTokenProvider(
  target: ConnectionTarget,
  identity: { id: string; name: string; color: string },
  fetchJson: FetchLike,
): TokenProvider {
  return {
    refreshable: true,
    get: async () => {
      const response = await fetchJson(tokenUrl(target), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          room: target.room,
          name: identity.name,
          color: identity.color,
          sub: identity.id,
        }),
      });
      if (!response.ok) throw new Error(`token request failed with status ${response.status}`);
      const body = await response.json();
      const token =
        typeof body === 'object' && body !== null ? (body as { token?: unknown }).token : undefined;
      if (typeof token !== 'string' || token === '') throw new Error('token response had no token');
      return { token };
    },
  };
}

export function tokenProviderFor(
  target: ConnectionTarget,
  identity: { id: string; name: string; color: string },
  fetchJson: FetchLike,
): TokenProvider {
  return target.fixedToken === undefined
    ? devTokenProvider(target, identity, fetchJson)
    : fixedTokenProvider(target.fixedToken);
}

export const FETCH_JSON = new InjectionToken<FetchLike>('FETCH_JSON', {
  providedIn: 'root',
  factory: () => (url, init) => globalThis.fetch(url, init),
});
