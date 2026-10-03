import { describe, expect, it } from 'vitest';
import { runCli, type CliIo } from '../src/cli';
import { formatDuration, formatFailure, formatSummary, type SimReport } from '../src/report';

interface Harness {
  readonly io: CliIo;
  readonly out: string[];
  readonly err: string[];
  readonly written: { path: string; value: unknown }[];
}

function harness(): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const written: { path: string; value: unknown }[] = [];
  let tick = 0;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    now: () => {
      tick += 2000;
      return tick;
    },
    isoNow: () => '2026-10-03T00:00:00.000Z',
    writeJson: (path, value) => written.push({ path, value }),
    nodeVersion: 'v24.test',
  };
  return { io, out, err, written };
}

describe('sim CLI', () => {
  it('runs many seeds, prints one summary line and writes the results file', () => {
    const { io, out, written } = harness();
    expect(runCli(['--seeds', '12'], io)).toBe(0);
    expect(out).toEqual(['seeds=12 failed=0 duration=2.0s']);
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe('bench/results/sim.json');
    const report = written[0]?.value as SimReport;
    expect(report.seeds).toBe(12);
    expect(report.from).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.failedSeeds).toEqual([]);
    expect(report.durationMs).toBe(2000);
    expect(report.seedsPerSecond).toBe(6);
    expect(report.totals.messagesSent).toBeGreaterThan(0);
    expect(report.node).toBe('v24.test');
    expect(report.generatedAt).toBe('2026-10-03T00:00:00.000Z');
  });

  it('honours --from, --out and --no-storm and reports progress on stderr', () => {
    const { io, out, err, written } = harness();
    expect(
      runCli(['--seeds', '1001', '--from', '5000', '--out', 'custom.json', '--no-storm'], io),
    ).toBe(0);
    expect(out[0]).toContain('seeds=1001 failed=0');
    expect(written[0]?.path).toBe('custom.json');
    expect((written[0]?.value as SimReport).from).toBe(5000);
    expect(err).toEqual(['1000/1001 seeds, 0 failed']);
  });

  it('passes within the time budget and fails with its own exit code when over it', () => {
    const within = harness();
    expect(runCli(['--seeds', '3', '--budget', '10'], within.io)).toBe(0);
    expect(within.err).toEqual([]);
    const over = harness();
    expect(runCli(['--seeds', '3', '--budget', '1'], over.io)).toBe(3);
    expect(over.err).toEqual(['over budget: 2.0s is more than the 1s allowed']);
    expect(over.written).toHaveLength(1);
  });

  it('prints the trace hash for one seed and the same one on a second run', () => {
    const first = harness();
    const second = harness();
    expect(runCli(['--seed', '1', '--verbose'], first.io)).toBe(0);
    expect(runCli(['--seed', '1', '--verbose'], second.io)).toBe(0);
    const hashLine = first.out.find((line) => line.startsWith('traceHash='));
    expect(hashLine).toMatch(/^traceHash=[0-9a-f]{16}$/);
    expect(first.out).toEqual(second.out);
    expect(first.out.length).toBeGreaterThan(50);
    expect(first.written).toEqual([]);
  });

  it('prints only the summary of a single seed without --verbose', () => {
    const { io, out } = harness();
    expect(runCli(['--seed', '2'], io)).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('seed=2 ok=true');
  });

  it('fails with exit code 1 and prints the failing seed when a bug is injected', () => {
    const { io, out, written } = harness();
    expect(runCli(['--seeds', '15', '--inject', 'lose-log'], io)).toBe(1);
    const failure = out.find((line) => line.startsWith('FAILED seed='));
    expect(failure).toMatch(/^FAILED seed=\d+\n/);
    expect(out.some((line) => line.includes('persisted-log-replays'))).toBe(true);
    const summary = out[out.length - 1];
    expect(summary).toMatch(/^seeds=15 failed=\d+ duration=/);
    expect(summary).not.toContain('failed=0');
    const report = written[0]?.value as SimReport;
    expect(report.failedSeeds.length).toBe(report.failed);
  });

  it('truncates a long list of failing seeds', () => {
    const { io, out } = harness();
    runCli(['--seeds', '40', '--inject', 'lose-log'], io);
    expect(out.filter((line) => line.startsWith('FAILED seed=')).length).toBeLessThanOrEqual(10);
    expect(out.some((line) => line.startsWith('... and '))).toBe(true);
  });

  it('replays a single failing seed with the injected bug', () => {
    const { io, out } = harness();
    expect(runCli(['--seed', '3', '--inject', 'lose-log'], io)).toBe(1);
    expect(out.some((line) => line.startsWith('FAILED seed=3\n'))).toBe(true);
  });

  it('rejects unknown flags and bad numbers with a usage message and exit code 2', () => {
    for (const argv of [
      ['--bogus'],
      ['--seeds', 'x'],
      ['--seeds', '3', '--budget', 'soon'],
      ['--seed', '-3'],
      ['--seed', '1', '--inject', 'nope'],
      [],
    ]) {
      const { io, err, out } = harness();
      expect(runCli(argv, io)).toBe(2);
      expect(err.join('\n')).toContain('usage: pnpm sim');
      expect(out).toEqual([]);
    }
  });
});

describe('sim report formatting', () => {
  it('formats durations and summaries', () => {
    expect(formatDuration(79_123)).toBe('79.1s');
    const report: SimReport = {
      seeds: 5000,
      from: 1,
      failed: 0,
      failedSeeds: [],
      durationMs: 79_123,
      seedsPerSecond: 63.2,
      totals: {
        messagesSent: 0,
        messagesDelivered: 0,
        messagesDuplicated: 0,
        messagesLost: 0,
        messagesPartitioned: 0,
        connects: 0,
        loggedUpdates: 0,
      },
      virtualMs: 0,
      generatedAt: '',
      node: '',
    };
    expect(formatSummary(report)).toBe('seeds=5000 failed=0 duration=79.1s');
  });

  it('prints the seed, every broken invariant and the replay command for a failure', () => {
    const text = formatFailure({
      seed: 1234,
      failures: [
        { phase: 'convergence', invariant: 'identical-documents', detail: 'client 2 differs' },
        { phase: 'undo-storm', invariant: 'valid-graph', detail: 'dangling edge e1' },
      ],
    });
    expect(text.split('\n')).toEqual([
      'FAILED seed=1234',
      '  convergence identical-documents: client 2 differs',
      '  undo-storm valid-graph: dangling edge e1',
      '  replay: pnpm sim --seed 1234 --verbose',
    ]);
  });
});
