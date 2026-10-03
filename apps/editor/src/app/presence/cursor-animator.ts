export interface CursorPoint {
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_HALF_LIFE_MS = 45;
export const SETTLE_DISTANCE = 0.05;
export const MAX_FRAME_GAP_MS = 250;
export const NOMINAL_FRAME_MS = 16.7;

export function smoothingFactor(elapsedMs: number, halfLifeMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (halfLifeMs <= 0) return 1;
  return 1 - 2 ** (-elapsedMs / halfLifeMs);
}

export function approach(
  current: CursorPoint,
  target: CursorPoint,
  elapsedMs: number,
  halfLifeMs: number,
): CursorPoint {
  const factor = smoothingFactor(elapsedMs, halfLifeMs);
  const x = current.x + (target.x - current.x) * factor;
  const y = current.y + (target.y - current.y) * factor;
  return Math.hypot(target.x - x, target.y - y) < SETTLE_DISTANCE ? target : { x, y };
}

interface Track {
  current: CursorPoint;
  target: CursorPoint;
}

export class CursorAnimator {
  private readonly tracks = new Map<number, Track>();
  private lastFrame: number | undefined;

  constructor(
    private readonly halfLifeMs = DEFAULT_HALF_LIFE_MS,
    private reducedMotion = false,
  ) {}

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  setTarget(id: number, target: CursorPoint | null): void {
    if (target === null) {
      this.tracks.delete(id);
      return;
    }
    const track = this.tracks.get(id);
    if (track === undefined || this.reducedMotion) {
      this.tracks.set(id, { current: target, target });
      return;
    }
    track.target = target;
  }

  remove(id: number): void {
    this.tracks.delete(id);
  }

  get active(): boolean {
    for (const track of this.tracks.values()) if (track.current !== track.target) return true;
    return false;
  }

  get size(): number {
    return this.tracks.size;
  }

  step(now: number): ReadonlyMap<number, CursorPoint> {
    const gap =
      this.lastFrame === undefined
        ? NOMINAL_FRAME_MS
        : Math.min(MAX_FRAME_GAP_MS, Math.max(0, now - this.lastFrame));
    this.lastFrame = this.active ? now : undefined;
    const positions = new Map<number, CursorPoint>();
    for (const [id, track] of this.tracks) {
      if (track.current !== track.target) {
        track.current = this.reducedMotion
          ? track.target
          : approach(track.current, track.target, gap, this.halfLifeMs);
      }
      positions.set(id, track.current);
    }
    return positions;
  }
}
