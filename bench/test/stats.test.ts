import { describe, expect, it } from 'vitest';
import { describeHardware } from '../lib/hardware';
import { SampleBuffer, percentile, round, summarize } from '../lib/stats';

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const sorted = Float64Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 0.99)).toBe(99);
    expect(percentile(sorted, 1)).toBe(100);
    expect(percentile(sorted, 0)).toBe(1);
  });

  it('is not a number for no samples', () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe('summarize', () => {
  it('reports the mean, percentiles and maximum of unsorted input', () => {
    const summary = summarize([5, 1, 4, 2, 3]);
    expect(summary).toEqual({ samples: 5, mean: 3, p50: 3, p95: 5, p99: 5, max: 5 });
  });

  it('survives an empty input', () => {
    const summary = summarize([]);
    expect(summary.samples).toBe(0);
    expect(summary.p95).toBeNaN();
  });
});

describe('round', () => {
  it('rounds to the given digits and leaves non-finite values alone', () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(Number.NaN)).toBeNaN();
  });
});

describe('SampleBuffer', () => {
  it('grows past its initial capacity and snapshots what it holds', () => {
    const buffer = new SampleBuffer();
    for (let index = 0; index < 5000; index += 1) buffer.push(index);
    expect(buffer.length).toBe(5000);
    const snapshot = buffer.snapshot();
    expect(snapshot[4999]).toBe(4999);
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(snapshot).toHaveLength(5000);
  });
});

describe('describeHardware', () => {
  it('names the machine', () => {
    const hardware = describeHardware();
    expect(hardware.cores).toBeGreaterThan(0);
    expect(hardware.cpuModel.length).toBeGreaterThan(0);
    expect(hardware.node).toMatch(/^v\d+\./u);
  });
});
