import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
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
