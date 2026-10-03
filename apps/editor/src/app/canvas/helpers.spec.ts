import { describe, expect, it } from 'vitest';
import { detailForZoom } from './detail';
import { fitLabel } from './fit-label';
import { linesPath, rectsPath } from './overview';
import { routePath } from './route-path';

describe('detailForZoom', () => {
  it('switches level at the documented zoom thresholds', () => {
    expect(detailForZoom(1)).toBe('full');
    expect(detailForZoom(0.7)).toBe('full');
    expect(detailForZoom(0.69)).toBe('simple');
    expect(detailForZoom(0.25)).toBe('simple');
    expect(detailForZoom(0.24)).toBe('minimal');
  });
});

describe('fitLabel', () => {
  it('keeps a label that fits', () => {
    expect(fitLabel('Pump A', 200, 14)).toBe('Pump A');
  });

  it('shortens a label with an ellipsis and handles tiny widths', () => {
    expect(fitLabel('A very long label indeed', 60, 14)).toBe('A very…');
    expect(fitLabel('Long', 9, 14)).toBe('…');
    expect(fitLabel('Long', 4, 14)).toBe('');
  });
});

describe('routePath', () => {
  it('is empty without points and a plain line for two points', () => {
    expect(routePath([])).toBe('');
    expect(
      routePath([
        [0, 0],
        [10, 0],
      ]),
    ).toBe('M0 0L10 0');
  });

  it('rounds the corners', () => {
    expect(
      routePath(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        10,
      ),
    ).toBe('M0 0L90 0Q100 0 100 10L100 100');
  });

  it('shrinks the radius on short segments', () => {
    expect(
      routePath(
        [
          [0, 0],
          [10, 0],
          [10, 100],
        ],
        10,
      ),
    ).toBe('M0 0L5 0Q10 0 10 5L10 100');
  });

  it('survives repeated points', () => {
    expect(
      routePath(
        [
          [0, 0],
          [0, 0],
          [10, 0],
        ],
        4,
      ),
    ).toBe('M0 0L0 0Q0 0 0 0L10 0');
  });
});

describe('overview paths', () => {
  it('writes one closed subpath per rectangle', () => {
    expect(rectsPath([{ x: 1, y: 2, width: 10, height: 20 }])).toBe('M1 2h10v20h-10z');
    expect(rectsPath([])).toBe('');
  });

  it('writes one line per pair, centre to centre', () => {
    const left = { x: 0, y: 0, width: 10, height: 10 };
    const right = { x: 100, y: 0, width: 10, height: 10 };
    expect(linesPath([[left, right]])).toBe('M5 5L105 5');
  });
});
