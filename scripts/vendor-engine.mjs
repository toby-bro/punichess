/**
 * Copy the Stockfish WASM engine out of node_modules into public/ so the built
 * app is a plain pile of static files with no runtime dependency on npm.
 *
 * We ship the "lite single-threaded" flavour deliberately: it needs no
 * SharedArrayBuffer, so the app needs no COOP/COEP headers, so it can be hosted
 * on GitHub Pages as-is.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'stockfish', 'bin');
const to = join(root, 'public', 'engine');
const files = ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'];

await mkdir(to, { recursive: true });
for (const file of files) {
  await copyFile(join(from, file), join(to, file));
  console.log(`vendored ${file}`);
}
