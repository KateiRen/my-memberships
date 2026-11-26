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
      watchPosition: (success: PositionCallback, error: (error: { code: number }) => void) => {
        const element = document.documentElement;
        element.dataset.locationRequests = String(Number(element.dataset.locationRequests ?? 0) + 1);
        const emit = () => {
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
              latitude: Number(element.dataset.latitude ?? 52.52), longitude: 13.405, accuracy: Number(element.dataset.locationAccuracy ?? accuracy),
              altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}),
            },
            timestamp: Date.now(), toJSON: () => ({}),
          });
        };
        const watch = setInterval(emit, 250);
        queueMicrotask(emit);
        return watch;
      },
      clearWatch: (watch: number) => clearInterval(watch),
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

test('compact previews persist offline, use exactly the brand colors, and keep card navigation', async ({ page, context }) => {
  page.on('dialog', (dialog) => dialog.accept());
  const cards = [locatedCard('Alpha'), locatedCard('Beta')];
  await restoreCards(page, cards);
  const toggle = page.getByRole('switch', { name: 'Use smaller card previews' });
  await expect(toggle).not.toBeChecked();
  expect(await page.locator('#language').evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.querySelector('#location-state')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true);
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  const fullSize = await page.locator('#all-cards .membership-card').first().boundingBox();
  if (!fullSize) throw new Error('Standard card is not visible');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await toggle.check();
  await expect(toggle).toBeEnabled();
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  const previews = page.locator('#all-cards .compact-card');
  await expect(previews).toHaveCount(2);
  await expect(previews.locator('h3')).toHaveText(['Alpha', 'Beta']);
  await expect(page.locator('.card-caption, .card-art')).toHaveCount(0);
  expect(await previews.first().evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color, style.backgroundImage, element.textContent];
  })).toEqual(['rgb(17, 34, 51)', 'rgb(68, 85, 102)', 'none', 'Alpha']);
  const smallSize = await previews.first().boundingBox();
  if (!smallSize) throw new Error('Compact card is not visible');
  expect(smallSize.height).toBeLessThan(fullSize.height / 2);
  expect(smallSize.width).toBeLessThan(fullSize.width);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(previews).toHaveCount(2);
  await previews.first().click();
  await expect(page.getByRole('heading', { name: 'Alpha', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).toBeEnabled();
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.locator('#all-cards .card-caption h3')).toHaveText(['Alpha', 'Beta']);
  await page.reload();
  await expect(page.locator('.compact-card')).toHaveCount(0);
});

test('category toggles combine with search in both card sections and fit compact German previews', async ({ page }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [
    { ...locatedCard('Alpha', 52.52), category: 'Shopping & Rewards' },
    { ...locatedCard('Beta', 52.52), category: 'Travel' },
    locatedCard('Gamma'),
  ]);
  await page.getByRole('switch', { name: 'Use smaller card previews' }).check();
  await expect(page.getByRole('switch')).toBeEnabled();
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  const filters = page.getByRole('group', { name: 'Filter by category' });
  await expect(filters.getByRole('button')).toHaveText(['No category', 'Shopping & Rewards', 'Travel']);
  expect(await filters.evaluate((element) =>
    element.getBoundingClientRect().top >= document.querySelector('.search-box')!.getBoundingClientRect().bottom,
  )).toBe(true);
  await filters.getByRole('button', { name: 'Travel', exact: true }).click();
  await expect(page.locator('#all-cards h3')).toHaveText(['Beta']);
  await expect(page.locator('#nearby-cards h3')).toHaveText(['Beta']);
  await filters.getByRole('button', { name: 'Shopping & Rewards', exact: true }).click();
  await expect(page.locator('#all-cards h3')).toHaveText(['Alpha', 'Beta']);
  await expect(page.locator('#nearby-cards .compact-card')).toHaveCount(2);
  await page.getByRole('searchbox').fill('Alpha');
  await expect(page.locator('#all-cards h3')).toHaveText(['Alpha']);
  await expect(page.locator('#nearby-cards h3')).toHaveText(['Alpha']);
  await filters.getByRole('button', { name: 'Shopping & Rewards', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching cards' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('#all-cards h3')).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await expect(filters.locator('[aria-pressed="true"]')).toHaveCount(0);
  await filters.getByRole('button', { name: 'No category', exact: true }).click();
  await expect(page.locator('#all-cards h3')).toHaveText(['Gamma']);
  await expect(page.locator('#nearby-cards')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open card: Gamma', exact: true }).click();
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await expect(filters.getByRole('button', { name: 'No category' })).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: 'No category', exact: true }).click();
  await expect(page.locator('#all-cards h3')).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('switch', { name: 'Kleinere Kartenvorschau verwenden' })).toBeChecked();
  await page.getByRole('link', { name: 'Meine Wallet', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('button', { name: 'Ohne Kategorie', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

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
  await expect(page.locator('.location-row .mono')).toHaveText('52.52, 13.405');
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Location label', exact: true }).fill('Main branch');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByText('Main branch', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Remove location', exact: true }).click();
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(save).toBeVisible();
});

test('a separate nearby section appears above the complete alphabetical list, including offline', async ({ page, context }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [locatedCard('Alpha'), locatedCard('Zoo', 52.52), locatedCard('Market', 52.5205)]);
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  const nearby = page.getByRole('region', { name: 'Nearby', exact: true });
  const all = page.getByRole('region', { name: 'All cards', exact: true });
  await expect(nearby.locator('.membership-card h3')).toHaveText(['Market', 'Zoo']);
  await expect(all.locator('.membership-card h3')).toHaveText(['Alpha', 'Market', 'Zoo']);
  await expect(page.locator('.wallet-section > h2')).toHaveText(['Nearby', 'All cards']);
  await expect(page.locator('.nearby-badge')).toHaveCount(2);
  await nearby.getByRole('link', { name: 'Open card: Zoo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zoo', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await page.getByRole('searchbox').fill('Market');
  await expect(nearby.locator('.membership-card h3')).toHaveText(['Market']);
  await expect(all.locator('.membership-card h3')).toHaveText(['Market']);
  await page.getByRole('searchbox').fill('Alpha');
  await expect(nearby).toHaveCount(0);
  await expect(all.locator('.membership-card h3')).toHaveText(['Alpha']);
  await page.getByRole('searchbox').fill('Missing');
  await expect(nearby).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No matching cards', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(nearby.locator('.membership-card h3')).toHaveText(['Market', 'Zoo']);
  await expect(all.locator('.membership-card h3')).toHaveText(['Alpha', 'Market', 'Zoo']);
  await page.evaluate(() => { document.documentElement.dataset.locationError = '2'; });
  await page.getByRole('button', { name: 'Refresh nearby cards', exact: true }).click();
  await expect(page.getByText('Your location is unavailable. Cards remain in alphabetical order; try again when location is available.', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(nearby).toHaveCount(0);
  await expect(all.locator('.membership-card h3')).toHaveText(['Alpha', 'Market', 'Zoo']);
  await expect(page.locator('.nearby-badge')).toHaveCount(0);
});

test('German nearby section fits a narrow screen and disappears when all saved places are far away', async ({ page }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [locatedCard('Alpha'), locatedCard('Zoo', 52.52)]);
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Meine Wallet', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  const refresh = page.getByRole('button', { name: 'Karten in der Nähe aktualisieren', exact: true });
  await expect(refresh.locator('svg')).toHaveCount(1);
  await expect(refresh.locator('.sr-only')).toHaveText('Karten in der Nähe aktualisieren');
  await expect(page.getByRole('button', { name: 'Karten in der Nähe deaktivieren', exact: true })).toHaveCount(0);
  expect(await refresh.evaluate((element) => {
    const button = element.getBoundingClientRect();
    const hint = element.parentElement!.querySelector('p')!.getBoundingClientRect();
    return button.left >= hint.right && button.top < hint.bottom && button.bottom > hint.top;
  })).toBe(true);
  await expect(page.locator('.wallet-section > h2')).toHaveText(['In der Nähe', 'Alle Karten']);
  await expect(page.getByRole('region', { name: 'In der Nähe', exact: true }).locator('.membership-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.dataset.latitude = '50'; });
  await refresh.click();
  await expect(page.getByRole('region', { name: 'In der Nähe', exact: true })).toHaveCount(0);
  await expect(refresh.locator('svg')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Alle Karten', exact: true }).locator('.membership-card h3')).toHaveText(['Alpha', 'Zoo']);
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
  await expect(page.getByRole('region', { name: 'Nearby', exact: true })).toHaveCount(0);
  await expect(page.locator('#all-cards .membership-card h3')).toHaveText(['Alpha', 'Zoo']);
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

test('location capture remains available with an approximate fix and saves only after accuracy improves', async ({ page }) => {
  await mockLocation(page, 'granted', 201);
  await page.goto('./');
  await addCard(page);
  const save = page.getByRole('button', { name: 'Save current location for this card' });
  await expect(save).toBeVisible();
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.locator('#location-detail-status')).toContainText('Checking your location');
  await page.evaluate(() => { document.documentElement.dataset.locationAccuracy = '25'; });
  await expect(page.getByText('Location saved. This card will be suggested when you are nearby.', { exact: true })).toBeVisible();
  await expect(save).toHaveCount(0);
});

test('an existing location suppresses capture even when it is far away and coordinates are not manually editable', async ({ page }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  const card = locatedCard('Far', 50);
  card.locations.push({ label: 'Second branch', latitude: 49, longitude: 12 });
  await restoreCards(page, [card]);
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await page.getByRole('link', { name: 'Open card: Far', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save current location for this card' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add location', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove location', exact: true }).first().click();
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.locator('.location-list')).toContainText('Second branch');
  await expect(page.locator('.location-list')).toContainText('49, 12');
  await page.reload();
  await expect(page.locator('.location-list li')).toHaveCount(1);
});

test('German card-detail capture stays visible after lookup failure and fits a narrow screen', async ({ page }) => {
  await mockLocation(page, 'granted');
  await page.goto('./');
  await addCard(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Einstellungen', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Meine Wallet', exact: true }).click();
  await page.locator('.membership-card').click();
  await page.setViewportSize({ width: 320, height: 740 });
  const capture = page.getByRole('button', { name: 'Aktuellen Standort hinzufügen', exact: true });
  await expect(capture).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition() { throw new Error('Location hardware unavailable'); },
      clearWatch() {},
    } });
  });
  await capture.click();
  await expect(page.getByRole('alert')).toContainText('Dein Standort ist nicht verfügbar');
  await expect(capture).toBeEnabled();
  await expect(page.locator('.location-list')).toHaveCount(0);
});

test('a coarse initial phone location can improve before the 15-second deadline', async ({ page }) => {
  await mockLocation(page, 'granted', 1500);
  await page.goto('./');
  await expect(page.getByText('Checking your location. You can keep using your wallet.', { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.locationAccuracy = '25'; });
  await expect(page.getByText('Cards with a saved location within 200 metres appear first.', { exact: true })).toBeVisible();
  await addCard(page);
  await expect(page.getByRole('button', { name: 'Save current location for this card' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Add location', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.locator('.barcode-value')).toHaveText('00042');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Library Rewards', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await page.getByRole('searchbox').fill('missing');
  await expect(page.getByRole('heading', { name: 'No matching cards' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('link', { name: 'Open card: Library Rewards' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All your memberships. One little wallet.' })).toBeVisible();
});
for (const format of ['code128', 'code39', 'ean13', 'ean8', 'qrcode', 'azteccode']) {
  test(`${format} preserves membership spacing across save, reload, and edit`, async ({ page }) => {
    const number = format === 'ean13' ? '4006  3813 3393 1' : format === 'ean8' ? '9638  5074' : ' 00  1234 ';
    const compact = number.replace(/\s/g, '');
    await page.goto('./#new');
    await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Spaced membership');
    await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill(number);
    await page.locator('#barcode-format').selectOption(format);
    await expect(page.locator('[name="barcode-value"]')).toHaveValue(compact);
    await page.getByRole('button', { name: 'Save card', exact: true }).click();
    await expect(page.locator('.barcode-image svg')).toBeVisible();
    await expect(page.locator('.detail-title')).toHaveText('Spaced membership');
    await expect(page.locator('.detail-title svg')).toHaveCount(0);
    await expect(page.locator('.detail-title + .scan-panel > .barcode-image:first-child')).toBeVisible();
    await expect(page.locator('.scan-panel > .barcode-value + .detail-location #save-location')).toHaveCount(1);
    await expect(page.locator('.detail-location + .muted')).toBeVisible();
    if (format === 'qrcode' || format === 'azteccode') {
      const bounds = await page.locator('.barcode-image svg').boundingBox();
      if (!bounds) throw new Error('Matrix code is not visible');
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThanOrEqual(1);
      expect(bounds.width).toBeLessThanOrEqual(260);
    }
    const svg = await page.locator('.barcode-image').innerHTML();
    await page.reload();
    expect(await page.locator('dd.mono').textContent()).toBe(number);
    expect(await page.locator('.barcode-value').textContent()).toBe(number);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Membership number', exact: true })).toHaveValue(number);
    await expect(page.locator('#same-number')).toBeChecked();
    await expect(page.locator('[name="barcode-value"]')).toHaveValue(compact);
    await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill(compact);
    await page.getByRole('button', { name: 'Save card', exact: true }).click();
    expect(await page.locator('.barcode-image').innerHTML()).toBe(svg);
  });
}
for (const count of [0, 1, 10]) {
  test(`shows the restore preview and replacement action after selecting a backup with ${count} cards`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('./#settings');
    const cards = Array.from({ length: count }, (_, index) => ({
      ...locatedCard(`card-${index}`),
      name: `Card ${index} ${'Long membership name '.repeat(4)}`,
    }));
    await page.locator('#restore-file').scrollIntoViewIfNeeded();
    await page.locator('#restore-file').setInputFiles({
      name: 'wallet.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'my-memberships', version: 1, cards })),
    });
    const replace = page.getByRole('button', { name: 'Replace wallet', exact: true });
    await expect(replace).toBeFocused();
    await expect(page.locator('.restore-preview')).toBeInViewport();
    await expect(replace).toBeInViewport({ ratio: 1 });
    await expect.poll(() => replace.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const navigation = document.querySelector('.bottom-nav')!.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= navigation.top;
    })).toBe(true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.restore-preview')).toHaveCount(0);
  });
}
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
