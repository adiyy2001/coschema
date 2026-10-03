import { describe, expect, it } from 'vitest';
import { measureScene } from '../geometry/measure';
import { DEFAULT_GEOMETRY_OPTIONS, parseGeometryOptions } from '../geometry/options';
import { generateScene } from '../geometry/scene';

describe('geometry bench scenes', () => {
  it('generates the same scene for the same seed and a different one for another seed', () => {
    expect(generateScene(300, 7)).toEqual(generateScene(300, 7));
    expect(generateScene(300, 7)).not.toEqual(generateScene(300, 8));
  });

  it('connects existing nodes only and keeps node ids unique', () => {
    const scene = generateScene(250, 1);
    const ids = new Set(scene.nodes.map((node) => node.id));
    expect(ids.size).toBe(250);
    expect(scene.edges.length).toBeGreaterThan(250);
    expect(scene.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });

  it('measures a small scene and finds grid and linear scan in agreement', () => {
    const result = measureScene(generateScene(60, 3), 2, 30, 10, 3);
    expect(result.nodes).toBe(60);
    expect(result.coldRouting.edges).toBe(result.edges);
    expect(result.coldRouting.totalMs).toHaveLength(2);
    expect(result.culling).toHaveLength(4);
    expect(result.dragMissesPerMove).toBeGreaterThan(0);
  });
});

describe('parseGeometryOptions', () => {
  it('uses the defaults and reads overrides', () => {
    expect(parseGeometryOptions([])).toEqual(DEFAULT_GEOMETRY_OPTIONS);
    expect(
      parseGeometryOptions(['--sizes', '10,20', '--runs', '2', '--output', 'tmp']),
    ).toMatchObject({
      sizes: [10, 20],
      runs: 2,
      output: 'tmp',
    });
  });

  it('rejects values that are not positive integers', () => {
    expect(() => parseGeometryOptions(['--runs', '0'])).toThrow('--runs');
    expect(() => parseGeometryOptions(['--sizes', '10,x'])).toThrow('--sizes');
  });
});
