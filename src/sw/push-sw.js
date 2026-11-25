// Reminder notifications sent by the finpair-t212 Worker (worker/src/reminders.ts).
// Pulled into the generated service worker via workbox `importScripts`; the
// build replaces __ICON_DIR__ with this build's icon folder (see vite.config.ts).

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    // not JSON — fall back to a generic notification
  }
  const scope = self.registration.scope;
  event.waitUntil(
    self.registration.showNotification(msg.title || 'MC Bank', {
      body: msg.body || '',
      tag: msg.tag || undefined,
      icon: scope + '__ICON_DIR__/icon-192.png',
      data: { url: scope + (msg.url || '') },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const scope = self.registration.scope;
  const url = (event.notification.data && event.notification.data.url) || scope;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(scope));
      if (open) {
        await open.focus();
        if ('navigate' in open) await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
