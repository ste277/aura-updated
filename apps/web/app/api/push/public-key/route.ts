import { NextResponse } from 'next/server';
import { getWebPushPublicKey, isWebPushConfigured } from '../../../../lib/webPushServer';

/**
 * Web Push V1 -- the ONLY route that ever returns a VAPID key, and it
 * returns exclusively the PUBLIC one (brief section 8: "Only public key
 * may reach browser"). The client needs this as `applicationServerKey`
 * when calling `pushManager.subscribe()`. Deliberately unauthenticated --
 * a VAPID public key is not a secret (it's designed to be shared with any
 * browser subscribing to push), so gating it behind a session would add
 * friction with no real security benefit; only the PRIVATE key (never
 * returned by any route) needs protecting.
 */
export async function GET() {
  if (!isWebPushConfigured()) {
    return NextResponse.json({ error: 'Web Push is not configured on this deployment.' }, { status: 503 });
  }
  return NextResponse.json({ publicKey: getWebPushPublicKey() });
}
