import { expect, type Locator, type Page } from '@playwright/test';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-node-id]')).toHaveCount(7);
  await expect(page.locator('g[cs-edge] path.line')).toHaveCount(7);
}

export function node(page: Page, id: string): Locator {
  return page.locator(`[data-node-id="${id}"]`);
}

export async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function boxOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x, y: box.y };
}

export async function eastPortOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no box');
  return { x: box.x + box.width, y: box.y + box.height / 2 };
}

export async function dragBetween(page: Page, from: Point, to: Point, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function counts(page: Page): Promise<{ nodes: number; edges: number }> {
  const text = (await page.locator('.status').textContent()) ?? '';
  const match = /(\d+) nodes, (\d+) edges/.exec(text);
  return { nodes: Number(match?.[1] ?? Number.NaN), edges: Number(match?.[2] ?? Number.NaN) };
}

export async function zoomPercent(page: Page): Promise<number> {
  const text = (await page.locator('[data-action="zoom-reset"]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

export async function emptySpot(page: Page): Promise<Point> {
  const box = await page.locator('svg.surface').boundingBox();
  if (box === null) throw new Error('surface has no box');
  return { x: box.x + box.width - 120, y: box.y + box.height - 100 };
}

export async function worldPosition(locator: Locator): Promise<Point> {
  const transform = (await locator.getAttribute('transform')) ?? '';
  const match = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(transform);
  return { x: Number(match?.[1] ?? Number.NaN), y: Number(match?.[2] ?? Number.NaN) };
}
