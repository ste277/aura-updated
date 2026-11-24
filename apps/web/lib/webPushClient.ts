'use client';

/**
 * Web Push V1 -- client-side subscribe/unsubscribe helpers. Nothing here
 * ever runs automatically on page load (brief section 6: "Do NOT call
 * Notification.requestPermission() on page load") -- every exported
 * function is only ever invoked from an explicit user action (the
 * "Enable notifications" / "Turn off" buttons in
 * components/DeviceNotificationSettings.tsx).
 */

export type PushCapabilityState =
  | 'UNSUPPORTED'
  /** AURA-REM-01: iPhone/iPad Safari tab -- Web Push needs Aura added to
   * the Home Screen and opened from there. */
  | 'IOS_INSTALL_REQUIRED'
  /** AURA-REM-01: the deployment has no Web Push keys -- nothing to enable. */
  | 'NOT_CONFIGURED'
  | 'NOT_ASKED'
  | 'GRANTED'
  | 'DENIED'
  | 'SUBSCRIBED'
  /** AURA-REM-01: this device is subscribed, but the server's scheduler has
   * not run recently, so reminders can't reach a closed app yet. Never shown
   * as "on". */
  | 'BACKGROUND_UNAVAILABLE'
  /** AURA-REM-01: the browser still holds a subscription the server no
   * longer accepts (provider said it expired, or it was removed) -- the next
   * enable replaces it instead of re-sending the dead one. */
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_ERROR';

export type ServerBackgroundDelivery = 'AVAILABLE' | 'NOT_CONFIGURED' | 'SCHEDULER_INACTIVE';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isNativeShell(): boolean {
  const cap = typeof window !== 'undefined' ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor : undefined;
  return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

/** iPhone/iPad in a normal Safari tab (not the installed Home Screen app). */
export function isIosBrowserTab(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1);
  if (!isIos) return false;
  const standalone =
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return !standalone;
}

/** AURA-REM-01: navigator.serviceWorker.ready never settles when the service
 * worker failed to register (or isn't registered, as in `next dev`), which
 * used to leave the notification settings blank forever. Bounded instead. */
const SERVICE_WORKER_READY_TIMEOUT_MS = 5000;
function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service_worker_not_ready')), SERVICE_WORKER_READY_TIMEOUT_MS);
    navigator.serviceWorker.ready.then(
      (registration) => { clearTimeout(timer); resolve(registration); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function fetchServerPushStatus(): Promise<{ hasActiveSubscription: boolean; backgroundDelivery: ServerBackgroundDelivery | null } | null> {
  try {
    const res = await fetch('/api/push-subscriptions');
    if (!res.ok) return null;
    const body = await res.json();
    const delivery = body?.backgroundDelivery;
    return {
      hasActiveSubscription: body?.hasActiveSubscription === true,
      backgroundDelivery: delivery === 'AVAILABLE' || delivery === 'NOT_CONFIGURED' || delivery === 'SCHEDULER_INACTIVE' ? delivery : null,
    };
  } catch {
    return null;
  }
}

/**
 * Brief section 7: "Do not show 'Notifications enabled' merely because
 * Notification.permission === 'granted'. A valid active server-stored
 * PushSubscription must exist." -- this checks BOTH the browser's own
 * permission/subscription state AND the server's record (they can
 * disagree, e.g. the server disabled a subscription after a provider 410
 * while the browser's local PushManager object is still technically
 * present).
 *
 * AURA-REM-01: also requires the server's background delivery to be
 * running before reporting SUBSCRIBED. Never prompts.
 */
export async function getPushCapabilityState(): Promise<PushCapabilityState> {
  if (!isPushSupported() || isNativeShell()) {
    return !isNativeShell() && isIosBrowserTab() ? 'IOS_INSTALL_REQUIRED' : 'UNSUPPORTED';
  }
  if (Notification.permission === 'denied') return 'DENIED';

  const server = await fetchServerPushStatus();
  if (server?.backgroundDelivery === 'NOT_CONFIGURED') return 'NOT_CONFIGURED';
  if (Notification.permission === 'default') return 'NOT_ASKED';

  try {
    const registration = await serviceWorkerReady();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return 'GRANTED';
    if (!server) return 'GRANTED';
    if (!server.hasActiveSubscription) return 'SUBSCRIPTION_EXPIRED';
    return server.backgroundDelivery === 'AVAILABLE' ? 'SUBSCRIBED' : 'BACKGROUND_UNAVAILABLE';
  } catch {
    return 'GRANTED';
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
  return output;
}

export type SubscribeOutcome =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'permission_denied' | 'not_configured' | 'server_error' | 'subscription_error' };

/**
 * Requests permission (if not already resolved) then subscribes via the
 * service worker and registers the subscription server-side. Called ONLY
 * from the "Enable notifications" button's onClick -- never automatically.
 */
export async function subscribeToPush(options: { replaceExisting?: boolean } = {}): Promise<SubscribeOutcome> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  // Notification.permission is already 'granted' or 'default' by the time
  // this runs (the caller only offers this button in those states) --
  // calling requestPermission() when already 'granted' is a harmless no-op
  // (no second prompt), and when 'default' this IS the one deliberate,
  // user-initiated prompt this feature is allowed to trigger.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission_denied' };

  try {
    const keyRes = await fetch('/api/push/public-key');
    if (!keyRes.ok) return { ok: false, reason: 'not_configured' };
    const { publicKey } = await keyRes.json();
    if (!publicKey) return { ok: false, reason: 'not_configured' };

    const registration = await serviceWorkerReady();
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && options.replaceExisting) {
      // AURA-REM-01: the server rejected this subscription (expired/invalid).
      // Re-registering the same dead endpoint would look enabled and never
      // deliver, so drop it and create a fresh one.
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }

    const json = subscription.toJSON();
    const res = await fetch('/api/push-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
    });
    if (!res.ok) return { ok: false, reason: 'server_error' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'subscription_error' };
  }
}

/** Unsubscribes the browser's own PushManager subscription AND disables the
 * server-side record (brief section 28) -- never touches remindersEnabled
 * or the in-app Bell/Upcoming reminders, which are a separate concept. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await serviceWorkerReady();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    await fetch('/api/push-subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  } catch {
    // Best-effort -- if the browser-side unsubscribe fails, the server
    // record staying active just means a future push attempt to a now-dead
    // endpoint, which the delivery service already handles safely (brief
    // section 18: disables on a provider 404/410).
  }
}
