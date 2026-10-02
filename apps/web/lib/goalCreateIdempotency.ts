/**
 * Goals V2 Candidate B3.1 -- Goal-create idempotency, server-only (never
 * imported by a 'use client' component -- `createHash` is a Node builtin
 * that does not belong in a client bundle; contrast with lib/goals.ts,
 * which stays deliberately crypto-free for exactly that reason).
 *
 * Architecture decision (this ticket's own sections 2-4): the existing
 * `PlanCreationIdempotency` table (db.ts) was audited and rejected as a
 * foundation for Goal-create idempotency -- its own `plannedActivityId`
 * result column is a real foreign key into "PlannedActivity", not a
 * generic "any result id" slot; storing a Goal id there would either
 * violate that FK outright or require leaving the result permanently
 * unfilled (losing "replay returns the original result" entirely).
 * Reusing it would mean lying about its domain, which this ticket's own
 * section 3 explicitly forbids.
 *
 * Instead, this reuses `Goal.id` itself as the idempotency key, applying
 * the EXACT SAME "insert, let Postgres's own unique constraint decide,
 * recover by re-fetching on 23505" pattern `logHabitCompletion`/
 * `getHabitLogByClientRequestId` (db.ts) already establish for HabitLog --
 * just keyed by the table's own primary key instead of a second
 * `clientRequestId` column + partial unique index, which would require a
 * migration. A Goal id derived this way is a pure, stateless function of
 * (userId, clientRequestId) -- nothing is written or claimed ahead of the
 * real Goal INSERT itself, so a failed attempt (validation error, DB
 * error) leaves nothing behind to recover from; a plain retry with the
 * same clientRequestId simply attempts the same deterministic id again,
 * fresh (this ticket's own section 11).
 */
import { createHash } from 'crypto';
import { DONE_COMPLETION_REQUIREMENT, type CompletionRequirement } from './goalCompletion';
import { NONE_GOAL_ACTIVITY_RHYTHM, type GoalActivityRhythm } from './goalActivityRhythm';

/**
 * Deterministic, non-reversible, user-salted. Salting by the AUTHENTICATED
 * session's own userId (never a client-supplied value) means two
 * different users who happen to generate the identical opaque
 * clientRequestId string produce two completely different Goal ids -- no
 * cross-user collision is possible (this ticket's own section 7/15).
 * Plain SHA-256 hex, not a UUIDv5 -- Goal.id has no DB-level UUID type
 * constraint (schema.prisma's own `String @id @default(uuid())`, no
 * `@db.Uuid`), and every reader already treats it as an opaque string, so
 * there is nothing to gain from hand-rolling UUID version/variant bits
 * (this ticket's own section 5: "do not invent cryptographic semantics
 * beyond what is needed").
 */
export function deriveIdempotentGoalId(userId: string, clientRequestId: string): string {
  return createHash('sha256').update(`goal-create:${userId}:${clientRequestId}`).digest('hex');
}

/** The shape of one activity as the INCOMING request expresses it
 * (completionRequirement/rhythm optional -- omitted means the canonical
 * default, same convention as createGoalWithActivities itself). */
export interface IdempotentGoalCreateActivity {
  title: string;
  activityId: string | null;
  completionRequirement?: CompletionRequirement;
  rhythm?: GoalActivityRhythm;
}

/** The shape of one activity as ALREADY PERSISTED, normalized back to
 * canonical form (completionKind/rhythmKind's own null-means-default
 * already resolved by the caller via normalizeGoalActivityCompletionRequirement/
 * normalizeGoalActivityRhythm -- this module performs no DB access and no
 * normalization of its own). */
export interface PersistedIdempotentGoalCreateActivity {
  title: string;
  activityId: string | null;
  completionRequirement: CompletionRequirement;
  rhythm: GoalActivityRhythm;
}

/**
 * This ticket's own sections 9/18 -- payload-mismatch detection, with NO
 * stored fingerprint of any kind: the "existing" side is read live from
 * the already-materialized Goal + GoalActivity rows (which genuinely
 * exist once a 23505 conflict is hit), compared directly against the
 * INCOMING request's own values. Order-sensitive (same convention as
 * createGoalWithActivities's own insertion-order loop and
 * listGoalActivitiesWithLinkedPlanStatus's `ORDER BY "createdAt"`) --
 * a reordering of otherwise-identical activities is treated as a
 * mismatch, which is the conservative, fail-closed choice this ticket's
 * own section 9 asks for.
 */
export function goalCreateRequestMatchesExisting(
  request: { title: string; targetDate: string | null; activities: readonly IdempotentGoalCreateActivity[] },
  existing: { title: string; targetDate: string | null; activities: readonly PersistedIdempotentGoalCreateActivity[] }
): boolean {
  if (request.title !== existing.title) return false;
  if (request.targetDate !== existing.targetDate) return false;
  if (request.activities.length !== existing.activities.length) return false;
  for (let i = 0; i < request.activities.length; i += 1) {
    const a = request.activities[i];
    const b = existing.activities[i];
    if (a.title !== b.title) return false;
    if (a.activityId !== b.activityId) return false;
    const aCompletion = a.completionRequirement ?? DONE_COMPLETION_REQUIREMENT;
    if (aCompletion.kind !== b.completionRequirement.kind) return false;
    if ((aCompletion.targetValue ?? null) !== (b.completionRequirement.targetValue ?? null)) return false;
    if ((aCompletion.unit ?? null) !== (b.completionRequirement.unit ?? null)) return false;
    const aRhythm = a.rhythm ?? NONE_GOAL_ACTIVITY_RHYTHM;
    if (aRhythm.kind !== b.rhythm.kind) return false;
    if ((aRhythm.targetPerWeek ?? null) !== (b.rhythm.targetPerWeek ?? null)) return false;
  }
  return true;
}
