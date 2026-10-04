import { describe, expect, it } from 'vitest';
import { badgeSvg, combinedLinePercent } from '../coverage-badge.ts';
import { buildReport, type Results } from '../report.ts';

const summary = (covered: number, total: number) => ({ total: { lines: { covered, total } } });

describe('combinedLinePercent', () => {
  it('weights each summary by its line count', () => {
    expect(combinedLinePercent([summary(90, 100), summary(100, 300)])).toBe(47.5);
  });

  it('rounds down so a badge never claims more than was measured', () => {
    expect(combinedLinePercent([summary(2999, 3000)])).toBe(99.9);
  });

  it('is zero for an empty project', () => {
    expect(combinedLinePercent([summary(0, 0)])).toBe(0);
  });
});

describe('badgeSvg', () => {
  it('names label and value for assistive technology', () => {
    const svg = badgeSvg('coverage', '97.3%', '#2e7d32');
    expect(svg).toContain('aria-label="coverage: 97.3%"');
    expect(svg).toContain('<title>coverage: 97.3%</title>');
  });
});

const summaryStats = { p50: 1, p95: 2, p99: 3, max: 4 };

const results: Results = {
  sim: {
    seeds: 5000,
    failed: 0,
    durationMs: 76300,
    seedsPerSecond: 65.5,
    totals: { messagesSent: 1000, messagesLost: 10, messagesDuplicated: 5 },
  },
  latency: {
    hardware: { cpuModel: 'CPU', cores: 8, ramGiB: 16, os: 'linux', node: 'v24' },
    browser: { name: 'chromium', version: '1', headless: true },
    results: [{ store: 'memory', edits: 200, latencyMs: summaryStats }],
  },
  pan: {
    options: { nodes: 5000, runs: 3, durationMs: 4000 },
    zooms: [{ zoom: 1, nodesInDom: 99, medianFps: 60, worstFps: 59.7 }],
  },
  load: {
    postgres: 'PostgreSQL 18',
    configuration: {
      rooms: 50,
      clientsPerRoom: 10,
      clients: 500,
      targetOpsPerSecondPerClient: 4,
      windows: 5,
      windowSeconds: 6,
    },
    results: {
      opsPerSecond: 1991.1,
      latencyMs: summaryStats,
      acknowledgementMs: summaryStats,
      convergedRooms: 50,
      rooms: 50,
      disconnects: 0,
      server: { cpuPercentOfOneCore: 56, peakRssMiB: 209 },
    },
  },
  saturation: {
    configuration: { p95LimitMs: 200 },
    maxSustainedOpsPerSecond: 3986.6,
    steps: [
      {
        offeredOpsPerSecond: 2000,
        achievedOpsPerSecond: 1999,
        deliveryP95Ms: 1.7,
        serverCpuPercentOfOneCore: 50,
        busiestGeneratorUtilization: 0.2,
        sustained: true,
        stoppedBecause: undefined,
      },
      {
        offeredOpsPerSecond: 8000,
        achievedOpsPerSecond: 7600,
        deliveryP95Ms: 850,
        serverCpuPercentOfOneCore: 110,
        busiestGeneratorUtilization: 0.8,
        sustained: false,
        stoppedBecause: 'delivery p95 above 200 ms',
      },
    ],
  },
  size: {
    scenes: [
      {
        nodes: 93,
        edges: 113,
        updates: 711,
        before: { bytes: 47367 },
        after: { bytes: 28620 },
        bytesRatio: 1.66,
      },
    ],
  },
  geometry: {
    scenes: [
      { nodes: 100, edges: 135, coldRouting: { totalMs: [3, 1, 2] }, dragRerouteMs: { p95: 0.8 } },
    ],
  },
  lighthouse: { lighthouse: '13.5.0', results: [{ path: '/', formFactor: 'desktop', score: 100 }] },
};

describe('buildReport', () => {
  const report = buildReport(results);

  it('prints the hardware first', () => {
    expect(report.startsWith('## Hardware')).toBe(true);
    expect(report).toContain('CPU: CPU, 8 logical cores, 16 GiB RAM');
  });

  it('reports the simulator line with grouped numbers', () => {
    expect(report).toContain('seeds=5,000 failed=0 duration=76.3s (65.5 seeds per second)');
  });

  it('uses the median of the routing runs', () => {
    expect(report).toContain('| 100 | 135 | 2 | 0.8 |');
  });

  it('says that the paced run is an offered rate and lists the saturation ramp', () => {
    expect(report).toContain('offers 2,000 operations per second');
    expect(report).toContain('maximum sustained 3,987 operations per second');
    expect(report).toContain('| 8,000 | 7,600 | 850 | 110 | no, delivery p95 above 200 ms |');
  });

  it('shows the compaction ratio', () => {
    expect(report).toContain('| 93 | 113 | 711 | 47,367 | 28,620 | 1.66x |');
  });
});
