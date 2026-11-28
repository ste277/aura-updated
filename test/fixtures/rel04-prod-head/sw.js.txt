const CACHE_NAME = 'aura-v2';
const ASSETS = ['/manifest.json', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Network first fallback to cache strategy for API calls
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

// Web Push V1 -- reuses this SAME existing service worker (brief section
// 9: "Do not register a competing service worker"). The push payload is
// the minimal, privacy-safe DTO lib/pushPayload.ts builds server-side --
// title, body, target, scheduledItemType, scheduledItemId, reminderAt.
// Never birth data, natal context, SavedPerson details, Muhurta reasons,
// or the public Moment token.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = {};
  }

  const title = payload.title || 'Aura';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // One notification per scheduled item replaces any earlier one for
    // the SAME item rather than stacking duplicates (e.g. a retry).
    tag: payload.scheduledItemId ? `aura-reminder-${payload.scheduledItemId}` : undefined,
    data: {
      target: payload.target || null,
      scheduledItemType: payload.scheduledItemType || null,
      scheduledItemId: payload.scheduledItemId || null,
      reminderAt: payload.reminderAt || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Web Push V1 (brief section 10/11) -- close the notification, mark the
// reminder occurrence seen via the SAME authenticated /api/reminders/seen
// endpoint the in-app UI already calls (session cookies travel
// automatically on a same-origin fetch from the service worker), then
// focus an already-open Aura tab (postMessage so the SPA can react without
// a full reload) or open a new one at the reminder's target.
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  event.waitUntil(
    (async () => {
      if (data.scheduledItemType && data.scheduledItemId && data.reminderAt) {
        try {
          await fetch('/api/reminders/seen', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              scheduledItemType: data.scheduledItemType,
              scheduledItemId: data.scheduledItemId,
              reminderAt: data.reminderAt,
            }),
          });
        } catch (err) {
          // Best-effort -- the next GET /api/aura-updates the app makes
          // will still reflect whatever the server-side state actually is.
        }

        // REMINDER_OPENED, source: PUSH (brief section 31) -- the SAME
        // canonical open event the in-app click path fires, not a second
        // PUSH-specific event representing the identical user action.
        fetch('/api/product-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            eventName: 'REMINDER_OPENED',
            metadata: { scheduledItemType: data.scheduledItemType, source: 'PUSH' },
          }),
        }).catch(() => {});
      }

      const targetUrl = data.target && data.target.type === 'MOMENT' ? `/moment/${data.target.momentToken}` : '/';

      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        existing.focus();
        // PLAN_APPROACHING has no dedicated URL (Plans aren't individually
        // addressable -- the SAME limitation the in-app reminder click
        // already has); the already-open SPA reacts to this message the
        // same way it reacts to an in-app reminder click.
        existing.postMessage({ type: 'AURA_REMINDER_NAVIGATE', target: data.target });
        return;
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
