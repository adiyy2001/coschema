import { createMemoryPair } from '@coschema/sync';
import { describe, expect, it } from 'vitest';
import { bridgeToServer } from './bridge';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function setup(): {
  linkClient: ReturnType<typeof createMemoryPair>;
  upstream: ReturnType<typeof createMemoryPair>;
  flushAll: () => void;
  fromUpstream: Uint8Array[];
  fromLink: Uint8Array[];
} {
  const linkClient = createMemoryPair();
  const upstream = createMemoryPair();
  const fromUpstream: Uint8Array[] = [];
  const fromLink: Uint8Array[] = [];
  upstream.server.onMessage((frame) => fromLink.push(frame));
  linkClient.client.onMessage((frame) => fromUpstream.push(frame));
  bridgeToServer(linkClient.server, () => upstream.client);
  const flushAll = (): void => {
    for (let round = 0; round < 20; round += 1) {
      linkClient.flush();
      upstream.flush();
    }
  };
  return { linkClient, upstream, flushAll, fromUpstream, fromLink };
}

describe('bridgeToServer', () => {
  it('holds frames until the upstream socket opens and then sends them in order', () => {
    const { linkClient, upstream, flushAll, fromLink } = setup();
    linkClient.client.send(bytes(1));
    linkClient.client.send(bytes(2));
    linkClient.flush();
    expect(fromLink).toEqual([]);
    upstream.flush();
    linkClient.client.send(bytes(3));
    flushAll();
    expect(fromLink).toEqual([bytes(1), bytes(2), bytes(3)]);
  });

  it('passes frames from the server back to the link', () => {
    const { upstream, flushAll, fromUpstream } = setup();
    upstream.server.send(bytes(9, 9));
    flushAll();
    expect(fromUpstream).toEqual([bytes(9, 9)]);
  });

  it('closes the upstream socket when the link closes and the other way round', () => {
    const first = setup();
    const upstreamClosed: number[] = [];
    first.upstream.server.onClose((code) => upstreamClosed.push(code));
    first.linkClient.client.close(1006, 'offline');
    first.flushAll();
    expect(upstreamClosed).toEqual([1000]);
    const second = setup();
    const linkClosed: number[] = [];
    second.linkClient.client.onClose((code) => linkClosed.push(code));
    second.upstream.server.close(4401, 'denied');
    second.flushAll();
    expect(linkClosed).toEqual([4401]);
  });
});
