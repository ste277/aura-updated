/**
 * HGR3-C2 -- Home Weekly Planning UI, CLIENT side.
 *
 * Mirrors this repository's own established thin-network-wrapper
 * convention (`dayConstructorPreviewItemClient.ts`, `acceptConstructedDay.ts`):
 * a pure request builder, a pure response parser (independently testable
 * with plain JS values, no `fetch` mock), and exactly one function per
 * endpoint that actually calls `fetch`. This file is the ONLY place that
 * calls `/api/daily-assistant/goal-rhythm/weekly-proposal`,
 * `/api/daily-assistant/goal-rhythm/weekly-accept`, or `/api/timing-search`
 * on behalf of the Home weekly-review UI -- never a second, hand-rolled
 * request shape, and never a re-derivation of anything the server already
 * computed.
 *
 * REUSE, NOT DUPLICATION:
 *  - `formatMuhurtaReason` (muhurtaReasonFormat.ts) is the SAME formatter
 *    `PlanWithAuraView.tsx`/`MuhurthamFinderView.tsx`/`GuestFindClient.tsx`
 *    already use to turn a structured `MuhurtaReason` into English prose --
 *    never a new explanation generator, never LLM text. `summarizeSessionReasons`
 *    below reuses it verbatim, taking the engine's own top reasons
 *    (`reasons.slice(0, 3)`, the exact same convention `PlanWithAuraView.tsx`'s
 *    own `topReasons` already established) -- never re-sorted, never invented.
 *  - Request/response shapes mirror `goalRhythmWeeklyProposal.ts`/
 *    `goalRhythmWeeklyAcceptance.ts`/`timingSearchRequest.ts` exactly; this
 *    file only narrows/validates what a `fetch` response could plausibly be,
 *    it never redefines what a valid request looks like.
 *
 * ACCEPTANCE IDENTITY LIFECYCLE (HGR3-C1 integration contract) -- this file
 * deliberately does NOT generate the `acceptanceId` itself: that is owned by
 * `WeeklyPlanReviewModal.tsx` (one UUID per explicit "Accept all"
 * confirmation, i.e. one per modal instance, reused across retries of that
 * same confirmation, never across a different confirmation or a different
 * GoalActivity -- see that component's own header comment). This module only
 * accepts whatever `acceptanceId` it is given and sends it unmodified.
 *
 * KNOWN BACKEND LIMITATION, NOT MISCHARACTERIZED HERE: the payload-binding
 * courtesy check (`detectAcceptanceIdentityConflict`,
 * goalRhythmWeeklyAcceptance.ts) is scoped per
 * (acceptanceId, GoalActivity, localDate) -- NOT a single whole-batch
 * fingerprint. This file's own doc comments and the UI copy built on top of
 * it must never claim full batch-level binding.
 */

import type { MuhurtaReason } from '../../../packages/muhurta/src/activityOntology';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import type { WeeklyRhythmProposalItem } from './goalRhythmWeeklyProposal';
import type { WeeklyAcceptanceSummary, WeeklySessionAcceptanceOutcome } from './goalRhythmWeeklyAcceptance';
import type { TimingSearchResponse, TimingCandidate } from '../../../packages/recommendation/src/timingSearch';

// ============================================================
// Review-screen entry gate -- a single, non-cross-cutting decision shared
// between GoalRhythmSuggestionsCard.tsx and this file's own test, never
// duplicated.
// ============================================================

/**
 * Whether a GoalActivity's card should offer the dual "Plan remaining N" /
 * "Just today" actions (the weekly review flow) rather than retaining the
 * existing single "Plan it" action unchanged. With exactly one remaining
 * session, a weekly review that shows one row is barely distinguishable
 * from today's existing single-day flow and adds a tap (open the review
 * modal) for no benefit -- so this returns `false` for `remainingThisWeek
 * <= 1`, keeping the pre-HGR3-C2 single-action card exactly as it already
 * is for that case. Pure, no I/O.
 */
export function shouldOfferWeeklyReview(remainingThisWeek: number): boolean {
  return remainingThisWeek > 1;
}

// ============================================================
// Session draft -- the review screen's own in-memory, pre-confirmation
// state for one proposed/adjusted session. Never persisted; exists only
// for the lifetime of one open WeeklyPlanReviewModal instance.
// ============================================================

export type WeeklyReviewSessionOutcome = 'PENDING' | 'ACCEPTED' | 'ALREADY_ACCEPTED' | 'FAILED';

export interface WeeklyReviewSessionDraft {
  localDate: string;
  start: string;
  end: string;
  durationMinutes: number;
  score: number;
  label: TimingCandidate['label'];
  reasons: readonly MuhurtaReason[];
  /** True once the user has used Adjust to pick a different instant than
   * Aura's own original proposal for this slot -- presentation-only (lets
   * the UI say "adjusted" rather than claiming Aura's original pick). */
  adjusted: boolean;
  outcome: WeeklyReviewSessionOutcome;
  /** Set only once `outcome` is `ACCEPTED`/`ALREADY_ACCEPTED` -- the real,
   * authoritative identity the acceptance endpoint returned. Never guessed
   * client-side. */
  plannedActivityId?: string;
  /** Set only once `outcome` is `FAILED` -- the real, closed machine code
   * the acceptance endpoint returned (never a client-invented reason). */
  failureReason?: string;
}

/** 1:1 projection, order-preserving -- never re-sorts/re-scores the
 * engine's own proposal order. Every new draft starts PENDING/not-adjusted;
 * removal/adjustment/acceptance are all applied afterward, client-side. */
export function buildSessionDraftsFromProposal(items: readonly WeeklyRhythmProposalItem[]): WeeklyReviewSessionDraft[] {
  return items.map((item) => ({
    localDate: item.localDate,
    start: item.start,
    end: item.end,
    durationMinutes: item.durationMinutes,
    score: item.score,
    label: item.label,
    reasons: item.reasons,
    adjusted: false,
    outcome: 'PENDING',
  }));
}

/** Locked sessions (a real, confirmed commitment) must never be resubmitted
 * or offered Adjust/Remove -- this is the one predicate every caller uses
 * to decide that, rather than re-deriving the `ACCEPTED`/`ALREADY_ACCEPTED`
 * check inline in more than one place. */
export function isSessionLocked(outcome: WeeklyReviewSessionOutcome): boolean {
  return outcome === 'ACCEPTED' || outcome === 'ALREADY_ACCEPTED';
}

/** The exact sessions a submission (first attempt OR a retry) should
 * include: every draft that is NOT already a real, confirmed commitment.
 * A retry therefore naturally omits already-succeeded sessions from the
 * request body entirely (the smallest safe request), while still reusing
 * the SAME acceptanceId -- idempotency on the backend means resubmitting a
 * locked session would also be harmless, but omitting it is simpler and
 * cheaper. Preserves each draft's own CURRENT start/end exactly (so a prior
 * Adjust is carried through unchanged) -- never re-derives or rounds them. */
export function selectSessionsPendingSubmission(drafts: readonly WeeklyReviewSessionDraft[]): { localDate: string; start: string; end: string }[] {
  return drafts.filter((d) => !isSessionLocked(d.outcome)).map((d) => ({ localDate: d.localDate, start: d.start, end: d.end }));
}

/**
 * Applies a real `WeeklyAcceptanceSummary` back onto the drafts that
 * produced the submitted request. A success (`ACCEPTED`/`ALREADY_ACCEPTED`)
 * is matched by the exact (localDate, start, end) triple the request
 * itself carried -- never by array position -- so a success can never be
 * mismatched onto the wrong draft. The backend's own closed
 * `WeeklySessionAcceptanceOutcome` union does not carry the attempted
 * start/end back on a `FAILED` outcome (goalRhythmWeeklyAcceptance.ts's own
 * response shape, deliberately non-leaking), so a failure is matched by
 * `localDate` alone instead -- unambiguous in practice, since a batch for
 * one GoalActivity never legitimately contains two sessions on the same
 * date (HGR3-A's own same-day exclusion). A draft with no matching outcome
 * at all is left completely unchanged (should not happen for a well-formed
 * request, but never silently assumed successful either way).
 */
export function applyAcceptanceSummaryToDrafts(drafts: readonly WeeklyReviewSessionDraft[], summary: WeeklyAcceptanceSummary): WeeklyReviewSessionDraft[] {
  const successByKey = new Map<string, WeeklySessionAcceptanceOutcome>();
  const failureReasonByDate = new Map<string, string>();
  for (const session of summary.sessions) {
    if (session.outcome === 'FAILED') failureReasonByDate.set(session.localDate, session.reason);
    else successByKey.set(`${session.localDate}|${session.start}|${session.end}`, session);
  }
  return drafts.map((draft) => {
    const success = successByKey.get(`${draft.localDate}|${draft.start}|${draft.end}`);
    if (success && (success.outcome === 'ACCEPTED' || success.outcome === 'ALREADY_ACCEPTED')) {
      return { ...draft, outcome: success.outcome, plannedActivityId: success.plannedActivityId, start: success.start, end: success.end, failureReason: undefined };
    }
    const failureReason = failureReasonByDate.get(draft.localDate);
    if (failureReason) return { ...draft, outcome: 'FAILED', failureReason };
    return draft;
  });
}

// ============================================================
// Explanation rendering (ticket section 11) -- real structured reasons
// only, the engine's own top-ranked order, the existing formatter.
// ============================================================

/** Mirrors PlanWithAuraView.tsx's own (unexported) REASON_FACTOR_LABEL --
 * the same 7-entry factor vocabulary `MuhurtaReason['factor']` already
 * defines, never a new/invented factor name. */
const REASON_FACTOR_LABEL: Record<MuhurtaReason['factor'], string> = {
  NAKSHATRA: 'Nakshatra',
  TITHI: 'Tithi',
  YOGA: 'Yoga',
  KARANA: 'Karana',
  SOLAR_WINDOW: 'Solar window',
  PERSONAL: 'Personal Tara',
  ACTIVITY: 'Activity rule',
};

/** Up to 3 short, real explanation lines for one session -- the engine's
 * own top reasons (`reasons.slice(0, 3)`, PlanWithAuraView.tsx's own
 * convention), each formatted via the existing, shared `formatMuhurtaReason`.
 * Never re-ranks, never invents a factor not present in `reasons`, never
 * generates prose of its own. Empty when the candidate carries no reasons
 * at all (e.g. a manually CHECK-validated time with a neutral result). */
export function summarizeSessionReasons(reasons: readonly MuhurtaReason[]): string[] {
  return reasons.slice(0, 3).map((reason) => `${REASON_FACTOR_LABEL[reason.factor]}: ${formatMuhurtaReason(reason)}`);
}

// ============================================================
// Date/time presentation -- reuses the SAME Intl-based, timezone-aware
// formatting convention StartingSoonCard/formatUpdateDateTime
// (HomeDashboard.tsx) already establish -- never the browser's own local
// timezone, never a hand-rolled offset calculation.
// ============================================================

export function formatSessionDayLabel(localDate: string, timezone: string): string {
  // `localDate` is a plain YYYY-MM-DD civil date, not an instant -- format
  // it at local noon so no timezone's DST transition can ever shift it to
  // the adjacent calendar day.
  const atNoon = new Date(`${localDate}T12:00:00Z`);
  return atNoon.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  void timezone; // kept in the signature for a future locale-aware caller; unused today since localDate is already civil.
}

export function formatSessionTimeLabel(startIso: string, timezone: string): string {
  const date = new Date(startIso);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
}

// ============================================================
// Failure-reason presentation -- the backend's own closed, non-leaking
// `SessionFailureReason` vocabulary (goalRhythmWeeklyAcceptance.ts), never
// a raw internal code shown to the user, and never a reason this file
// invents.
// ============================================================

export interface FailureGuidance {
  message: string;
  /** Whether Adjust (pick a different time) is a sensible next step for
   * this specific failure. */
  canAdjust: boolean;
}

const FAILURE_GUIDANCE: Record<string, FailureGuidance> = {
  NOT_ELIGIBLE: { message: "This week's target is already met, or this activity is no longer eligible.", canAdjust: false },
  OUTSIDE_CURRENT_WEEK: { message: 'This date is no longer in the current week.', canAdjust: false },
  ACCEPTANCE_IDENTITY_CONFLICT: { message: 'This confirmation changed after it was started. Close and reopen to try again.', canAdjust: false },
  INVALID_TIME_RANGE: { message: 'That time could not be used.', canAdjust: true },
  TIME_DATE_MISMATCH: { message: 'That time no longer matches this date.', canAdjust: true },
  TIME_ALREADY_ELAPSED: { message: 'That time has already passed.', canAdjust: true },
  OUTSIDE_AVAILABILITY: { message: 'That time is outside your configured availability.', canAdjust: true },
  PREVIEW_NOT_READY: { message: "Aura couldn't check that time just now.", canAdjust: true },
  TIME_NO_LONGER_AVAILABLE: { message: 'That time is no longer available.', canAdjust: true },
  PLACEMENT_MISMATCH: { message: "Aura couldn't confirm that exact time.", canAdjust: true },
  PREVIEW_FAILED: { message: "Aura couldn't check that time just now.", canAdjust: true },
  ACCEPTANCE_REJECTED: { message: 'That session could not be confirmed.', canAdjust: true },
  IDEMPOTENCY_CONFLICT: { message: 'That session could not be confirmed. Try a different time.', canAdjust: true },
  SAVE_FAILED: { message: "Aura couldn't save that session just now.", canAdjust: true },
  COMMITMENT_NO_LONGER_LIVE: { message: 'This exact slot was already handled. Pick a different time to rebook.', canAdjust: true },
};

const DEFAULT_FAILURE_GUIDANCE: FailureGuidance = { message: 'That session could not be confirmed.', canAdjust: true };

export function describeSessionFailure(reason: string | undefined): FailureGuidance {
  if (!reason) return DEFAULT_FAILURE_GUIDANCE;
  return FAILURE_GUIDANCE[reason] ?? DEFAULT_FAILURE_GUIDANCE;
}

// ============================================================
// Weekly proposal -- request/response.
// ============================================================

export interface WeeklyProposalFetchOk {
  status: 'OK';
  goalActivityId: string;
  goalId: string;
  activityTitle: string;
  activityId: string | null;
  weeklyTarget: number;
  completedThisWeek: number;
  committedThisWeek: number;
  remainingThisWeek: number;
  requestedCount: number;
  proposals: WeeklyRhythmProposalItem[];
  shortfallReason?: 'FEWER_SUITABLE_DAYS_THAN_REQUESTED';
}

export type WeeklyProposalFetchResult =
  | WeeklyProposalFetchOk
  | { status: 'NOT_ELIGIBLE' }
  | { status: 'SEARCH_FAILED' }
  | { status: 'NETWORK_ERROR' }
  | { status: 'HTTP_ERROR'; httpStatus: number }
  | { status: 'UNKNOWN_RESPONSE' };

/** Pure -- never throws, never touches the network. */
export function parseWeeklyProposalResponseBody(body: unknown, httpStatus: number): WeeklyProposalFetchResult {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (record.status === 'OK' && Array.isArray(record.proposals)) {
      return record as unknown as WeeklyProposalFetchOk;
    }
    if (record.status === 'NOT_ELIGIBLE') return { status: 'NOT_ELIGIBLE' };
    if (record.status === 'SEARCH_FAILED') return { status: 'SEARCH_FAILED' };
  }
  if (httpStatus !== 200) return { status: 'HTTP_ERROR', httpStatus };
  return { status: 'UNKNOWN_RESPONSE' };
}

/** The one network call for proposal generation. Read-only on the server
 * (goalRhythmWeeklyProposal.ts) -- this function never writes anything and
 * is always safe to call again (e.g. a "Regenerate" retry). */
export async function fetchWeeklyRhythmProposal(goalActivityId: string): Promise<WeeklyProposalFetchResult> {
  let response: Response;
  try {
    response = await fetch('/api/daily-assistant/goal-rhythm/weekly-proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goalActivityId }),
    });
  } catch {
    return { status: 'NETWORK_ERROR' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: 'UNKNOWN_RESPONSE' };
  }
  return parseWeeklyProposalResponseBody(json, response.status);
}

// ============================================================
// Weekly acceptance -- request/response.
// ============================================================

export interface WeeklyAcceptanceRequestBody {
  goalActivityId: string;
  acceptanceId: string;
  sessions: { localDate: string; start: string; end: string }[];
}

/** Pure. `acceptanceId` is never generated here -- see this file's own
 * header comment on why identity generation belongs to the modal, not this
 * client module. */
export function buildWeeklyAcceptanceRequestBody(goalActivityId: string, acceptanceId: string, sessions: readonly { localDate: string; start: string; end: string }[]): WeeklyAcceptanceRequestBody {
  return { goalActivityId, acceptanceId, sessions: sessions.map((s) => ({ localDate: s.localDate, start: s.start, end: s.end })) };
}

export type WeeklyAcceptanceSubmitResult =
  | { status: 'OK'; summary: WeeklyAcceptanceSummary }
  | { status: 'NETWORK_ERROR' }
  | { status: 'HTTP_ERROR'; httpStatus: number }
  | { status: 'UNKNOWN_RESPONSE' };

/** Pure -- never throws, never touches the network. */
export function parseWeeklyAcceptanceResponseBody(body: unknown, httpStatus: number): WeeklyAcceptanceSubmitResult {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.sessions) && typeof record.requestedCount === 'number') {
      return {
        status: 'OK',
        summary: {
          requestedCount: record.requestedCount,
          acceptedCount: record.acceptedCount as number,
          alreadyAcceptedCount: record.alreadyAcceptedCount as number,
          failedCount: record.failedCount as number,
          sessions: record.sessions as WeeklySessionAcceptanceOutcome[],
          remainingThisWeekByGoalActivityId: new Map(),
        },
      };
    }
  }
  if (httpStatus !== 200) return { status: 'HTTP_ERROR', httpStatus };
  return { status: 'UNKNOWN_RESPONSE' };
}

/**
 * The one network call for acceptance -- the ONLY place anywhere in this
 * module (or the modal built on top of it) that can create a real
 * commitment. `NETWORK_ERROR` is reported distinctly from every
 * server-returned outcome: the caller must preserve the exact
 * `acceptanceId`/`sessions` it sent and offer a retry of THAT SAME request,
 * never silently mint a new acceptanceId merely because this threw (see
 * `WeeklyPlanReviewModal.tsx`'s own "network uncertainty" handling).
 */
export async function submitWeeklyAcceptance(goalActivityId: string, acceptanceId: string, sessions: readonly { localDate: string; start: string; end: string }[]): Promise<WeeklyAcceptanceSubmitResult> {
  let response: Response;
  try {
    response = await fetch('/api/daily-assistant/goal-rhythm/weekly-accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildWeeklyAcceptanceRequestBody(goalActivityId, acceptanceId, sessions)),
    });
  } catch {
    return { status: 'NETWORK_ERROR' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: 'UNKNOWN_RESPONSE' };
  }
  return parseWeeklyAcceptanceResponseBody(json, response.status);
}

// ============================================================
// Time adjustment -- composes the EXISTING, already-authenticated
// /api/timing-search endpoint directly (FIND for "another time this day",
// CHECK for "validate the time I just typed"). No backend change: this is
// the exact, already-shipped request/response shape
// timingSearchRequest.ts/timingSearch.ts already define.
//
// HONEST SCOPE NOTE: CHECK reports the real Panchangam quality/label/score
// and any friction-window conflict for the candidate instant, but it does
// NOT check real calendar conflicts, Availability Context, or weekly/daily
// capacity -- those remain the acceptance endpoint's own, sole authority
// (goalRhythmWeeklyAcceptance.ts), exactly as the ticket requires. Adjust's
// job is to let the user preview a time's Panchangam fit before including
// it in the batch; Accept is what actually, authoritatively validates it.
// ============================================================

export interface TimingSearchFetchParams {
  activityId: string | null;
  activityTitleFallback: string;
  durationMinutes: number;
}

export type TimingSearchFetchResult = { status: 'OK'; response: TimingSearchResponse } | { status: 'NETWORK_ERROR' } | { status: 'HTTP_ERROR'; httpStatus: number } | { status: 'UNKNOWN_RESPONSE' };

function timingSearchBaseBody(params: TimingSearchFetchParams): Record<string, unknown> {
  return params.activityId
    ? { activityId: params.activityId, durationMinutes: params.durationMinutes, timePreference: 'ANY' }
    : { taskTitle: params.activityTitleFallback, durationMinutes: params.durationMinutes, timePreference: 'ANY' };
}

/** Pure request body for "suggest another time, same day" -- FIND scoped
 * to exactly one calendar date (the smallest possible dateRange), never a
 * new multi-day search of its own. */
export function buildAdjustmentFindRequestBody(params: TimingSearchFetchParams, localDate: string): Record<string, unknown> {
  return { mode: 'FIND', ...timingSearchBaseBody(params), dateRange: { start: localDate, end: localDate }, limit: 5 };
}

/** Pure request body for "check this exact time I chose" -- CHECK, the
 * real Panchangam-quality evaluation for one specific instant. */
export function buildAdjustmentCheckRequestBody(params: TimingSearchFetchParams, candidateStartIso: string): Record<string, unknown> {
  return { mode: 'CHECK', ...timingSearchBaseBody(params), candidateStart: candidateStartIso };
}

function parseTimingSearchResponseBody(body: unknown, httpStatus: number): TimingSearchFetchResult {
  if (body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).candidates)) {
    return { status: 'OK', response: body as TimingSearchResponse };
  }
  if (httpStatus !== 200) return { status: 'HTTP_ERROR', httpStatus };
  return { status: 'UNKNOWN_RESPONSE' };
}

async function callTimingSearch(requestBody: Record<string, unknown>): Promise<TimingSearchFetchResult> {
  let response: Response;
  try {
    response = await fetch('/api/timing-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
  } catch {
    return { status: 'NETWORK_ERROR' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { status: 'UNKNOWN_RESPONSE' };
  }
  return parseTimingSearchResponseBody(json, response.status);
}

export async function fetchAdjustmentAlternatives(params: TimingSearchFetchParams, localDate: string): Promise<TimingSearchFetchResult> {
  return callTimingSearch(buildAdjustmentFindRequestBody(params, localDate));
}

export async function fetchAdjustmentCheck(params: TimingSearchFetchParams, candidateStartIso: string): Promise<TimingSearchFetchResult> {
  return callTimingSearch(buildAdjustmentCheckRequestBody(params, candidateStartIso));
}

/** Turns one real `TimingCandidate` (from either FIND or CHECK) into a
 * session draft update -- carries `start`/`end`/`score`/`label`/`reasons`
 * verbatim, never re-derived, and marks `adjusted: true` so the UI can
 * honestly say this is no longer Aura's original top pick for this slot. */
export function draftFromAdjustmentCandidate(draft: WeeklyReviewSessionDraft, candidate: TimingCandidate, localDate: string): WeeklyReviewSessionDraft {
  return {
    ...draft,
    localDate,
    start: candidate.start,
    end: candidate.end,
    score: candidate.score,
    label: candidate.label,
    reasons: candidate.reasons,
    adjusted: true,
    outcome: 'PENDING',
    failureReason: undefined,
  };
}
