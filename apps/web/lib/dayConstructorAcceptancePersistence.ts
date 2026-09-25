/**
 * Day Constructor V1 -- PR E2: atomic acceptance persistence + real
 * dependency wiring.
 *
 * ARCHITECTURE (this ticket's own section 1):
 *
 *   POST acceptance request
 *     -> authenticated user (route.ts, session boundary)
 *     -> authoritative `now` read ONCE (route.ts)
 *     -> persistAcceptedConstructedDay() (this file)
 *          -> replay/collision check (PlanCreationIdempotency)
 *          -> BEGIN + per-user advisory lock
 *          -> evaluateAcceptance() (PR E1, dayConstructorAcceptance.ts,
 *             UNMODIFIED -- reused verbatim, never re-implemented here)
 *          -> REJECTED -> ROLLBACK, zero writes
 *          -> ACCEPTABLE -> N Plan inserts + N claim fills -> COMMIT
 *
 * E2 never changes the proposal PR E1 decided was acceptable -- this file
 * only decides HOW (and whether) to durably persist that decision.
 *
 * Goals -> Planning Integration V1 PR C -- `persistAcceptedConstructedDay`
 * gained one new, optional, SIBLING parameter (`goalActivityLinks`, never
 * merged into `AcceptConstructedDayRequest`/E1's own scheduling-domain
 * contract) and one new atomic write inside the existing per-item loop
 * (`linkGoalActivityToPlannedActivity`, db.ts) -- see that loop's own
 * comment for the exact eligibility/atomicity rules. `evaluateAcceptance`
 * (E1) itself is untouched.
 */

import type { PoolClient } from 'pg';
import {
  beginTransaction,
  claimPlanCreation,
  fillPlanCreationClaim,
  findPlanCreationClaimsByPrefix,
  createPlannedActivityWithClient,
  listPlannedActivitiesForDay,
  getPlannedActivityForOwner,
  getUserById,
  linkGoalActivityToPlannedActivity,
  linkCaptureToPlannedActivity,
  type PlannedActivity,
  type CreatePlannedActivityInput,
} from './db';
import { resolveTzOffsetMinutes } from './timezone';
import { buildPersonalMuhurtaContextForUser } from './natalContext';
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';
import { runTimingSearch, type TimingSearchRequest } from '../../../packages/recommendation/src/timingSearch';
import {
  evaluateAcceptance,
  type AcceptConstructedDayRequest,
  type AcceptedProposedItem,
  type AcceptanceDeps,
  type AcceptanceRejectionReason,
  type AcceptanceDiagnostic,
  type AcceptedPlanWrite,
} from './dayConstructorAcceptance';
import { schedulingModeFromPlacementSource } from './plannedActivitySchedulingMode';

// ============================================================
// Idempotency key derivation (this ticket's own section 3/5). Length-
// prefixed encoding (never a bare `:`-joined string) so no value of
// `clientRequestId`/`intentId` containing a literal `:` can collide two
// otherwise-distinct (clientRequestId, intentId) pairs onto the same key.
//
// `deriveAcceptancePrefix` and `deriveAcceptanceIdempotencyKey` share ONE
// prefix-building block (pre-commit review fix) -- every per-item key for
// one acceptance starts with the EXACT SAME `deriveAcceptancePrefix(...)`
// string, which is also what `findPlanCreationClaimsByPrefix` (db.ts)
// uses to discover the COMPLETE stored claim set for one
// `clientRequestId`, not just whichever keys the current request happens
// to mention (see `classifyExistingAcceptanceState` below for why that
// distinction is the whole point).
// ============================================================

export const MAX_CLIENT_REQUEST_ID_LENGTH = 200; // mirrors the existing Plan-creation route's own limit.
export const MAX_INTENT_ID_LENGTH = 200;

export function deriveAcceptancePrefix(clientRequestId: string): string {
  return `day-constructor:${clientRequestId.length}:${clientRequestId}:`;
}

export function deriveAcceptanceIdempotencyKey(clientRequestId: string, intentId: string): string {
  return `${deriveAcceptancePrefix(clientRequestId)}${intentId}`;
}

/** Pure set-equality over two key lists -- order-independent, duplicate-
 * safe. Used to prove "the complete stored set for this clientRequestId
 * is EXACTLY the incoming proposal's own item set," never merely "every
 * incoming item has a match" (which a strict-subset retry would also
 * satisfy, incorrectly -- this is exactly the bug this review fixes). */
export function keySetsAreEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== a.length) return false; // a had a duplicate -- can never equal a duplicate-free b of the same length.
  return b.every((key) => setA.has(key));
}

// ============================================================
// Replay/collision content comparison (this ticket's own section 6/7/8/9)
// -- resolved WITHOUT any new schema. `PlanCreationIdempotency`'s existing
// (userId, clientRequestId) shape already lets every expected per-item key
// be looked up directly; comparing the ALREADY-PERSISTED Plan's own
// content against the CURRENT request's corresponding item is sufficient
// to distinguish a genuine idempotent replay from a collision (the same
// clientRequestId reused with a materially different proposal) -- no
// separate stored proposal fingerprint/hash is needed. See
// `persistAcceptedConstructedDay`'s own doc comment for the full
// classification rule this feeds into.
// ============================================================

export function plansMatchAcceptedItem(plan: PlannedActivity, item: AcceptedProposedItem): boolean {
  return (
    plan.title === item.title &&
    plan.plannedStartAt.getTime() === item.start.getTime() &&
    plan.plannedEndAt.getTime() === item.end.getTime() &&
    (plan.activityId ?? null) === (item.activityId ?? null)
  );
  // `placementSource` is deliberately NOT compared -- it is never persisted
  // as acquisition provenance (this ticket's own section 18/27: "PlannedActivity
  // stays completely unaware of acquisition source" is an already-
  // established house rule, migration 0025's own doc comment). F1 persists the
  // scheduling CONSTRAINT derived from it (`schedulingMode`) on the FIRST accept;
  // a replay returns the already-persisted plans and never rewrites that value,
  // so a resubmission claiming a different placementSource is still an idempotent
  // replay of the original acceptance, never a change of its scheduling mode.
}

// ============================================================
// AcceptedPlanWrite -> CreatePlannedActivityInput (this ticket's own
// section 18/23). Legacy Muhurtham-Finder-era fields (`windowType`/
// `windowLabel`/`matchLabel`/`score`/`recommendation`/`calendarUrl`/
// `eventTimezone`/`eventLocationName`) have no Day Constructor equivalent
// and are never fabricated -- `windowType: 'NEUTRAL'` is the SAME honest
// "no specific Panchang window classification" value the existing
// `POST /api/plans` route already defaults to when a caller omits
// `windowType` entirely; every other legacy field is left `null`/omitted,
// its own already-established optional/nullable meaning on this table.
// ============================================================

export function toCreatePlannedActivityInput(userId: string, write: { activityId?: string; title: string; plannedStartAt: Date; plannedEndAt: Date; durationMinutes: number; placementSource?: AcceptedPlanWrite['placementSource'] }): CreatePlannedActivityInput {
  return {
    userId,
    title: write.title,
    activityType: write.title,
    plannedStartAt: write.plannedStartAt,
    plannedEndAt: write.plannedEndAt,
    durationMinutes: write.durationMinutes,
    windowType: 'NEUTRAL',
    activityId: write.activityId ?? null,
    // F1: the intent's own constraint (FIXED_CONSTRAINT -> FIXED, SELECTED_CANDIDATE -> FLEXIBLE). Accepting the
    // proposed time never turns a FLEXIBLE intent into FIXED. Absent/unknown placementSource -> null = protected.
    schedulingMode: schedulingModeFromPlacementSource(write.placementSource),
  };
}

// ============================================================
// Persistence result contract (this ticket's own section 16). Exposes a
// persistence-level outcome, never DB internals/stack traces.
// ============================================================

export type AcceptConstructedDayPersistenceResult =
  | { status: 'SAVED'; plans: PlannedActivity[] }
  | { status: 'ALREADY_ACCEPTED'; plans: PlannedActivity[] }
  | { status: 'REJECTED'; reason: AcceptanceRejectionReason; diagnostics: AcceptanceDiagnostic[] }
  | { status: 'IDEMPOTENCY_CONFLICT' }
  | { status: 'SAVE_FAILED' };

// ============================================================
// Real AcceptanceDeps wiring (this ticket's own section 11/12/13/32).
// Reuses PR E1's own `evaluateAcceptance` unmodified -- this factory only
// supplies real reads/the real timing engine, never re-implements
// acceptance rules. `loadFreshBlockers`/`getPlannedActivityForOwner`-style
// reads run on the SAME transaction `client` passed in, so acceptance
// validation sees a state consistent with everything already done inside
// this same transaction (this ticket's own section 31).
//
// CHECK is local, synchronous, in-memory computation (confirmed by
// re-reading `evaluateTimingCandidate`/`runCheck` -- no network/DB I/O),
// so running it inside an open transaction (this ticket's own section 32)
// holds no external-I/O risk.
// ============================================================

function createRealAcceptanceDeps(userId: string, client: PoolClient, timingContext: TimingSearchRequest['context']): AcceptanceDeps {
  return {
    loadFreshBlockers: async (bounds) => {
      const plans = await listPlannedActivitiesForDay(userId, bounds.from, bounds.to, client);
      return plans.map((plan) => ({ start: new Date(plan.plannedStartAt), end: new Date(plan.plannedEndAt), status: plan.status }));
    },
    validateActivity: (activityId) => getActivityProfileById(activityId) !== undefined,
    checkTiming: (request) => {
      const searchRequest: TimingSearchRequest = request.activityId
        ? { mode: 'CHECK', activityId: request.activityId, durationMinutes: request.durationMinutes, candidateStart: request.candidateStart.toISOString(), context: timingContext }
        : { mode: 'CHECK', taskTitle: request.taskTitle, durationMinutes: request.durationMinutes, candidateStart: request.candidateStart.toISOString(), context: timingContext };
      const response = runTimingSearch(searchRequest);
      // CHECK's own contract guarantees `requestedCandidate` is always
      // present (TimingSearchResponse's own doc comment: "CHECK: exactly
      // [requestedCandidate]") -- this is a defensive assertion, never a
      // path this file expects to actually take.
      if (!response.requestedCandidate) throw new Error('CHECK did not return a requestedCandidate.');
      return response.requestedCandidate;
    },
  };
}

// ============================================================
// persistAcceptedConstructedDay -- the main entry point (this ticket's
// own section 1/6/7/8/9/24/27/28/29).
//
// REPLAY/COLLISION CLASSIFICATION (resolved without new schema -- this
// ticket's own section 6/7/8/9, corrected in a pre-commit review pass --
// see below for the bug the correction fixes):
//
//   1. Discover the COMPLETE stored claim set for this `clientRequestId`
//      via `findPlanCreationClaimsByPrefix` -- every row EVER created
//      under it, regardless of which items the CURRENT request mentions.
//   2. If that stored set is empty: genuinely fresh -- proceed to fresh
//      validation.
//   3. Otherwise, the stored set must be EXACTLY EQUAL (`keySetsAreEqual`,
//      set identity, not subset/superset containment) to the incoming
//      request's own derived key set, AND every stored claim must already
//      be filled -- otherwise: IDEMPOTENCY_CONFLICT, zero writes.
//   4. If the sets match and all are filled, every filled claim's
//      persisted Plan content must match this request's own corresponding
//      item exactly (`plansMatchAcceptedItem`) -- if so, this is a genuine
//      idempotent replay: return ALREADY_ACCEPTED with zero new writes,
//      WITHOUT re-running blocker validation (re-validating would
//      incorrectly see this acceptance's OWN already-committed Plans as
//      fresh conflicts against itself). Otherwise: IDEMPOTENCY_CONFLICT.
//
// THE BUG THIS FIXES: an earlier version of this function only ever
// looked up claims for the keys the INCOMING request itself derived,
// never discovering keys that exist under the same `clientRequestId` but
// are ABSENT from the current request. That let a genuine collision slip
// through as a false ALREADY_ACCEPTED whenever the retried item set was a
// STRICT SUBSET of the original (e.g. original [A,B] succeeds, then a
// retry submitting only [A] found A's own claim filled and matching, and
// incorrectly treated that as a complete, valid replay -- silently
// tolerating the client's dropped item B rather than rejecting the
// mismatched confirmation). Prefix-based COMPLETE discovery (step 1)
// closes this: the stored set's own SIZE is now always known, so a
// subset/superset/disjoint mismatch is caught by `keySetsAreEqual` before
// any content comparison even runs. A single atomic transaction still
// guarantees "ALL filled or NONE filled" for any ONE proposal's own
// successful run, so "sets equal but not all filled" remains proof of a
// same-id race rather than an ambiguous state requiring a separate
// INCONSISTENT_ACCEPTANCE_STATE result.
//
// CONCURRENCY (this ticket's own section 27/28/29/30): a Postgres
// transaction-scoped advisory lock keyed by `userId`
// (`pg_advisory_xact_lock`, automatically released at COMMIT/ROLLBACK,
// never leaked by a crashed connection) serializes every Day Constructor
// acceptance FOR THE SAME USER -- never blocking unrelated users. Two
// concurrent identical requests: the second blocks on the lock until the
// first's transaction ends, then re-reads claims (now all filled) and
// returns ALREADY_ACCEPTED -- no duplicate Plans, no application-level
// polling loop (Postgres's own lock wait is the only "waiting").
//
// DELIBERATE, EXPLICIT LIMITATION (this ticket's own section 30, not
// silently assumed): this lock and the fresh-blocker re-read inside this
// transaction guarantee atomicity between concurrent Day Constructor
// acceptances for one user. They do NOT and cannot guarantee atomicity
// against a concurrent ORDINARY `POST /api/plans` write for the same
// user, since that route's own `createPlannedActivity` neither takes this
// advisory lock nor runs inside any transaction today. Re-reading fresh
// blockers immediately before insert (rather than trusting a stale read
// from before this transaction opened) narrows that race to the smallest
// practically achievable window without modifying `/api/plans` -- it does
// not eliminate it. Modifying `/api/plans` to close this fully is an
// explicit, separate architecture decision this PR does not make.
// ============================================================

export async function persistAcceptedConstructedDay(
  userId: string,
  request: AcceptConstructedDayRequest,
  now: Date,
  // Goals -> Planning Integration V1 PR C -- a SIBLING envelope, never
  // merged into `AcceptConstructedDayRequest` (this PR's own section 20:
  // "keep the Goal linkage envelope outside" E1's scheduling-domain
  // contract). `evaluateAcceptance` (E1, imported below, unmodified)
  // never receives this parameter at all -- it is consulted ONLY inside
  // this file's own write loop, after E1 has already decided
  // `decision.writeIntents`.
  goalActivityLinks: ReadonlyMap<string, string> = new Map(),
  // Quick Capture V1 PR B -- the sibling of goalActivityLinks above, same
  // rules: consulted only in the write loop, never seen by E1.
  captureLinks: ReadonlyMap<string, string> = new Map()
): Promise<AcceptConstructedDayPersistenceResult> {
  if (!request.clientRequestId || request.clientRequestId.length > MAX_CLIENT_REQUEST_ID_LENGTH) {
    return { status: 'REJECTED', reason: 'INVALID_REQUEST', diagnostics: [{ intentId: '', reason: 'INVALID_REQUEST', detail: 'INVALID_CLIENT_REQUEST_ID' }] };
  }
  for (const item of request.proposedItems) {
    if (!item.intentId || item.intentId.length > MAX_INTENT_ID_LENGTH) {
      return { status: 'REJECTED', reason: 'INVALID_REQUEST', diagnostics: [{ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'INVALID_INTENT_ID' }] };
    }
  }

  const user = await getUserById(userId);
  if (!user) return { status: 'SAVE_FAILED' };

  const client = await beginTransaction();
  try {
    // Per-user advisory lock -- held for the remainder of this
    // transaction, released automatically on COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day-constructor-accept:${userId}`]);

    // Replay/collision classification (see this function's own doc
    // comment above, and `classifyExistingAcceptanceState`'s own doc
    // comment below for the exact rule) -- skipped only when there is
    // nothing to classify (an empty proposal falls straight through to
    // evaluateAcceptance, which already rejects it as
    // INVALID_REQUEST/EMPTY_PROPOSAL).
    if (request.proposedItems.length > 0) {
      const keyed = request.proposedItems.map((item) => ({ item, key: deriveAcceptanceIdempotencyKey(request.clientRequestId, item.intentId) }));
      // COMPLETE discovery (pre-commit review fix) -- every row EVER
      // created under this clientRequestId, not just the keys the
      // incoming request happens to mention. This is what makes set-
      // identity (not mere subset containment) provable.
      const storedClaims = await findPlanCreationClaimsByPrefix(userId, deriveAcceptancePrefix(request.clientRequestId), client);

      if (storedClaims.length > 0) {
        const storedKeys = storedClaims.map((claim) => claim.clientRequestId);
        const incomingKeys = keyed.map(({ key }) => key);
        const filledCount = storedClaims.filter((claim) => claim.plannedActivityId).length;

        if (!keySetsAreEqual(storedKeys, incomingKeys) || filledCount !== storedClaims.length) {
          // Either the stored item-ID set differs from the incoming one
          // (a strict subset/superset/disjoint/partial-overlap retry --
          // this is the exact bug class this review targets, e.g. original
          // [A,B] retried as [A] alone must NOT look like a valid replay
          // just because A's own claim is filled), or a stored claim
          // exists but is not yet filled (structurally should not happen
          // at rest -- an incomplete transaction rolls its own claim rows
          // back too -- treated defensively as a collision rather than an
          // opportunity to complete someone else's partial work). Either
          // way: zero writes, never a partial create.
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_CONFLICT' };
        }

        // Sets match exactly and every stored claim is filled -- verify
        // this is a genuine replay of THIS SAME proposal's own content,
        // not merely the same item-ID set with different times/titles.
        const byKey = new Map(keyed.map(({ key, item }) => [key, item]));
        const plans = await Promise.all(storedClaims.map((claim) => getPlannedActivityForOwner(userId, claim.plannedActivityId!, client)));
        const allMatch = plans.every((plan, index) => plan !== null && plansMatchAcceptedItem(plan, byKey.get(storedClaims[index].clientRequestId)!));
        await client.query(allMatch ? 'COMMIT' : 'ROLLBACK');
        return allMatch ? { status: 'ALREADY_ACCEPTED', plans: plans as PlannedActivity[] } : { status: 'IDEMPOTENCY_CONFLICT' };
      }

      // No stored claims at all under this clientRequestId -- genuinely
      // fresh; claim every key now, still inside this same lock+
      // transaction, before validating.
      for (const { key } of keyed) {
        const claimed = await claimPlanCreation(userId, key, client);
        if (!claimed) {
          // Lost a claim we should be the only writer for, under our own
          // held advisory lock -- treated as a hard failure, never
          // silently retried/ignored.
          await client.query('ROLLBACK');
          return { status: 'SAVE_FAILED' };
        }
      }
    }

    const timingContext: TimingSearchRequest['context'] = {
      now,
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
      tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
      personalContext: buildPersonalMuhurtaContextForUser(user),
    };
    const deps = createRealAcceptanceDeps(userId, client, timingContext);
    const decision = await evaluateAcceptance(request, deps, now);

    if (decision.status === 'REJECTED') {
      await client.query('ROLLBACK');
      return { status: 'REJECTED', reason: decision.reason, diagnostics: decision.diagnostics };
    }

    const plans: PlannedActivity[] = [];
    for (const writeIntent of decision.writeIntents) {
      const plan = await createPlannedActivityWithClient(client, toCreatePlannedActivityInput(userId, writeIntent));
      const key = deriveAcceptanceIdempotencyKey(request.clientRequestId, writeIntent.intentId);
      await fillPlanCreationClaim(userId, key, plan.id, client);

      // Goals -> Planning Integration V1 PR C, this file's own section
      // 26/27 -- the atomic reverse link, on the SAME `client`/
      // transaction as the PlannedActivity insert immediately above it.
      // Only rows the CALLER already proved (a) carry Goal provenance and
      // (b) were actually placed reach this map at all (see
      // buildGoalActivityLinksForAccept, planDayEntry.ts) -- a deferred
      // or removed-before-preview Goal row is never a key here, so it
      // never receives a link (this PR's own section 22).
      const goalActivityId = goalActivityLinks.get(writeIntent.intentId);
      const captureId = captureLinks.get(writeIntent.intentId);
      // A planning row has at most one source; a request claiming both for
      // one intent is malformed -- fail the whole acceptance.
      if (goalActivityId && captureId) throw new Error('AMBIGUOUS_SOURCE_LINK');
      if (captureId) {
        const captureLinked = await linkCaptureToPlannedActivity(userId, captureId, plan.id, client);
        if (!captureLinked) throw new Error('CAPTURE_LINK_FAILED');
      }
      if (goalActivityId) {
        const linked = await linkGoalActivityToPlannedActivity(userId, goalActivityId, plan.id, client);
        if (!linked) {
          // This PR's own section 24/25/27: the GoalActivity does not
          // exist, is not owned by this user, is DISMISSED, or already
          // retains a live (UPCOMING/LOGGED) linkage to a DIFFERENT Plan
          // -- never silently continue. Throwing here is caught by this
          // function's own outer try/catch below, which ROLLBACKs the
          // WHOLE transaction (this Plan insert included) and returns
          // SAVE_FAILED -- no orphan PlannedActivity, no half-linked
          // GoalActivity, no partial mixed-source acceptance (this PR's
          // own section 26/31).
          throw new Error('GOAL_ACTIVITY_LINK_FAILED');
        }
      }

      plans.push(plan);
    }

    await client.query('COMMIT');
    return { status: 'SAVED', plans };
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return { status: 'SAVE_FAILED' };
  } finally {
    client.release();
  }
}
