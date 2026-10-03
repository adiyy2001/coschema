import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { E2E_PORT, SYNC_PORT } from '../playwright.config';

export const SERVER_URL = `http://127.0.0.1:${SYNC_PORT}`;
export const ONLINE = '[data-connection][data-state="online"]';

export interface Client {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

export interface JoinOptions {
  readonly token?: string;
  readonly color?: string;
  readonly expectOnline?: boolean;
}

const COLORS: Readonly<Record<string, string>> = {
  Anna: '#d6336c',
  Bartek: '#1c7ed6',
  Celina: '#2f9e44',
};

let roomCounter = 0;

export function uniqueRoom(label: string): string {
  roomCounter += 1;
  return `${label}-${Date.now().toString(36)}-${roomCounter}`;
}

export function roomUrl(room: string, token?: string): string {
  const params = new URLSearchParams({ server: SERVER_URL });
  if (token !== undefined) params.set('token', token);
  return `http://127.0.0.1:${E2E_PORT}/r/${room}?${params.toString()}`;
}

export async function newClient(
  browser: Browser,
  name: string,
  color = COLORS[name] ?? '#1c7ed6',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const identity = { id: `e2e-${name.toLowerCase()}`, name, color };
  await context.addInitScript((value) => {
    if (window.localStorage.getItem('coschema:identity') === null) {
      window.localStorage.setItem('coschema:identity', JSON.stringify(value));
    }
  }, identity);
  const page = await context.newPage();
  return { context, page };
}

export async function joinRoom(
  browser: Browser,
  room: string,
  name: string,
  options: JoinOptions = {},
): Promise<Client> {
  const { context, page } = await newClient(browser, name, options.color);
  await page.goto(roomUrl(room, options.token));
  if (options.expectOnline ?? true) {
    await expect(page.locator(ONLINE)).toBeVisible();
    await expect(page.locator('[data-node-id]')).toHaveCount(7);
  }
  return { name, context, page };
}

export async function nodePositions(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const entries: [string, string][] = [];
    for (const element of document.querySelectorAll('[data-node-id]')) {
      const id = element.getAttribute('data-node-id') ?? '';
      const label = element.querySelector('text.label')?.textContent.trim() ?? '';
      entries.push([id, `${element.getAttribute('transform') ?? ''}|${label}`]);
    }
    return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
  });
}

export async function setOffline(page: Page, offline: boolean): Promise<void> {
  const toggle = page.locator('[data-action="offline-toggle"]');
  await expect(toggle).toHaveAttribute('aria-pressed', offline ? 'false' : 'true');
  await toggle.click();
  await expect(page.locator('[data-connection]')).toHaveAttribute(
    'data-state',
    offline ? 'offline' : 'online',
  );
}

export async function dragNode(
  page: Page,
  id: string,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const box = await page.locator(`[data-node-id="${id}"]`).boundingBox();
  if (box === null) throw new Error(`node ${id} has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await page.mouse.up();
}

export async function renameNode(page: Page, id: string, text: string): Promise<void> {
  await page.locator(`[data-node-id="${id}"]`).dblclick();
  const field = page.getByLabel('Node label');
  await expect(field).toBeFocused();
  await field.fill(text);
  await page.keyboard.press('Enter');
  await expect(field).toBeHidden();
}
