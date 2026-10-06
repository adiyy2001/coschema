import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { resolvePagesFile } from './pages-site';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticServer {
  readonly url: string;
  close(): Promise<void>;
}

function resolveRequestPath(root: string, urlPath: string): string | undefined {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(`${root}/`)) return undefined;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const fallback = join(root, 'index.html');
  return extname(decoded) === '' && existsSync(fallback) ? fallback : undefined;
}

interface ResolvedFile {
  readonly file: string;
  readonly status: number;
}

type FileResolver = (urlPath: string) => ResolvedFile | undefined;

export async function startStaticServer(
  root: string,
  port: number,
  host = '127.0.0.1',
): Promise<StaticServer> {
  const base = resolve(root);
  return serveFiles(
    (urlPath) => {
      const file = resolveRequestPath(base, urlPath);
      return file === undefined ? undefined : { file, status: 200 };
    },
    port,
    host,
  );
}

export async function startPagesServer(
  root: string,
  port: number,
  host = '127.0.0.1',
): Promise<StaticServer> {
  const base = resolve(root);
  return serveFiles((urlPath) => resolvePagesFile(base, urlPath), port, host);
}

async function serveFiles(
  resolveFile: FileResolver,
  port: number,
  host: string,
): Promise<StaticServer> {
  const server: Server = createServer((request, response) => {
    const resolved = resolveFile(request.url ?? '/');
    if (resolved === undefined) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(resolved.status, {
      'content-type': CONTENT_TYPES[extname(resolved.file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(resolved.file).pipe(response);
  });
  await new Promise<void>((resolveListening, rejectListening) => {
    server.once('error', rejectListening);
    server.listen(port, host, resolveListening);
  });
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolveClosed) => {
        server.closeAllConnections();
        server.close(() => {
          resolveClosed();
        });
      }),
  };
}
