import { TestBed } from '@angular/core/testing';
import { LINK_PROFILES } from '@coschema/sim/link';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLAB_CLOCK } from '../collab/collaboration';
import { mulberry32 } from '../core/bench-scene';
import { RANDOM } from '../core/random';
import { ManualClock } from '../testing/manual-clock';
import {
  DEMO_NAMES,
  DEMO_OPTIONS,
  DemoWorld,
  MESS_OFFLINE_MS,
  POLL_INTERVAL_MS,
  demoIdentity,
  paneCountFrom,
  usesRealServer,
} from './demo-world';

function worldWith(search = '', paneCount = 2): { world: DemoWorld; clock: ManualClock } {
  const clock = new ManualClock();
  TestBed.configureTestingModule({
    providers: [
      DemoWorld,
      { provide: COLLAB_CLOCK, useValue: clock },
      { provide: RANDOM, useValue: mulberry32(8) },
      { provide: DEMO_OPTIONS, useValue: { paneCount, search } },
    ],
  });
  return { world: TestBed.inject(DemoWorld), clock };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('demo options', () => {
  it('limits the pane count to two or three', () => {
    expect(paneCountFrom('?panes=3', 2)).toBe(3);
    expect(paneCountFrom('?panes=9', 2)).toBe(3);
    expect(paneCountFrom('?panes=1', 2)).toBe(2);
    expect(paneCountFrom('?panes=two', 2)).toBe(2);
    expect(paneCountFrom('', 3)).toBe(3);
  });

  it('gives every pane a distinct person', () => {
    const names = DEMO_NAMES.map((_, index) => demoIdentity(index).name);
    expect(new Set(names).size).toBe(DEMO_NAMES.length);
    expect(demoIdentity(0).id).not.toBe(demoIdentity(1).id);
  });

  it('detects the real server mode from the query', () => {
    expect(usesRealServer('?server=http://127.0.0.1:4318')).toBe(true);
    expect(usesRealServer('?panes=3')).toBe(false);
  });
});

describe('DemoWorld', () => {
  it('builds panes with their own links and a seeded room', () => {
    const { world } = worldWith('', 3);
    expect(world.panes()).toHaveLength(3);
    expect(world.real).toBe(false);
    expect(new Set(world.panes().map((pane) => pane.key)).size).toBe(3);
    expect(world.panes()[0]?.target.fixedToken).toBe('demo');
  });

  it('applies a profile to every link', () => {
    const { world } = worldWith();
    world.applyProfile('lossy');
    for (const pane of world.panes()) {
      expect(pane.link.currentConfig).toEqual(LINK_PROFILES.lossy);
      expect(pane.lossPercent()).toBe(20);
      expect(pane.latencyMs()).toBe(60);
    }
    expect(world.profile()).toBe('lossy');
  });

  it('changes one link through its setters', () => {
    const { world } = worldWith();
    const [pane] = world.panes();
    pane?.setLatency(300);
    pane?.setJitter(40);
    pane?.setLossPercent(25);
    expect(pane?.link.currentConfig).toMatchObject({
      latencyMs: 300,
      jitterMs: 40,
      lossRate: 0.25,
    });
    pane?.setOffline(true);
    expect(pane?.link.offline).toBe(true);
    pane?.refresh();
    expect(pane?.stats().connects).toBe(0);
  });

  it('refreshes the numbers on a timer', () => {
    const { world, clock } = worldWith();
    const [pane] = world.panes();
    pane?.link.connect();
    expect(pane?.stats().connects).toBe(0);
    clock.advance(POLL_INTERVAL_MS + 1);
    expect(pane?.stats().connects).toBe(1);
  });

  it('takes every link offline for a moment during a mess and then restores them', () => {
    const { world, clock } = worldWith();
    const [first, second] = world.panes();
    second?.setOffline(true);
    world.makeMess();
    expect(world.messing()).toBe(true);
    expect(first?.link.offline).toBe(true);
    world.makeMess();
    clock.advance(MESS_OFFLINE_MS + 1);
    expect(world.messing()).toBe(false);
    expect(first?.link.offline).toBe(false);
    expect(second?.link.offline).toBe(true);
  });

  it('starts over on reset with new panes and the starter profile', () => {
    const { world } = worldWith();
    const before = world.panes().map((pane) => pane.key);
    world.applyProfile('chaotic');
    world.reset();
    expect(world.panes().map((pane) => pane.key)).not.toEqual(before);
    expect(world.profile()).toBe('clean');
    expect(world.panes()[0]?.link.currentConfig).toEqual(LINK_PROFILES.clean);
  });
});
