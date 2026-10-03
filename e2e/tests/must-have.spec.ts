import { expect, test, type Page } from '@playwright/test';
import {
  dragNode,
  joinRoom,
  nodePositions,
  renameNode,
  setOffline,
  uniqueRoom,
} from '../support/clients';
import { eastPortOf, centerOf, node, openEditor } from '../support/editor';

async function routeProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const surface = document.querySelector('svg.surface');
    if (!(surface instanceof SVGSVGElement)) return ['no surface'];
    const rects = [...document.querySelectorAll('[data-node-id]')].map((element) => {
      const box = element.getBoundingClientRect();
      return { id: element.getAttribute('data-node-id') ?? '', box };
    });
    for (const path of document.querySelectorAll('g[cs-edge] path.line')) {
      if (!(path instanceof SVGPathElement)) continue;
      const matrix = path.getScreenCTM();
      if (matrix === null) continue;
      const vertices: [number, number][] = [];
      const commands = [...(path.getAttribute('d') ?? '').matchAll(/([MLQ])([-\d. ]+)/gu)];
      commands.forEach((match, index) => {
        const numbers = (match[2] ?? '').trim().split(/\s+/u).map(Number);
        const isLast = index === commands.length - 1;
        if (match[1] === 'L' && !isLast) return;
        const point = new DOMPoint(numbers[0], numbers[1]).matrixTransform(matrix);
        vertices.push([point.x, point.y]);
      });
      const edgeId = path.closest('g[cs-edge]')?.getAttribute('data-edge-id') ?? '';
      for (let index = 1; index < vertices.length; index += 1) {
        const from = vertices[index - 1];
        const to = vertices[index];
        if (from === undefined || to === undefined) continue;
        if (Math.abs(from[0] - to[0]) > 0.6 && Math.abs(from[1] - to[1]) > 0.6) {
          problems.push(`${edgeId}: diagonal segment`);
        }
        for (const { id, box } of rects) {
          const inset = 8;
          const left = box.left + inset;
          const right = box.right - inset;
          const top = box.top + inset;
          const bottom = box.bottom - inset;
          const minX = Math.min(from[0], to[0]);
          const maxX = Math.max(from[0], to[0]);
          const minY = Math.min(from[1], to[1]);
          const maxY = Math.max(from[1], to[1]);
          if (maxX > left && minX < right && maxY > top && minY < bottom) {
            problems.push(`${edgeId}: crosses ${id}`);
          }
        }
      }
    }
    return problems;
  });
}

async function renderedEdgesAreValid(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nodeIds = new Set(
      [...document.querySelectorAll('[data-node-id]')].map((element) =>
        element.getAttribute('data-node-id'),
      ),
    );
    const edges = [...document.querySelectorAll('g[cs-edge]')];
    return (
      edges.length > 0 &&
      edges.every((edge) => edge.querySelector('path.line') !== null) &&
      nodeIds.size > 0
    );
  });
}

test.describe('must-have behaviours on the production build @must-have', () => {
  test('every client renders the same valid graph after a delete races a label edit and a new connection @must-have', async ({
    browser,
  }) => {
    const room = uniqueRoom('validity');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    await setOffline(anna.page, true);
    await setOffline(bartek.page, true);
    await node(anna.page, 'alarm').click();
    await anna.page.keyboard.press('Delete');
    await expect(anna.page.locator('.status')).toHaveText('6 nodes, 6 edges');
    await renameNode(bartek.page, 'alarm', 'Siren');
    await dragNode(bartek.page, 'alarm', 40, 30);
    await node(bartek.page, 'alarm').click();
    const port = await eastPortOf(node(bartek.page, 'alarm'));
    const target = await centerOf(node(bartek.page, 'outlet'));
    await bartek.page.mouse.move(port.x, port.y);
    await bartek.page.mouse.down();
    await bartek.page.mouse.move(target.x, target.y, { steps: 10 });
    await bartek.page.mouse.up();
    await expect(bartek.page.locator('.status')).toHaveText('7 nodes, 8 edges');
    await setOffline(anna.page, false);
    await setOffline(bartek.page, false);
    await expect(anna.page.locator('[data-pending]')).toHaveCount(0);
    await expect(bartek.page.locator('[data-pending]')).toHaveCount(0);
    await expect(anna.page.locator('.status')).toHaveText('6 nodes, 6 edges');
    await expect(bartek.page.locator('.status')).toHaveText('6 nodes, 6 edges');
    await expect(bartek.page.locator('[data-node-id="alarm"]')).toHaveCount(0);
    await expect(anna.page.locator('g[cs-edge]')).toHaveCount(6);
    await expect(bartek.page.locator('g[cs-edge]')).toHaveCount(6);
    expect(await renderedEdgesAreValid(anna.page)).toBe(true);
    await expect
      .poll(async () => JSON.stringify(await nodePositions(bartek.page)))
      .toBe(JSON.stringify(await nodePositions(anna.page)));
    await anna.context.close();
    await bartek.context.close();
  });

  test('undo takes back only your own move and leaves the other label edit @must-have', async ({
    browser,
  }) => {
    const room = uniqueRoom('undo');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    const before = (await nodePositions(anna.page))['pump-a'] ?? '';
    await dragNode(anna.page, 'pump-a', 0, 96);
    await expect.poll(async () => (await nodePositions(bartek.page))['pump-a']).not.toBe(before);
    await renameNode(bartek.page, 'pump-a', 'Main pump');
    await expect(anna.page.locator('[data-node-id="pump-a"]')).toContainText('Main pump');
    await anna.page.locator('[data-action="undo"]').click();
    await expect
      .poll(async () => (await nodePositions(bartek.page))['pump-a'])
      .toBe(before.replace('Pump A', 'Main pump'));
    await expect(anna.page.locator('[data-node-id="pump-a"]')).toContainText('Main pump');
    await expect(anna.page.locator('[data-action="undo"]')).toBeDisabled();
    await expect(bartek.page.locator('[data-action="undo"]')).toBeEnabled();
    await anna.context.close();
    await bartek.context.close();
  });

  test('routes every edge orthogonally around the nodes, also after nodes move @must-have', async ({
    page,
  }) => {
    await openEditor(page);
    expect(await routeProblems(page)).toEqual([]);
    const center = await centerOf(node(page, 'alarm'));
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x - 300, center.y + 80, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => routeProblems(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('routed.png') });
  });

  test('draws only the nodes near the viewport in a diagram of 5000 nodes @must-have', async ({
    page,
  }) => {
    await page.goto('/bench?nodes=5000&zoom=1');
    await expect
      .poll(() => page.locator('[data-node-id]').count(), { timeout: 60_000 })
      .toBeGreaterThan(20);
    const drawn = await page.locator('[data-node-id]').count();
    expect(drawn).toBeLessThan(400);
    const firstIds = await page
      .locator('[data-node-id]')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-node-id')));
    await page.mouse.move(600, 400);
    for (let step = 0; step < 20; step += 1) {
      await page.mouse.wheel(200, 150);
    }
    await expect
      .poll(async () =>
        page
          .locator('[data-node-id]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-node-id')),
          ),
      )
      .not.toEqual(firstIds);
    expect(await page.locator('[data-node-id]').count()).toBeLessThan(400);
  });
});
