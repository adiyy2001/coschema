import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const RESULTS_DIRECTORY = resolve(import.meta.dirname, '../results');

export async function writeResult(name: string, value: unknown): Promise<string> {
  const target = resolve(RESULTS_DIRECTORY, `${name}.json`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}
