import { describe, expect, it } from 'vitest';
import {
  devTokenProvider,
  fixedTokenProvider,
  isValidRoom,
  normalizeRoom,
  resolveTarget,
  socketUrl,
  tokenProviderFor,
  tokenUrl,
  type FetchLike,
} from './connection';

const identity = { id: 'abc', name: 'Anna 12', color: '#1c7ed6' };

describe('connection target', () => {
  it('uses the proxy prefixes of the page origin by default', () => {
    const target = resolveTarget('plant', '', { protocol: 'http:', host: '127.0.0.1:4280' });
    expect(socketUrl(target)).toBe('ws://127.0.0.1:4280/ws/rooms/plant');
    expect(tokenUrl(target)).toBe('http://127.0.0.1:4280/api/dev/token');
    expect(target.fixedToken).toBeUndefined();
  });

  it('switches to secure sockets on https', () => {
    const target = resolveTarget('plant', '', { protocol: 'https:', host: 'demo.example' });
    expect(socketUrl(target)).toBe('wss://demo.example/ws/rooms/plant');
    expect(tokenUrl(target)).toBe('https://demo.example/api/dev/token');
  });

  it('points at another server with the server parameter', () => {
    const target = resolveTarget('plant', '?server=http://127.0.0.1:4318/', {
      protocol: 'http:',
      host: 'x',
    });
    expect(socketUrl(target)).toBe('ws://127.0.0.1:4318/rooms/plant');
    expect(tokenUrl(target)).toBe('http://127.0.0.1:4318/dev/token');
  });

  it('ignores a server parameter that is not an http address', () => {
    for (const bad of ['?server=ftp://x', '?server=nonsense', '?server=']) {
      const target = resolveTarget('plant', bad, { protocol: 'http:', host: 'h:1' });
      expect(socketUrl(target)).toBe('ws://h:1/ws/rooms/plant');
    }
  });

  it('reads a fixed token from the url', () => {
    const target = resolveTarget('plant', '?token=abc.def', { protocol: 'http:', host: 'h' });
    expect(target.fixedToken).toBe('abc.def');
  });

  it('encodes the room in the socket url and validates room names', () => {
    expect(isValidRoom('plant-1_a')).toBe(true);
    expect(isValidRoom('')).toBe(false);
    expect(isValidRoom('a b')).toBe(false);
    expect(isValidRoom('x'.repeat(65))).toBe(false);
  });

  it('turns free text into a valid room name', () => {
    expect(normalizeRoom('  My Plant / Unit 3 ')).toBe('My-Plant-Unit-3');
    expect(normalizeRoom('---')).toBe('');
    expect(normalizeRoom('x'.repeat(100))).toHaveLength(64);
  });
});

describe('token providers', () => {
  const target = resolveTarget('plant', '', { protocol: 'http:', host: 'h' });

  it('hands out the fixed token and cannot refresh it', async () => {
    const provider = fixedTokenProvider('t');
    expect(provider.refreshable).toBe(false);
    expect(await provider.get()).toEqual({ token: 't' });
  });

  it('asks the dev endpoint for a token with the identity', async () => {
    const requests: { url: string; body: unknown }[] = [];
    const fetchJson: FetchLike = (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: 'jwt' }),
      });
    };
    const provider = devTokenProvider(target, identity, fetchJson);
    expect(provider.refreshable).toBe(true);
    expect(await provider.get()).toEqual({ token: 'jwt' });
    expect(requests).toEqual([
      {
        url: 'http://h/api/dev/token',
        body: { room: 'plant', name: 'Anna 12', color: '#1c7ed6', sub: 'abc' },
      },
    ]);
  });

  it('fails when the endpoint answers with an error or a body without a token', async () => {
    const failing: FetchLike = () =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    await expect(devTokenProvider(target, identity, failing).get()).rejects.toThrow('status 404');
    const empty: FetchLike = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ token: '' }) });
    await expect(devTokenProvider(target, identity, empty).get()).rejects.toThrow('no token');
    const nothing: FetchLike = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(null) });
    await expect(devTokenProvider(target, identity, nothing).get()).rejects.toThrow('no token');
  });

  it('picks the fixed provider when the url carries a token', () => {
    const withToken = resolveTarget('plant', '?token=zzz', { protocol: 'http:', host: 'h' });
    expect(
      tokenProviderFor(withToken, identity, () => Promise.reject(new Error('unused'))).refreshable,
    ).toBe(false);
    expect(
      tokenProviderFor(target, identity, () => Promise.reject(new Error('unused'))).refreshable,
    ).toBe(true);
  });
});
