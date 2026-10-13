import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import {
  getUserById,
  listGoalsForUser,
  listGoalActivitiesWithLinkedPlanStatusForGoals,
  loadGoalActivityRhythmFactsForActivities,
  listPlannedActivitiesForReporting,
} from '../../../../lib/db';
import { getDatePartsInTimezone } from '../../../../lib/timezone';
import { normalizeGoalActivityRhythm } from '../../../../lib/goalActivityRhythm';
import { buildGoalSummary, summarizePlanningStatus, classifyPlanningStatus } from '../../../../lib/insightsReporting';

const DEFAULT_RANGE_DAYS = 30;
// Insights V1 PR4 -- a bound on the ITEM-level "awaiting confirmation"
// list only (never on the Goals list itself, and never on the planning-
// status COUNTS, both of which are cheap aggregates with nothing to
// paginate). Stable ordering (most-recently-elapsed first) so a capped
// list is still a deterministic, sensible subset, never an arbitrary one.
const AWAITING_CONFIRMATION_ITEM_LIMIT = 20;

/** Parses an optional ISO date-only or full-instant query param into a
 * Date, or returns null for "not supplied" / invalid (the caller decides
 * the default/error). Never trusts an out-of-range or malformed value
 * silently -- an invalid supplied value is a 400, not a silent fallback. */
function parseDateParam(value: string | null): Date | null | 'INVALID' {
  if (value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'INVALID';
  return parsed;
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = new Date();
  const toParam = parseDateParam(req.nextUrl.searchParams.get('to'));
  const fromParam = parseDateParam(req.nextUrl.searchParams.get('from'));
  if (toParam === 'INVALID' || fromParam === 'INVALID') {
    return NextResponse.json({ error: 'from/to must be valid ISO dates.' }, { status: 400 });
  }
  const to = toParam ?? now;
  const from = fromParam ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: 'from must not be after to.' }, { status: 400 });
  }

  const todayLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;

  // ============================================================
  // Goal summaries -- ownership-scoped, batched across EVERY Goal in
  // exactly two queries total (Goals, then every GoalActivity for all of
  // them in one call), plus ONE batched Rhythm-facts query across every
  // N_PER_WEEK activity found -- never one query per Goal or per
  // activity. Reuses listGoalActivitiesWithLinkedPlanStatusForGoals
  // (db.ts) and loadGoalActivityRhythmFactsForActivities (already
  // shipped, R4) exactly as apps/web/app/api/goals/[goalId]/route.ts
  // already does for one Goal.
  // ============================================================
  const goals = await listGoalsForUser(session.userId, 'ACTIVE');
  const rows = await listGoalActivitiesWithLinkedPlanStatusForGoals(session.userId, goals.map((g) => g.id));
  const rhythmActivityIds = rows.filter((row) => normalizeGoalActivityRhythm(row).kind === 'N_PER_WEEK').map((row) => row.id);
  const factsByActivityId = await loadGoalActivityRhythmFactsForActivities(session.userId, rhythmActivityIds, user.timezone);

  const rowsByGoalId = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = rowsByGoalId.get(row.goalId);
    if (existing) existing.push(row);
    else rowsByGoalId.set(row.goalId, [row]);
  }
  // Do not silently truncate Goals -- every ACTIVE Goal gets a summary,
  // including one with zero activities (classifyGoalKind's own 'EMPTY' case).
  const goalSummaries = goals.map((goal) => buildGoalSummary(goal, rowsByGoalId.get(goal.id) ?? [], factsByActivityId, todayLocalDate));

  // ============================================================
  // Planning status summary -- every non-deleted PlannedActivity in the
  // requested range, one query, classified entirely by the pure
  // classifyPlanningStatus/summarizePlanningStatus (insightsReporting.ts).
  // ============================================================
  const plans = await listPlannedActivitiesForReporting(session.userId, from, to);
  const planningStatus = summarizePlanningStatus(plans, now);

  const awaitingConfirmationItems = plans
    .filter((plan) => classifyPlanningStatus(plan, now) === 'AWAITING_CONFIRMATION')
    .sort((a, b) => new Date(b.plannedStartAt).getTime() - new Date(a.plannedStartAt).getTime())
    .slice(0, AWAITING_CONFIRMATION_ITEM_LIMIT)
    .map((plan) => ({ id: plan.id, title: plan.title, plannedStartAt: plan.plannedStartAt, plannedEndAt: plan.plannedEndAt }));

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    goals: goalSummaries,
    planningStatus,
    awaitingConfirmation: {
      count: planningStatus.awaitingConfirmation,
      items: awaitingConfirmationItems,
      truncated: planningStatus.awaitingConfirmation > awaitingConfirmationItems.length,
    },
    // Insights V1 PR4 -- a disclosed-limitations note, populated only
    // when it actually applies (never a permanent fixture of the
    // response, per the architecture audit's own section 7/10). For now,
    // this surfaces only the one limitation this endpoint can actually
    // detect cheaply from data it already has: whether the requested
    // range extends before the account's own creation (so "no activity"
    // there is a real absence of history, not evidence of inactivity).
    limitations: from.getTime() < new Date(user.createdAt).getTime()
      ? ['Some of the requested range is before this account existed -- there is nothing to report for that period.']
      : [],
  });
}
