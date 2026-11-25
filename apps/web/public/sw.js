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
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== STATE_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      // R5: pages of the current bundle re-announce themselves to this (new) worker.
      .then(() => queryAllClients())
  );
});

// AURA-ANDROID-REL-04 (R4, R5) -- compatibility bridge for pages loaded BEFORE
// the account boundary (old bundles cannot be changed; this worker controls
// them once the browser has fetched this version -- on the next navigation in
// the origin -- and skipWaiting + clients.claim apply it to open pages).
//  1. Refresh path (A-1/A-2): an /api request WITHOUT X-Aura-Expected-Account
//     that the server refuses with 503 client_upgrade_required came from an
//     out-of-date page, which is reloaded into the current bundle
//     (?aura_reloaded=upgrade lets the new page say so) -- e.g. an old page's
//     refused sign-out no longer leaves a false "signed out" screen.
//     R5 lifecycle: before reloading, the worker ASKS that page whether it is
//     a current-bundle page (current pages answer; old pages cannot), so the
//     decision survives a worker restart. Known current pages and the reload
//     guards are also persisted in Cache Storage (STATE_CACHE), and automatic
//     reloads are rate-limited origin-wide, so restarts cannot produce a
//     reload loop. A failed navigation is not retried.
//  2. Cookie settlement (A-3): sign-in and sign-out requests from every page
//     this worker controls are sent one at a time. R5: the wait is measured
//     from when the previous request was actually SENT; if it has still not
//     settled after AUTH_SETTLE_TIMEOUT_MS, the next request is NOT sent out
//     of order -- it is answered 503 auth_transition_unsettled (the page then
//     reconciles with a fresh session read; nothing is reported as completed).
// NOT covered (activation blockers A-1..A-3 stay open for these): pages this
// worker does not control (service workers unavailable/disabled, hard reload,
// no navigation since the update), requests in flight in a worker being
// replaced, and any client outside this origin's worker. Server-side session
// revocation is AURA-AUTH-01; neither it nor this worker alone establishes
// complete mixed-version authentication safety.
const STATE_CACHE = 'aura-sw-state-v1';
const STATE_URL = '/__aura-sw-state__';
const ACCOUNT_HEADER = 'x-aura-expected-account';
const AUTH_COOKIE_ROUTES = ['/api/auth/logout', '/api/auth/verify-code'];
// Below every client-side auth timeout (sign-out 10 s, sign-in 15 s), so the page receives the
// explicit "still in progress" answer rather than timing out on its own.
const AUTH_SETTLE_TIMEOUT_MS = 8000;
const RELOAD_GUARD_MS = 30000;
const RELOAD_WINDOW_MS = 10 * 60 * 1000;
const RELOAD_WINDOW_MAX = 3;
const ANNOUNCE_WAIT_MS = 600;
const STATE_MAX_AGE_MS = 60 * 60 * 1000;
let statePromise = null;

function emptyState() { return { boundary: {}, reloaded: {}, reloads: [], navigateFailed: 0 }; }
function loadState() {
  if (!statePromise) {
    statePromise = caches.open(STATE_CACHE)
      .then((c) => c.match(STATE_URL))
      .then((r) => (r ? r.json() : emptyState()))
      .catch(() => emptyState())
      .then((st) => { void queryAllClients(); return Object.assign(emptyState(), st); }); // first use after a (re)start
  }
  return statePromise;
}
async function saveState(st) {
  const now = Date.now();
  for (const k of Object.keys(st.boundary)) if (now - st.boundary[k] > STATE_MAX_AGE_MS) delete st.boundary[k];
  for (const k of Object.keys(st.reloaded)) if (now - st.reloaded[k] > STATE_MAX_AGE_MS) delete st.reloaded[k];
  st.reloads = st.reloads.filter((t) => now - t < RELOAD_WINDOW_MS);
  try { await (await caches.open(STATE_CACHE)).put(STATE_URL, new Response(JSON.stringify(st), { headers: { 'content-type': 'application/json' } })); } catch (err) { /* in-memory state still applies */ }
}
// R6: every read-check-write of the persisted state runs in ONE serialized step, so concurrent
// recovery checks cannot both pass a stale guard read (atomic reservation within this worker).
let stateLock = Promise.resolve();
function withState(fn) {
  const run = stateLock.then(async () => { const st = await loadState(); const out = await fn(st); await saveState(st); return out; });
  stateLock = run.then(() => undefined, () => undefined);
  return run;
}
async function queryAllClients() {
  try {
    const all = await self.clients.matchAll({ type: 'window' });
    for (const c of all) c.postMessage({ type: 'AURA_BOUNDARY_QUERY' });
  } catch (err) { /* ignore */ }
}

// R6: pending "are you current?" checks, per page; EVERY check for a page is answered by that
// page's acknowledgement (a nonce ties a reply to its query; any announcement from the page proves it current).
const pendingChecks = new Map(); // clientId -> Map<nonce, resolve>
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'AURA_ACCOUNT_BOUNDARY' || !event.source || !event.source.id) return;
  const id = event.source.id;
  const waiting = pendingChecks.get(id);
  if (waiting) { pendingChecks.delete(id); for (const resolve of waiting.values()) resolve(true); }
  event.waitUntil(withState((st) => { st.boundary[id] = Date.now(); }));
});

/** Asks one page whether it runs the current bundle; true when it answers in time. */
function askCurrent(client) {
  return new Promise((resolve) => {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const forClient = pendingChecks.get(client.id) || new Map();
    pendingChecks.set(client.id, forClient);
    const done = (answer) => { clearTimeout(timer); forClient.delete(nonce); if (forClient.size === 0 && pendingChecks.get(client.id) === forClient) pendingChecks.delete(client.id); resolve(answer); };
    const timer = setTimeout(() => done(false), ANNOUNCE_WAIT_MS);
    forClient.set(nonce, () => done(true));
    try { client.postMessage({ type: 'AURA_BOUNDARY_QUERY', nonce }); } catch (err) { done(false); }
  });
}

let authInFlight = null; // { sentAt, settled }
function unsettledResponse() {
  return new Response(JSON.stringify({ error: 'Signing in or out is still in progress. Try again in a moment.', code: 'auth_transition_unsettled' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
async function settleAuthSerially(request) {
  while (authInFlight) {
    const cur = authInFlight;
    const remaining = Math.max(0, AUTH_SETTLE_TIMEOUT_MS - (Date.now() - cur.sentAt));
    const settled = await Promise.race([cur.settled.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), remaining))]);
    if (!settled) return unsettledResponse(); // never sent out of order behind an unsettled response
  }
  const run = fetch(request);
  const entry = { sentAt: Date.now(), settled: run.then(() => undefined, () => undefined) };
  authInFlight = entry;
  entry.settled.then(() => { if (authInFlight === entry) authInFlight = null; });
  return run;
}

// R6: concurrent refusals from one page share ONE recovery check (coalesced).
const recoveryInFlight = new Map(); // clientId -> Promise
function reloadOutdatedClient(clientId) {
  if (!clientId) return Promise.resolve();
  const existing = recoveryInFlight.get(clientId);
  if (existing) return existing;
  const p = recoverClient(clientId).finally(() => { if (recoveryInFlight.get(clientId) === p) recoveryInFlight.delete(clientId); });
  recoveryInFlight.set(clientId, p);
  return p;
}

const eligible = (st, clientId, now) => !st.boundary[clientId] && now - (st.reloaded[clientId] || 0) >= RELOAD_GUARD_MS;

async function recoverClient(clientId) {
  if (!eligible(await loadState(), clientId, Date.now())) return;
  const client = await self.clients.get(clientId);
  if (!client || client.type !== 'window' || typeof client.navigate !== 'function') return;
  const target = new URL(client.url);
  if (target.origin !== self.location.origin || target.searchParams.get('aura_reloaded') === 'upgrade') return;
  if (await askCurrent(client)) return; // a current-bundle page (e.g. its announcement was lost with a restart)
  // Re-check eligibility and reserve the reload in one serialized step (origin-wide limit, persisted).
  const reserved = await withState((st) => {
    const now = Date.now();
    if (!eligible(st, clientId, now)) return false;
    st.reloads = st.reloads.filter((t) => now - t < RELOAD_WINDOW_MS);
    if (st.reloads.length >= RELOAD_WINDOW_MAX) return false; // origin-wide loop protection
    st.reloaded[clientId] = now;
    st.reloads.push(now);
    return true;
  });
  if (!reserved) return;
  target.searchParams.set('aura_reloaded', 'upgrade');
  try { await client.navigate(target.toString()); } catch (err) { await withState((st) => { st.navigateFailed += 1; }); }
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
