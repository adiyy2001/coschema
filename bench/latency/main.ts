import { chromium, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startStaticServer } from '../../scripts/static-server';
import { startSyncServer } from '../../scripts/sync-server-process';
import { startTestDatabase, type TestDatabase } from '../../scripts/test-database';
import { describeHardware } from '../lib/hardware';
import { writeResult } from '../lib/results';
import { round, summarize, type Summary } from '../lib/stats';
import { DEFAULT_LATENCY_OPTIONS, measureEditLatency } from './measure';
import { parseLatencyOptions, type LatencyOptions, type LatencyStore } from './options';

const EDITOR_ROOT = resolve(import.meta.dirname, '../../apps/editor/dist/editor/browser');
const TARGET_P95_MS = 200;

interface StoreResult {
  readonly store: LatencyStore;
  readonly postgres: string | undefined;
  readonly edits: number;
  readonly warmupEdits: number;
  readonly latencyMs: Summary;
  readonly share: {
    readonly under50: number;
    readonly under100: number;
    readonly under200: number;
  };
  readonly meetsTarget: boolean;
}

function shareUnder(values: readonly number[], limit: number): number {
  return round(values.filter((value) => value < limit).length / values.length, 4);
}

async function joinRoom(browser: Browser, url: string, name: string, color: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(
    (identity) => {
      window.localStorage.setItem('coschema:identity', JSON.stringify(identity));
    },
    { id: `bench-${name}`, name, color },
  );
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('[data-connection][data-state="online"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-node-id]').length === 7);
  return page;
}

function postgresVersion(database: TestDatabase | undefined): string | undefined {
  if (database === undefined) return undefined;
  try {
    return execFileSync('docker', ['exec', 'coschema-test-pg', 'postgres', '--version'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
}

async function measureStore(
  browser: Browser,
  options: LatencyOptions,
  store: LatencyStore,
): Promise<StoreResult> {
  const database = store === 'postgres' ? await startTestDatabase() : undefined;
  const editorOrigin = `http://127.0.0.1:${options.editorPort}`;
  const server = await startSyncServer({
    port: options.serverPort,
    allowedOrigins: [editorOrigin],
    ...(database === undefined ? {} : { databaseUrl: database.url }),
  });
  const editor = await startStaticServer(EDITOR_ROOT, options.editorPort);
  try {
    const params = new URLSearchParams({ server: server.url });
    const url = `${editor.url}/r/latency-${store}-${Date.now().toString(36)}?${params.toString()}`;
    const writer = await joinRoom(browser, url, 'Anna', '#d6336c');
    const reader = await joinRoom(browser, url, 'Bartek', '#1c7ed6');
    const all = await measureEditLatency(writer, reader, {
      ...DEFAULT_LATENCY_OPTIONS,
      edits: options.edits + options.warmupEdits,
    });
    const samples = all.slice(options.warmupEdits);
    const summary = summarize(samples);
    return {
      store,
      postgres: postgresVersion(database),
      edits: samples.length,
      warmupEdits: options.warmupEdits,
      latencyMs: summary,
      share: {
        under50: shareUnder(samples, 50),
        under100: shareUnder(samples, 100),
        under200: shareUnder(samples, 200),
      },
      meetsTarget: summary.p95 < TARGET_P95_MS,
    };
  } finally {
    await editor.close();
    await server.stop();
    await database?.stop();
  }
}

function gitRevision(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
}

const options = parseLatencyOptions(process.argv.slice(2));
const hardware = describeHardware();
const browser = await chromium.launch();
try {
  console.log(
    `latency bench: ${hardware.cpuModel}, ${hardware.cores} cores, ${hardware.ramGiB} GiB, ${hardware.os}, chromium ${browser.version()} (headless), ${options.edits} edits per store`,
  );
  const results: StoreResult[] = [];
  for (const store of options.stores) {
    const result = await measureStore(browser, options, store);
    results.push(result);
    console.log(
      `${store}: p50 ${result.latencyMs.p50} ms, p95 ${result.latencyMs.p95} ms, p99 ${result.latencyMs.p99} ms, max ${result.latencyMs.max} ms over ${result.edits} edits`,
    );
  }
  const target = await writeResult(options.output, {
    generatedAt: new Date().toISOString(),
    revision: gitRevision(),
    hardware,
    browser: { name: 'chromium', version: browser.version(), headless: true },
    method:
      'Two browser contexts in one room on localhost. The writer drags a node by 40 px with the mouse. The clock starts at the pointerup that commits the move and stops when a mutation observer in the reader sees the transform of that node change. Both pages read Date.now() on the same machine.',
    targetP95Ms: TARGET_P95_MS,
    results,
  });
  console.log(`wrote ${target}`);
} finally {
  await browser.close();
}
