import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preparePagesSite, resolvePagesFile } from '../pages-site.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coschema-pages-'));
  writeFileSync(join(root, 'index.html'), '<base href="/coschema/">');
  writeFileSync(join(root, 'main.js'), 'boot');
  mkdirSync(join(root, 'media'));
  writeFileSync(join(root, 'media', 'index.html'), 'media');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('preparePagesSite', () => {
  it('copies the app shell to 404.html and to one file per route', () => {
    expect(preparePagesSite(root)).toEqual(['404.html', 'demo.html', 'solo.html']);
    for (const name of ['404.html', 'demo.html', 'solo.html']) {
      expect(readFileSync(join(root, name), 'utf8')).toBe('<base href="/coschema/">');
    }
  });

  it('refuses a folder without a build', () => {
    rmSync(join(root, 'index.html'));
    expect(() => preparePagesSite(root)).toThrow('no index.html');
  });
});

describe('resolvePagesFile', () => {
  beforeEach(() => {
    preparePagesSite(root);
  });

  it('serves the site root and its files under the base path', () => {
    expect(resolvePagesFile(root, '/coschema/')).toEqual({
      file: join(root, 'index.html'),
      status: 200,
    });
    expect(resolvePagesFile(root, '/coschema')?.file).toBe(join(root, 'index.html'));
    expect(resolvePagesFile(root, '/coschema/main.js?v=1')?.file).toBe(join(root, 'main.js'));
    expect(resolvePagesFile(root, '/coschema/media/')?.file).toBe(
      join(root, 'media', 'index.html'),
    );
  });

  it('serves a route from its html file like GitHub Pages does', () => {
    expect(resolvePagesFile(root, '/coschema/demo?panes=3')).toEqual({
      file: join(root, 'demo.html'),
      status: 200,
    });
  });

  it('answers anything else with 404.html and a 404 status', () => {
    const notFound = { file: join(root, '404.html'), status: 404 };
    expect(resolvePagesFile(root, '/coschema/r/plant')).toEqual(notFound);
    expect(resolvePagesFile(root, '/demo')).toEqual(notFound);
    expect(resolvePagesFile(root, '/coschema/../../etc/passwd')).toEqual(notFound);
  });

  it('has nothing to serve before the site is prepared', () => {
    rmSync(join(root, '404.html'));
    expect(resolvePagesFile(root, '/coschema/missing')).toBeUndefined();
  });
});
