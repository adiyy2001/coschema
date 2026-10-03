import { describe, expect, it } from 'vitest';
import { createLogger, describeError, silentLogger } from '../src/logger';
import { Metrics } from '../src/metrics';

describe('logger', () => {
  it('writes one JSON line per entry with time, level and fields', () => {
    const lines: string[] = [];
    const logger = createLogger({
      write: (line) => lines.push(line),
      now: () => new Date('2026-10-03T12:00:00Z'),
    });
    logger.info('listening', { port: 4218 });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      time: '2026-10-03T12:00:00.000Z',
      level: 'info',
      message: 'listening',
      port: 4218,
    });
  });

  it('drops entries below the level', () => {
    const lines: string[] = [];
    const logger = createLogger({
      write: (line) => lines.push(line),
      now: () => new Date(0),
      level: 'warn',
    });
    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(lines.map((line) => (JSON.parse(line) as { message: string }).message)).toEqual([
      'c',
      'd',
    ]);
  });

  it('describes errors and other thrown values', () => {
    expect(describeError(new TypeError('bad'))).toEqual({ error: 'bad', errorName: 'TypeError' });
    expect(describeError('plain')).toEqual({ error: 'plain' });
  });

  it('has a logger that says nothing', () => {
    expect(() => {
      silentLogger.debug('x');
      silentLogger.info('x');
      silentLogger.warn('x');
      silentLogger.error('x');
    }).not.toThrow();
  });
});

describe('metrics', () => {
  it('counts and renders the Prometheus text format', () => {
    const metrics = new Metrics();
    metrics.increment('updates_applied_total');
    metrics.increment('bytes_persisted_total', 42);
    metrics.setGauge('rooms', () => 3);
    const text = metrics.render();
    expect(text).toContain('# TYPE coschema_updates_applied_total counter');
    expect(text).toContain('coschema_updates_applied_total 1');
    expect(text).toContain('coschema_bytes_persisted_total 42');
    expect(text).toContain('coschema_rooms 3');
    expect(text).toContain('coschema_connections 0');
    expect(text.endsWith('\n')).toBe(true);
  });
});
