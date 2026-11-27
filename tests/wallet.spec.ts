import { expect, test, type Page } from '@playwright/test';
import { barcodeSvg, parseBackup, type Card, type BarcodeFormat } from '../src/model';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

async function mockCamera(page: Page, format?: BarcodeFormat, value = ''): Promise<void> {
  const png = format ? await sharp(Buffer.from(barcodeSvg({ format, value }))).png().toBuffer()
    : await sharp({ create: { width: 640, height: 480, channels: 4, background: '#ffffff' } }).png().toBuffer();
  await page.addInitScript((url) => {
    const image = new Image();
    image.src = url;
    let activeStream: unknown = null;
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true, get: () => activeStream, set: (stream: unknown) => { activeStream = stream; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: async () => {} });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => image.naturalWidth });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => image.naturalHeight });
    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    const draw: (this: CanvasRenderingContext2D, source: CanvasImageSource, x: number, y: number, width: number, height: number) => void = CanvasRenderingContext2D.prototype.drawImage;
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'drawImage', { configurable: true,
      value: function (this: CanvasRenderingContext2D, source: CanvasImageSource, x: number, y: number, width: number, height: number) {
        draw.call(this, source instanceof HTMLVideoElement ? image : source, x, y, width, height);
      },
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        document.documentElement.dataset.cameraRequests = String(Number(document.documentElement.dataset.cameraRequests ?? 0) + 1);
        await image.decode();
        const track = Object.assign(new EventTarget(), {
          stop: () => { document.documentElement.dataset.cameraStopped = 'true'; },
        });
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      },
    } });
  }, `data:image/png;base64,${png.toString('base64')}`);
}

for (const [format, value] of [
  ['qrcode', '00042'], ['qrcode', ' https://example.test/card\r\nMüller & Sons '],
  ['qrcode', 'x'.repeat(201)], ['azteccode', ' 00 1234 é '], ['code128', ' 000123456789 '],
  ['code39', 'AB-00042'], ['ean13', '4006381333931'], ['ean8', '96385074'],
] satisfies [BarcodeFormat, string][]) {
  test(`camera captures ${format} (${value.length} characters) and preserves its reviewed payload`, async ({ page }) => {
    await mockCamera(page, format, value);
    await page.goto('./#new');
    await expect(page.locator('#scan-status')).toContainText('Code captured');
    await expect(page.locator('#barcode-format')).toHaveValue(format);
    await expect(page.locator('[name="barcode-value"]')).toHaveValue(value.replace(/\r\n?/g, '\n'));
    await expect(page.locator('#same-number')).not.toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'true');
    await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Target');
    await expect(page.locator('[name="color-one"]')).toHaveValue('#cc0000');
    await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill('00042');
    await page.getByRole('button', { name: 'Save card', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Target', exact: true })).toBeVisible();
    const svg = await page.locator('.barcode-image').innerHTML();
    await page.reload();
    expect(await page.locator('.barcode-value').textContent()).toBe(value.replace(/\r\n?/g, '\n'));
    expect(await page.locator('.barcode-image').innerHTML()).toBe(svg);
    const expectedSvg = await page.evaluate((markup) => {
      const container = document.createElement('div');
      container.innerHTML = markup;
      return container.innerHTML;
    }, barcodeSvg({ format, value }));
    expect(svg).toBe(expectedSvg);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#barcode-format')).toHaveValue(format);
    await page.getByRole('button', { name: 'Save card', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Target', exact: true })).toBeVisible();
    expect(await page.locator('.barcode-value').textContent()).toBe(value.replace(/\r\n?/g, '\n'));
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup', exact: true }).click();
    const path = await (await download).path();
    if (!path) throw new Error('Backup not downloaded');
    expect(parseBackup(await readFile(path, 'utf8'))[0]?.barcode).toEqual({ format, value });
    await page.locator('#restore-file').setInputFiles(path);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Replace wallet', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Replace wallet', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'My wallet', exact: true }).click();
    await page.getByRole('link', { name: 'Open card: Target', exact: true }).click();
    expect(await page.locator('.barcode-value').textContent()).toBe(value.replace(/\r\n?/g, '\n'));
    expect(await page.locator('.barcode-image').innerHTML()).toBe(svg);
  });
}

test('camera permission denial leaves manual entry available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { throw new DOMException('Denied', 'NotAllowedError'); },
    } });
  });
  await page.goto('./#new');
  await expect(page.locator('#camera-panel [role="alert"]')).toContainText('Camera access denied');
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Card name', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Manual card');
  await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill('0001');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Manual card', exact: true })).toBeVisible();
});

test('camera capture stops on manual entry or navigation and can restart offline', async ({ page, context }) => {
  await mockCamera(page);
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Add a card', exact: true }).last().click();
  await expect(page.locator('#scan-status')).toContainText('Looking for a code');
  await expect(page.locator('html')).toHaveAttribute('data-camera-requests', '1');
  await page.getByRole('button', { name: 'Enter manually', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'true');
  await page.getByRole('button', { name: 'Scan with camera', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-camera-requests', '2');
  await page.evaluate(() => { delete document.documentElement.dataset.cameraStopped; });
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-camera-stopped', 'true');
  await expect(page.locator('#camera-panel')).toHaveCount(0);
});

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

test('brand colors follow new-card names, persist after saving, and work offline', async ({ page, context }) => {
  await page.goto('./#new');
  const name = page.getByRole('textbox', { name: 'Card name', exact: true });
  const first = page.locator('[name="color-one"]');
  const second = page.locator('[name="color-two"]');
  await name.fill('Target');
  await expect(first).toHaveValue('#cc0000');
  await expect(second).toHaveValue('#eb9d9d');
  await expect(page.locator('#brand-status')).toContainText('Matching brand colors applied');
  await name.fill('Unknown shop');
  await expect(first).toHaveValue('#c5ed76');
  await expect(second).toHaveValue('#275c4b');
  await name.fill(' target rewards ');
  await expect(first).toHaveValue('#cc0000');
  await page.getByRole('textbox', { name: 'Membership number', exact: true }).fill('0001');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'target rewards', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(first).toHaveValue('#cc0000');
  await name.fill('H&M');
  await expect(second).toHaveValue('#eb9d9d');
  await page.getByRole('button', { name: 'Save card', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'H&M', exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Add a card', exact: true }).last().click();
  await name.fill('H & M');
  await expect(first).toHaveValue('#cc1f25');
  await expect(second).toHaveValue('#cc1f25');
  await first.fill('#123456');
  await name.fill('Target');
  await expect(first).toHaveValue('#123456');
  await expect(second).toHaveValue('#cc1f25');
  await expect(page.locator('#brand-status')).toBeEmpty();
});

for (const manual of [false, true]) {
test(`late brand responses ${manual ? 'preserve manual colors' : 'use the latest name'}`, async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/brand-colors.json', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: { target: ['#cc0000', '#eb9d9d'], hm: ['#cc1f25', '#cc1f25'] } });
  });
  await page.goto('./#new');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Target');
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('H&M');
  if (manual) await page.locator('[name="color-one"]').fill('#123456');
  release?.();
  if (manual) {
    await expect.poll(() => page.locator('#card-form').getAttribute('data-brand-colors')).toBeNull();
    await expect(page.locator('[name="color-one"]')).toHaveValue('#123456');
    await expect(page.locator('[name="color-two"]')).toHaveValue('#275c4b');
  } else {
    await expect(page.locator('[name="color-one"]')).toHaveValue('#cc1f25');
    await expect(page.locator('[name="color-two"]')).toHaveValue('#cc1f25');
  }
});
}

test('brand-loading errors are reported and a later name entry retries', async ({ page }) => {
  let requests = 0;
  await page.route('**/brand-colors.json', async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.fulfill({ json: { target: ['#cc0000', '#eb9d9d'] } });
  });
  await page.goto('./#new');
  await expect(page.getByRole('alert')).toContainText('Brand colors could not be loaded');
  await page.getByRole('textbox', { name: 'Card name', exact: true }).fill('Target');
  await expect(page.locator('[name="color-one"]')).toHaveValue('#cc0000');
});

test('compact previews persist offline, use exactly the brand colors, and keep card navigation', async ({ page, context }) => {
  page.on('dialog', (dialog) => dialog.accept());
  const cards = [locatedCard('Alpha'), locatedCard('Beta')];
  await restoreCards(page, cards);
  const display = page.getByRole('combobox', { name: 'Wallet display' });
  await expect(display).toHaveValue('standard');
  expect(await page.locator('#language').evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.querySelector('#location-state')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true);
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  const fullSize = await page.locator('#all-cards .membership-card').first().boundingBox();
  if (!fullSize) throw new Error('Standard card is not visible');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await display.selectOption('compact');
  await expect(display).toBeEnabled();
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  const previews = page.locator('#all-cards .compact-card');
  await expect(previews).toHaveCount(2);
  await expect(previews.locator('h4')).toHaveText(['Alpha', 'Beta']);
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
  await expect(display).toHaveValue('compact');
  await display.selectOption('standard');
  await expect(display).toBeEnabled();
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.locator('#all-cards .card-caption h3')).toHaveText(['Alpha', 'Beta']);
  await page.reload();
  await expect(page.locator('.compact-card')).toHaveCount(0);
});

for (const view of ['compact', 'list'] as const) {
test(`${view} view groups categories, searches both sections, persists offline and fits German narrow screens`, async ({ page, context }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [
    { ...locatedCard('Alpha', 52.52), category: 'Travel' },
    { ...locatedCard('Beta', 52.52), category: 'Shopping & Rewards' },
    { ...locatedCard('Zebra'), category: 'Shopping & Rewards' },
    locatedCard('Gamma'),
  ]);
  const display = page.getByRole('combobox', { name: 'Wallet display' });
  await display.selectOption(view);
  await expect(display).toBeEnabled();
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.locator('.category-filters, [data-action="filter-category"]')).toHaveCount(0);
  await expect(page.locator('#all-cards .category-heading')).toHaveText(['No category', 'Shopping & Rewards', 'Travel']);
  await expect(page.locator('#nearby-cards .category-heading')).toHaveText(['Shopping & Rewards', 'Travel']);
  await expect(page.locator('#all-cards h4')).toHaveText(['Gamma', 'Beta', 'Zebra', 'Alpha']);
  if (view === 'list') {
    await expect(page.locator('#all-cards .card-list')).toHaveCount(3);
    await expect(page.locator('#all-cards .list-card')).toHaveCount(4);
    const box = await page.locator('#all-cards .list-card').first().boundingBox();
    expect(box && box.height >= 44 && box.height <= 88).toBeTruthy();
  }
  await page.getByRole('searchbox').fill(' shopping ');
  await expect(page.locator('#all-cards .category-heading')).toHaveText(['Shopping & Rewards']);
  await expect(page.locator('#all-cards h4')).toHaveText(['Beta', 'Zebra']);
  await expect(page.locator('#nearby-cards h4')).toHaveText(['Beta']);
  await page.getByRole('searchbox').fill('Missing');
  await expect(page.getByRole('heading', { name: 'No matching cards' })).toBeVisible();
  await expect(page.locator('#nearby-cards')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await page.getByRole('searchbox').fill('Gamma');
  await expect(page.locator('#all-cards h4')).toHaveText(['Gamma']);
  await expect(page.locator('#nearby-cards')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open card: Gamma', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gamma', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to wallet', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('Gamma');
  await page.getByRole('searchbox').fill('');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#all-cards h4')).toHaveText(['Gamma', 'Beta', 'Zebra', 'Alpha']);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(display).toHaveValue(view);
  await page.locator('#language').selectOption('de');
  await expect(page.getByRole('combobox', { name: 'Wallet-Ansicht' })).toHaveValue(view);
  await page.getByRole('link', { name: 'Meine Wallet', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('heading', { name: 'Ohne Kategorie', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
}

test('large cards hide categories and category filters while category search works', async ({ page }) => {
  await mockLocation(page, 'granted');
  page.on('dialog', (dialog) => dialog.accept());
  await restoreCards(page, [
    { ...locatedCard('Alpha', 52.52), category: 'Shopping & Rewards' },
    { ...locatedCard('Beta'), category: 'Travel' },
  ]);
  await page.getByRole('link', { name: 'My wallet', exact: true }).click();
  await expect(page.locator('.card-category, .category-heading, .category-filters')).toHaveCount(0);
  await expect(page.getByText('Shopping & Rewards', { exact: true })).toHaveCount(0);
  await page.getByRole('searchbox').fill('REWARDS');
  await expect(page.locator('#all-cards .card-caption h3')).toHaveText(['Alpha']);
  await expect(page.locator('#nearby-cards .card-caption h3')).toHaveText(['Alpha']);
  await page.getByRole('searchbox').fill('travel');
  await expect(page.locator('#all-cards .card-caption h3')).toHaveText(['Beta']);
  await expect(page.locator('#nearby-cards')).toHaveCount(0);
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
