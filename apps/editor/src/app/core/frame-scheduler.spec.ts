import { afterEach, describe, expect, it, vi } from 'vitest';
import { animationFrameScheduler } from './frame-scheduler';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('animationFrameScheduler', () => {
  it('runs the callback on the next animation frame', () => {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      queued.push(callback),
    );
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const callback = vi.fn();
    animationFrameScheduler(callback);
    expect(callback).not.toHaveBeenCalled();
    queued[0]?.(0);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('cancels the frame it requested', () => {
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 42);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const stop = animationFrameScheduler(() => undefined);
    stop();
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
