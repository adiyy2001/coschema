import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './files.ts';

import { isExcepted, licenseIsAllowed, type PackageInfo } from './licenses-rules.ts';

function licenseOf(manifest: Record<string, unknown>): string {
  const license = manifest['license'];
  if (typeof license === 'string') return license;
  if (typeof license === 'object' && license !== null && 'type' in license) {
    const type = license.type;
    if (typeof type === 'string') return type;
  }
  return 'UNKNOWN';
}

function readManifest(directory: string): PackageInfo | undefined {
  const file = resolve(directory, 'package.json');
  if (!existsSync(file)) return undefined;
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const name = manifest['name'];
  const version = manifest['version'];
  if (typeof name !== 'string' || typeof version !== 'string') return undefined;
  return { name, version, license: licenseOf(manifest) };
}

function packageDirectories(store: string): string[] {
  const directories: string[] = [];
  for (const entry of readdirSync(store)) {
    const modules = resolve(store, entry, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      const path = resolve(modules, name);
      if (name.startsWith('@')) {
        for (const scoped of readdirSync(path)) directories.push(resolve(path, scoped));
      } else if (statSync(path).isDirectory()) {
        directories.push(path);
      }
    }
  }
  return directories;
}

function main(): void {
  const store = resolve(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(store)) {
    console.error('node_modules/.pnpm is missing, run pnpm install first');
    process.exit(1);
  }
  const seen = new Map<string, PackageInfo>();
  for (const directory of packageDirectories(store)) {
    const info = readManifest(directory);
    if (info !== undefined) seen.set(`${info.name}@${info.version}`, info);
  }
  const rejected = [...seen.values()].filter(
    (info) => !licenseIsAllowed(info.license) && !isExcepted(info.name, info.license),
  );
  if (rejected.length > 0) {
    for (const info of rejected) {
      console.error(`${info.name}@${info.version}: ${info.license}`);
    }
    console.error(`license check failed: ${rejected.length} package(s)`);
    process.exit(1);
  }
  console.log(`license check passed (${seen.size} packages)`);
}

main();
