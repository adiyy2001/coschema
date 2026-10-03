import type { Page } from '@playwright/test';

export interface LatencyOptions {
  readonly nodeId: string;
  readonly edits: number;
  readonly distance: number;
  readonly settleMs: number;
}

export const DEFAULT_LATENCY_OPTIONS: LatencyOptions = {
  nodeId: 'pump-a',
  edits: 30,
  distance: 40,
  settleMs: 60,
};

interface Probe {
  __editedAt?: number;
}

export async function armEditClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener(
      'pointerup',
      () => {
        (window as unknown as Probe).__editedAt = Date.now();
      },
      { capture: true },
    );
  });
}

function watchNode(page: Page, nodeId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const target = document.querySelector(`[data-node-id="${id}"]`);
        if (target === null) throw new Error(`node ${id} is not rendered`);
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve(Date.now());
        });
        observer.observe(target, { attributes: true, attributeFilter: ['transform'] });
      }),
    nodeId,
  );
}

async function drag(page: Page, nodeId: string, deltaX: number): Promise<void> {
  const box = await page.locator(`[data-node-id="${nodeId}"]`).boundingBox();
  if (box === null) throw new Error(`node ${nodeId} has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y, { steps: 4 });
  await page.mouse.up();
}

export async function measureEditLatency(
  writer: Page,
  reader: Page,
  options: LatencyOptions = DEFAULT_LATENCY_OPTIONS,
): Promise<number[]> {
  await armEditClock(writer);
  const samples: number[] = [];
  for (let edit = 0; edit < options.edits; edit += 1) {
    const arrival = watchNode(reader, options.nodeId);
    const direction = edit % 2 === 0 ? 1 : -1;
    await drag(writer, options.nodeId, direction * options.distance);
    const startedAt = await writer.evaluate(() => (window as unknown as Probe).__editedAt ?? 0);
    samples.push((await arrival) - startedAt);
    await writer.waitForTimeout(options.settleMs);
  }
  return samples;
}
