import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createPlannedActivity, listPlannedActivities, getPlannedActivityForOwner, getGuestConversionRedemption, claimGuestConversionToken, fillGuestConversionRedemption, getPlanCreationClaim, claimPlanCreation, fillPlanCreationClaim } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { verifyGuestStateToken, hashGuestConversionToken } from '../../../lib/guestState';
import { parseEventLocationSnapshot } from '../../../lib/plansRequest';

const MIN_PLAN_DURATION_MINUTES = 15;
const MAX_PLAN_DURATION_MINUTES = 360;
const DURATION_TOLERANCE_MINUTES = 1;
const VALID_MATCH_LABELS = new Set(['Best Match', 'Good Match']);
const VALID_WINDOW_TYPES = new Set(['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL']);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseScore(value: unknown): number | null {
  if (value == null) return null;
  const score = Math.round(Number(value));
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return score;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function parseMatchLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return VALID_MATCH_LABELS.has(trimmed) ? trimmed : '';
}

function parseWindowType(value: unknown): string {
  if (value == null) return 'NEUTRAL';
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toUpperCase();
  return VALID_WINDOW_TYPES.has(trimmed) ? trimmed : '';
}

/** E2E Journey Coverage V1.1 (brief section 4) -- a short, bounded poll
 * for the guest-conversion claim's WINNER to finish
 * createPlannedActivity + fillGuestConversionRedemption, closing the real
 * race a single immediate re-check missed. Five checks, 100ms apart
 * (~500ms worst case, far under any request timeout) -- deliberately not
 * a distributed lock, just enough real time for a genuinely fast concurrent
 * write to land. */
async function awaitGuestConversionFill(tokenHash: string, userId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const redemption = await getGuestConversionRedemption(tokenHash);
    if (redemption?.plannedActivityId) {
      const plan = await getPlannedActivityForOwner(userId, redemption.plannedActivityId);
      if (plan) return plan;
    }
  }
  return null;
}

/** Intentional Day Builder V1 (brief section 20) -- the same bounded poll
 * as awaitGuestConversionFill above, applied to the plan-creation claim
 * table instead of the guest-conversion one. See that function's own doc
 * comment for why a short bounded wait (not a distributed lock) is the
 * right amount of rigor for a single fast synchronous INSERT. */
async function awaitPlanCreationFill(clientRequestId: string, userId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const claim = await getPlanCreationClaim(userId, clientRequestId);
    if (claim?.plannedActivityId) {
      const plan = await getPlannedActivityForOwner(userId, claim.plannedActivityId);
      if (plan) return plan;
    }
  }
  return null;
}

const MAX_CLIENT_REQUEST_ID_LENGTH = 200;

function parseCalendarUrl(value: unknown): string | null {
  const trimmed = cleanString(value, 2000);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname === 'calendar.google.com' && url.pathname === '/calendar/render'
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

// Event Location Plan Persistence V1: `parseEventLocationSnapshot` moved to
// lib/plansRequest.ts (imported above) -- Next's route modules may only
// export HTTP handlers, and this needs to be unit-testable without a live
// server/DB, same reasoning as muhurthamSearchRequest.ts's own extraction.

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const plans = await listPlannedActivities(session.userId);
  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  // Recipient Conversion V1 Hardening (brief section 10) -- an OPTIONAL
  // idempotency key. Only the guest-conversion save path ever sends this;
  // every other caller (PlanWithAuraView, Muhurtham Finder, My Day) is
  // completely unaffected. Re-verified here (not just shape-checked) so an
  // arbitrary client string can never be used to manipulate the claim.
  const guestConversionToken = typeof body?.guestConversionToken === 'string' ? body.guestConversionToken : undefined;
  let guestConversionTokenHash: string | undefined;
  if (guestConversionToken) {
    if (!verifyGuestStateToken(guestConversionToken)) {
      return NextResponse.json({ error: 'That guest session is no longer valid.' }, { status: 400 });
    }
    guestConversionTokenHash = hashGuestConversionToken(guestConversionToken);

    const existing = await getGuestConversionRedemption(guestConversionTokenHash);
    if (existing?.plannedActivityId) {
      // Idempotent replay -- a double-click, a duplicate verification, a
      // refresh after a successful save, etc. Return the ALREADY-created
      // Plan rather than validating/creating a second one.
      const existingPlan = await getPlannedActivityForOwner(session.userId, existing.plannedActivityId);
      if (existingPlan) return NextResponse.json(existingPlan);
      // The referenced Plan is somehow gone -- fall through and create a
      // fresh one rather than returning a dead end.
    } else if (existing) {
      // E2E Journey Coverage V1.1 (brief section 4) -- someone else already
      // claimed this token but hasn't finished filling it in yet (a
      // concurrent request from the same code-entry/magic-link double-fire).
      // Wait for them rather than immediately creating a second Plan.
      const filled = await awaitGuestConversionFill(guestConversionTokenHash, session.userId);
      if (filled) return NextResponse.json(filled);
      // Still unfilled after the bounded wait -- an orphaned claim from a
      // genuinely failed prior attempt. Falls through and creates a fresh
      // Plan rather than blocking the user's save forever.
    } else {
      const claimed = await claimGuestConversionToken(guestConversionTokenHash, session.userId);
      if (!claimed) {
        // Lost a genuine sub-second race to a concurrent request from the
        // same user. Previously this checked ONCE immediately and gave up
        // -- under real concurrency the winner rarely finishes
        // createPlannedActivity + fillGuestConversionRedemption that fast,
        // so the loser almost always created its own duplicate Plan
        // (reproduced live: 5 simultaneous requests for one token produced
        // 3 distinct Plans). A short bounded wait for the winner closes
        // this without becoming a distributed lock.
        const filled = await awaitGuestConversionFill(guestConversionTokenHash, session.userId);
        if (filled) return NextResponse.json(filled);
      }
    }
  }

  // Intentional Day Builder V1 (brief section 20) -- a SECOND, independent
  // OPTIONAL idempotency key alongside guestConversionToken above (a
  // caller could in principle send either, never both -- Day Builder's
  // Add action is not part of the guest-conversion flow). Unlike a guest
  // token, a clientRequestId needs no signature verification: it carries
  // no claim of prior entitlement, it only deduplicates THIS authenticated
  // user's own repeated request (a double-tap, a duplicate render), so
  // ownership is already guaranteed by session.userId.
  const clientRequestId = typeof body?.clientRequestId === 'string' ? body.clientRequestId.trim() : undefined;
  if (clientRequestId && clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return NextResponse.json({ error: `clientRequestId must be ${MAX_CLIENT_REQUEST_ID_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (clientRequestId) {
    const existing = await getPlanCreationClaim(session.userId, clientRequestId);
    if (existing?.plannedActivityId) {
      const existingPlan = await getPlannedActivityForOwner(session.userId, existing.plannedActivityId);
      if (existingPlan) return NextResponse.json(existingPlan);
    } else if (existing) {
      const filled = await awaitPlanCreationFill(clientRequestId, session.userId);
      if (filled) return NextResponse.json(filled);
    } else {
      const claimed = await claimPlanCreation(session.userId, clientRequestId);
      if (!claimed) {
        const filled = await awaitPlanCreationFill(clientRequestId, session.userId);
        if (filled) return NextResponse.json(filled);
      }
    }
  }

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const plannedStartAt = parseDate(body?.plannedStartAt);
  const plannedEndAt = parseDate(body?.plannedEndAt);
  const durationMinutes = Number(body?.durationMinutes);
  const status = typeof body?.status === 'string' ? body.status : 'UPCOMING';
  const score = parseScore(body?.score);
  const activityType = cleanString(body?.activityType, 200) ?? title;
  const icon = cleanString(body?.icon, 40);
  const windowType = parseWindowType(body?.windowType);
  const windowLabel = cleanString(body?.windowLabel, 120);
  const matchLabel = parseMatchLabel(body?.matchLabel);
  const recommendation = cleanString(body?.recommendation, 2000);
  const calendarUrl = parseCalendarUrl(body?.calendarUrl);
  const eventLocationSnapshot = parseEventLocationSnapshot(body?.eventLocation);

  if (!title || title.length > 200) return NextResponse.json({ error: 'A title of up to 200 characters is required.' }, { status: 400 });
  if (!plannedStartAt || !plannedEndAt || plannedEndAt <= plannedStartAt) {
    return NextResponse.json({ error: 'Valid plannedStartAt and plannedEndAt values are required.' }, { status: 400 });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_PLAN_DURATION_MINUTES || durationMinutes > MAX_PLAN_DURATION_MINUTES) {
    return NextResponse.json({ error: `durationMinutes must be between ${MIN_PLAN_DURATION_MINUTES} and ${MAX_PLAN_DURATION_MINUTES}.` }, { status: 400 });
  }
  const timestampDurationMinutes = Math.round((plannedEndAt.getTime() - plannedStartAt.getTime()) / 60000);
  if (Math.abs(timestampDurationMinutes - durationMinutes) > DURATION_TOLERANCE_MINUTES) {
    return NextResponse.json({ error: 'durationMinutes must match the planned start and end times.' }, { status: 400 });
  }
  if (status !== 'UPCOMING') {
    return NextResponse.json({ error: 'New plans must be created as upcoming.' }, { status: 400 });
  }
  if (matchLabel === '') {
    return NextResponse.json({ error: 'matchLabel must be Best Match or Good Match.' }, { status: 400 });
  }
  if (!windowType) {
    return NextResponse.json({ error: 'windowType must be a known Panchang window type.' }, { status: 400 });
  }
  if (calendarUrl === '') {
    return NextResponse.json({ error: 'calendarUrl must be a Google Calendar render URL.' }, { status: 400 });
  }
  if (!eventLocationSnapshot.ok) {
    return NextResponse.json({ error: eventLocationSnapshot.error }, { status: 400 });
  }

  const plan = await createPlannedActivity({
    userId: session.userId,
    title,
    activityType,
    icon,
    plannedStartAt,
    plannedEndAt,
    durationMinutes,
    windowType,
    windowLabel,
    matchLabel,
    score,
    recommendation,
    calendarUrl,
    eventTimezone: eventLocationSnapshot.eventTimezone,
    eventLocationName: eventLocationSnapshot.eventLocationName,
  });

  if (guestConversionTokenHash) {
    await fillGuestConversionRedemption(guestConversionTokenHash, plan.id);
  }
  if (clientRequestId) {
    await fillPlanCreationClaim(session.userId, clientRequestId, plan.id);
  }

  return NextResponse.json(plan);
}
