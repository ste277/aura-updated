import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { disablePushSubscriptionForOwner, hasActivePushSubscription, upsertPushSubscription } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';

/**
 * Web Push V1 (brief section 5) -- REGISTER/UPSERT and REMOVE for browser
 * push subscriptions. Both authenticated only; never accepts an
 * unauthenticated registration (brief: "Never allow unauthenticated
 * subscription registration"). Ownership is implicit -- a subscription
 * always belongs to whichever session registered it (upsertPushSubscription
 * reassigns ownership to session.userId on every call, never to a
 * client-supplied userId).
 */

const MAX_ENDPOINT_LENGTH = 2000;
const MAX_KEY_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 300;

function isValidEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ENDPOINT_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH;
}

/** Brief section 5/7 -- the authoritative "does the SERVER currently have
 * an active subscription for this owner" check (never inferred purely from
 * client-side Notification.permission/PushManager state). */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const hasActiveSubscription = await hasActivePushSubscription(session.userId);
  return NextResponse.json({ hasActiveSubscription });
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  // Accepts the browser's own PushSubscriptionJSON shape
  // ({ endpoint, keys: { p256dh, auth } }) -- never a flattened/renamed
  // shape invented by this route, so the client can pass
  // subscription.toJSON() through with no reshaping.
  const endpoint = body.endpoint;
  const keys = body.keys && typeof body.keys === 'object' && !Array.isArray(body.keys) ? (body.keys as Record<string, unknown>) : {};
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  const userAgent = typeof body.userAgent === 'string' ? body.userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH) : null;

  if (!isValidEndpoint(endpoint)) {
    return NextResponse.json({ error: 'A valid https endpoint is required.' }, { status: 400 });
  }
  if (!isValidKey(p256dh) || !isValidKey(auth)) {
    return NextResponse.json({ error: 'Malformed subscription keys.' }, { status: 400 });
  }

  const subscription = await upsertPushSubscription({
    userId: session.userId,
    endpoint,
    p256dh,
    auth,
    userAgent,
  });

  // Never echo back p256dh/auth -- the client already has them (it just
  // sent them), and there's no reason to round-trip subscription secrets
  // through a response body.
  return NextResponse.json({ id: subscription.id, createdAt: subscription.createdAt });
}

export async function DELETE(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  const endpoint = body?.endpoint;
  if (!isValidEndpoint(endpoint)) {
    return NextResponse.json({ error: 'A valid endpoint is required.' }, { status: 400 });
  }

  await disablePushSubscriptionForOwner(session.userId, endpoint);
  return NextResponse.json({ ok: true });
}
