import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runCli } from './cli';

process.exitCode = runCli(process.argv.slice(2), {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
  now: () => performance.now(),
  isoNow: () => new Date(performance.timeOrigin + performance.now()).toISOString(),
  writeJson: (path, value) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  },
  nodeVersion: process.version,
});
