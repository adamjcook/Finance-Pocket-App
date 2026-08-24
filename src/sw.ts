/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { savePendingShare } from './model/db';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/**
 * Web Share Target: a static site has no server to receive the POST an
 * "Open with Pocket Finances" / Nearby Share hand-off makes, so the service
 * worker's fetch handler catches it here entirely client-side, stashes the
 * shared file, and redirects into the app — see manifest.share_target
 * (vite.config.ts) and the Sync screen's pending-share check.
 */
const SHARE_TARGET_PATH = 'share-target/';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith(SHARE_TARGET_PATH)) return;

  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const file = formData.get('payload');
        if (file instanceof File) {
          await savePendingShare(await file.text());
        }
      } catch {
        // Nothing usable arrived — the Sync screen simply won't find a pending share.
      }
      return Response.redirect(new URL('#/sync', self.registration.scope).href, 303);
    })(),
  );
});
