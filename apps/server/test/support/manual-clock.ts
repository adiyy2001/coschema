import type { Clock, TimerHandle } from '@coschema/sync';

interface Timer {
  readonly handle: TimerHandle;
  readonly due: number;
  readonly callback: () => void;
}

export class ManualClock implements Clock {
  private current = 0;
  private nextHandle = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.current;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.push({ handle, due: this.current + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((timer) => timer.handle !== handle);
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const next = this.timers
        .filter((timer) => timer.due <= target)
        .sort((left, right) => left.due - right.due || left.handle - right.handle)[0];
      if (next === undefined) break;
      this.timers = this.timers.filter((timer) => timer !== next);
      this.current = Math.max(this.current, next.due);
      next.callback();
      await settle();
    }
    this.current = target;
  }
}

export async function settle(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}
