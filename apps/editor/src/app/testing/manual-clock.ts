import type { Clock, TimerHandle } from '@coschema/sync';

interface Timer {
  readonly at: number;
  readonly callback: () => void;
}

export class ManualClock implements Clock {
  private time = 0;
  private nextHandle = 1;
  private readonly timers = new Map<TimerHandle, Timer>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { at: this.time + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle);
  }

  get pending(): number {
    return this.timers.size;
  }

  advance(durationMs: number): void {
    const target = this.time + durationMs;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (next === undefined) break;
      this.timers.delete(next[0]);
      this.time = Math.max(this.time, next[1].at);
      next[1].callback();
    }
    this.time = target;
  }
}
