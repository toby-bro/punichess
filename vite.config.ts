import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
