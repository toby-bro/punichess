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

/**
 * The build this bundle was made from, written in at build time.
 *
 * Compared against the one the site is publishing to find out whether the code
 * running here is the code that is deployed.
 */
declare const __BUILD_ID__: string;

/**
 * How often to ask what is published.
 *
 * Two minutes, because the asking is a request for a few dozen bytes. It used to
 * be thirty, and it asked by refetching the worker -- seventeen kilobytes and the
 * whole install machinery -- so it could not be asked often, and an update took
 * the better part of an hour to be noticed.
 */
const CHECK_EVERY_MS = 2 * 60 * 1000;

/**
 * And how often to ask the worker directly, whatever the version file said.
 *
 * A fallback for the case where version.json cannot be read at all: an old build
 * that predates it, a deploy that dropped it, a network that returns something
 * else entirely.
 */
const FALLBACK_EVERY_MS = 30 * 60 * 1000;

/**
 * What build the site is serving, or nothing if it will not say.
 *
 * `no-store` keeps the browser's own cache out of it. Nothing can be done about
 * the CDN in front of GitHub Pages: it holds everything for up to ten minutes
 * and ignores every request header asking it not to -- no-cache, Pragma, max-age
 * zero, and a unique query string, all measured, all served the same aged copy.
 * Ten minutes is therefore the floor here, and the thirty-minute timer above it
 * was the part worth fixing.
 */
async function publishedBuild(): Promise<string | undefined> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const build = (body as { build?: unknown }).build;
    return typeof build === 'string' ? build : undefined;
  } catch {
    // Offline, or something that is not the file we asked for. Neither is worth
    // making a noise about; the next check is two minutes away.
    return undefined;
  }
}

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
      /*
       * Ask what is published, and only wake the worker when it has changed.
       *
       * The expensive half then runs once per deploy instead of once per tick,
       * which is what makes checking every couple of minutes affordable.
       */
      const check = (): void => {
        void publishedBuild().then(published => {
          if (published !== undefined && published !== __BUILD_ID__) {
            void registration.update();
          }
        });
      };
      setInterval(check, CHECK_EVERY_MS);
      setInterval(() => {
        void registration.update();
      }, FALLBACK_EVERY_MS);
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
