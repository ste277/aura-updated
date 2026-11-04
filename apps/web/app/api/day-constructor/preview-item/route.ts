import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../../lib/natalContext';
import { buildTimingSearchRequest } from '../../../../lib/timingSearchRequest';
import { runTimingSearchWithDailyRhythm } from '../../../../lib/timingSearchDailyRhythm';
import type { DailyRhythmPreferencesInput } from '../../../../lib/dailyRhythmScheduling';
import { signPreviewItem, verifyPreviewItem, type PreviewItemFacts } from '../../../../lib/dayConstructorPreviewIntegrity';
import type { AcceptedProposedItem } from '../../../../lib/dayConstructorAcceptance';
import type { ConstructionWindow, ConstructionWindowSource } from '../../../../lib/dayIntent';
import { DailyAssistantContext } from '../../../../../../packages/recommendation/src/dailyAssistant';

/**
 * Plan My Day -- single-item time editing (backend foundation).
 *
 * TRUST BOUNDARY (mirrors dayConstructorPreviewIntegrity.ts's own model):
 * this endpoint's ONLY capability is "take a provably-already-issued
 * preview item and re-sign it with a new time, after re-running the exact
 * same CHECK assessment full preview generation would have run for it".
 * It is not a generic signing endpoint: `activityId`/`title`/`placementSource`
 * are NEVER taken from client input for the re-signed item -- they are read
 * exclusively from the VERIFIED original item object this handler itself
 * produces by calling the existing, unmodified `verifyPreviewItem`. A
 * request whose original item fails verification is rejected before any
 * assessment or signing happens; nothing beyond that point ever touches a
 * client-supplied value for a signed field other than the new start/end.
 *
 * Duration is DERIVED from the verified original item's own start/end --
 * never accepted from the client -- so a caller cannot request a longer or
 * shorter slot than what was actually assessed and signed originally.
 *
 * PERSISTS NOTHING. No database read or write anywhere in this file. Final
 * acceptance (`POST /api/day-constructor/accept`, completely unmodified by
 * this PR) remains the one and only persistence boundary and the one and
 * only place HPG3's capacity/eligibility checks run -- this endpoint's
 * output still has to pass that same gate like any other proposed item.
 */

const MAX_TITLE_LENGTH = 200; // mirrors dayConstructorAcceptance.ts's own MAX_TITLE_LENGTH (private there)
const MAX_INTENT_ID_LENGTH = 200; // mirrors dayConstructorAcceptancePersistence.ts's own exported constant

const VALID_WINDOW_SOURCES = new Set<ConstructionWindowSource>(['REMAINING_TODAY', 'EXPLICIT_RANGE']);
const VALID_PLACEMENT_SOURCES = new Set(['FIXED_CONSTRAINT', 'SELECTED_CANDIDATE']);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseConstructionWindow(value: unknown): ConstructionWindow | null {
  if (!value || typeof value !== 'object') return null;
  const w = value as Record<string, unknown>;
  if (typeof w.date !== 'string' || typeof w.timezone !== 'string') return null;
  const start = parseDate(w.start);
  const end = parseDate(w.end);
  if (!start || !end) return null;
  if (typeof w.source !== 'string' || !VALID_WINDOW_SOURCES.has(w.source as ConstructionWindowSource)) return null;
  return { date: w.date, start, end, timezone: w.timezone, source: w.source as ConstructionWindowSource };
}

function parseOriginalItem(value: unknown): AcceptedProposedItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.intentId !== 'string' || !item.intentId || item.intentId.length > MAX_INTENT_ID_LENGTH) return null;
  if (typeof item.title !== 'string' || item.title.length > MAX_TITLE_LENGTH) return null;
  const start = parseDate(item.start);
  const end = parseDate(item.end);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  if (typeof item.placementSource !== 'string' || !VALID_PLACEMENT_SOURCES.has(item.placementSource)) return null;
  if (item.activityId !== undefined && typeof item.activityId !== 'string') return null;
  return {
    intentId: item.intentId,
    activityId: typeof item.activityId === 'string' ? item.activityId : undefined,
    title: item.title,
    start,
    end,
    placementSource: item.placementSource as AcceptedProposedItem['placementSource'],
  };
}

// Mirrors dayConstructorAcceptance.ts's own private isWithinWindow() exactly
// (that function is not exported; this is the identical one-line [start,end]
// bound check, not a second convention).
function isWithinWindow(start: Date, end: Date, window: ConstructionWindow): boolean {
  return start.getTime() >= window.start.getTime() && end.getTime() <= window.end.getTime();
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const window = parseConstructionWindow(body.window);
  const originalItem = parseOriginalItem(body.item);
  if (!window || !originalItem) {
    return NextResponse.json({ status: 'REJECTED', reason: 'INVALID_REQUEST', detail: 'MALFORMED_REQUEST' });
  }

  // Step 1 -- verify the ORIGINAL item's signature. The userId used here is
  // the SERVER's own authenticated session.userId, never anything from the
  // request body -- a token signed for a different user can never pass
  // this check regardless of what the client claims about ownership.
  // verifyPreviewItem itself is completely unmodified.
  const verification = verifyPreviewItem({ userId: session.userId, window, item: originalItem }, body.acceptanceToken);
  if (!verification.ok) {
    return NextResponse.json({ status: 'REJECTED', reason: 'INVALID_REQUEST', detail: verification.code });
  }
  // From this point on, originalItem is the VERIFIED source of truth for
  // activityId/title/placementSource/intentId -- the re-signed item below
  // reads every one of those fields from THIS object, never from a second,
  // separately-trusted copy in the request body (there is no such second
  // copy -- the request schema only carries one `item`).

  // Step 2 -- validate the requested replacement time.
  const candidateStart = parseDate(body.candidateStart);
  if (!candidateStart) {
    return NextResponse.json({ status: 'REJECTED', reason: 'INVALID_REQUEST', detail: 'INVALID_CANDIDATE_START' });
  }
  // Duration is DERIVED from the verified original item's own start/end --
  // never accepted from the client (a client-supplied duration could differ
  // from what was actually assessed and signed originally).
  const durationMinutes = (originalItem.end.getTime() - originalItem.start.getTime()) / 60000;
  const candidateEnd = new Date(candidateStart.getTime() + durationMinutes * 60000);
  if (!isWithinWindow(candidateStart, candidateEnd, window)) {
    return NextResponse.json({ status: 'REJECTED', reason: 'STALE_PREVIEW', detail: 'CANDIDATE_OUTSIDE_WINDOW' });
  }

  // Step 3 -- reuse the EXISTING timing-assessment engine (the same
  // function /api/timing-search's own CHECK mode calls, including its
  // existing Daily Rhythm preference logic -- advisory only, never a hard
  // exclusion, exactly as CHECK mode already behaves for Plan tab's
  // "Choose My Own Time"). Built as a synthetic timing-search body so this
  // reuses buildTimingSearchRequest's own existing CHECK-mode validation
  // verbatim, rather than re-implementing it.
  const now = new Date();
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };
  const syntheticTimingSearchBody: Record<string, unknown> = {
    mode: 'CHECK',
    activityId: originalItem.activityId,
    taskTitle: originalItem.activityId ? undefined : originalItem.title,
    durationMinutes,
    candidateStart: candidateStart.toISOString(),
    timePreference: 'ANY',
  };
  const validated = buildTimingSearchRequest(syntheticTimingSearchBody, context);
  if (!validated.ok) {
    return NextResponse.json({ status: 'REJECTED', reason: 'INVALID_REQUEST', detail: validated.error });
  }

  let assessment;
  try {
    const dailyRhythmPrefs: DailyRhythmPreferencesInput = {
      workStart: user.dailyRhythmWorkStart ?? null,
      workEnd: user.dailyRhythmWorkEnd ?? null,
      workDays: user.dailyRhythmWorkDays ?? [],
    };
    assessment = runTimingSearchWithDailyRhythm(validated.request, user.timezone, dailyRhythmPrefs);
  } catch {
    // Never leak internals -- mirrors the accept route's own SAVE_FAILED convention.
    return NextResponse.json({ status: 'REJECTED', reason: 'TIMING_CHECK_FAILED' }, { status: 500 });
  }

  // CHECK mode evaluates exactly the requested instant and never filters or
  // reorders it (runTimingSearchWithDailyRhythm's own doc comment) -- this
  // is the SAME candidate the engine would have produced during full
  // preview generation for this exact activity/duration/instant. A genuine
  // conflict (FRICTION_WINDOW_BLOCKED / DURATION_EXCEEDS_DAY) is surfaced
  // as a typed rejection and NOTHING is signed -- a mere lower-quality
  // label (e.g. CAUTION) is never treated as a rejection, exactly mirroring
  // AcceptanceDeps.checkTiming's own documented convention ("a successful
  // evaluation that merely returns a lower-quality label is NEVER treated
  // as a failure").
  const requestedCandidate = assessment.requestedCandidate ?? assessment.candidates[0];
  if (!requestedCandidate) {
    return NextResponse.json({ status: 'REJECTED', reason: 'TIMING_CHECK_FAILED' }, { status: 500 });
  }
  if (requestedCandidate.conflicts && requestedCandidate.conflicts.length > 0) {
    return NextResponse.json({ status: 'REJECTED', reason: 'UNAVAILABLE', detail: requestedCandidate.conflicts[0].type });
  }

  // Step 4 -- re-sign. activityId/title/placementSource/intentId are the
  // SAME values from the verified original item above -- only start/end
  // change. This is the ONLY call to signPreviewItem in this file, and it
  // only happens after every prior check has succeeded.
  const updatedItem: AcceptedProposedItem = {
    intentId: originalItem.intentId,
    activityId: originalItem.activityId,
    title: originalItem.title,
    start: candidateStart,
    end: candidateEnd,
    placementSource: originalItem.placementSource,
  };
  const facts: PreviewItemFacts = { userId: session.userId, window, item: updatedItem };
  const acceptanceToken = signPreviewItem(facts);

  return NextResponse.json({
    status: 'UPDATED',
    item: { ...updatedItem, start: updatedItem.start.toISOString(), end: updatedItem.end.toISOString(), acceptanceToken },
    candidate: requestedCandidate,
    dailyRhythmNotes: assessment.dailyRhythmNotes,
  });
}
