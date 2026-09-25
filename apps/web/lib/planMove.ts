/**
 * Daily Experience V1 PR D2 -- Move: "the user still intends to perform this
 * committed activity, but at a different time."
 *
 *   A (UPCOMING) --Move--> A (MOVED) ---> B (UPCOMING, rescheduledFromPlanId = A)
 *
 * A stays as history; B is a NEW commitment; a Capture/GoalActivity that was
 * linked to A is repointed to B in the SAME transaction so it never leaves
 * PLANNED. One domain operation for every UPCOMING plan regardless of how it is
 * presented in time (future, imminent, active, derived-MISSED): eligibility is
 * the persisted status only.
 *
 * Concurrency: the per-user advisory lock is the SAME key Day Constructor
 * acceptance takes (so conflict checks serialize against acceptance), then
 * `SELECT ... FOR UPDATE` on A (the row lock logPlannedActivity holds), then a
 * conditional UPCOMING -> MOVED update. UNIQUE("rescheduledFromPlanId") is the
 * database backstop against a forked successor.
 */
import { randomUUID } from 'crypto';
import { beginTransaction, type PlannedActivity } from './db';
import { isActivePlanBlocker } from './dayConstructorOrchestrator';
import { parseSchedulingMode } from './plannedActivitySchedulingMode';
import { buildGoogleCalendarUrl } from '../../../packages/recommendation/src/dailyAssistant';

export type MovePlanErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'ALREADY_MOVED'
  | 'INVALID_DESTINATION'
  | 'CONFLICT'
  | 'HAS_LINKED_MOMENT';

export class MovePlanError extends Error {
  constructor(public readonly code: MovePlanErrorCode, message: string) {
    super(message);
    this.name = 'MovePlanError';
  }
}

export interface MovePlanInput {
  newStartAt: Date;
}

export interface MovePlanResult {
  from: PlannedActivity;
  to: PlannedActivity;
}

const MINUTE_MS = 60_000;

/** Pure destination rules. `now` is the authoritative server instant. */
export function validateMoveDestination(plan: Pick<PlannedActivity, 'plannedStartAt' | 'durationMinutes'>, newStartAt: Date, now: Date): { newStartAt: Date; newEndAt: Date } {
  if (!(newStartAt instanceof Date) || !Number.isFinite(newStartAt.getTime())) {
    throw new MovePlanError('INVALID_DESTINATION', 'newStartAt must be a valid instant.');
  }
  if (newStartAt.getTime() % MINUTE_MS !== 0) {
    throw new MovePlanError('INVALID_DESTINATION', 'newStartAt must be on a whole-minute boundary.');
  }
  if (newStartAt.getTime() <= now.getTime()) {
    throw new MovePlanError('INVALID_DESTINATION', 'newStartAt must be in the future.');
  }
  if (newStartAt.getTime() === new Date(plan.plannedStartAt).getTime()) {
    throw new MovePlanError('INVALID_DESTINATION', 'newStartAt must differ from the current start.');
  }
  return { newStartAt, newEndAt: new Date(newStartAt.getTime() + plan.durationMinutes * MINUTE_MS) };
}

/** Same [start, end) overlap test used throughout the Constructor and acceptance. */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export async function movePlannedActivity(userId: string, planId: string, input: MovePlanInput): Promise<MovePlanResult> {
  const client = await beginTransaction();
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`day-constructor-accept:${userId}`]);

    const aRes = await client.query(`SELECT * FROM "PlannedActivity" WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [planId, userId]);
    if (aRes.rows.length === 0) throw new MovePlanError('NOT_FOUND', 'Plan not found.');
    const a: PlannedActivity = aRes.rows[0];

    if (a.status === 'MOVED') {
      const succ = await client.query(`SELECT * FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1 AND "userId" = $2`, [planId, userId]);
      const b: PlannedActivity | undefined = succ.rows[0];
      if (b && input.newStartAt instanceof Date && new Date(b.plannedStartAt).getTime() === input.newStartAt.getTime()) {
        await client.query('COMMIT');
        return { from: a, to: b };
      }
      throw new MovePlanError('ALREADY_MOVED', 'Plan was already moved.');
    }
    if (a.status !== 'UPCOMING') throw new MovePlanError('INVALID_STATE', 'Plan cannot be moved.');

    const moment = await client.query(
      `SELECT 1 FROM "AuraMoment" WHERE "plannedActivityId" = $1 AND status = 'ACTIVE' AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1`,
      [planId]
    );
    if (moment.rows.length > 0) throw new MovePlanError('HAS_LINKED_MOMENT', 'This plan has an active shared moment; reschedule it from the shared moment.');

    const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const { newStartAt, newEndAt } = validateMoveDestination(a, input.newStartAt, now);

    // Conflict: any OTHER plan whose [start, end) overlaps the destination and
    // that the existing blocker rule says still blocks. A itself is excluded.
    const candidates = await client.query(
      `SELECT "plannedStartAt", "plannedEndAt", status FROM "PlannedActivity"
       WHERE "userId" = $1 AND id <> $2 AND "plannedStartAt" < $4 AND "plannedEndAt" > $3`,
      [userId, planId, newStartAt, newEndAt]
    );
    const conflict = candidates.rows.some(
      (row) =>
        isActivePlanBlocker({ start: new Date(row.plannedStartAt), end: new Date(row.plannedEndAt), status: row.status }, now) &&
        overlaps(newStartAt, newEndAt, new Date(row.plannedStartAt), new Date(row.plannedEndAt))
    );
    if (conflict) throw new MovePlanError('CONFLICT', 'That time overlaps another plan.');

    // B is inserted directly (never through createPlannedActivity, whose
    // same-title/same-time dedupe could hand back someone else's plan).
    // Time-specific Aura evaluation is NOT carried over: it described A's time. The scheduling MODE is inherited
    // exactly (FIXED stays FIXED, FLEXIBLE stays FLEXIBLE, unknown stays unknown): Move neither grants nor removes
    // recomposition permission, and it is independent of whether the user may Move a plan.
    const bId = randomUUID();
    const bRes = await client.query(
      `INSERT INTO "PlannedActivity"
         (id, "userId", title, "activityType", icon, status, "plannedStartAt", "plannedEndAt", "durationMinutes",
          "windowType", "windowLabel", "matchLabel", score, recommendation, "calendarUrl",
          "eventTimezone", "eventLocationName", "schedulingMode", "activityId", "rescheduledFromPlanId")
       VALUES ($1, $2, $3, $4, $5, 'UPCOMING', $6, $7, $8, 'NEUTRAL', NULL, NULL, NULL, NULL, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        bId, userId, a.title, a.activityType, a.icon, newStartAt, newEndAt, a.durationMinutes,
        buildGoogleCalendarUrl(a.title, newStartAt.toISOString(), newEndAt.toISOString()),
        a.eventTimezone, a.eventLocationName, parseSchedulingMode(a.schedulingMode), a.activityId ?? null, planId,
      ]
    );

    const aMoved = await client.query(
      `UPDATE "PlannedActivity" SET status = 'MOVED', "updatedAt" = now()
       WHERE id = $1 AND "userId" = $2 AND status = 'UPCOMING' RETURNING *`,
      [planId, userId]
    );
    if (aMoved.rows.length !== 1) throw new MovePlanError('INVALID_STATE', 'Plan cannot be moved.');

    // Continuity: the source follows the commitment. Zero rows for a source-less plan.
    await client.query(`UPDATE "Capture" SET "plannedActivityId" = $1, "updatedAt" = now() WHERE "plannedActivityId" = $2 AND "userId" = $3`, [bId, planId, userId]);
    await client.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1, "updatedAt" = now() WHERE "plannedActivityId" = $2 AND "userId" = $3`, [bId, planId, userId]);

    await client.query('COMMIT');
    return { from: aMoved.rows[0], to: bRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
