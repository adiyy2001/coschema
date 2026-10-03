import { chromium } from '@playwright/test';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { startStaticServer } from '../../scripts/static-server';
import { startSyncServer } from '../../scripts/sync-server-process';
import { describeHardware } from '../lib/hardware';
import { writeResult } from '../lib/results';
import {
  LIGHTHOUSE_VERSION,
  MIN_ACCESSIBILITY_SCORE,
  allMeetTarget,
  parseAccessibilityReport,
  toPageResult,
  type PageResult,
} from './report';

const execFileAsync = promisify(execFile);
const EDITOR_ROOT = resolve(import.meta.dirname, '../../apps/editor/dist/editor/browser');
const EDITOR_PORT = 4327;
const SERVER_PORT = 4328;
const PAGES = ['/', '/r/test', '/demo'] as const;
const FORM_FACTORS = ['desktop', 'mobile'] as const;
const CHROME_FLAGS = '--headless=new --no-sandbox --disable-gpu';

function gitRevision(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
}

async function runLighthouse(
  url: string,
  formFactor: (typeof FORM_FACTORS)[number],
  chromePath: string,
  workDirectory: string,
): Promise<unknown> {
  const output = join(workDirectory, `report-${formFactor}.json`);
  const args = [
    'dlx',
    `lighthouse@${LIGHTHOUSE_VERSION}`,
    url,
    '--only-categories=accessibility',
    '--output=json',
    `--output-path=${output}`,
    `--chrome-flags=${CHROME_FLAGS}`,
    '--quiet',
    ...(formFactor === 'desktop' ? ['--preset=desktop'] : []),
  ];
  await execFileAsync('pnpm', args, {
    cwd: workDirectory,
    env: { ...process.env, CHROME_PATH: chromePath },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(readFileSync(output, 'utf8'));
}

const browser = await chromium.launch();
const chromeVersion = browser.version();
const chromePath = chromium.executablePath();
await browser.close();
const workDirectory = mkdtempSync(join(tmpdir(), 'coschema-lighthouse-'));
const editor = await startStaticServer(EDITOR_ROOT, EDITOR_PORT);
const server = await startSyncServer({
  port: SERVER_PORT,
  allowedOrigins: [`http://127.0.0.1:${EDITOR_PORT}`],
});
try {
  const results: PageResult[] = [];
  for (const path of PAGES) {
    const query = path.startsWith('/r/') ? `?server=${encodeURIComponent(server.url)}` : '';
    const url = `${editor.url}${path}${query}`;
    for (const formFactor of FORM_FACTORS) {
      const report = parseAccessibilityReport(
        await runLighthouse(url, formFactor, chromePath, workDirectory),
      );
      const result = toPageResult(path, formFactor, report);
      results.push(result);
      const failures = result.failed
        .map((audit) => `${audit.id} (${audit.items}) ${audit.examples.join(' ')}`)
        .join(', ');
      console.log(
        `${path} ${formFactor}: accessibility ${result.score}${failures === '' ? '' : `, failed: ${failures}`}`,
      );
    }
  }
  const target = await writeResult('lighthouse', {
    generatedAt: new Date().toISOString(),
    revision: gitRevision(),
    hardware: describeHardware(),
    browser: { name: 'chromium', version: chromeVersion, headless: true },
    lighthouse: LIGHTHOUSE_VERSION,
    category: 'accessibility',
    minimumScore: MIN_ACCESSIBILITY_SCORE,
    results,
  });
  console.log(`wrote ${target}`);
  if (!allMeetTarget(results)) {
    console.error(`at least one page scored below ${MIN_ACCESSIBILITY_SCORE}`);
    process.exitCode = 1;
  }
} finally {
  await editor.close();
  await server.stop();
  rmSync(workDirectory, { recursive: true, force: true });
}
