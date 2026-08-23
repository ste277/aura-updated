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
  | 'NOT_ASKED'
  | 'GRANTED'
  | 'DENIED'
  | 'SUBSCRIBED'
  | 'SUBSCRIPTION_ERROR';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Brief section 7: "Do not show 'Notifications enabled' merely because
 * Notification.permission === 'granted'. A valid active server-stored
 * PushSubscription must exist." -- this checks BOTH the browser's own
 * permission/subscription state AND the server's record (they can
 * disagree, e.g. the server disabled a subscription after a provider 410
 * while the browser's local PushManager object is still technically
 * present).
 */
export async function getPushCapabilityState(): Promise<PushCapabilityState> {
  if (!isPushSupported()) return 'UNSUPPORTED';
  if (Notification.permission === 'denied') return 'DENIED';
  if (Notification.permission === 'default') return 'NOT_ASKED';

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return 'GRANTED';

    const res = await fetch('/api/push-subscriptions');
    if (!res.ok) return 'GRANTED';
    const { hasActiveSubscription } = await res.json();
    return hasActiveSubscription ? 'SUBSCRIBED' : 'GRANTED';
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
export async function subscribeToPush(): Promise<SubscribeOutcome> {
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

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
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
    const registration = await navigator.serviceWorker.ready;
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
