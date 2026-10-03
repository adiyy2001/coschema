import { expect, test } from '@playwright/test';
import {
  boxOf,
  centerOf,
  counts,
  dragBetween,
  eastPortOf,
  emptySpot,
  node,
  openEditor,
  worldPosition,
  zoomPercent,
} from '../support/editor';

test.describe('editor @single', () => {
  test.beforeEach(async ({ page }) => {
    await openEditor(page);
  });

  test('renders the starter diagram @single', async ({ page }, testInfo) => {
    await expect(page.locator('.status')).toHaveText('7 nodes, 7 edges');
    await expect(node(page, 'pump-a')).toContainText('Pump A');
    await page.screenshot({ path: testInfo.outputPath('starter.png') });
  });

  test('creates a node with a shape tool @single', async ({ page }, testInfo) => {
    await page.locator('[data-tool="ellipse"]').click();
    const spot = await emptySpot(page);
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator('.status')).toHaveText('8 nodes, 7 edges');
    await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-node-id].selected')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('created.png') });
  });

  test('drags a node and snaps it to the grid @single', async ({ page }) => {
    const target = node(page, 'intake');
    const before = await worldPosition(target);
    const center = await centerOf(target);
    await dragBetween(page, center, { x: center.x + 101, y: center.y + 77 });
    const after = await worldPosition(target);
    expect(after.x - before.x).toBeGreaterThan(90);
    expect(after.x % 8).toBe(0);
    expect(after.y % 8).toBe(0);
    await expect(page.locator('[data-action="undo"]')).toBeEnabled();
  });

  test('selects several nodes with shift @single', async ({ page }) => {
    await node(page, 'intake').click();
    await node(page, 'pump-a').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-node-id].selected')).toHaveCount(2);
    await node(page, 'pump-a').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-node-id].selected')).toHaveCount(1);
  });

  test('selects with a marquee @single', async ({ page }, testInfo) => {
    const surface = await page.locator('svg.surface').boundingBox();
    if (surface === null) throw new Error('no surface');
    const start = { x: surface.x + 20, y: surface.y + 20 };
    const end = { x: surface.x + 760, y: surface.y + 440 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await expect(page.locator('rect.marquee')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('marquee.png') });
    await page.mouse.up();
    await expect(page.locator('rect.marquee')).toHaveCount(0);
    await expect(page.locator('[data-node-id].selected')).toHaveCount(5);
  });

  test('connects two nodes from a port @single', async ({ page }, testInfo) => {
    await node(page, 'alarm').click();
    const port = await eastPortOf(node(page, 'alarm'));
    const target = await centerOf(node(page, 'outlet'));
    await page.mouse.move(port.x, port.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await expect(page.locator('path.connect')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('connecting.png') });
    await page.mouse.up();
    await expect(page.locator('.status')).toHaveText('7 nodes, 8 edges');
    await expect(page.locator('g[cs-edge].selected')).toHaveCount(1);
  });

  test('edits a label inline @single', async ({ page }, testInfo) => {
    await node(page, 'pump-b').dblclick();
    const field = page.getByLabel('Node label');
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Pump B');
    await page.screenshot({ path: testInfo.outputPath('editing.png') });
    await field.fill('Backup pump');
    await page.keyboard.press('Enter');
    await expect(field).toBeHidden();
    await expect(node(page, 'pump-b')).toContainText('Backup pump');
    await page.locator('[data-action="undo"]').click();
    await expect(node(page, 'pump-b')).toContainText('Pump B');
  });

  test('pans with the hand tool and with the wheel @single', async ({ page }) => {
    const target = node(page, 'tank');
    const before = await boxOf(target);
    await page.locator('[data-tool="hand"]').click();
    const spot = await emptySpot(page);
    await dragBetween(page, spot, { x: spot.x - 150, y: spot.y - 60 });
    const panned = await boxOf(target);
    expect(Math.round(before.x - panned.x)).toBe(150);
    expect(Math.round(before.y - panned.y)).toBe(60);
    await page.locator('[data-tool="select"]').click();
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.wheel(0, 100);
    await expect.poll(async () => (await boxOf(target)).y).toBeLessThan(panned.y);
  });

  test('zooms around the pointer with ctrl wheel and the toolbar @single', async ({ page }) => {
    expect(await zoomPercent(page)).toBe(100);
    const anchor = await centerOf(node(page, 'check'));
    await page.mouse.move(anchor.x, anchor.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(100);
    const after = await centerOf(node(page, 'check'));
    expect(Math.abs(after.x - anchor.x)).toBeLessThan(3);
    expect(Math.abs(after.y - anchor.y)).toBeLessThan(3);
    await page.locator('[data-action="zoom-reset"]').click();
    expect(await zoomPercent(page)).toBe(100);
    await page.locator('[data-action="zoom-out"]').click();
    expect(await zoomPercent(page)).toBe(80);
  });

  test('pinch zooms with two touches over CDP @single', async ({ browser }) => {
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await openEditor(page);
    const session = await context.newCDPSession(page);
    const surface = await page.locator('svg.surface').boundingBox();
    if (surface === null) throw new Error('no surface');
    const cx = surface.x + surface.width / 2;
    const cy = surface.y + surface.height / 2;
    const touch = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 1, radiusY: 1 });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touch(1, cx - 60, cy), touch(2, cx + 60, cy)],
    });
    for (let step = 1; step <= 8; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [touch(1, cx - 60 - step * 15, cy), touch(2, cx + 60 + step * 15, cy)],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => zoomPercent(page)).toBeGreaterThan(150);
    await page.screenshot({ path: test.info().outputPath('pinched.png') });
    await context.close();
  });

  test('undoes and redoes with the toolbar and the keyboard @single', async ({ page }) => {
    const target = node(page, 'alarm');
    const before = await worldPosition(target);
    const center = await centerOf(target);
    await dragBetween(page, center, { x: center.x - 80, y: center.y - 80 });
    const moved = await worldPosition(target);
    expect(moved.x).not.toBe(before.x);
    await page.locator('[data-action="undo"]').click();
    await expect.poll(() => worldPosition(target)).toEqual(before);
    await expect(page.locator('[data-action="redo"]')).toBeEnabled();
    await page.locator('[data-action="redo"]').click();
    await expect.poll(() => worldPosition(target)).toEqual(moved);
    await page.locator('svg.surface').focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => worldPosition(target)).toEqual(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => worldPosition(target)).toEqual(moved);
    await page.keyboard.press('Control+z');
    await node(page, 'alarm').click();
    await page.keyboard.press('Delete');
    await expect.poll(() => counts(page)).toEqual({ nodes: 6, edges: 6 });
    await page.keyboard.press('Control+z');
    await expect.poll(() => counts(page)).toEqual({ nodes: 7, edges: 7 });
  });
});
