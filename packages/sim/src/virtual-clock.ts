import type { Clock, TimerHandle } from '@coschema/sync';

interface ScheduledTimer {
  readonly id: number;
  readonly time: number;
  readonly callback: () => void;
}

export class VirtualClockOverflowError extends Error {
  constructor(readonly processed: number) {
    super(`virtual clock did not go idle after ${processed} events`);
    this.name = 'VirtualClockOverflowError';
  }
}

export class VirtualClock implements Clock {
  private currentTime = 0;
  private nextId = 1;
  private readonly heap: ScheduledTimer[] = [];
  private readonly cancelled = new Set<number>();
  private readonly active = new Set<number>();

  now(): number {
    return this.currentTime;
  }

  get pending(): number {
    return this.active.size;
  }

  setTimeout(callback: () => void, delayMs: number): TimerHandle {
    const id = this.nextId;
    this.nextId += 1;
    this.push({ id, time: this.currentTime + Math.max(0, delayMs), callback });
    this.active.add(id);
    return id;
  }

  clearTimeout(handle: TimerHandle): void {
    if (this.active.delete(handle)) this.cancelled.add(handle);
  }

  advance(durationMs: number): number {
    const target = this.currentTime + Math.max(0, durationMs);
    let processed = 0;
    for (
      let next = this.peekLive();
      next !== undefined && next.time <= target;
      next = this.peekLive()
    ) {
      this.runNext();
      processed += 1;
    }
    this.currentTime = target;
    return processed;
  }

  runUntilIdle(maxEvents: number): number {
    let processed = 0;
    while (this.peekLive() !== undefined) {
      if (processed >= maxEvents) throw new VirtualClockOverflowError(processed);
      this.runNext();
      processed += 1;
    }
    return processed;
  }

  private runNext(): void {
    const timer = this.pop();
    if (timer === undefined) return;
    if (this.cancelled.delete(timer.id)) return;
    this.active.delete(timer.id);
    this.currentTime = Math.max(this.currentTime, timer.time);
    timer.callback();
  }

  private peekLive(): ScheduledTimer | undefined {
    for (let top = this.heap[0]; top !== undefined; top = this.heap[0]) {
      if (!this.cancelled.has(top.id)) return top;
      this.cancelled.delete(top.id);
      this.pop();
    }
    return undefined;
  }

  private before(left: ScheduledTimer, right: ScheduledTimer): boolean {
    return left.time < right.time || (left.time === right.time && left.id < right.id);
  }

  private push(timer: ScheduledTimer): void {
    const heap = this.heap;
    heap.push(timer);
    let index = heap.length - 1;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = heap[parentIndex];
      const child = heap[index];
      if (parent === undefined || child === undefined || !this.before(child, parent)) break;
      heap[parentIndex] = child;
      heap[index] = parent;
      index = parentIndex;
    }
  }

  private pop(): ScheduledTimer | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined) return top;
    if (heap.length === 0) return top;
    heap[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      const leftTimer = heap[left];
      const rightTimer = heap[right];
      const current = heap[smallest];
      if (leftTimer !== undefined && current !== undefined && this.before(leftTimer, current)) {
        smallest = left;
      }
      const best = heap[smallest];
      if (rightTimer !== undefined && best !== undefined && this.before(rightTimer, best)) {
        smallest = right;
      }
      if (smallest === index) break;
      const swapWith = heap[smallest];
      const here = heap[index];
      if (swapWith === undefined || here === undefined) break;
      heap[smallest] = here;
      heap[index] = swapWith;
      index = smallest;
    }
    return top;
  }
}
