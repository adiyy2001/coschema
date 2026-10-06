import { copyFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PAGES_BASE = '/';
export const PAGES_SITE_ROOT = resolve(import.meta.dirname, '../apps/editor/dist/pages/browser');
export const PAGES_ROUTES = ['demo', 'solo'] as const;
export const NOT_FOUND_PAGE = '404.html';

export interface PagesFile {
  readonly file: string;
  readonly status: 200 | 404;
}

export function preparePagesSite(root: string): string[] {
  const index = join(root, 'index.html');
  if (!existsSync(index))
    throw new Error(`no index.html in ${root}, build the pages configuration first`);
  const written = [NOT_FOUND_PAGE, ...PAGES_ROUTES.map((route) => `${route}.html`)];
  for (const name of written) copyFileSync(index, join(root, name));
  return written;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export function resolvePagesFile(
  root: string,
  urlPath: string,
  base = PAGES_BASE,
): PagesFile | undefined {
  const notFound = join(root, NOT_FOUND_PAGE);
  const fallback = isFile(notFound) ? { file: notFound, status: 404 as const } : undefined;
  const path = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  if (!path.startsWith(base) && `${path}/` !== base) return fallback;
  const relative = normalize(path.slice(base.length - 1));
  const candidate = resolve(join(root, relative));
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return fallback;
  const options = [candidate, join(candidate, 'index.html')];
  if (extname(candidate) === '') options.push(`${candidate}.html`);
  const found = options.find(isFile);
  return found === undefined ? fallback : { file: found, status: 200 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(process.argv[2] ?? PAGES_SITE_ROOT);
  process.stdout.write(`pages site in ${root}: ${preparePagesSite(root).join(', ')}\n`);
}
