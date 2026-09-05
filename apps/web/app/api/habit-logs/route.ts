import { NextRequest, NextResponse } from 'next/server';
import { createHabitLog, getUserById, listHabitLogsForInsights, INSIGHTS_HISTORY_DAYS } from '../../../lib/db';
import { getSessionFromRequest } from '../../../lib/session';
import { parseJsonObject } from '../../../lib/request';
import { resolveHistoricalActiveWindow } from '../../../lib/historicalActivityWindow';
import { getMinuteOfDayInTimezone } from '../../../lib/timezone';

function parseLogSource(value: unknown): 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION' {
  if (value === 'AURA_PLANNED' || value === 'AURA_DO_NOW' || value === 'MANUAL' || value === 'OVERRIDE_CAUTION') return value;
  return 'MANUAL';
}

function parseActivitySignificance(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') return value;
  return 'MEDIUM';
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const { activityTitle, logTimestamp, notes, durationMinutes, logSource, activitySignificance } = body;
  const cleanTitle = typeof activityTitle === 'string' ? activityTitle.trim() : '';

  if (!cleanTitle) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }

  // Parse custom timestamp if provided, fallback to current time
  const customDate = typeof logTimestamp === 'string' ? new Date(logTimestamp) : new Date();
  if (Number.isNaN(customDate.getTime())) {
    return NextResponse.json({ error: 'logTimestamp must be a valid date.' }, { status: 400 });
  }

  // Insights Correctness + Historical Integrity V1 -- activeWindow is now
  // ALWAYS computed server-side from this log's own timestamp and the
  // owner's Timing Location, never accepted from the client. Previously a
  // client-supplied `activeWindow` was trusted as-is; a backdated entry
  // (PastActivityModal.tsx) either fell back to today's live window
  // (activeType, via the wired onConfirmLog path) or a hardcoded 'NEUTRAL'
  // (the unused direct-fetch fallback path) -- both wrong for a genuinely
  // past instant. This single server-side computation fixes both, and
  // removes any possibility of client/server skew for live entries too.
  // Uses ONLY the owner's Timing Location (never Birth Location, Event
  // Location, or SavedPerson/SHARED context) -- an ordinary owner activity
  // log.
  const activeWindow = resolveHistoricalActiveWindow(customDate, user.latitude, user.longitude, user.timezone);

  // Insights Timezone Consistency V1 -- logMinuteOfDay is now ALSO ALWAYS
  // computed server-side, from the exact SAME logTimestamp + owner Timing
  // Location used for activeWindow above, mirroring PR #75's
  // server-authoritative pattern. Previously the client computed this
  // value itself (page.tsx: browser-local `targetDate.getHours()*60+
  // getMinutes()`) and the server trusted it as-is -- an inconsistent
  // provenance (correct for logPlannedActivity's own server-side path via
  // getMinuteOfDayInTimezone, but browser-local here) the prior audit
  // flagged. A client-submitted `logMinuteOfDay`, if present in the
  // request body, is no longer read or required at all.
  const logMinuteOfDay = getMinuteOfDayInTimezone(user.timezone, customDate);

  const entry = await createHabitLog({
    userId: session.userId,
    activityTitle: cleanTitle,
    activeWindow,
    logMinuteOfDay,
    logTimestamp: customDate,
    // Good Right Now Action Semantics V1: the floor used to be 5, silently
    // bumping any near-zero submission up -- that made it impossible to
    // ever log a genuinely INSTANT activity (a hydration check) without
    // manufacturing a fake few minutes of "effort" (brief section 1/4).
    // 0 is now a legitimate, real value: instantaneous activities log
    // exactly 0, not a placeholder. Insights/streak calculations were
    // audited (brief section 1/13) and already treat durationMinutes as
    // real elapsed effort ONLY where a nullish-coalescing default (?? 30)
    // is applied -- 0 passes through those unchanged (nullish coalescing
    // only substitutes for null/undefined, never 0), so this is a
    // backward-compatible floor change, not a new code path.
    durationMinutes: Math.min(180, Math.max(0, Number(durationMinutes ?? 30))),
    notes: notes ? String(notes).trim() : undefined,
    logSource: parseLogSource(logSource),
    activitySignificance: parseActivitySignificance(activitySignificance),
  });

  return NextResponse.json(entry);
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Insights Correctness + Historical Integrity V1 -- this is the ONLY
  // caller of this route (apps/web/app/page.tsx's client fetch, which
  // feeds InsightsView.tsx's own client-side analytics -- This Month, the
  // 7-day trend, the 30-day heatmap, the active logging streak -- as well
  // as loggedActivitiesToday/Timeline/HomeDashboard, which only ever
  // filter this same list down to a narrower window and are unaffected by
  // receiving more history). Switched from the row-count-capped
  // listHabitLogs() (LIMIT 50, deliberately left unmodified -- see its own
  // doc comment; apps/web/lib/myDayOrchestrator.ts calls that function
  // directly, not this route, and is unaffected by this change) to the
  // date-range listHabitLogsForInsights(), so a moderately active logger's
  // period-based Insights are no longer silently truncated.
  const sinceDate = new Date(Date.now() - INSIGHTS_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const entries = await listHabitLogsForInsights(session.userId, sinceDate);

  return NextResponse.json(entries);
}
