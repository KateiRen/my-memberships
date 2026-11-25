import { expect, test, type Page } from '@playwright/test';
import type { Card } from '../src/model';

async function mockLocation(page: Page, permission: PermissionState = 'prompt', accuracy = 10, failure = 0): Promise<void> {
  await page.addInitScript(({ permission, accuracy, failure }) => {
    const status = Object.assign(new EventTarget(), { state: sessionStorage.getItem('test-location-permission') ?? permission });
    document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.locationRequests = '0'; });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: async () => status,
    } });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (success: PositionCallback, error: (error: { code: number }) => void) => queueMicrotask(() => {
        const element = document.documentElement;
        element.dataset.locationRequests = String(Number(element.dataset.locationRequests ?? 0) + 1);
        const code = Number(element.dataset.locationError ?? failure);
        if (code) {
          if (code === 1) {
            status.state = 'denied';
            sessionStorage.setItem('test-location-permission', 'denied');
            status.dispatchEvent(new Event('change'));
          }
          error({ code });
          return;
        }
        status.state = 'granted';
        sessionStorage.setItem('test-location-permission', 'granted');
        status.dispatchEvent(new Event('change'));
        success({
          coords: {
            latitude: Number(element.dataset.latitude ?? 52.52), longitude: 13.405, accuracy,
            altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}),
          },
          timestamp: Date.now(), toJSON: () => ({}),
        });
      }),
    } });
  }, { permission, accuracy, failure });
}
function locatedCard(name: string, latitude?: number): Card {
  return {
    id: name, name, number: '00042', colors: ['#112233', '#445566'], category: '', description: '',
    addedAt: '2026-11-24T12:00:00.000Z', barcode: null,
    locations: latitude === undefined ? [] : [{ label: '', latitude, longitude: 13.405 }],
  };
}
async function restoreCards(page: Page, cards: Card[]): Promise<void> {
  await page.goto('./#settings');
  await page.locator('#restore-file').setInputFiles({
    name: 'locations.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'my-memberships', version: 1, cards })),
  });
  await page.getByRole('button', { name: 'Replace wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Replace wallet', exact: true })).toHaveCount(0);
}

test('location is opt-in and a card can save its current area once', async ({ page }) => {
  await mockLocation(page);
  await page.goto('./');
  await addCard(page);
  await expect(page.locator('html')).toHaveAttribute('data-location-requests', '0');
  await expect(page.getByRole('button', { name: 'Save current location for this card' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Enable nearby cards', exact: true }).click();
  await expect(page.getByText('Cards with a saved location within 200 metres appear first.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open card: Bookshop Rewards' }).click();
  const save = page.getByRole('button', { name: 'Save current location for this card' });
  await expect(save).toBeVisible();
  const box = await save.boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBeTruthy();
  await save.click();
  await expect(page.getByText('Location saved. This card will be suggested when you are nearby.', { exact: true })).toBeVisible();
  await expect(save).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bookshop Rewards', exact: true })).toBeVisible();
  await expect(save).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.location-row')).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'Latitude', exact: true })).toHaveValue('52.52');
  await expect(page.getByRole('spinbutton', { name: 'Longitude', exact: true })).toHaveValue('13.405');
});

test('all nearby cards appear first across offline app opens while search and fallback stay alphabetical', async ({ page, context }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [locatedCard('Alpha'), locatedCard('Zoo', 52.52), locatedCard('Market', 52.5205)]);
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.locator('.membership-card h2')).toHaveText(['Market', 'Zoo', 'Alpha']);
  await expect(page.locator('.nearby-badge')).toHaveCount(2);
  await page.getByRole('searchbox').fill('Alpha');
  await expect(page.locator('.membership-card h2')).toHaveText(['Alpha']);
  await page.getByRole('searchbox').fill('');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.membership-card h2')).toHaveText(['Market', 'Zoo', 'Alpha']);
  await page.evaluate(() => { document.documentElement.dataset.locationError = '2'; });
  await page.getByRole('button', { name: 'Refresh nearby cards', exact: true }).click();
  await expect(page.getByText('Your location is unavailable. Cards remain in alphabetical order; try again when location is available.', { exact: true })).toBeVisible();
  await expect(page.locator('.membership-card h2')).toHaveText(['Alpha', 'Market', 'Zoo']);
  await expect(page.locator('.nearby-badge')).toHaveCount(0);
});

for (const accept of [true, false]) {
  test(`restoring saved locations asks once and remembers ${accept ? 'acceptance' : 'refusal'}`, async ({ page }) => {
    await mockLocation(page);
    let prompts = 0;
    page.on('dialog', async (dialog) => {
      if (dialog.message().startsWith('This backup contains saved card locations.')) {
        prompts++;
        if (accept) await dialog.accept(); else await dialog.dismiss();
      } else await dialog.accept();
    });
    await restoreCards(page, [locatedCard('Zoo', 52.52)]);
    await expect.poll(() => prompts).toBe(1);
    await expect(page.getByText(accept
      ? 'Cards with a saved location within 200 metres appear first.'
      : 'Nearby cards are turned off. Your choice is saved on this device.', { exact: true })).toBeVisible();
    await restoreCards(page, [locatedCard('Zoo', 52.52)]);
    expect(prompts).toBe(1);
    await page.getByRole('link', { name: 'My wallet', exact: true }).click();
    await expect(page.locator('.nearby-badge')).toHaveCount(accept ? 1 : 0);
    if (!accept) await expect(page.locator('html')).toHaveAttribute('data-location-requests', '0');
  });
}

test('turning off nearby cards is remembered even when browser location permission stays granted', async ({ page }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [locatedCard('Alpha'), locatedCard('Zoo', 52.52)]);
  await expect(page.locator('#location-state')).toHaveText('Location enabled');
  await page.getByRole('button', { name: 'Turn off nearby cards', exact: true }).click();
  await expect(page.locator('#location-state')).toHaveText('Location disabled in this app');
  await page.reload();
  await expect(page.locator('#location-state')).toHaveText('Location disabled in this app');
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.locator('.membership-card h2')).toHaveText(['Alpha', 'Zoo']);
  await expect(page.locator('html')).toHaveAttribute('data-location-requests', '0');
  await page.getByRole('link', { name: 'Open card: Alpha' }).click();
  await expect(page.getByRole('button', { name: 'Save current location for this card' })).toHaveCount(0);
});

test('settings explain browser denial and allow retry after browser location access is restored', async ({ page }) => {
  await mockLocation(page, 'denied');
  await page.goto('./#settings');
  await expect(page.locator('#location-state')).toHaveText('Location blocked by browser');
  await expect(page.getByText('Location access is blocked. Allow it in your browser settings to use nearby cards.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ask for location access again', exact: true }).click();
  await expect(page.locator('#location-state')).toHaveText('Location enabled');
  await expect(page.getByRole('button', { name: 'Turn off nearby cards', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('#location-state')).toHaveText('Location enabled');
});

test('approximate location does not expose the save-location action', async ({ page }) => {
  await mockLocation(page, 'granted', 201);
  await page.goto('./');
  await expect(page.getByText('Your position is too approximate for a 200-metre match. Try again with more precise location access.', { exact: true })).toBeVisible();
  await addCard(page);
  await expect(page.getByRole('button', { name: 'Save current location for this card' })).toHaveCount(0);
});

test('denying the native permission request is remembered and can be retried from settings', async ({ page }) => {
  await mockLocation(page, 'prompt', 10, 1);
  await page.goto('./#settings');
  await page.getByRole('button', { name: 'Enable nearby cards', exact: true }).click();
  await expect(page.locator('#location-state')).toHaveText('Location blocked by browser');
  await expect(page.getByRole('button', { name: 'Ask for location access again', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.locator('#location-state')).toHaveText('Location blocked by browser');
  await expect(page.locator('html')).toHaveAttribute('data-location-requests', '0');
  await page.evaluate(() => { document.documentElement.dataset.locationError = '0'; });
  await page.getByRole('button', { name: 'Ask for location access again', exact: true }).click();
  await expect(page.locator('#location-state')).toHaveText('Location enabled');
});

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
