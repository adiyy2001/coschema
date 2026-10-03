import { CLOSE_ABNORMAL, CLOSE_NORMAL, type Transport } from '@coschema/sync';
import { describe, expect, it } from 'vitest';
import {
  LINK_PROFILES,
  LINK_PROFILE_NAMES,
  SimulatedLink,
  isLinkProfileName,
  validateLinkConfig,
  type LinkConfig,
  type LinkEvent,
} from '../src/link';
import { Prng } from '../src/prng';
import { VirtualClock } from '../src/virtual-clock';

const FIXED: LinkConfig = {
  latencyMs: 10,
  jitterMs: 0,
  lossRate: 0,
  duplicateRate: 0,
  reorderRate: 0,
  reorderDelayMs: 0,
};

interface Rig {
  readonly clock: VirtualClock;
  readonly link: SimulatedLink;
  readonly servers: Transport[];
  readonly events: LinkEvent[];
}

function rig(config: LinkConfig = FIXED, seed = 1): Rig {
  const clock = new VirtualClock();
  const servers: Transport[] = [];
  const events: LinkEvent[] = [];
  const link = new SimulatedLink({
    clock,
    random: Prng.fromSeed(seed).source(),
    config,
    accept: (transport) => servers.push(transport),
    onEvent: (event) => events.push(event),
  });
  return { clock, link, servers, events };
}

function listen(transport: Transport): {
  messages: number[];
  closes: { code: number; reason: string }[];
  opened: () => boolean;
} {
  const messages: number[] = [];
  const closes: { code: number; reason: string }[] = [];
  let opened = false;
  transport.onOpen(() => {
    opened = true;
  });
  transport.onMessage((data) => messages.push(data[0] ?? -1));
  transport.onClose((code, reason) => closes.push({ code, reason }));
  return { messages, closes, opened: () => opened };
}

function connected(config?: LinkConfig, seed?: number) {
  const setup = rig(config, seed);
  const client = setup.link.connect();
  const clientSide = listen(client);
  setup.clock.advance(100);
  const server = setup.servers[0];
  if (server === undefined) throw new Error('not accepted');
  return { ...setup, client, server, clientSide, serverSide: listen(server) };
}

describe('SimulatedLink connections', () => {
  it('accepts the server end after one trip and opens the client after a round trip', () => {
    const { link, clock, servers } = rig();
    const client = link.connect();
    const side = listen(client);
    clock.advance(9);
    expect(servers).toHaveLength(0);
    clock.advance(1);
    expect(servers).toHaveLength(1);
    expect(side.opened()).toBe(false);
    clock.advance(10);
    expect(side.opened()).toBe(true);
    expect(link.stats.connects).toBe(1);
  });

  it('delivers messages in both directions after the latency', () => {
    const { client, server, clock, clientSide, serverSide } = connected();
    client.send(new Uint8Array([1]));
    server.send(new Uint8Array([2]));
    clock.advance(9);
    expect(serverSide.messages).toEqual([]);
    clock.advance(1);
    expect(serverSide.messages).toEqual([1]);
    expect(clientSide.messages).toEqual([2]);
  });

  it('copies messages so later changes to the buffer do not leak through', () => {
    const { client, clock, serverSide } = connected();
    const buffer = new Uint8Array([7]);
    client.send(buffer);
    buffer[0] = 9;
    clock.advance(50);
    expect(serverSide.messages).toEqual([7]);
  });

  it('notifies both sides when the client closes', () => {
    const { client, clock, clientSide, serverSide, link } = connected();
    client.close(CLOSE_NORMAL, 'bye');
    clock.advance(50);
    expect(clientSide.closes).toEqual([{ code: CLOSE_NORMAL, reason: 'bye' }]);
    expect(serverSide.closes).toEqual([{ code: CLOSE_NORMAL, reason: 'bye' }]);
    expect(link.openConnectionCount).toBe(0);
    client.close();
    clock.advance(50);
    expect(clientSide.closes).toHaveLength(1);
  });

  it('notifies both sides when the server closes', () => {
    const { server, clock, clientSide, serverSide } = connected();
    server.close(4401, 'denied');
    clock.advance(50);
    expect(serverSide.closes).toEqual([{ code: 4401, reason: 'denied' }]);
    expect(clientSide.closes).toEqual([{ code: 4401, reason: 'denied' }]);
  });

  it('drops sends after a close and counts them', () => {
    const { client, clock, link, serverSide } = connected();
    client.close();
    client.send(new Uint8Array([1]));
    clock.advance(50);
    expect(serverSide.messages).toEqual([]);
    expect(link.stats.droppedBecauseClosed).toBe(1);
  });

  it('closes every connection with closeAll', () => {
    const { link, clock, clientSide, serverSide } = connected();
    link.closeAll();
    clock.advance(50);
    expect(clientSide.closes).toHaveLength(1);
    expect(serverSide.closes).toHaveLength(1);
  });

  it('never accepts a connection that the client abandoned before it arrived', () => {
    const { link, clock, servers } = rig();
    const client = link.connect();
    client.close();
    clock.advance(100);
    expect(servers).toHaveLength(0);
  });
});

describe('SimulatedLink message handling', () => {
  it('keeps order on a link without jitter', () => {
    const { client, clock, serverSide } = connected();
    for (let value = 0; value < 100; value += 1) client.send(new Uint8Array([value]));
    clock.advance(1000);
    expect(serverSide.messages).toEqual(Array.from({ length: 100 }, (_, value) => value));
  });

  it('reorders messages when jitter and reordering are on, and still delivers all of them', () => {
    const { client, clock, serverSide } = connected({
      ...FIXED,
      jitterMs: 50,
      reorderRate: 0.5,
      reorderDelayMs: 200,
    });
    for (let value = 0; value < 100; value += 1) client.send(new Uint8Array([value]));
    clock.advance(10_000);
    expect(serverSide.messages).toHaveLength(100);
    expect(serverSide.messages).not.toEqual([...serverSide.messages].sort((a, b) => a - b));
    expect([...serverSide.messages].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, value) => value),
    );
  });

  it('delivers every message twice when duplication is certain', () => {
    const { client, clock, serverSide, link } = connected({ ...FIXED, duplicateRate: 1 });
    for (let value = 0; value < 20; value += 1) client.send(new Uint8Array([value]));
    clock.advance(10_000);
    expect(serverSide.messages).toHaveLength(40);
    expect(link.stats.duplicated).toBe(20);
    expect(link.stats.delivered).toBe(40);
  });

  it('drops about the configured share of messages', () => {
    const total = 4000;
    const { client, clock, serverSide, link } = connected({ ...FIXED, lossRate: 0.3 }, 17);
    for (let value = 0; value < total; value += 1) client.send(new Uint8Array([value % 256]));
    clock.advance(10_000);
    const lossRate = link.stats.droppedByLoss / total;
    expect(lossRate).toBeGreaterThan(0.27);
    expect(lossRate).toBeLessThan(0.33);
    expect(serverSide.messages.length + link.stats.droppedByLoss).toBe(total);
  });

  it('drops everything when loss is certain', () => {
    const { client, clock, serverSide } = connected({ ...FIXED, lossRate: 1 });
    client.send(new Uint8Array([1]));
    clock.advance(1000);
    expect(serverSide.messages).toEqual([]);
  });

  it('applies the latency of the current configuration', () => {
    const { client, clock, serverSide, link } = connected();
    link.configure({ ...FIXED, latencyMs: 400 });
    client.send(new Uint8Array([1]));
    clock.advance(399);
    expect(serverSide.messages).toEqual([]);
    clock.advance(1);
    expect(serverSide.messages).toEqual([1]);
  });
});

describe('SimulatedLink partitions', () => {
  it('drops messages in both directions and keeps the connection open', () => {
    const { client, server, clock, link, clientSide, serverSide } = connected();
    link.setPartitioned(true);
    client.send(new Uint8Array([1]));
    server.send(new Uint8Array([2]));
    clock.advance(1000);
    expect(serverSide.messages).toEqual([]);
    expect(clientSide.messages).toEqual([]);
    expect(link.stats.droppedByPartition).toBe(2);
    expect(clientSide.closes).toEqual([]);
    link.setPartitioned(false);
    client.send(new Uint8Array([3]));
    clock.advance(1000);
    expect(serverSide.messages).toEqual([3]);
  });

  it('drops messages that are in flight when the partition starts', () => {
    const { client, clock, link, serverSide } = connected();
    client.send(new Uint8Array([1]));
    clock.advance(5);
    link.setPartitioned(true);
    clock.advance(1000);
    expect(serverSide.messages).toEqual([]);
    expect(link.stats.droppedByPartition).toBe(1);
  });

  it('lets a connection attempt hang until the partition ends', () => {
    const { link, clock, servers } = rig();
    link.setPartitioned(true);
    const client = link.connect();
    const side = listen(client);
    clock.advance(1000);
    expect(servers).toHaveLength(0);
    expect(side.opened()).toBe(false);
  });

  it('holds close notifications until the partition ends', () => {
    const { client, clock, link, serverSide } = connected();
    link.setPartitioned(true);
    client.close();
    clock.advance(1000);
    expect(serverSide.closes).toEqual([]);
    link.setPartitioned(false);
    clock.advance(1000);
    expect(serverSide.closes).toHaveLength(1);
  });

  it('ignores a repeated partition switch', () => {
    const { link } = connected();
    link.setPartitioned(true);
    link.setPartitioned(true);
    expect(link.partitioned).toBe(true);
    link.setPartitioned(false);
    link.setPartitioned(false);
    expect(link.partitioned).toBe(false);
  });
});

describe('SimulatedLink offline switch', () => {
  it('closes live connections on both sides', () => {
    const { clock, link, clientSide, serverSide } = connected();
    link.setOffline(true);
    clock.advance(1000);
    expect(clientSide.closes).toEqual([{ code: CLOSE_ABNORMAL, reason: 'offline' }]);
    expect(serverSide.closes).toEqual([{ code: CLOSE_ABNORMAL, reason: 'offline' }]);
    expect(link.offline).toBe(true);
  });

  it('fails connection attempts while offline and works again afterwards', () => {
    const { clock, link, servers } = rig();
    link.setOffline(true);
    const failed = link.connect();
    const failedSide = listen(failed);
    clock.advance(1000);
    expect(failedSide.closes).toHaveLength(1);
    expect(failedSide.opened()).toBe(false);
    expect(servers).toHaveLength(0);
    link.setOffline(false);
    link.setOffline(false);
    const client = link.connect();
    const side = listen(client);
    clock.advance(1000);
    expect(side.opened()).toBe(true);
    expect(servers).toHaveLength(1);
  });

  it('drops messages sent while offline and messages already in flight', () => {
    const { client, server, clock, link } = connected();
    server.send(new Uint8Array([1]));
    link.setOffline(true);
    client.send(new Uint8Array([2]));
    clock.advance(1000);
    expect(link.stats.droppedByOffline).toBeGreaterThanOrEqual(1);
    expect(link.stats.delivered).toBe(0);
  });
});

describe('SimulatedLink determinism and configuration', () => {
  function trace(seed: number): string {
    const { client, server, clock, events, link } = connected(FIXED, seed);
    link.configure(LINK_PROFILES.chaotic);
    for (let value = 0; value < 60; value += 1) {
      client.send(new Uint8Array([value]));
      server.send(new Uint8Array([value]));
    }
    clock.advance(60_000);
    return events
      .map((event) => `${event.time.toFixed(3)}${event.kind}${event.direction}`)
      .join('|');
  }

  it('replays the same events for the same seed', () => {
    expect(trace(5)).toBe(trace(5));
    expect(trace(5)).not.toBe(trace(6));
  });

  it('names the profiles and validates configurations', () => {
    expect(LINK_PROFILE_NAMES.every((name) => isLinkProfileName(name))).toBe(true);
    expect(isLinkProfileName('nope')).toBe(false);
    for (const name of LINK_PROFILE_NAMES) {
      expect(validateLinkConfig(LINK_PROFILES[name])).toBe(LINK_PROFILES[name]);
    }
    expect(() => validateLinkConfig({ ...FIXED, lossRate: 1.5 })).toThrow(RangeError);
    expect(() => validateLinkConfig({ ...FIXED, duplicateRate: -0.1 })).toThrow(RangeError);
    expect(() => validateLinkConfig({ ...FIXED, latencyMs: -1 })).toThrow(RangeError);
    expect(() => validateLinkConfig({ ...FIXED, jitterMs: Number.NaN })).toThrow(RangeError);
    const { link } = rig();
    expect(() => {
      link.configure({ ...FIXED, reorderRate: 2 });
    }).toThrow(RangeError);
    expect(link.currentConfig).toEqual(FIXED);
  });
});
