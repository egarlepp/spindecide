// Copies the runtime third-party files from node_modules into vendor/ so the
// app makes no CDN requests. Run with `npm run build:vendor` after bumping a
// dependency version in package.json; commit the result.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = (...p) => join(root, 'vendor', ...p);

const files = [
  [nm('lucide', 'dist', 'umd', 'lucide.min.js'), out('lucide', 'lucide.min.js')],
  [nm('lucide', 'LICENSE'), out('lucide', 'LICENSE')],
  [nm('canvas-confetti', 'dist', 'confetti.browser.js'), out('canvas-confetti', 'confetti.browser.js')],
  [nm('canvas-confetti', 'LICENSE'), out('canvas-confetti', 'LICENSE')],
  [nm('@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'), out('inter', 'inter-latin-wght-normal.woff2')],
  [nm('@fontsource-variable', 'inter', 'files', 'inter-latin-ext-wght-normal.woff2'), out('inter', 'inter-latin-ext-wght-normal.woff2')],
  [nm('@fontsource-variable', 'inter', 'LICENSE'), out('inter', 'LICENSE')],
];

// Remove previously vendored packages but keep vendor/README.md.
for (const dir of ['lucide', 'canvas-confetti', 'inter']) await rm(out(dir), { recursive: true, force: true });
for (const [from, to] of files) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}
console.log(`Vendored ${files.length} files into vendor/`);
