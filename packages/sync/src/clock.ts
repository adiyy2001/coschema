export type TimerHandle = number;

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemClock: Clock = {
  now: () => globalThis.performance.now(),
  setTimeout: (callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle);
  },
};
