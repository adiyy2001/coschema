import { describe, expect, it } from 'vitest';
import { VirtualClock, VirtualClockOverflowError } from '../src/virtual-clock';

describe('VirtualClock', () => {
  it('runs timers in time order and ties in creation order', () => {
    const clock = new VirtualClock();
    const order: string[] = [];
    clock.setTimeout(() => order.push('late'), 50);
    clock.setTimeout(() => order.push('first'), 10);
    clock.setTimeout(() => order.push('second'), 10);
    clock.setTimeout(() => order.push('now'), 0);
    clock.advance(100);
    expect(order).toEqual(['now', 'first', 'second', 'late']);
    expect(clock.now()).toBe(100);
  });

  it('only runs timers that are due', () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 10);
    clock.setTimeout(() => fired.push(2), 30);
    expect(clock.advance(15)).toBe(1);
    expect(fired).toEqual([1]);
    expect(clock.pending).toBe(1);
    clock.advance(15);
    expect(fired).toEqual([1, 2]);
  });

  it('sets the time to the timer time while a callback runs', () => {
    const clock = new VirtualClock();
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 25);
    clock.advance(100);
    expect(seen).toEqual([25]);
  });

  it('runs timers that callbacks schedule within the same advance', () => {
    const clock = new VirtualClock();
    const fired: string[] = [];
    clock.setTimeout(() => {
      fired.push('outer');
      clock.setTimeout(() => fired.push('inner'), 5);
    }, 10);
    clock.advance(20);
    expect(fired).toEqual(['outer', 'inner']);
  });

  it('cancels timers and ignores unknown or finished handles', () => {
    const clock = new VirtualClock();
    const fired: number[] = [];
    const handle = clock.setTimeout(() => fired.push(1), 10);
    const done = clock.setTimeout(() => fired.push(2), 5);
    clock.clearTimeout(handle);
    clock.clearTimeout(handle);
    clock.clearTimeout(9999);
    clock.advance(20);
    clock.clearTimeout(done);
    expect(fired).toEqual([2]);
    expect(clock.pending).toBe(0);
  });

  it('goes idle and reports how many events ran', () => {
    const clock = new VirtualClock();
    clock.setTimeout(() => undefined, 10);
    clock.setTimeout(() => undefined, 20);
    expect(clock.runUntilIdle(10)).toBe(2);
    expect(clock.now()).toBe(20);
    expect(clock.runUntilIdle(10)).toBe(0);
  });

  it('fails when timers never stop', () => {
    const clock = new VirtualClock();
    const tick = (): void => {
      clock.setTimeout(tick, 1);
    };
    tick();
    expect(() => clock.runUntilIdle(100)).toThrow(VirtualClockOverflowError);
  });

  it('keeps a large random schedule in order', () => {
    const clock = new VirtualClock();
    const times: number[] = [];
    let state = 12345;
    for (let index = 0; index < 500; index += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      clock.setTimeout(() => times.push(clock.now()), state % 1000);
    }
    clock.runUntilIdle(1000);
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(times).toHaveLength(500);
  });

  it('treats negative delays as zero', () => {
    const clock = new VirtualClock();
    let fired = false;
    clock.setTimeout(() => {
      fired = true;
    }, -5);
    clock.advance(0);
    expect(fired).toBe(true);
  });
});
