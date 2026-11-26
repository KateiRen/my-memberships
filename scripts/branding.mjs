import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'assets', 'branding');
const icons = path.join(root, 'public', 'icons');
const branding = path.join(root, 'public', 'branding');
await Promise.all([mkdir(icons, { recursive: true }), mkdir(branding, { recursive: true })]);
const wallet = path.join(source, 'Elegantes Lederkartenetui mit bunten Karten.png');
for (const size of [180, 192, 512]) {
  await sharp(wallet).resize(size, size, { fit: 'contain', background: '#ffffff' })
    .png().toFile(path.join(icons, size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`));
}
await sharp(wallet).resize(360, 360, { fit: 'contain', background: '#ffffff' })
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: '#ffffff' })
  .png().toFile(path.join(icons, 'maskable-512.png'));
await sharp(path.join(source, 'Fächer aus bunten Einkaufskarten.png'))
  .resize(600, 600, { fit: 'inside', withoutEnlargement: true })
  .webp({ quality: 80 }).toFile(path.join(branding, 'cards.webp'));

const records = JSON.parse(await readFile(path.join(root, 'src', 'data', 'brand-colors.json'), 'utf8'));
const brands = Object.create(null);
for (const record of records) {
  if (typeof record.name !== 'string' || !record.name.trim() || !Array.isArray(record.colors) ||
      record.colors.length !== 2 || !record.colors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error('Invalid brand-color reference record');
  }
  const name = record.name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const colors = record.colors.map((color) => color.toLowerCase());
  if (Object.hasOwn(brands, name) && JSON.stringify(brands[name]) !== JSON.stringify(colors)) brands[name] = null;
  else if (!Object.hasOwn(brands, name)) brands[name] = colors;
}
await writeFile(path.join(root, 'public', 'brand-colors.json'), JSON.stringify(brands));
