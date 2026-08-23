import { NextRequest, NextResponse } from 'next/server';
import { dispatchDueReminderPushes } from '../../../../../lib/reminderDelivery';

/**
 * Web Push V1 (brief section 19/32) -- the scheduler's trigger point.
 * Not a page, an internal API, gated by a shared secret compared in the
 * Authorization header, fail-closed like /api/internal/product-metrics
 * (this codebase's own existing internal-endpoint convention) -- a
 * missing/mismatched secret returns 404, not 401, so the route's existence
 * isn't revealed to an unauthenticated prober.
 *
 * Accepts `Authorization: Bearer <secret>` specifically because that is
 * Vercel's OWN documented convention for protecting Cron Jobs (set
 * CRON_SECRET in the Vercel dashboard's Cron Jobs settings to the same
 * value as INTERNAL_REMINDER_DISPATCH_SECRET here, and Vercel sends it
 * automatically on every scheduled invocation -- no custom header wiring
 * needed). An external scheduler (cron-job.org, a GitHub Actions
 * scheduled workflow, etc.) can send the identical header manually.
 *
 * Does NOT recalculate reminder eligibility, does NOT reimplement
 * deriveAuraReminders() -- see lib/reminderDelivery.ts's
 * dispatchDueReminderPushes(), which is the entire body of this route.
 */

export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_REMINDER_DISPATCH_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const startedAt = Date.now();
  const result = await dispatchDueReminderPushes(new Date());
  const durationMs = Date.now() - startedAt;

  // Brief section 48: the exact counts a performance report needs, plus
  // total wall-clock duration -- no Panchang/Muhurtham/Timing
  // Search/natal computation happens anywhere in this path.
  return NextResponse.json({ ...result, durationMs });
}

// Vercel Cron Jobs invoke via GET by default; support both so the same
// secret check protects whichever method the scheduler actually uses.
export async function GET(req: NextRequest) {
  return POST(req);
}
