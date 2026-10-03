import { expect, test, type Locator, type Page } from '@playwright/test';

function pane(page: Page, name: string): Locator {
  return page.locator(`[data-pane="${name}"]`);
}

async function openDemo(page: Page, query = ''): Promise<void> {
  await page.goto(`/demo${query}`);
  await expect(page.locator('[data-pane]')).toHaveCount(query.includes('panes=3') ? 3 : 2);
  for (const name of ['Ada', 'Bruno']) {
    await expect(pane(page, name).locator('[data-connection][data-state="online"]')).toBeVisible();
    await expect(pane(page, name).locator('[data-node-id]')).toHaveCount(7);
  }
}

async function setRange(input: Locator, value: number): Promise<void> {
  await input.evaluate((element, next) => {
    if (!(element instanceof HTMLInputElement)) throw new Error('not an input');
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function positionsIn(scope: Locator): Promise<Record<string, string>> {
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

async function dragIn(
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

test.describe('demo page @demo', () => {
  test('shows two editors with the same starter diagram and their network controls @demo @must-have', async ({
    page,
  }, testInfo) => {
    await openDemo(page);
    await expect(page).toHaveTitle('Live demo | coschema');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Live collaboration demo');
    expect(await positionsIn(pane(page, 'Ada'))).toEqual(await positionsIn(pane(page, 'Bruno')));
    await expect(pane(page, 'Ada').locator('[data-link-state]')).toHaveText('Online');
    await expect(pane(page, 'Ada').locator('[data-action="follow"]')).toContainText('Bruno');
    await page.screenshot({ path: testInfo.outputPath('demo.png'), fullPage: true });
  });

  test('supports a third editor with the panes query parameter @demo', async ({ page }) => {
    await page.goto('/demo?panes=3');
    await expect(page.locator('[data-pane]')).toHaveCount(3);
    await expect(pane(page, 'Cleo').locator('[data-node-id]')).toHaveCount(7);
  });

  test('moves a node in one editor and shows it in the other @demo @must-have', async ({
    page,
  }) => {
    await openDemo(page);
    await dragIn(page, pane(page, 'Ada'), 'intake', 120, 80);
    await expect
      .poll(async () => (await positionsIn(pane(page, 'Bruno')))['intake'])
      .toBe((await positionsIn(pane(page, 'Ada')))['intake']);
  });

  test('merges edits made on both sides of an offline link and converges @demo @must-have', async ({
    page,
  }, testInfo) => {
    await openDemo(page);
    const ada = pane(page, 'Ada');
    const bruno = pane(page, 'Bruno');
    await ada.locator('[data-link-offline]').check();
    await expect(ada.locator('[data-link-state]')).toHaveText('Offline');
    await expect(ada.locator('[data-connection]')).not.toHaveAttribute('data-state', 'online');
    await dragIn(page, ada, 'intake', 96, 40);
    await dragIn(page, bruno, 'pump-b', 0, 64);
    await expect(ada.locator('[data-pending]')).toBeVisible();
    expect((await positionsIn(ada))['pump-b']).not.toBe((await positionsIn(bruno))['pump-b']);
    await page.screenshot({ path: testInfo.outputPath('demo-offline.png'), fullPage: true });
    await ada.locator('[data-link-offline]').uncheck();
    await expect(ada.locator('[data-connection][data-state="online"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(async () => positionsIn(ada), { timeout: 20_000 })
      .toEqual(await positionsIn(bruno));
    await expect.poll(async () => positionsIn(bruno)).toEqual(await positionsIn(ada));
    await expect(ada.locator('[data-pending]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('demo-merged.png'), fullPage: true });
  });

  test('the sliders change how messages are delivered @demo @must-have', async ({ page }) => {
    await openDemo(page);
    const ada = pane(page, 'Ada');
    const bruno = pane(page, 'Bruno');
    await setRange(ada.locator('[data-latency]'), 1200);
    await expect(ada.locator('[data-latency-value]')).toHaveText('1200 ms');
    await dragIn(page, ada, 'intake', 64, 32);
    await expect(ada.locator('[data-inflight]')).not.toHaveText('0 in flight');
    const moved = (await positionsIn(ada))['intake'];
    expect((await positionsIn(bruno))['intake']).not.toBe(moved);
    await expect
      .poll(async () => (await positionsIn(bruno))['intake'], { timeout: 10_000 })
      .toBe(moved);
    await setRange(ada.locator('[data-latency]'), 0);
    await setRange(ada.locator('[data-loss]'), 60);
    await expect(ada.locator('[data-loss-value]')).toHaveText('60%');
    await dragIn(page, ada, 'pump-a', 0, 56);
    await dragIn(page, ada, 'pump-b', 0, -56);
    await dragIn(page, ada, 'alarm', 56, 0);
    await expect
      .poll(
        async () => Number.parseInt((await ada.locator('[data-dropped]').textContent()) ?? '0', 10),
        {
          timeout: 10_000,
        },
      )
      .toBeGreaterThan(0);
  });

  test('make a mess edits both sides at once and the editors still agree @demo', async ({
    page,
  }, testInfo) => {
    await openDemo(page);
    await page.locator('[data-action="make-mess"]').click();
    await expect(page.locator('[data-action="make-mess"]')).toBeDisabled();
    await expect(page.locator('[data-action="make-mess"]')).toBeEnabled({ timeout: 10_000 });
    const ada = pane(page, 'Ada');
    const bruno = pane(page, 'Bruno');
    await ada.locator('[data-action="fit"]').click();
    await bruno.locator('[data-action="fit"]').click();
    await expect(ada.locator('.status')).toHaveText('9 nodes, 7 edges', { timeout: 20_000 });
    await expect(bruno.locator('.status')).toHaveText('9 nodes, 7 edges', { timeout: 20_000 });
    await expect
      .poll(
        async () =>
          JSON.stringify(await positionsIn(ada)) === JSON.stringify(await positionsIn(bruno)),
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect(ada.locator('[data-node-id]')).toHaveCount(9);
    await page.screenshot({ path: testInfo.outputPath('demo-mess.png'), fullPage: true });
  });

  test('reset starts from a clean diagram @demo', async ({ page }) => {
    await openDemo(page);
    await page.locator('[data-action="make-mess"]').click();
    await expect(page.locator('[data-action="make-mess"]')).toBeEnabled({ timeout: 10_000 });
    await page.locator('[data-action="reset"]').click();
    for (const name of ['Ada', 'Bruno']) {
      await expect(
        pane(page, name).locator('[data-connection][data-state="online"]'),
      ).toBeVisible();
      await expect(pane(page, name).locator('[data-node-id]')).toHaveCount(7);
    }
    expect(await positionsIn(pane(page, 'Ada'))).toEqual(await positionsIn(pane(page, 'Bruno')));
  });

  test('a preset applies to every link @demo', async ({ page }) => {
    await openDemo(page);
    await page.locator('[data-profile="lossy"]').click();
    await expect(page.locator('[data-profile="lossy"]')).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['Ada', 'Bruno']) {
      await expect(pane(page, name).locator('[data-loss-value]')).toHaveText('20%');
      await expect(pane(page, name).locator('[data-latency-value]')).toHaveText('60 ms');
    }
  });

  test('reload starts clean because nothing is stored @demo', async ({ page }) => {
    await openDemo(page);
    await dragIn(page, pane(page, 'Ada'), 'intake', 96, 40);
    const moved = (await positionsIn(pane(page, 'Ada')))['intake'];
    await page.reload();
    await expect(pane(page, 'Ada').locator('[data-node-id]')).toHaveCount(7);
    expect((await positionsIn(pane(page, 'Ada')))['intake']).not.toBe(moved);
  });
});
