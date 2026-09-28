/**
 * Copy the Stockfish WASM engine out of node_modules into public/ so the built
 * app is a plain pile of static files with no runtime dependency on npm.
 *
 * We ship the "lite single-threaded" flavour deliberately: it needs no
 * SharedArrayBuffer, so the app needs no COOP/COEP headers, so it can be hosted
 * on GitHub Pages as-is.
 *
 * The file is found rather than named. Stockfish puts its major version in every
 * filename -- stockfish-18-lite-single.js, and 19 will not be called that -- so a
 * hardcoded name turns every major release into a build that cannot copy its own
 * engine. Which is exactly what happened, and the failure was an ENOENT in a
 * copy step, a good distance from anything that says "new major version".
 *
 * It is copied under a name with no version in it, which the app can then point
 * at once and for good. Safe because the glue code works out its own wasm from
 * its own URL -- `replace(/\.js$/i, '.wasm')` -- so the pair can be called
 * anything as long as they are called the same thing.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** What the app asks for. No version in it, on purpose. */
export const ENGINE_NAME = 'stockfish-lite-single';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'stockfish', 'bin');
const to = join(root, 'public', 'engine');

const bin = await readdir(from);
const script = bin.find(name => /^stockfish-\d+-lite-single\.js$/.test(name));
if (!script) {
  throw new Error(
    `no lite single-threaded engine in ${from}. Found: ${bin.join(', ') || '(nothing)'}`,
  );
}
const wasm = script.replace(/\.js$/, '.wasm');
if (!bin.includes(wasm)) throw new Error(`${script} is there but ${wasm} is not`);

// Emptied first: the engine is 7MB a copy, and a build that changed major
// version would otherwise precache both the old one and the new one.
await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });

for (const [source, target] of [
  [script, `${ENGINE_NAME}.js`],
  [wasm, `${ENGINE_NAME}.wasm`],
]) {
  await copyFile(join(from, source), join(to, target));
  console.log(`vendored ${source} as ${target}`);
}
