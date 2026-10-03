import { InjectionToken } from '@angular/core';

export type FrameScheduler = (callback: () => void) => () => void;

export const FRAME_SCHEDULER = new InjectionToken<FrameScheduler>('FRAME_SCHEDULER', {
  providedIn: 'root',
  factory: () => animationFrameScheduler,
});

export function animationFrameScheduler(callback: () => void): () => void {
  const handle = requestAnimationFrame(callback);
  return () => {
    cancelAnimationFrame(handle);
  };
}
