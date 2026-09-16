/**
 * Day Constructor V1 -- PR E1: acceptance domain + revalidation contract.
 *
 * CORE TRUST INVARIANT (this ticket's own section 2): THE ACCEPTED OBJECT
 * IS THE REVIEWED PROPOSAL. This file never reconstructs a day, never
 * calls `constructDay`/FIND, never chooses a different candidate, never
 * moves/shortens/extends/splits a reviewed item, never re-resolves
 * duration, never changes a title or activityId. Either the exact
 * reviewed proposal remains valid, or the whole proposal is REJECTED and
 * control returns to the caller -- there is no partial acceptance and no
 * silent substitution.
 *
 * PURE DOMAIN LAYER (this ticket's own section 1/29): this file never
 * persists anything, never touches a database, never makes an HTTP call,
 * never adds an API route. `evaluateAcceptance` is a plain async function
 * over injected dependencies (`AcceptanceDeps`) and an injected boundary
 * clock (`now`) -- deterministic given deterministic inputs. A future PR
 * E2 is responsible for (a) wiring `AcceptanceDeps` to real repository
 * reads/the real timing engine, and (b) atomically persisting the
 * `AcceptedPlanWrite[]` this file returns when `status === 'ACCEPTABLE'`.
 */

import type { ConstructionWindow } from './dayIntent';
import type { PlanBlockerCandidate } from './dayConstructorOrchestrator';
import { isActivePlanBlocker } from './dayConstructorOrchestrator';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';

// ============================================================
// Request contract (this ticket's own section 4/5). Deliberately excludes
// userId (never client-trusted -- the real boundary layer supplies it out
// of band), the constructor's own deferred-item list (structurally
// impossible to include -- see
// AcceptedProposedItem below), capacity state, warnings, presentation
// copy, and any blocker list (fresh blockers are always reloaded via
// `AcceptanceDeps.loadFreshBlockers`, never trusted from the client).
// ============================================================

/**
 * The reviewed facts for ONE proposed item -- deliberately NOT the full
 * `ProposedItem` (dayConstructor.ts): `timingFit`/`candidateOrder` are
 * presentation/ranking artifacts acceptance never needs (this ticket's
 * own section 5: "do not require presentation-only fields" -- a changed
 * timing-fit label at accept time is explicitly NOT grounds for
 * rejection, see section 19, so this file has no reason to even receive
 * it). `requiresConfirmation` is dropped entirely -- it is always `true`
 * on a `ProposedItem` and carries no acceptance-relevant fact.
 */
export interface AcceptedProposedItem {
  intentId: string;
  /** UNTRUSTED. Re-validated against the current catalog by
   * `AcceptanceDeps.validateActivity` -- never assumed still valid merely
   * because it resolved at preview time (this ticket's own section 15). */
  activityId?: string;
  title: string;
  start: Date;
  end: Date;
  placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
}

/**
 * `clientRequestId` is the ONE acceptance-level idempotency identity (this
 * ticket's own section 4) -- it identifies the user's single confirmation
 * operation, not any individual Plan. This file never reads
 * `PlanCreationIdempotency` itself (that is a real persistence concern,
 * E2's own job); `clientRequestId` is carried through here purely so a
 * future E2 can derive deterministic per-item persistence keys from ONE
 * caller-supplied identity, without this domain contract also having to
 * accept an independently-supplied idempotency key per item.
 *
 * `constructionWindow` is the SAME `ConstructionWindow` the reviewed
 * `ConstructDayPreview` carried -- reused verbatim, never reconstructed
 * (this ticket's own section 12). Its own `date`/`timezone` fields already
 * carry what a separate top-level `targetDate`/`timezone` field would
 * only duplicate (and risk diverging from), so this contract does not
 * repeat them.
 */
export interface AcceptConstructedDayRequest {
  clientRequestId: string;
  constructionWindow: ConstructionWindow;
  proposedItems: AcceptedProposedItem[];
}

// ============================================================
// Dependency injection boundary (this ticket's own section 28). Three
// narrow seams, deliberately mirroring `DayConstructorOrchestratorDeps`'s
// own shape (dayConstructorOrchestrator.ts) rather than inventing a new DI
// convention. `now` is passed as its own explicit argument to
// `evaluateAcceptance` (below), never bundled into this object -- it is a
// plain boundary VALUE (this ticket's own section 8), not a behavior seam.
// ============================================================

export interface AcceptanceDeps {
  /** Fresh, real Plan blockers for the reviewed `constructionWindow`'s own
   * bounds -- called EXACTLY ONCE per acceptance evaluation. Never trust
   * blocker state carried in the reviewed proposal (this ticket's own
   * section 9): the caller must reload this from the real repository at
   * evaluation time. Lifecycle filtering is `isActivePlanBlocker`
   * (imported from `dayConstructorOrchestrator.ts`, exported there --
   * reused verbatim, never reproduced, since this ticket's own section 9
   * only requires reproduction when the canonical helper is private). */
  loadFreshBlockers: (bounds: { from: Date; to: Date }) => Promise<PlanBlockerCandidate[]>;
  /** Re-validates a activityId against the CURRENT activity catalog (the
   * same discipline the existing Plan-creation route already applies to a
   * client-supplied activityId). Returns `false` for an id that no longer
   * resolves -- never throws for this case. */
  validateActivity: (activityId: string) => boolean;
  /** A thin wrapper around the real, synchronous timing-search engine's own
   * CHECK mode -- called ONCE per `SELECTED_CANDIDATE` item, NEVER
   * for a `FIXED_CONSTRAINT` item (this ticket's own section 18). Must
   * evaluate the EXACT reviewed `candidateStart`/`durationMinutes` --
   * never a different instant. May throw on genuine timing-infrastructure
   * failure; `evaluateAcceptance` catches this explicitly and reports
   * `TIMING_CHECK_FAILED`, exactly mirroring
   * `DayConstructorOrchestratorDeps.searchTiming`'s own established
   * throw/catch convention (this ticket's own section 20: a successful
   * evaluation that merely returns a lower-quality label is NEVER treated
   * as a failure here -- only a thrown/failed evaluation is). */
  checkTiming: (request: { activityId?: string; taskTitle?: string; candidateStart: Date; durationMinutes: number }) => TimingCandidate;
}

// ============================================================
// Result contract (this ticket's own section 6). Deliberately excludes
// persistence-only outcomes (`SAVED`/`ALREADY_ACCEPTED`/`SAVE_FAILED` --
// E2's own concern) and `TIMING_CHANGED` (this ticket's own section 6/19:
// a changed timing quality is informational, never a rejection reason on
// its own).
// ============================================================

export type AcceptanceRejectionReason = 'INVALID_REQUEST' | 'STALE_PREVIEW' | 'INVALID_ACTIVITY' | 'CONFLICT' | 'TIMING_CHECK_FAILED';

export interface AcceptanceDiagnostic {
  intentId: string;
  reason: AcceptanceRejectionReason;
  /** Short, machine-oriented explanation (e.g. `'END_BEFORE_START'`,
   * `'OVERLAPS_FRESH_BLOCKER'`) -- domain detail, never presentation
   * copy (this ticket's own section 6: "avoid presentation prose in
   * domain result"). A future PR D-style presentation adapter is
   * responsible for turning this into user-facing text, exactly as
   * `dayPlanPreviewPresentation.ts` already does for
   * `PlacementDeferralReason`. */
  detail: string;
}

/**
 * `writeIntents` is sorted chronologically by `plannedStartAt` (this
 * ticket's own section 27) -- preparation for E2's own deterministic
 * write order, never a re-ranking of acceptance meaning.
 */
export interface AcceptedPlanWrite {
  intentId: string;
  activityId?: string;
  title: string;
  plannedStartAt: Date;
  plannedEndAt: Date;
  durationMinutes: number;
  placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
}

export type AcceptanceDecision =
  | { status: 'ACCEPTABLE'; writeIntents: AcceptedPlanWrite[] }
  | { status: 'REJECTED'; reason: AcceptanceRejectionReason; diagnostics: AcceptanceDiagnostic[] };

// ============================================================
// Structural integrity (this ticket's own section 11/12/13/14) -- the
// FIRST validation stage, run before any external dependency is
// consulted. Reproduces (never imports, since both are private,
// unexported helpers -- `dayConstructor.ts`'s own `intervalsOverlap` and
// `dayCapacity.ts`'s own private copy of the identical formula already
// established this repository's precedent of reproducing this exact
// tiny formula rather than reaching into another module's internals)
// the same `[start,end)` overlap test used throughout PR A/B.
// ============================================================

const MAX_TITLE_LENGTH = 200; // mirrors the existing Plan-creation route's own limit -- checked here so an ultimately-invalid title is caught at accept-time, not deferred to a later persistence-layer rejection.

function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

function isWithinWindow(start: Date, end: Date, window: ConstructionWindow): boolean {
  return start.getTime() >= window.start.getTime() && end.getTime() <= window.end.getTime();
}

/** Plain, exact division -- never `Math.round` (this ticket's own section
 * 2). Callers past the structural-integrity stage (below) may rely on
 * `(end - start) % 60000 === 0` already having been enforced, so this is
 * exact, not an approximation. */
function exactDurationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60000;
}

function validateStructuralIntegrity(request: AcceptConstructedDayRequest): AcceptanceDiagnostic[] {
  const diagnostics: AcceptanceDiagnostic[] = [];

  if (request.proposedItems.length === 0) {
    diagnostics.push({ intentId: '', reason: 'INVALID_REQUEST', detail: 'EMPTY_PROPOSAL' });
    return diagnostics;
  }

  const seenIntentIds = new Set<string>();
  for (const item of request.proposedItems) {
    if (seenIntentIds.has(item.intentId)) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'DUPLICATE_INTENT_ID' });
    }
    seenIntentIds.add(item.intentId);

    if (!(item.start instanceof Date) || Number.isNaN(item.start.getTime()) || !(item.end instanceof Date) || Number.isNaN(item.end.getTime())) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'INVALID_INTERVAL' });
      continue;
    }
    if (item.end.getTime() <= item.start.getTime()) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'END_BEFORE_OR_EQUAL_START' });
      continue;
    }
    if (!item.title || !item.title.trim() || item.title.length > MAX_TITLE_LENGTH) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'INVALID_TITLE' });
    }
    if (!isWithinWindow(item.start, item.end, request.constructionWindow)) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'OUTSIDE_CONSTRUCTION_WINDOW' });
    }
    // Duration precision (pre-commit review fix, this ticket's own
    // section 2): every real Plan duration in this repository is a whole
    // number of minutes (CreatePlannedActivityInput.durationMinutes,
    // ProposedItem's own end/start, PR B's own duration resolution chain
    // -- never a fractional value). A resubmitted interval whose
    // millisecond span is NOT an exact multiple of 60000 is REJECTED
    // outright rather than silently rounded into a materially different
    // reviewed duration -- rounding a 44.6-minute interval to "45 min"
    // would be exactly the kind of silent transformation this file's own
    // core trust invariant forbids.
    if ((item.end.getTime() - item.start.getTime()) % 60000 !== 0) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'SUB_MINUTE_PRECISION' });
    }
  }

  // Internal proposal overlap (this ticket's own section 11) -- the
  // reviewed proposal SHOULD already be internally non-overlapping
  // (constructDay's own placement guarantee), but this file treats the
  // resubmitted client payload as untrusted and re-checks explicitly
  // rather than assuming that guarantee survived the network round trip.
  for (let i = 0; i < request.proposedItems.length; i++) {
    for (let j = i + 1; j < request.proposedItems.length; j++) {
      const a = request.proposedItems[i];
      const b = request.proposedItems[j];
      if (intervalsOverlap(a.start, a.end, b.start, b.end)) {
        diagnostics.push({ intentId: a.intentId, reason: 'INVALID_REQUEST', detail: `OVERLAPS_PROPOSED_ITEM:${b.intentId}` });
      }
    }
  }

  return diagnostics;
}

// ============================================================
// Staleness (this ticket's own section 8/14/22). `now` is ALWAYS the
// caller's own explicit boundary value -- this file never calls
// `new Date()`/`Date.now()` itself.
// ============================================================

function validateNotStale(request: AcceptConstructedDayRequest, now: Date): AcceptanceDiagnostic[] {
  const diagnostics: AcceptanceDiagnostic[] = [];

  // The whole reviewed window having elapsed covers local-day rollover
  // (this ticket's own section 22) without a second, timezone-string-
  // based rollover rule: if `constructionWindow.end` (an absolute UTC
  // instant) is at/before `now`, the entire reviewed day is in the past
  // relative to the acceptance boundary clock, regardless of which local
  // calendar date it was drawn from.
  if (request.constructionWindow.end.getTime() <= now.getTime()) {
    diagnostics.push({ intentId: '', reason: 'STALE_PREVIEW', detail: 'CONSTRUCTION_WINDOW_ELAPSED' });
    return diagnostics;
  }

  for (const item of request.proposedItems) {
    if (item.start.getTime() <= now.getTime()) {
      diagnostics.push({ intentId: item.intentId, reason: 'STALE_PREVIEW', detail: 'PROPOSED_START_ELAPSED' });
    }
  }
  return diagnostics;
}

// ============================================================
// Activity validity (this ticket's own section 15).
// ============================================================

function validateActivities(request: AcceptConstructedDayRequest, deps: AcceptanceDeps): AcceptanceDiagnostic[] {
  const diagnostics: AcceptanceDiagnostic[] = [];
  for (const item of request.proposedItems) {
    if (item.activityId && !deps.validateActivity(item.activityId)) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_ACTIVITY', detail: 'ACTIVITY_NO_LONGER_RESOLVES' });
    }
  }
  return diagnostics;
}

// ============================================================
// Fresh blocker conflict (this ticket's own section 9/10). Never trusts
// blocker state from the reviewed preview -- `deps.loadFreshBlockers` is
// always a real, current read.
// ============================================================

async function validateAgainstFreshBlockers(request: AcceptConstructedDayRequest, deps: AcceptanceDeps, now: Date): Promise<AcceptanceDiagnostic[]> {
  const blockers = await deps.loadFreshBlockers({ from: request.constructionWindow.start, to: request.constructionWindow.end });
  const activeBlockers = blockers.filter((blocker) => isActivePlanBlocker(blocker, now));

  const diagnostics: AcceptanceDiagnostic[] = [];
  for (const item of request.proposedItems) {
    const conflict = activeBlockers.find((blocker) => intervalsOverlap(item.start, item.end, blocker.start, blocker.end));
    if (conflict) diagnostics.push({ intentId: item.intentId, reason: 'CONFLICT', detail: 'OVERLAPS_FRESH_BLOCKER' });
  }
  return diagnostics;
}

// ============================================================
// Timing CHECK for SELECTED_CANDIDATE items only (this ticket's own
// section 16/17/18/19/20). FIXED_CONSTRAINT items never reach this stage
// (hard feasibility, validated above, is their only gate).
// ============================================================

async function validateSelectedCandidateTiming(request: AcceptConstructedDayRequest, deps: AcceptanceDeps): Promise<AcceptanceDiagnostic[]> {
  const diagnostics: AcceptanceDiagnostic[] = [];
  for (const item of request.proposedItems) {
    if (item.placementSource !== 'SELECTED_CANDIDATE') continue;
    const durationMinutes = exactDurationMinutes(item.start, item.end);
    try {
      // Exact reviewed instant/duration, activityId when known else the
      // item's own title (this ticket's own section 17: resolveTaskProfile's
      // own fallback to taskTitle-based classification means CHECK never
      // requires a concrete activityId -- the SAME activityId-or-title
      // branch `orchestrateConstructDay` already uses for FIND). A changed
      // score/label from the result is NEVER inspected here -- only a
      // thrown evaluation counts as a failure (this ticket's own section
      // 19/20).
      deps.checkTiming(
        item.activityId
          ? { activityId: item.activityId, candidateStart: item.start, durationMinutes }
          : { taskTitle: item.title, candidateStart: item.start, durationMinutes }
      );
    } catch (err) {
      diagnostics.push({ intentId: item.intentId, reason: 'TIMING_CHECK_FAILED', detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return diagnostics;
}

// ============================================================
// evaluateAcceptance -- the main entry point. Staged, fail-together
// pipeline (this ticket's own section 3: whole-proposal only, never a
// mix of per-item outcomes): each stage runs against the FULL proposal;
// the first stage that produces any diagnostic determines the single
// `reason` the whole proposal is REJECTED for. Deterministic given
// deterministic inputs (this ticket's own section 26) -- no random id
// generation, no mutation of `request`.
// ============================================================

export async function evaluateAcceptance(request: AcceptConstructedDayRequest, deps: AcceptanceDeps, now: Date): Promise<AcceptanceDecision> {
  const structural = validateStructuralIntegrity(request);
  if (structural.length > 0) return { status: 'REJECTED', reason: 'INVALID_REQUEST', diagnostics: structural };

  const stale = validateNotStale(request, now);
  if (stale.length > 0) return { status: 'REJECTED', reason: 'STALE_PREVIEW', diagnostics: stale };

  const activity = validateActivities(request, deps);
  if (activity.length > 0) return { status: 'REJECTED', reason: 'INVALID_ACTIVITY', diagnostics: activity };

  const conflict = await validateAgainstFreshBlockers(request, deps, now);
  if (conflict.length > 0) return { status: 'REJECTED', reason: 'CONFLICT', diagnostics: conflict };

  const timing = await validateSelectedCandidateTiming(request, deps);
  if (timing.length > 0) return { status: 'REJECTED', reason: 'TIMING_CHECK_FAILED', diagnostics: timing };

  const writeIntents: AcceptedPlanWrite[] = request.proposedItems
    .map((item) => ({
      intentId: item.intentId,
      activityId: item.activityId,
      title: item.title,
      plannedStartAt: item.start,
      plannedEndAt: item.end,
      durationMinutes: exactDurationMinutes(item.start, item.end),
      placementSource: item.placementSource,
    }))
    .sort((a, b) => a.plannedStartAt.getTime() - b.plannedStartAt.getTime());

  return { status: 'ACCEPTABLE', writeIntents };
}
