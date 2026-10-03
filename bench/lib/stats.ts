export interface Summary {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function percentile(sorted: ArrayLike<number>, fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? Number.NaN;
}

export function round(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarize(values: ArrayLike<number>): Summary {
  const sorted = Float64Array.from(values).sort();
  let total = 0;
  for (const value of sorted) total += value;
  return {
    samples: sorted.length,
    mean: round(sorted.length === 0 ? Number.NaN : total / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted.length === 0 ? Number.NaN : (sorted[sorted.length - 1] ?? Number.NaN)),
  };
}

export class SampleBuffer {
  private values = new Float64Array(1024);
  private size = 0;

  push(value: number): void {
    if (this.size === this.values.length) {
      const grown = new Float64Array(this.values.length * 2);
      grown.set(this.values);
      this.values = grown;
    }
    this.values[this.size] = value;
    this.size += 1;
  }

  get length(): number {
    return this.size;
  }

  snapshot(): Float64Array {
    return this.values.slice(0, this.size);
  }

  clear(): void {
    this.size = 0;
  }
}
