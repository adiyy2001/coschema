import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startStaticServer } from '../../scripts/static-server';
import { describeHardware } from '../lib/hardware';
import { writeResult } from '../lib/results';
import { round, summarize, type Summary } from '../lib/stats';
import { IN_PAGE_PAN_SOURCE } from './in-page';
import { parsePanOptions, type PanOptions } from './options';

const FRAME_BUDGET_MS = 1000 / 60;
const DROPPED_FRAME_MS = FRAME_BUDGET_MS * 1.5;
const OVER_BUDGET_MS = FRAME_BUDGET_MS + 2;
const EDITOR_ROOT = resolve(import.meta.dirname, '../../apps/editor/dist/editor/browser');

interface InPageResult {
  readonly frames: readonly number[];
  readonly longTasks: readonly number[];
}

interface RunResult {
  readonly fps: number;
  readonly frameMs: Summary;
  readonly overBudgetShare: number;
  readonly droppedShare: number;
  readonly longTasks: number;
  readonly longestTaskMs: number;
}

interface ZoomResult {
  readonly zoom: number;
  readonly nodesInDom: number;
  readonly edgesInDom: number;
  readonly svgElements: number;
  readonly runs: readonly RunResult[];
  readonly medianFps: number;
  readonly worstFps: number;
}

function share(values: readonly number[], threshold: number): number {
  if (values.length === 0) return Number.NaN;
  return round(values.filter((value) => value > threshold).length / values.length, 4);
}

function toRunResult(raw: InPageResult): RunResult {
  const totalMs = raw.frames.reduce((sum, value) => sum + value, 0);
  return {
    fps: round((raw.frames.length / totalMs) * 1000, 1),
    frameMs: summarize(raw.frames),
    overBudgetShare: share(raw.frames, OVER_BUDGET_MS),
    droppedShare: share(raw.frames, DROPPED_FRAME_MS),
    longTasks: raw.longTasks.length,
    longestTaskMs: round(Math.max(0, ...raw.longTasks)),
  };
}

async function loadScene(page: Page, baseUrl: string, nodes: number, zoom: number): Promise<void> {
  await page.goto(`${baseUrl}/bench?nodes=${nodes}&zoom=${zoom}`);
  await page.waitForSelector('[data-node-id], path.overview-nodes[d^="M"]', {
    timeout: 120_000,
    state: 'attached',
  });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await page.addScriptTag({ content: IN_PAGE_PAN_SOURCE });
}

async function measureZoom(
  page: Page,
  baseUrl: string,
  options: PanOptions,
  zoom: number,
): Promise<ZoomResult> {
  await loadScene(page, baseUrl, options.nodes, zoom);
  const stepX = Math.max(4, Math.round(14 * Math.min(1, zoom * 2)));
  const runs: RunResult[] = [];
  for (let run = 0; run < options.runs; run += 1) {
    const raw = await page.evaluate<InPageResult, object>(
      (inPage) =>
        (window as unknown as { __measurePan(o: object): Promise<InPageResult> }).__measurePan(
          inPage,
        ),
      {
        durationMs: options.durationMs,
        warmupFrames: 10,
        legFrames: 120,
        stepX,
        stepY: Math.round(stepX / 2),
      },
    );
    runs.push(toRunResult(raw));
  }
  const fps = runs.map((entry) => entry.fps).sort((left, right) => left - right);
  return {
    zoom,
    nodesInDom: await page.locator('[data-node-id]').count(),
    edgesInDom: await page.locator('[data-edge-id]').count(),
    svgElements: await page.locator('svg.surface *').count(),
    runs,
    medianFps: fps[Math.floor(fps.length / 2)] ?? Number.NaN,
    worstFps: fps[0] ?? Number.NaN,
  };
}

function gitRevision(): string {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
}

const options = parsePanOptions(process.argv.slice(2));
const hardware = describeHardware();
const server = await startStaticServer(EDITOR_ROOT, options.port);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
  });
  const page = await context.newPage();
  console.log(
    `pan bench: ${hardware.cpuModel}, ${hardware.cores} cores, ${hardware.ramGiB} GiB, ${hardware.os}, chromium ${browser.version()} (headless), ${options.nodes} nodes`,
  );
  const zooms: ZoomResult[] = [];
  for (const zoom of options.zooms) {
    const result = await measureZoom(page, server.url, options, zoom);
    zooms.push(result);
    console.log(
      `zoom ${zoom}: median ${result.medianFps} fps, worst ${result.worstFps} fps, ${result.nodesInDom} node and ${result.edgesInDom} edge elements, ${result.svgElements} svg elements, p95 frame ${result.runs.map((entry) => entry.frameMs.p95).join('/')} ms`,
    );
  }
  const target = await writeResult(options.output, {
    generatedAt: new Date().toISOString(),
    revision: gitRevision(),
    hardware,
    browser: { name: 'chromium', version: browser.version(), headless: true },
    viewport: { width: options.width, height: options.height },
    options,
    frameBudgetMs: round(FRAME_BUDGET_MS, 2),
    zooms,
  });
  console.log(`wrote ${target}`);
} finally {
  await browser.close();
  await server.close();
}
