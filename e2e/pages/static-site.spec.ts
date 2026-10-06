import { expect, test, type Page } from '@playwright/test';
import { dragIn, expectDemoReady, pane, positionsIn } from '../support/demo';

interface Traffic {
  readonly foreign: string[];
  readonly sockets: string[];
}

function watchTraffic(page: Page, origin: string): Traffic {
  const traffic: Traffic = { foreign: [], sockets: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) {
      traffic.foreign.push(request.url());
    }
  });
  page.on('websocket', (socket) => {
    traffic.sockets.push(socket.url());
  });
  return traffic;
}

test.describe('static site on GitHub Pages @pages', () => {
  test('the site root opens the demo and two editors sync with no backend @pages', async ({
    page,
    baseURL,
  }, testInfo) => {
    const traffic = watchTraffic(page, baseURL ?? '');
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL('/demo');
    await expect(page).toHaveTitle('Live demo | coschema');
    await expectDemoReady(page);
    await dragIn(page, pane(page, 'Ada'), 'intake', 120, 80);
    await expect
      .poll(async () => (await positionsIn(pane(page, 'Bruno')))['intake'])
      .toBe((await positionsIn(pane(page, 'Ada')))['intake']);
    await page.screenshot({ path: testInfo.outputPath('pages-demo.png'), fullPage: true });
    expect(traffic.sockets).toEqual([]);
    expect(traffic.foreign).toEqual([]);
  });

  test('a deep link to the demo is served with its query @pages', async ({ page }) => {
    const response = await page.goto('/demo?panes=3');
    expect(response?.status()).toBe(200);
    await expectDemoReady(page, 3);
  });

  test('an unknown path boots the app from 404.html and lands on the demo @pages', async ({
    page,
  }) => {
    const response = await page.goto('/no/such/page');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL('/demo');
    await expectDemoReady(page);
  });

  test('the solo editor link opens the sandbox @pages', async ({ page }) => {
    await page.goto('/demo');
    await expectDemoReady(page);
    await page.getByRole('link', { name: 'Solo editor' }).click();
    await expect(page).toHaveURL('/solo');
    await expect(page).toHaveTitle('Local sandbox | coschema');
    await expect(page.locator('[data-node-id]')).toHaveCount(7);
  });
});
