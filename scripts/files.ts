import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '..');

export function listProjectFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .split('\0')
    .filter((file) => file.length > 0)
    .filter((file) => existsSync(resolve(repoRoot, file)));
}

export function readProjectFile(file: string): string {
  return readFileSync(resolve(repoRoot, file), 'utf8');
}

export function extensionOf(file: string): string {
  return extname(file).toLowerCase();
}
