/**
 * Noticing that a new version has been published.
 *
 * The registration vite-plugin-pwa injects is one line: register the worker on
 * load, and never look again. For a page in a tab that is nearly enough, because
 * the next navigation picks up the change. For an app installed on a phone it is
 * not: it is never fully closed, so "the next load" may be weeks away, and until
 * then the only way to see a new version is to clear the site's storage by hand.
 *
 * Three things were missing, and all three had to be fixed or the other two
 * bought nothing:
 *
 *  1. Nothing ever asked again. `update()` now runs on a timer, whenever the app
 *     comes back to the foreground, and whenever the network returns.
 *  2. The worker script itself was allowed to come from the HTTP cache, and
 *     GitHub Pages serves it with ten minutes of freshness, so a check could be
 *     answered by the very file it was checking for changes against.
 *     `updateViaCache: 'none'` forbids that.
 *  3. Even once a new worker takes over -- and it does take over at once, the
 *     generated worker calls skipWaiting and clientsClaim -- the page that is
 *     already open goes on running the JavaScript it loaded. Something has to
 *     reload it, and that is the caller's decision, not this module's.
 */

/** How often to ask, while the app is open and in front of you. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

export interface UpdateHooks {
  /**
   * A new version is now in charge and this page is running the old one.
   *
   * Whether to reload, and what to put somewhere safe first, is the caller's
   * business. A reload throws away everything the page is holding, and a game
   * that has not been saved is held nowhere else.
   */
  readonly onTakenOver: () => void;
}

/**
 * Watch for new versions. Does nothing unless a service worker is running,
 * which means it does nothing in development, where there is not one.
 */
export function watchForUpdates(hooks: UpdateHooks): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  // Whether this page was already being served by a worker. Without it the very
  // first install looks exactly like an update and reloads a page that has only
  // just finished loading.
  const wasControlled = navigator.serviceWorker.controller !== null;

  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .then(registration => {
      const check = (): void => {
        void registration.update();
      };
      setInterval(check, CHECK_EVERY_MS);
      // The moment that matters most: you have just opened the app again.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
      window.addEventListener('online', check);
    })
    .catch(() => {
      // No worker means no offline and no updates, and neither is worth
      // refusing to start a game over.
    });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wasControlled) hooks.onTakenOver();
  });
}
