import type { FrameScheduler } from '../core/frame-scheduler';

export class ManualFrames {
  private readonly callbacks = new Map<number, () => void>();
  private nextId = 0;

  readonly schedule: FrameScheduler = (callback) => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return () => {
      this.callbacks.delete(id);
    };
  };

  get pending(): number {
    return this.callbacks.size;
  }

  tick(): void {
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback();
  }
}
