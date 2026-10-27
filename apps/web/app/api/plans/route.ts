import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { DIRECT_PLAN_SCHEDULING_MODE } from '../../../lib/plannedActivitySchedulingMode';
import { beginTransaction, createPlannedActivity, listPlannedActivities, getPlannedActivityForOwner, getGuestConversionRedemption, claimGuestConversionToken, fillGuestConversionRedemption, getPlanCreationClaim, claimPlanCreation, fillPlanCreationClaim, linkGoalActivityToPlannedActivity, lockGoalParentLifecycleForPlanning } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { verifyGuestStateToken, hashGuestConversionToken } from '../../../lib/guestState';
import { parseEventLocationSnapshot } from '../../../lib/plansRequest';
import { getActivityProfileById } from '../../../../../packages/recommendation/src/personalizedTasks';

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

  // Planned Activity Canonical Identity Propagation V1 -- activityId is
  // UNTRUSTED client input, optional. Absent/null/empty -> persist NULL
  // (the legitimate, expected value for free-text/custom Plans -- never
  // treated as an error). Present -> must resolve to a REAL, current
  // FULL_ACTIVITY_CATALOG entry via an exact-id lookup (no alias/title/
  // fuzzy matching); an unknown id is rejected outright rather than
  // silently dropped to NULL or persisted unvalidated. `title` is NEVER
  // required to match the resolved activity's own catalog title -- a Plan's
  // title is what the user specifically intends to do; activityId is only
  // what KIND of activity it is (same discipline as C2's HabitLog.activityId,
  // apps/web/app/api/habit-logs/route.ts).
  const activityId = body?.activityId;
  let validatedActivityId: string | null = null;
  if (typeof activityId === 'string' && activityId.trim()) {
    const activity = getActivityProfileById(activityId.trim());
    if (!activity) {
      return NextResponse.json({ error: 'Unknown activity.' }, { status: 400 });
    }
    validatedActivityId = activity.id;
  }

  // HPG2 -- goalActivityId is UNTRUSTED client input, optional, and a
  // COMPLETELY SEPARATE identity space from activityId above: activityId
  // is a static, non-user-scoped catalog entry (packages/recommendation/
  // src/personalizedTasks.ts, no ownership concept at all); goalActivityId
  // is a real, per-user-owned "GoalActivity" database row. The two are
  // never interchangeable and this route never treats one as the other.
  // Only a well-formed string is accepted here -- the actual
  // existence/ownership/eligibility check happens atomically, inside the
  // transaction below, via the SAME linkGoalActivityToPlannedActivity this
  // app's Day Constructor acceptance path already relies on (db.ts) --
  // never a separate pre-check (that would be a TOCTOU race) and never by
  // matching this request's own `title` against any GoalActivity's title.
  const goalActivityId = typeof body?.goalActivityId === 'string' && body.goalActivityId.trim() ? body.goalActivityId.trim() : null;

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

  // Schedule write consistency S2 -- this ordinary/manual writer takes the SAME per-user, transaction-scoped advisory
  // lock Constructor acceptance, Move and Recomposition acceptance take, and inserts inside that transaction, so a manual
  // write and an Aura automatic write for one user cannot make their write decisions concurrently. The lock only
  // SERIALIZES writers: no overlap check is added here, and an explicit manual overlap stays allowed. The lock identity is
  // the authenticated session's user, never anything the request supplies; it is released automatically at COMMIT/ROLLBACK.
  const client = await beginTransaction();
  let plan: Awaited<ReturnType<typeof createPlannedActivity>>;
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day-constructor-accept:${session.userId}`]);
    plan = await createPlannedActivity({
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
      activityId: validatedActivityId,
      // F1: a direct plan is an explicit exact-time choice made outside the Constructor's flexible-placement flow.
      // Server constant, never read from the request body -- a client cannot grant recomposition permission.
      schedulingMode: DIRECT_PLAN_SCHEDULING_MODE,
    }, client);
    // HPG2 -- same transaction, same client, immediately after the Plan
    // insert that just happened: the exact pattern Day Constructor
    // acceptance already uses (dayConstructorAcceptancePersistence.ts).
    // linkGoalActivityToPlannedActivity itself enforces ownership
    // (userId), non-DISMISSED, and the established eligibility rule
    // (currently unlinked, or linked only to a CANCELLED/SKIPPED plan) --
    // one atomic conditional UPDATE, no separate check-then-act. `false`
    // means the id doesn't exist, isn't this user's, is DISMISSED, or
    // already retains a live link to a DIFFERENT plan -- this fails the
    // WHOLE request closed (no orphan, unlinked PlannedActivity silently
    // created instead of the Goal-linked one the caller explicitly asked
    // for) rather than silently degrading to an ordinary plan.
    //
    // Deliberately NOT wired to materializeGoalActivityRhythmOccurrence
    // (db.ts) here: that Rhythm-aware path is unreachable today (no
    // production GoalActivity has rhythmKind set yet -- HPG0 audit,
    // confirmed again during HPG2), and wiring it prematurely would pull
    // Rhythm-specific mechanics into what HPG2 scopes as plain Goal
    // association for ordinary plan creation. Revisit this call site
    // alongside whichever ticket first ships a Rhythm-creating UI.
    if (goalActivityId) {
      // HPG2 P0 fix -- Goal LIFECYCLE authorization, the same boundary Day
      // Constructor acceptance already enforces (dayConstructorAcceptancePersistence.ts,
      // lockGoalParentLifecycleForPlanning's own doc comment, db.ts): archiving
      // a Goal revokes its authority to produce NEW Goal-derived planning
      // state, so this must be checked -- on the SAME transaction client,
      // taking the SAME `FOR SHARE OF g` lock -- before the link write below,
      // not just left to linkGoalActivityToPlannedActivity's own WHERE clause
      // (which only ever looks at the GoalActivity row, never its parent
      // Goal). A GoalActivity this user doesn't own is simply absent from
      // `owned` -- unaffected, falls through to the existing fail-closed
      // ownership rejection at the link call below, exactly as before.
      const lifecycle = await lockGoalParentLifecycleForPlanning(session.userId, [goalActivityId], client);
      if (lifecycle.owned.has(goalActivityId) && !lifecycle.active.has(goalActivityId)) {
        throw new Error('GOAL_NOT_ACTIVE');
      }
      const linked = await linkGoalActivityToPlannedActivity(session.userId, goalActivityId, plan.id, client);
      if (!linked) throw new Error('GOAL_ACTIVITY_LINK_FAILED');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof Error && err.message === 'GOAL_NOT_ACTIVE') {
      return NextResponse.json({ error: 'That goal is no longer active, so a new plan cannot be linked to it.' }, { status: 400 });
    }
    if (err instanceof Error && err.message === 'GOAL_ACTIVITY_LINK_FAILED') {
      return NextResponse.json({ error: 'That goal activity is not available to link right now.' }, { status: 400 });
    }
    throw err;
  } finally {
    client.release();
  }

  if (guestConversionTokenHash) {
    await fillGuestConversionRedemption(guestConversionTokenHash, plan.id);
  }
  if (clientRequestId) {
    await fillPlanCreationClaim(session.userId, clientRequestId, plan.id);
  }

  return NextResponse.json(plan);
}
