/**
 * Remaining-Day Recomposition V1 PR F3 -- ATOMIC ACCEPTANCE of an F2 proposal.
 *
 *   F2 DECIDES.  F3 VALIDATES AND COMMITS.
 *
 * F3 never replans: it does not run the Constructor, does not re-run recomposition and never turns a KEEP into a
 * MOVE or vice versa. It takes the exact, server-signed proposal (remainingDayRecompositionIntegrity.ts), proves the
 * world still matches, and applies EVERY signed MOVE in ONE transaction -- or changes nothing. A stale or invalid
 * proposal is rejected; the user asks for a fresh one.
 *
 * SIGNED PROVENANCE != CURRENT SAFETY. The token only proves what Aura proposed. Everything below is re-checked
 * against current state, inside the transaction, after the locks are held.
 *
 * TRANSACTION, LOCK AND CLOCK ORDER (deadlock-safe, shared with manual Move and Day Constructor acceptance):
 *   1. verify the token (no DB, before anything is opened) -> INVALID_TOKEN
 *   2. BEGIN; per-user advisory lock `day-constructor-accept:<userId>` (the SAME namespace movePlannedActivity and
 *      persistAcceptedConstructedDay use, so all three serialize per user)
 *   3. SELECT ... FOR UPDATE on EVERY reconsidered plan (MOVE, KEEP and UNRESOLVED), ordered by id -- a deterministic
 *      lock order, so two acceptances sharing plans can never deadlock, and Done/Skip/Cancel (which take only row
 *      locks, never the advisory lock) cannot slip in between validation and writes
 *   4. identical-replay recognition (state only: it needs no clock, and a proposal that was ACCEPTED must still read as
 *      ALREADY_ACCEPTED after its destinations, or the day, have passed -- retry safety)
 *   5. THE ACCEPTANCE CLOCK: `clock_timestamp()` read ONCE, on this same transaction connection, AFTER the locks.
 *      LOCK-WAIT TIME COUNTS: a proposal that was future when the request arrived but became past-due (or a source
 *      became ACTIVE/MISSED, or local midnight passed) while it waited is rejected. This is the same principle as manual
 *      Move (a clock read after its lock). No route-entry / pre-lock clock is ever used; that single instant feeds every
 *      time-sensitive decision below (destination future, ACTIVE/MISSED, local day, availability window, moment lookup,
 *      collision blocker rule). A failure to read it fails the acceptance (SAVE_FAILED, rolled back) -- no fallback.
 *   6. staleness validation, then FINAL-STATE validation
 *   7. writes (sorted by plan id) through the SAME internals as a manual Move (`applyMoveWrites`), COMMIT
 * A manual Move takes the advisory lock and then one row lock, in that same order, so no lock-order inversion exists.
 *
 * FINAL-STATE VALIDATION: all MOVE source slots are released together and all destinations are validated together
 * against current blockers, availability and each other, so a swap (A<->B) or a rotation is valid as a FINAL schedule
 * even though no single move would be valid sequentially. Interval semantics are the repository's `[start, end)`
 * (touching is allowed) and collision uses the very same query and blocker rule as manual Move (`findBlockingPlanForRange`),
 * so plans protected by F2's candidate cap, FIXED / NULL plans, ACTIVE plans, LOGGED plans, KEEP and UNRESOLVED plans
 * all keep blocking; only the MOVE sources are released.
 *
 * IDEMPOTENCY WITHOUT NEW SCHEMA (audited): `PlanCreationIdempotency` claims a client key per CREATED plan and fills a
 * single plannedActivityId, so it cannot represent one multi-plan transaction; a table for this would be a schema
 * change F3 was told to avoid. The proposal's identity is the signed proposal itself, and its effect is fully
 * recorded in the data: a source MOVED whose successor (unique `rescheduledFromPlanId`, so at most one) sits exactly at
 * the signed destination. If EVERY signed MOVE is already in that state the request is an identical replay and returns
 * ALREADY_ACCEPTED with no writes; a mixture is stale. The advisory lock makes concurrent identical requests
 * serialize: exactly one performs the moves, the other observes the replay state.
 *
 * GUARANTEE (exactly what is provided): F3 validates the exact signed proposal against the state committed and visible to
 * its transaction at its validation boundary (after the locks, at the acceptance clock) and applies its own Move set
 * atomically -- all of it or none of it. It does NOT claim that no other writer can ever add an overlapping plan.
 *
 * KNOWN, CLASSIFIED V1 BOUNDARIES (pre-existing writers that do not take the advisory lock; each yields an end state
 * that equals a legal serial history, because none of them validates overlap or availability itself, and existing plans
 * are never retro-validated):
 *   - POST /api/plans (createPlannedActivity: plain autocommit INSERT, no overlap check) can add a plan between F3's
 *     validation and its commit;
 *   - the availability writer can change availability after F3 read it (F3 reads it through the pool, after the locks);
 *   - an AuraMoment can be linked to a source after the moment check (manual Move has the same window);
 *   - Day Constructor acceptance shares the advisory lock, so it serializes; only writers WITHOUT the lock are listed.
 *
 * NOT DONE HERE: no UI, no automatic acceptance, no paging, no tomorrow/week.
 */
import { beginTransaction, getUserById, listPlanIdsWithActiveMoment, type PlannedActivity, type User } from './db';
import {
  createRealDayConstructorOrchestratorDeps,
  resolveAvailabilityAwareWindow,
  resolveConstructionWindow,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
} from './dayConstructorOrchestrator';
import { findBlockingPlanForRange, applyMoveWrites } from './planMove';
import { hasFlexibleScheduling } from './plannedActivitySchedulingMode';
import { localDayBoundsUTC } from './myDayOrchestrator';
import { getDatePartsInTimezone } from './timezone';
import { verifyRecompositionProposalToken, type SignedDecision, type SignedSlot } from './remainingDayRecompositionIntegrity';
import type { BlockedInterval } from './dayCapacity';
import type { ConstructionWindow } from './dayIntent';

export type RecompositionStaleReason =
  | 'TIMEZONE_CHANGED'
  | 'DAY_CHANGED'
  | 'SOURCE_NOT_FOUND'
  | 'LIFECYCLE_CHANGED'
  | 'SCHEDULING_MODE_CHANGED'
  | 'SOURCE_SLOT_CHANGED'
  | 'KEEP_CHANGED'
  | 'ACTIVE_OR_MISSED'
  | 'MOMENT_ACTIVE'
  | 'DESTINATION_PAST'
  | 'DESTINATION_OUTSIDE_TODAY'
  | 'DURATION_MISMATCH'
  | 'AVAILABILITY_CHANGED'
  | 'CONFLICT';

export interface AcceptedRecompositionMove {
  sourcePlanId: string;
  successorPlanId: string;
  from: SignedSlot;
  to: SignedSlot;
  /** The current occurrence (B): status UPCOMING, rescheduledFromPlanId = the source, schedulingMode inherited. */
  successor: PlannedActivity;
}

export type AcceptRecompositionResult =
  | { status: 'ACCEPTED' | 'ALREADY_ACCEPTED'; targetDate: string; moves: AcceptedRecompositionMove[] }
  /** The token cannot be trusted (missing, tampered, wrong purpose/version/user, malformed). */
  | { status: 'INVALID_TOKEN' }
  /** The token is genuine but the world no longer matches it: request a fresh proposal. Nothing was written. */
  | { status: 'STALE'; reason: RecompositionStaleReason; planId?: string }
  | { status: 'SAVE_FAILED' };

type TransactionClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export interface RecompositionAcceptanceDeps {
  getUser: (userId: string) => Promise<User | null>;
  /**
   * The acceptance clock, called ONCE, after the advisory and row locks, with the transaction's own connection.
   * Production always uses the default (`clock_timestamp()` on that connection). Overriding it is an explicit TEST SEAM
   * only -- no production path passes one, and the HTTP route supplies no clock at all.
   */
  readClock: (client: TransactionClient) => Promise<Date>;
  /** Current availability configuration (the same reader the Day Constructor uses). */
  loadAvailabilityConfiguration: (user: User, now: Date) => ReturnType<DayConstructorOrchestratorDeps['loadAvailabilityConfiguration']>;
}
/** The authoritative acceptance clock: PostgreSQL `clock_timestamp()` on the SAME transaction connection, read after the locks. Throws (no fallback) if it cannot be read. */
export async function readTransactionClock(client: TransactionClient): Promise<Date> {
  const result = await client.query('SELECT clock_timestamp() AS now');
  const value = result.rows[0]?.now;
  const clock = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(clock.getTime())) throw new Error('The acceptance clock could not be read.');
  return clock;
}

export const realRecompositionAcceptanceDeps: RecompositionAcceptanceDeps = {
  getUser: (userId) => getUserById(userId),
  readClock: readTransactionClock,
  loadAvailabilityConfiguration: (user, now) => createRealDayConstructorOrchestratorDeps(user, now).loadAvailabilityConfiguration(),
};

const ms = (d: Date | string) => new Date(d).getTime();
const sameSlot = (row: PlannedActivity, slot: SignedSlot) => ms(row.plannedStartAt) === slot.start.getTime() && ms(row.plannedEndAt) === slot.end.getTime();
const overlaps = (a: SignedSlot, b: SignedSlot) => a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

// ------------------------------------------------------------
// Pure destination validation (final state, all destinations together)
// ------------------------------------------------------------

export interface DestinationViolation {
  reason: Extract<RecompositionStaleReason, 'DESTINATION_PAST' | 'DESTINATION_OUTSIDE_TODAY' | 'AVAILABILITY_CHANGED' | 'CONFLICT'>;
  planId: string;
}

/**
 * Checks every signed destination against the acceptance clock, today's local bounds, the CURRENT remaining-day
 * window and availability gaps, and against each other -- all at once, in deterministic (plan id) order. Pure.
 * (Collision with plans already in the schedule is checked in the transaction with the shared Move query.)
 */
export function validateDestinations(moves: ReadonlyArray<{ planId: string; to: SignedSlot }>, now: Date, dayBounds: { from: Date; to: Date }, window: Pick<ConstructionWindow, 'start' | 'end'>, gapBlockers: ReadonlyArray<Pick<BlockedInterval, 'start' | 'end'>>): DestinationViolation | null {
  const ordered = [...moves].sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0));
  for (const move of ordered) {
    if (move.to.start.getTime() <= now.getTime()) return { reason: 'DESTINATION_PAST', planId: move.planId };
    if (move.to.start.getTime() < dayBounds.from.getTime() || move.to.end.getTime() > dayBounds.to.getTime()) return { reason: 'DESTINATION_OUTSIDE_TODAY', planId: move.planId };
    if (move.to.start.getTime() < window.start.getTime() || move.to.end.getTime() > window.end.getTime()) return { reason: 'AVAILABILITY_CHANGED', planId: move.planId };
    if (gapBlockers.some((gap) => overlaps(move.to, gap))) return { reason: 'AVAILABILITY_CHANGED', planId: move.planId };
  }
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) if (overlaps(ordered[i].to, ordered[j].to)) return { reason: 'CONFLICT', planId: ordered[j].planId };
  return null;
}

// ------------------------------------------------------------
// Acceptance
// ------------------------------------------------------------

export async function acceptRemainingDayRecomposition(userId: string, proposalToken: unknown, deps: RecompositionAcceptanceDeps = realRecompositionAcceptanceDeps): Promise<AcceptRecompositionResult> {
  const verified = verifyRecompositionProposalToken(userId, proposalToken);
  if (!verified.ok) return { status: 'INVALID_TOKEN' };
  const proposal = verified.proposal;
  const stale = (reason: RecompositionStaleReason, planId?: string): AcceptRecompositionResult => ({ status: 'STALE', reason, ...(planId ? { planId } : {}) });

  const client = await beginTransaction();
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day-constructor-accept:${userId}`]);
    const finish = async (result: AcceptRecompositionResult, commit: boolean): Promise<AcceptRecompositionResult> => {
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    };

    // Lock EVERY reconsidered plan in id order (deterministic; see the lock hierarchy above).
    const ids = proposal.decisions.map((d) => d.planId); // canonical: strictly ascending
    const locked = await client.query(`SELECT * FROM "PlannedActivity" WHERE id = ANY($1::text[]) AND "userId" = $2 ORDER BY id FOR UPDATE`, [ids, userId]);
    const rows = new Map<string, PlannedActivity>(locked.rows.map((row: PlannedActivity) => [row.id, row]));
    for (const decision of proposal.decisions) if (!rows.has(decision.planId)) return finish(stale('SOURCE_NOT_FOUND', decision.planId), false);

    const moves = proposal.decisions.filter((d): d is SignedDecision & { to: SignedSlot } => d.decision === 'MOVE');

    // ---- identical replay: every signed MOVE already applied exactly as signed ----
    const alreadyMoved = moves.filter((d) => rows.get(d.planId)!.status === 'MOVED');
    if (alreadyMoved.length > 0) {
      if (alreadyMoved.length !== moves.length) return finish(stale('LIFECYCLE_CHANGED', alreadyMoved[0].planId), false);
      const successors = await client.query(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = ANY($1::text[]) AND "userId" = $2`, [moves.map((d) => d.planId), userId]);
      const bySource = new Map<string, PlannedActivity>(successors.rows.map((row: PlannedActivity) => [row.rescheduledFromPlanId as string, row]));
      const replay: AcceptedRecompositionMove[] = [];
      for (const move of moves) {
        const successor = bySource.get(move.planId);
        if (!successor || !sameSlot(successor, move.to)) return finish(stale('LIFECYCLE_CHANGED', move.planId), false);
        replay.push({ sourcePlanId: move.planId, successorPlanId: successor.id, from: move.current, to: move.to, successor });
      }
      return finish({ status: 'ALREADY_ACCEPTED', targetDate: proposal.targetDate, moves: replay }, true);
    }

    // ---- the ONE acceptance clock (post-lock, this transaction's connection) and the user context it is judged in ----
    const now = await deps.readClock(client);
    const user = await deps.getUser(userId);
    if (!user) return finish({ status: 'INVALID_TOKEN' }, false);
    if (user.timezone !== proposal.timezone) return finish(stale('TIMEZONE_CHANGED'), false);
    if (getDatePartsInTimezone(proposal.timezone, now).dateStr !== proposal.targetDate) return finish(stale('DAY_CHANGED'), false);

    // ---- staleness: what the proposal relies on must still be exactly true ----
    for (const decision of proposal.decisions) {
      const row = rows.get(decision.planId)!;
      if (row.status !== 'UPCOMING') return finish(stale('LIFECYCLE_CHANGED', decision.planId), false);
      if (!sameSlot(row, decision.current)) return finish(stale(decision.decision === 'MOVE' ? 'SOURCE_SLOT_CHANGED' : 'KEEP_CHANGED', decision.planId), false);
    }
    for (const move of moves) {
      const row = rows.get(move.planId)!;
      if (!hasFlexibleScheduling(row)) return finish(stale('SCHEDULING_MODE_CHANGED', move.planId), false);
      if (ms(row.plannedStartAt) <= now.getTime()) return finish(stale('ACTIVE_OR_MISSED', move.planId), false); // started (ACTIVE) or elapsed (MISSED)
      const durationMs = row.durationMinutes * 60_000;
      if (!Number.isFinite(durationMs) || durationMs <= 0 || ms(row.plannedEndAt) - ms(row.plannedStartAt) !== durationMs || move.to.end.getTime() - move.to.start.getTime() !== durationMs) return finish(stale('DURATION_MISMATCH', move.planId), false);
    }
    const withMoment = await listPlanIdsWithActiveMoment(moves.map((d) => d.planId), now, client);
    const momentPlan = moves.find((d) => withMoment.has(d.planId));
    if (momentPlan) return finish(stale('MOMENT_ACTIVE', momentPlan.planId), false);

    // ---- final-state validation: release ALL sources, validate ALL destinations together ----
    const dayBounds = localDayBoundsUTC(proposal.targetDate, proposal.timezone);
    const request = { targetDate: proposal.targetDate, timezone: proposal.timezone, constructionWindowSource: 'REMAINING_TODAY', now, intents: [] } as ConstructDayRequest;
    const availabilityDeps = { loadAvailabilityConfiguration: () => deps.loadAvailabilityConfiguration(user, now) } as DayConstructorOrchestratorDeps;
    const availability = await resolveAvailabilityAwareWindow(request, availabilityDeps);
    let window: Pick<ConstructionWindow, 'start' | 'end'>;
    let gapBlockers: BlockedInterval[] = [];
    if (availability.status === 'READY') {
      window = availability.window;
      gapBlockers = availability.gapBlockers;
    } else if (availability.status === 'UNCONFIGURED_TODAY') {
      const remaining = resolveConstructionWindow(request);
      if (remaining.status !== 'READY') return finish(stale('AVAILABILITY_CHANGED'), false);
      window = remaining.window;
    } else {
      return finish(stale('AVAILABILITY_CHANGED'), false); // no usable capacity now / future availability required
    }
    const violation = validateDestinations(moves.map((d) => ({ planId: d.planId, to: d.to })), now, dayBounds, window, gapBlockers);
    if (violation) return finish(stale(violation.reason, violation.planId), false);
    const sourceIds = moves.map((d) => d.planId);
    for (const move of moves) if (await findBlockingPlanForRange(client, userId, sourceIds, move.to.start, move.to.end, now)) return finish(stale('CONFLICT', move.planId), false);

    // ---- writes: the same internals as a manual Move, one transaction, deterministic order ----
    const accepted: AcceptedRecompositionMove[] = [];
    for (const move of moves) {
      const { to } = await applyMoveWrites(client, userId, rows.get(move.planId)!, move.to.start, move.to.end);
      accepted.push({ sourcePlanId: move.planId, successorPlanId: to.id, from: move.current, to: move.to, successor: to });
    }
    return finish({ status: 'ACCEPTED', targetDate: proposal.targetDate, moves: accepted }, true);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('day/recompose/accept: unexpected failure', err instanceof Error ? err.message : err);
    return { status: 'SAVE_FAILED' };
  } finally {
    client.release();
  }
}
