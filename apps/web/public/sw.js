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

// AURA-ANDROID-REL-04 (R4) -- compatibility bridge for pages loaded BEFORE the
// account boundary (old bundles cannot be changed; this worker controls them
// once the browser has fetched this version, which it does on the next
// navigation anywhere in the origin; skipWaiting + clients.claim above then
// apply it to already-open pages).
//  1. Refresh path (activation blockers A-1/A-2): an /api request WITHOUT the
//     X-Aura-Expected-Account header that the server refuses with 503
//     client_upgrade_required came from an out-of-date page. That page is
//     reloaded (once) into the current bundle, with ?aura_reloaded=upgrade so
//     the new page can say what happened. This includes an old page's sign-out
//     (refused so it cannot clear a replacement session): instead of leaving a
//     false "signed out" screen, the page reloads and shows the real session.
//     Pages of the current bundle announce themselves and are never reloaded.
//  2. Cookie settlement (A-3): sign-in and sign-out requests from EVERY page
//     this worker controls (old or new bundle, with or without Web Locks) are
//     sent one at a time; the next starts only after the previous response
//     (and its Set-Cookie) has arrived, so a stale sign-out response can no
//     longer land after a newer sign-in and clear it. Bounded wait.
// Pages this worker does not control (service workers unavailable or
// disabled, a hard reload, before the update) are NOT covered; see the
// readiness report.
const ACCOUNT_HEADER = 'x-aura-expected-account';
const AUTH_COOKIE_ROUTES = ['/api/auth/logout', '/api/auth/verify-code'];
const AUTH_SETTLE_TIMEOUT_MS = 15000;
const RELOAD_GUARD_MS = 30000;
const boundaryClients = new Set();
const reloadedClients = new Map();
let authChain = Promise.resolve();

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'AURA_ACCOUNT_BOUNDARY' && event.source && event.source.id) boundaryClients.add(event.source.id);
});

function settleAuthSerially(request) {
  const run = authChain.then(() => fetch(request));
  const settled = run.then(() => undefined, () => undefined);
  authChain = Promise.race([settled, new Promise((resolve) => setTimeout(resolve, AUTH_SETTLE_TIMEOUT_MS))]);
  return run;
}

async function reloadOutdatedClient(clientId) {
  if (!clientId || boundaryClients.has(clientId)) return;
  const now = Date.now();
  if (now - (reloadedClients.get(clientId) || 0) < RELOAD_GUARD_MS) return;
  reloadedClients.set(clientId, now);
  const client = await self.clients.get(clientId);
  if (!client || client.type !== 'window' || typeof client.navigate !== 'function') return;
  const target = new URL(client.url);
  if (target.origin !== self.location.origin || target.searchParams.get('aura_reloaded') === 'upgrade') return;
  target.searchParams.set('aura_reloaded', 'upgrade');
  try { await client.navigate(target.toString()); } catch (err) { /* not controlled / navigation refused */ }
}

self.addEventListener('fetch', (event) => {
  // Network first fallback to cache strategy for API calls
  if (event.request.url.includes('/api/')) {
    const url = new URL(event.request.url);
    const sameOrigin = url.origin === self.location.origin;
    const unbound = sameOrigin && !event.request.headers.has(ACCOUNT_HEADER);
    const authCookie = sameOrigin && event.request.method === 'POST' && AUTH_COOKIE_ROUTES.includes(url.pathname);
    const responded = (authCookie ? settleAuthSerially(event.request) : fetch(event.request)).then(
      (res) => {
        if (unbound && res.status === 503 && event.clientId) {
          // Still within respondWith's pending promise, so extending the event's lifetime is allowed.
          event.waitUntil(res.clone().json().then((body) => {
            if (body && body.code === 'client_upgrade_required') return reloadOutdatedClient(event.clientId);
            return undefined;
          }).catch(() => undefined));
        }
        return res;
      },
      () => caches.match(event.request)
    );
    event.respondWith(responded);
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
