import { expect, test, type Page } from '@playwright/test';

async function addCard(page: Page, name = 'Bookshop Rewards'): Promise<void> {
  await page.getByRole('button', { name: 'Add a card', exact: true }).last().click();
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill(' 00123456789 ');
  await page.locator('#barcode-format').selectOption('code128');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
test('mobile create, edit, search, reload, and delete preserve card details', async ({ page }) => {
  await page.goto('./');
  await addCard(page);
  await expect(page.locator('.barcode-image svg')).toBeVisible();
  await expect(page.locator('.barcode-value')).toHaveText('00123456789');
  await expect(page.locator('dd.mono')).toHaveText('00123456789');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Library Rewards');
  await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill('00042');
  await page.getByRole('button', { name: 'Add location', exact: true }).click();
  await page.getByRole('textbox', { name: 'Location label', exact: true }).fill('Main branch');
  await page.getByRole('spinbutton', { name: 'Latitude', exact: true }).fill('52.52');
  await page.getByRole('spinbutton', { name: 'Longitude', exact: true }).fill('13.405');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.locator('.barcode-value')).toHaveText('00042');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library Rewards', exact: true })).toBeVisible();
  await expect(page.getByText('Main branch', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await page.getByRole('searchbox').fill('missing');
  await expect(page.getByRole('heading', { name: 'No matching cards' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('link', { name: 'Open card: Library Rewards' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All your memberships. One little wallet.' })).toBeVisible();
});
test('backs up and restores all fields and rejects invalid imports without replacing cards', async ({ page }) => {
  await page.goto('./');
  await addCard(page, '<My & private card>');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('wallet.memberships.json');
  const backupPath = await download.path();
  if (!backupPath) throw new Error('Backup was not downloaded');
  await page.locator('#restore-file').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99,"cards":[]}'),
  });
  await expect(page.getByRole('alert')).toContainText('not a supported');
  await page.locator('#restore-file').setInputFiles(backupPath);
  await expect(page.getByRole('heading', { name: 'Review your backup · 1 card' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Replace wallet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Backup restored.');
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.getByRole('heading', { name: '<My & private card>', exact: true })).toBeVisible();
});
test('switches to German, persists it, and fits narrow screens with enlarged text', async ({ page }) => {
  await page.goto('./#settings');
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Karte hinzufügen', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Ein neuer Begleiter' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('retains the wallet through a fully offline reload after service-worker activation', async ({ page, context }) => {
  await page.goto('./');
  await addCard(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bookshop Rewards', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bookshop Rewards', exact: true })).toBeVisible();
  await expect(page.locator('.barcode-image svg')).toBeVisible();
  await expect(page.locator('#connection')).toContainText('Offline');
});
test('rejects stale edits from another tab and keeps the unsaved form', async ({ page, context }) => {
  await page.goto('./');
  await addCard(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByRole('button', { name: 'Edit', exact: true }).click();
  await second.getByRole('textbox', { name: 'Card name', exact: true }).fill('Stale edit');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Newer edit');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Newer edit', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('changed in another tab');
  await expect(second.getByRole('textbox', { name: 'Card name', exact: true })).toHaveValue('Stale edit');
});
