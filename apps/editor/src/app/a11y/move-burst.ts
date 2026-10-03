import type { Gesture } from '@coschema/model';
import type { Clock, TimerHandle } from '@coschema/sync';

const BURST_WINDOW_MS = 400;

export interface BurstHistory {
  beginGesture(): Gesture;
}

export class MoveBurst {
  private gesture: Gesture | undefined;
  private timer: TimerHandle | undefined;

  constructor(
    private readonly history: BurstHistory,
    private readonly clock: Clock,
    private readonly windowMs = BURST_WINDOW_MS,
  ) {}

  get open(): boolean {
    return this.gesture !== undefined;
  }

  run(repeat: boolean, work: () => void): void {
    if (!repeat) this.end();
    this.gesture ??= this.history.beginGesture();
    try {
      work();
    } finally {
      this.restartTimer();
    }
  }

  end(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.gesture?.end();
    this.gesture = undefined;
  }

  private restartTimer(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      this.end();
    }, this.windowMs);
  }
}
