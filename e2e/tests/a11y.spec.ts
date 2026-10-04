import { expect, test, type Locator, type Page } from '@playwright/test';
import { dragNode, joinRoom, uniqueRoom } from '../support/clients';
import { counts, node, openEditor, worldPosition } from '../support/editor';

const MAX_TABS = 60;

async function tabToNode(page: Page): Promise<void> {
  for (let presses = 0; presses < MAX_TABS; presses += 1) {
    await page.keyboard.press('Tab');
    const onNode = await page.evaluate(
      () => document.activeElement?.hasAttribute('data-node-id') ?? false,
    );
    if (onNode) return;
  }
  throw new Error('focus never reached a node');
}

async function focusedId(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.activeElement?.getAttribute('data-node-id') ??
      document.activeElement?.getAttribute('data-edge-id') ??
      null,
  );
}

function liveRegion(page: Page): Locator {
  return page.locator('[data-live-region]');
}

test.describe('accessibility @a11y', () => {
  test('works from the keyboard alone: focus, move, edit, connect, undo @a11y @must-have', async ({
    page,
  }, testInfo) => {
    await openEditor(page);
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    await tabToNode(page);
    const firstId = await focusedId(page);
    expect(firstId).not.toBeNull();
    const focused = node(page, firstId ?? '');
    await expect(focused).toBeFocused();
    await expect(focused).toHaveAttribute('aria-roledescription', 'diagram node');
    await page.screenshot({ path: testInfo.outputPath('focus-ring.png') });

    await page.keyboard.press('n');
    await expect
      .poll(async () => {
        const id = await focusedId(page);
        return id !== null && id !== firstId;
      })
      .toBe(true);
    await page.keyboard.press('p');
    await expect.poll(() => focusedId(page)).toBe(firstId);

    const before = await worldPosition(focused);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await worldPosition(focused)).x).toBeGreaterThan(before.x);
    const after = await worldPosition(focused);
    expect(after.x % 8).toBe(0);
    expect(after.y).toBeGreaterThan(before.y);
    await expect(focused).toBeFocused();

    await page.keyboard.press('Enter');
    const field = page.getByLabel('Node label');
    await expect(field).toBeFocused();
    await field.fill('Renamed by keyboard');
    await page.keyboard.press('Enter');
    await expect(field).toBeHidden();
    await expect(focused).toBeFocused();
    await expect(focused).toHaveAttribute('aria-label', /^Renamed by keyboard, /);

    const edges = (await counts(page)).edges;
    await page.keyboard.press('c');
    await expect(liveRegion(page)).toContainText(/connect/i);
    await page.keyboard.press('n');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await counts(page)).edges).toBe(edges + 1);
    await expect(liveRegion(page)).toContainText('Connected');
    await expect.poll(() => focusedId(page)).not.toBeNull();

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await counts(page)).edges).toBe(edges);
    await expect(liveRegion(page)).toContainText('Undid');

    await page.keyboard.press('Delete');
    await expect(page.locator('.status')).toContainText('6 nodes');
    await expect(liveRegion(page)).toContainText('Deleted');
    await page.screenshot({ path: testInfo.outputPath('keyboard-done.png') });
  });

  test('opens the shortcuts list with a question mark and returns focus @a11y', async ({
    page,
  }, testInfo) => {
    await openEditor(page);
    await tabToNode(page);
    const before = await focusedId(page);
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Connect the focused node');
    await page.screenshot({ path: testInfo.outputPath('shortcuts.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect.poll(() => focusedId(page)).toBe(before);
  });

  test('skip link moves focus to the main landmark @a11y', async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
  });

  test('sets a page title per route @a11y', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Local sandbox | coschema');
    await page.goto('/r/title-check');
    await expect(page).toHaveTitle('Room title-check | coschema');
    await page.goto('/demo');
    await expect(page).toHaveTitle('Live demo | coschema');
  });

  test('exposes the diagram to assistive technology @a11y @must-have', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByRole('toolbar', { name: 'Editor tools' })).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Water intake, rounded rectangle' }),
    ).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Connection from Water intake to Pump A' }),
    ).toHaveCount(1);
    await expect(page.locator('main#main')).toMatchAriaSnapshot(`
      - main:
        - application "Diagram canvas":
          - group "Connection from Water intake to Pump A"
          - group "Connection from Water intake to Pump B"
          - group "Connection from Pump A to Pressure?"
          - group "Connection from Pump B to Pressure?"
          - group "Connection from Pressure? to Storage tank"
          - group "Connection from Pressure? to Alarm"
          - group "Connection from Storage tank to Outlet valve"
          - group "Water intake, rounded rectangle"
          - group "Pump A, rectangle"
          - group "Pump B, rectangle"
          - group "Pressure?, diamond"
          - group "Storage tank, ellipse"
          - group "Alarm, rectangle"
          - group "Outlet valve, rounded rectangle"
        - paragraph: /Press N to move through nodes/
    `);
    await expect(page.locator('[data-tool="select"]')).toMatchAriaSnapshot(
      '- button "Select" [pressed]',
    );
    await expect(page.locator('[data-action="add-node"]')).toMatchAriaSnapshot(
      '- button "Add a node"',
    );
  });

  test('keeps colour from being the only signal: each person has a name and a pattern @a11y @must-have', async ({
    browser,
  }) => {
    const room = uniqueRoom('a11y-people');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    await expect(anna.page.locator('[data-action="follow"]')).toContainText('Bartek');
    await expect(anna.page.locator('[data-action="follow"]')).toHaveAttribute(
      'aria-label',
      'Follow Bartek',
    );
    await anna.context.close();
    await bartek.context.close();
  });

  test('announces a remote move politely and names who did it @a11y @must-have', async ({
    browser,
  }) => {
    const room = uniqueRoom('a11y-live');
    const anna = await joinRoom(browser, room, 'Anna');
    const bartek = await joinRoom(browser, room, 'Bartek');
    await expect(liveRegion(bartek.page)).toHaveAttribute('aria-live', 'polite');
    await expect(liveRegion(bartek.page)).toHaveAttribute('role', 'status');
    await expect(liveRegion(bartek.page)).toHaveText('');
    await dragNode(anna.page, 'pump-a', 96, 48);
    await expect(liveRegion(bartek.page)).toContainText('Anna moved Pump A', { timeout: 10_000 });
    await dragNode(anna.page, 'pump-b', 0, 48);
    await dragNode(anna.page, 'alarm', 48, 0);
    await expect(liveRegion(bartek.page)).toContainText(/Anna/, { timeout: 10_000 });
    await expect(liveRegion(anna.page)).toHaveText('');
    await anna.context.close();
    await bartek.context.close();
  });
});
