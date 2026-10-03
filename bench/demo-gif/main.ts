import { chromium, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startStaticServer } from '../../scripts/static-server';

const EDITOR_ROOT = resolve(import.meta.dirname, '../../apps/editor/dist/editor/browser');
const OUTPUT = resolve(import.meta.dirname, '../../docs/media/demo.gif');
const VIEWPORT = { width: 1280, height: 880 };
const GIF_WIDTH = 820;
const GIF_FPS = 9;
const MAX_BYTES = 8 * 1024 * 1024;

const POINTER_DOT = `
  const dot = document.createElement('div');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = 'position:fixed;left:0;top:0;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:rgba(20,20,20,0.75);border:2px solid #fff;pointer-events:none;z-index:2147483647;transition:transform 0.04s linear;';
  const attach = () => document.documentElement.appendChild(dot);
  if (document.documentElement) attach(); else addEventListener('DOMContentLoaded', attach);
  addEventListener('mousemove', (event) => {
    dot.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
  }, true);
`;

function pane(page: Page, name: string): Locator {
  return page.locator(`[data-pane="${name}"]`);
}

async function pause(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function centerOf(scope: Locator, id: string): Promise<{ x: number; y: number }> {
  const box = await scope.locator(`[data-node-id="${id}"]`).boundingBox();
  if (box === null) throw new Error(`node ${id} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, scope: Locator, id: string, dx: number, dy: number): Promise<void> {
  const from = await centerOf(scope, id);
  await page.mouse.move(from.x, from.y, { steps: 12 });
  await pause(page, 250);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 14 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 14 });
  await page.mouse.up();
  await pause(page, 400);
}

async function sweep(page: Page, scope: Locator): Promise<void> {
  const box = await scope.locator('svg').first().boundingBox();
  if (box === null) throw new Error('canvas has no box');
  const points = [
    [0.2, 0.3],
    [0.5, 0.2],
    [0.8, 0.45],
    [0.6, 0.75],
    [0.3, 0.6],
  ] as const;
  for (const [fx, fy] of points) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 22 });
    await pause(page, 120);
  }
}

async function panBy(page: Page, scope: Locator, dx: number, dy: number): Promise<void> {
  const box = await scope.locator('svg').first().boundingBox();
  if (box === null) throw new Error('canvas has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  for (let step = 0; step < 10; step += 1) {
    await page.mouse.wheel(dx / 10, dy / 10);
    await pause(page, 40);
  }
}

async function record(directory: string): Promise<string> {
  const server = await startStaticServer(EDITOR_ROOT, 4417, '127.0.0.1');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: directory, size: VIEWPORT },
    });
    await context.addInitScript(POINTER_DOT);
    const page = await context.newPage();
    await page.goto(`${server.url}/demo`);
    for (const name of ['Ada', 'Bruno']) {
      await page.waitForSelector(`[data-pane="${name}"] [data-connection][data-state="online"]`);
      await page.waitForFunction(
        (who) => document.querySelectorAll(`[data-pane="${who}"] [data-node-id]`).length === 7,
        name,
      );
    }
    const ada = pane(page, 'Ada');
    const bruno = pane(page, 'Bruno');
    await pause(page, 1200);

    await ada.locator('[data-link-offline]').check();
    await pause(page, 900);
    await drag(page, ada, 'intake', 0, 120);
    await drag(page, bruno, 'pump-b', 0, 70);
    await pause(page, 1600);
    await ada.locator('[data-link-offline]').uncheck();
    await page.waitForSelector('[data-pane="Ada"] [data-connection][data-state="online"]', {
      timeout: 20_000,
    });
    await pause(page, 2400);

    await sweep(page, ada);
    await pause(page, 600);
    await sweep(page, bruno);
    await pause(page, 500);

    await bruno.locator('[data-action="follow"]').click();
    await pause(page, 700);
    await panBy(page, ada, 140, 60);
    await pause(page, 500);
    await panBy(page, ada, -220, -20);
    await pause(page, 1500);

    const video = page.video();
    await context.close();
    if (video === null) throw new Error('no video was recorded');
    return await video.path();
  } finally {
    await browser.close();
    await server.close();
  }
}

function convert(video: string, directory: string): void {
  const palette = join(directory, 'palette.png');
  const filters = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    video,
    '-vf',
    `${filters},palettegen=max_colors=96:stats_mode=diff`,
    palette,
  ]);
  mkdirSync(resolve(OUTPUT, '..'), { recursive: true });
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    video,
    '-i',
    palette,
    '-lavfi',
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    OUTPUT,
  ]);
}

async function main(): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'coschema-gif-'));
  try {
    const video = await record(directory);
    convert(video, directory);
    const bytes = statSync(OUTPUT).size;
    process.stdout.write(`${OUTPUT}: ${(bytes / 1024 / 1024).toFixed(2)} MiB\n`);
    if (bytes > MAX_BYTES) throw new Error(`the GIF is ${bytes} bytes, the limit is ${MAX_BYTES}`);
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (process.exitCode !== 1) rmSync(directory, { recursive: true, force: true });
  }
}

void main();
