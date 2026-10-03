import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './files.ts';

import { yjsVersionsIn } from './yjs-versions.ts';

function main(): void {
  const store = resolve(repoRoot, 'node_modules/.pnpm');
  if (!existsSync(store)) {
    console.error('node_modules/.pnpm is missing, run pnpm install first');
    process.exit(1);
  }
  const versions = yjsVersionsIn(readdirSync(store));
  if (versions.length !== 1) {
    console.error(`expected exactly one yjs version, found: ${versions.join(', ') || 'none'}`);
    process.exit(1);
  }
  console.log(`single yjs check passed (${versions[0] ?? ''})`);
}

main();
