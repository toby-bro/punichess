import { defineConfig } from 'vite';

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
});
