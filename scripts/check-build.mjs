import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const files = await readdir(root, { recursive: true, withFileTypes: true });
let total = 0;
let javascript = 0;
let css = 0;
for (const file of files) {
  if (!file.isFile()) continue;
  const contents = await readFile(path.join(file.parentPath, file.name));
  total += contents.length;
  if (file.name.endsWith('.js')) javascript += gzipSync(contents).length;
  if (file.name.endsWith('.css')) css += gzipSync(contents).length;
}
for (const [label, size, budget] of [
  ['All JavaScript (gzip)', javascript, 100 * 1024],
  ['CSS (gzip)', css, 10 * 1024],
  ['Static build (uncompressed)', total, 1024 * 1024],
]) {
  console.log(`${label}: ${(size / 1024).toFixed(1)} / ${budget / 1024} KiB`);
  if (size > budget) throw new Error(`${label} exceeds the mobile asset budget`);
}
