import { type Plugin, defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * What this build is, for the app to compare itself against.
 *
 * The commit when a workflow built it, a timestamp otherwise, which is enough to
 * tell one local build from the next.
 */
const BUILD_ID = process.env['GITHUB_SHA'] ?? String(Date.now());

/**
 * Write that id where the running app can read it.
 *
 * A few dozen bytes, so it can be asked for often. Deliberately .json, which is
 * outside the worker's precache globs -- a version file served from the cache
 * that is meant to tell you the cache is stale would be a fine joke and no use.
 */
function versionFile(): Plugin {
  return {
    name: 'punichess-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: BUILD_ID, built: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Set BASE to "/<repo>/" when deploying to a project GitHub Pages site.
  base: process.env['BASE'] ?? '/',
  server: {
    // Bound to all interfaces so the phone can reach the container over the LAN.
    host: true,
    port: 5173,
    // Container filesystems miss inotify events on bind mounts.
    watch: { usePolling: true },
  },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  plugins: [
    versionFile(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in src/updates.ts: the injected one registers on load
      // and never checks again, which on an installed app means never.
      injectRegister: false,
      includeAssets: ['engine/*'],
      workbox: {
        // The engine is ~7.3MB and must be precached or the app is not offline.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,woff2}'],
        // The title's font is the only thing fetched over the network, and
        // nothing was keeping it. Every load asked Google for it again, so the
        // title fell back to the system font whenever the request was slow,
        // offline, or refused -- and a browser with tracker blocking on, which
        // Samsung Internet ships with, refuses it every time.
        //
        // Cached once and reused: the stylesheet is revalidated in the
        // background so a face that has been seen once keeps working with no
        // network at all, and the font files themselves never change, so they
        // are served from the cache outright.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      manifest: {
        name: 'Punichess',
        short_name: 'Punichess',
        description:
          'A chess bot that blunders on purpose and stops you the moment you fail to punish it.',
        start_url: '.',
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#161512',
        theme_color: '#161512',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Its own drawing, not the same file relabelled: a maskable icon is
          // cropped to the circle inside the middle 80%, so it is scaled to fit
          // that and runs its background to the edges for the mask to cut.
          // Both purposes at both sizes, as separate files. Never
          // `purpose: 'any maskable'` on one file: Chrome's own audit calls
          // that out, because the same image then has to be both an icon with
          // safe-zone padding and one without, and it ends up wrong in one
          // place or the other.
          {
            src: 'icon-192-maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          // The splash screen draws the icon on a 240dp canvas, which is 720px
          // on a 3x phone, so 512 gets upscaled and looks soft exactly when the
          // app opens.
          {
            src: 'icon-1024-maskable.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
