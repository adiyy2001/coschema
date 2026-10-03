import { expect, test } from '@playwright/test';
import { measureEditLatency } from '../../bench/latency/measure';
import {
  ONLINE,
  dragNode,
  joinRoom,
  newClient,
  nodePositions,
  renameNode,
  roomUrl,
  setOffline,
  uniqueRoom,
} from '../support/clients';

const LATENCY_BUDGET_MS = 200;

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] ?? Number.NaN;
}

test.describe('collaboration @collab', () => {
  test('shows an edit from one browser in the other within the latency budget @collab', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoom('latency');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    const samples = await measureEditLatency(anna.page, bartek.page);
    expect(samples).toHaveLength(30);
    const worst = p95(samples);
    await testInfo.attach('latency-ms', {
      body: JSON.stringify(samples),
      contentType: 'application/json',
    });
    expect(worst, `p95 ${worst} ms, samples ${samples.join(',')}`).toBeLessThan(LATENCY_BUDGET_MS);
    expect(await nodePositions(bartek.page)).toEqual(await nodePositions(anna.page));
    await anna.context.close();
    await bartek.context.close();
  });

  test('merges edits made offline in both browsers after they reconnect @collab', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoom('offline');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    await setOffline(anna.page, true);
    await setOffline(bartek.page, true);
    await dragNode(anna.page, 'intake', 96, 40);
    await renameNode(anna.page, 'tank', 'Header tank');
    await dragNode(bartek.page, 'pump-b', 0, 64);
    await renameNode(bartek.page, 'tank', 'Reservoir');
    await renameNode(bartek.page, 'alarm', 'Siren');
    await expect(anna.page.locator('[data-pending]')).toContainText('2 changes waiting');
    await expect(bartek.page.locator('[data-pending]')).toContainText('3 changes waiting');
    await expect(anna.page.locator('[data-node-id="alarm"]')).toContainText('Alarm');
    await anna.page.screenshot({ path: testInfo.outputPath('offline-anna.png') });
    await setOffline(anna.page, false);
    await setOffline(bartek.page, false);
    await expect(anna.page.locator('[data-pending]')).toHaveCount(0);
    await expect(bartek.page.locator('[data-pending]')).toHaveCount(0);
    await expect(anna.page.locator('[data-node-id="alarm"]')).toContainText('Siren');
    await expect(bartek.page.locator('[data-node-id="intake"]')).not.toContainText('zzz');
    await expect
      .poll(async () => JSON.stringify(await nodePositions(bartek.page)))
      .toBe(JSON.stringify(await nodePositions(anna.page)));
    const merged = await nodePositions(anna.page);
    expect(merged['alarm']).toContain('Siren');
    expect(merged['intake']).not.toContain('translate(80 168)');
    expect(merged['pump-b']).not.toContain('translate(328 264)');
    expect(merged['tank']).toMatch(/Header/u);
    expect(merged['tank']).toMatch(/Reser/u);
    await anna.page.screenshot({ path: testInfo.outputPath('merged-anna.png') });
    await anna.context.close();
    await bartek.context.close();
  });

  test('keeps offline edits across a reload and sends them later @collab', async ({ browser }) => {
    const room = uniqueRoom('reload');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    await setOffline(anna.page, true);
    await dragNode(anna.page, 'pump-a', 0, -48);
    await renameNode(anna.page, 'outlet', 'Drain');
    await expect(anna.page.locator('[data-pending]')).toContainText('2 changes waiting');
    await anna.page.route('**/dev/token', (route) => route.abort());
    await anna.page.reload();
    await expect(anna.page.locator('[data-node-id="outlet"]')).toContainText('Drain');
    await expect(anna.page.locator('[data-connection]')).toHaveAttribute('data-state', 'offline');
    await expect(anna.page.locator('[data-pending]')).toContainText('2 changes waiting');
    await expect(bartek.page.locator('[data-node-id="outlet"]')).toContainText('Outlet valve');
    await anna.page.unroute('**/dev/token');
    await anna.page.reload();
    await expect(anna.page.locator(ONLINE)).toBeVisible();
    await expect(anna.page.locator('[data-pending]')).toHaveCount(0);
    await expect(bartek.page.locator('[data-node-id="outlet"]')).toContainText('Drain');
    await anna.context.close();
    await bartek.context.close();
  });

  test('shows the other person cursor and selection @collab', async ({ browser }, testInfo) => {
    const room = uniqueRoom('presence');
    const anna = await joinRoom(browser, room, 'Anna', { color: '#d6336c' });
    const bartek = await joinRoom(browser, room, 'Bartek', { color: '#1c7ed6' });
    await expect(bartek.page.locator('[data-action="follow"]')).toHaveCount(1);
    await expect(bartek.page.locator('[data-action="follow"]')).toContainText('Anna');
    const surface = await anna.page.locator('svg.surface').boundingBox();
    if (surface === null) throw new Error('no surface');
    await anna.page.mouse.move(surface.x + 300, surface.y + 420);
    await anna.page.mouse.move(surface.x + 640, surface.y + 470, { steps: 10 });
    const cursor = bartek.page.locator('[data-cursor]');
    await expect(cursor).toHaveAttribute('visibility', 'visible');
    await expect(cursor).toContainText('Anna');
    await anna.page.locator('[data-node-id="check"]').click();
    await expect(bartek.page.locator('g[cs-presence] rect.outline')).toHaveCount(1);
    await expect(bartek.page.locator('g[cs-presence]')).toContainText('Anna');
    await bartek.page.screenshot({ path: testInfo.outputPath('presence-bartek.png') });
    await anna.page.mouse.click(surface.x + 40, surface.y + 40);
    await expect(bartek.page.locator('g[cs-presence] rect.outline')).toHaveCount(0);
    await anna.context.close();
    await bartek.context.close();
  });

  test('follows the other person viewport until a manual pan @collab', async ({
    browser,
  }, testInfo) => {
    const room = uniqueRoom('follow');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    const follow = bartek.page.locator('[data-action="follow"]');
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', 'true');
    const zoomOf = async (page: typeof anna.page): Promise<string> =>
      (await page.locator('[data-action="zoom-reset"]').textContent())?.trim() ?? '';
    await anna.page.locator('[data-action="zoom-in"]').click();
    await anna.page.locator('[data-action="zoom-in"]').click();
    await expect.poll(() => zoomOf(bartek.page)).toBe(await zoomOf(anna.page));
    const annaNode = await anna.page.locator('[data-node-id="tank"]').boundingBox();
    await expect
      .poll(async () => (await bartek.page.locator('[data-node-id="tank"]').boundingBox())?.x ?? 0)
      .toBeCloseTo(annaNode?.x ?? 0, -1);
    await bartek.page.screenshot({ path: testInfo.outputPath('follow-bartek.png') });
    await bartek.page.mouse.move(400, 500);
    await bartek.page.mouse.wheel(0, 120);
    await expect(follow).toHaveAttribute('aria-pressed', 'false');
    const before = await zoomOf(bartek.page);
    await anna.page.locator('[data-action="zoom-out"]').click();
    await anna.page.waitForTimeout(300);
    expect(await zoomOf(bartek.page)).toBe(before);
    await anna.context.close();
    await bartek.context.close();
  });

  test('shows an access error for a rejected token @collab', async ({ browser }, testInfo) => {
    const { context, page } = await newClient(browser, 'Mallory');
    await page.goto(roomUrl(uniqueRoom('denied'), 'not-a-token'));
    await expect(page.locator('[data-connection]')).toHaveAttribute('data-state', 'denied');
    await expect(page.locator('[data-connection]')).toContainText('Access denied');
    await expect(page.locator('[data-node-id]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('denied.png') });
    await context.close();
  });

  test('loads the starter diagram once for a new room and shares later edits @collab', async ({
    browser,
  }) => {
    const room = uniqueRoom('seed');
    const anna = await joinRoom(browser, room, 'Anna');
    await renameNode(anna.page, 'pump-a', 'Main pump');
    const bartek = await joinRoom(browser, room, 'Bartek');
    await expect(bartek.page.locator('[data-node-id="pump-a"]')).toContainText('Main pump');
    await expect(bartek.page.locator('.status')).toHaveText('7 nodes, 7 edges');
    await anna.context.close();
    await bartek.context.close();
  });
});
