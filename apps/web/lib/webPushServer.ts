import webpush from 'web-push';

/**
 * Web Push V1 -- the ONLY module that touches the `web-push` library
 * directly (VAPID setup + the actual send call). Kept separate from
 * reminderDelivery.ts's orchestration so the "how do we physically send a
 * push" concern never mixes with "which occurrence is eligible to be
 * sent" (brief section 16: "Do not recalculate reminder eligibility
 * here").
 *
 * VAPID (brief section 8): standard Web Push authentication. Only the
 * PUBLIC key ever reaches the browser (see app/api/push/public-key/route.ts);
 * the private key is read from env here and never returned by any route.
 * Configuration is read lazily (not at module load) so a missing secret
 * fails the specific request that needed it, not the whole server process
 * -- consistent with this app's other env-gated features (e.g.
 * RESEND_API_KEY for magic-link email) rather than crashing startup.
 */

let vapidConfigured = false;

function configureVapid(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Web Push is not configured: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT must all be set.');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/** Cheap capability check for routes that need to fail clean before doing
 * any real work (brief section 8: "Fail startup/request cleanly if
 * required server secrets are missing"). */
export function isWebPushConfigured(): boolean {
  return Boolean(process.env.WEB_PUSH_VAPID_PUBLIC_KEY && process.env.WEB_PUSH_VAPID_PRIVATE_KEY && process.env.WEB_PUSH_VAPID_SUBJECT);
}

/** The PUBLIC key only -- safe to send to the browser (subscribe() needs
 * it as applicationServerKey). Never returns the private key. */
export function getWebPushPublicKey(): string | null {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? null;
}

export interface WebPushSendResult {
  ok: boolean;
  /** True for a provider 404/410 -- the subscription is gone and must be
   * disabled, never retried (brief section 18). */
  isGone: boolean;
  /** A short, safe-to-store failure code -- never the raw provider
   * response body (brief section 19/23: "Do not store huge provider
   * response payloads"). */
  errorCode?: string;
}

export async function sendWebPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: unknown
): Promise<WebPushSendResult> {
  try {
    configureVapid();
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return { ok: true, isGone: false };
  } catch (err) {
    const statusCode = (err as { statusCode?: number } | null)?.statusCode;
    const isGone = statusCode === 404 || statusCode === 410;
    const errorCode = statusCode
      ? `http_${statusCode}`
      : err instanceof Error && err.message.startsWith('Web Push is not configured')
        ? 'not_configured'
        : 'send_error';
    return { ok: false, isGone, errorCode };
  }
}
