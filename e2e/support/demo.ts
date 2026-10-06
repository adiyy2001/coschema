import { expect, type Locator, type Page } from '@playwright/test';

export function pane(page: Page, name: string): Locator {
  return page.locator(`[data-pane="${name}"]`);
}

export async function setRange(input: Locator, value: number): Promise<void> {
  await input.evaluate((element, next) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('not an input');
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

export async function positionsIn(scope: Locator): Promise<Record<string, string>> {
  return scope.evaluate((root) => {
    const entries: [string, string][] = [];
    for (const element of root.querySelectorAll('[data-node-id]')) {
      const id = element.getAttribute('data-node-id') ?? '';
      const label = element.querySelector('text.label')?.textContent.trim() ?? '';
      entries.push([id, `${element.getAttribute('transform') ?? ''}|${label}`]);
    }
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  });
}

export async function dragIn(
  page: Page,
  scope: Locator,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const target = scope.locator(`[data-node-id="${id}"]`);
  const box = await target.boundingBox();
  if (box === null) throw new Error('node has no box');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 6 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
  await page.mouse.up();
}

export async function expectDemoReady(page: Page, paneCount = 2): Promise<void> {
  await expect(page.locator('[data-pane]')).toHaveCount(paneCount);
  for (const name of ['Ada', 'Bruno']) {
    await expect(pane(page, name).locator('[data-connection][data-state="online"]')).toBeVisible();
    await expect(pane(page, name).locator('[data-node-id]')).toHaveCount(7);
  }
}
