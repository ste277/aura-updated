import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { getMinuteOfDayInTimezone } from './timezone';

// Sandbox-only substitute for @prisma/client (its engine binary can't be downloaded
// here — see README). Same schema, same Postgres instance, plain SQL. Swap API
// routes back to `prisma.*` calls once you run `npx prisma generate` in an
// environment with normal internet access.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface User {
  id: string;
  email: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string; // IANA name, e.g. 'Asia/Kolkata'
  createdAt: Date;
  birthDate: Date | null;
  birthTime: string | null;
  birthCityName: string | null;
  birthLatitude: number | null;
  birthLongitude: number | null;
  birthTimezone: string | null;
  remindersEnabled: boolean;
  reminderLeadMinutes: number;
}

export interface CustomCity {
  id: string;
  userId: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  createdAt: Date;
}

export async function getCustomCitiesForUser(userId: string): Promise<CustomCity[]> {
  const result = await pool.query(
    `SELECT id, "userId", "cityName", latitude, longitude, timezone, "createdAt"
     FROM "CustomCity"
     WHERE "userId" = $1
     ORDER BY "createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

export async function saveCustomCityForUser(
  userId: string,
  city: { cityName: string; latitude: number; longitude: number; timezone: string }
): Promise<CustomCity> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "CustomCity" (id, "userId", "cityName", latitude, longitude, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("userId", "cityName")
     DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, timezone = EXCLUDED.timezone
     RETURNING id, "userId", "cityName", latitude, longitude, timezone, "createdAt"`,
    [id, userId, city.cityName, city.latitude, city.longitude, city.timezone]
  );
  return result.rows[0];
}

export async function updateBirthProfile(
  userId: string,
  input: {
    birthDate: string; // 'YYYY-MM-DD'
    birthTime: string; // 'HH:MM'
    birthCityName: string;
    birthLatitude: number;
    birthLongitude: number;
    birthTimezone: string;
  }
): Promise<User> {
  const result = await pool.query(
    `UPDATE "User" SET "birthDate" = $2, "birthTime" = $3, "birthCityName" = $4,
       "birthLatitude" = $5, "birthLongitude" = $6, "birthTimezone" = $7
     WHERE id = $1 RETURNING *`,
    [userId, input.birthDate, input.birthTime, input.birthCityName, input.birthLatitude, input.birthLongitude, input.birthTimezone]
  );
  return result.rows[0];
}

export type SavedPersonRelationshipType = 'PARTNER' | 'SPOUSE' | 'FAMILY' | 'FRIEND' | 'OTHER';

export interface SavedPerson {
  id: string;
  ownerUserId: string;
  name: string;
  relationshipType: SavedPersonRelationshipType;
  birthDate: Date;
  birthTime: string;
  birthTimezone: string;
  birthCityName: string | null;
  birthLatitude: number | null;
  birthLongitude: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedPersonInput {
  name: string;
  relationshipType: SavedPersonRelationshipType;
  birthDate: string; // 'YYYY-MM-DD'
  birthTime: string; // 'HH:MM'
  birthTimezone: string;
  birthCityName?: string;
  birthLatitude?: number;
  birthLongitude?: number;
}

/** All CRUD below is scoped by ownerUserId on every query -- never by id
 * alone -- so a user can never read, update, or delete another user's
 * SavedPerson (brief section 3: ownership is enforced here, at the data
 * layer, not just in the route). Mirrors cancelPlannedActivity()'s
 * `WHERE id = $1 AND "userId" = $2` pattern below. */
export async function listSavedPeople(ownerUserId: string): Promise<SavedPerson[]> {
  const result = await pool.query(
    `SELECT * FROM "SavedPerson" WHERE "ownerUserId" = $1 ORDER BY name ASC`,
    [ownerUserId]
  );
  return result.rows;
}

export async function getSavedPersonForOwner(ownerUserId: string, personId: string): Promise<SavedPerson | null> {
  const result = await pool.query(
    `SELECT * FROM "SavedPerson" WHERE id = $1 AND "ownerUserId" = $2`,
    [personId, ownerUserId]
  );
  return result.rows[0] ?? null;
}

export async function createSavedPerson(ownerUserId: string, input: SavedPersonInput): Promise<SavedPerson> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "SavedPerson"
       (id, "ownerUserId", name, "relationshipType", "birthDate", "birthTime", "birthTimezone", "birthCityName", "birthLatitude", "birthLongitude")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      ownerUserId,
      input.name,
      input.relationshipType,
      input.birthDate,
      input.birthTime,
      input.birthTimezone,
      input.birthCityName ?? null,
      input.birthLatitude ?? null,
      input.birthLongitude ?? null,
    ]
  );
  return result.rows[0];
}

export async function updateSavedPerson(ownerUserId: string, personId: string, input: SavedPersonInput): Promise<SavedPerson> {
  const result = await pool.query(
    `UPDATE "SavedPerson"
     SET name = $3, "relationshipType" = $4, "birthDate" = $5, "birthTime" = $6,
         "birthTimezone" = $7, "birthCityName" = $8, "birthLatitude" = $9, "birthLongitude" = $10,
         "updatedAt" = now()
     WHERE id = $1 AND "ownerUserId" = $2
     RETURNING *`,
    [
      personId,
      ownerUserId,
      input.name,
      input.relationshipType,
      input.birthDate,
      input.birthTime,
      input.birthTimezone,
      input.birthCityName ?? null,
      input.birthLatitude ?? null,
      input.birthLongitude ?? null,
    ]
  );
  if (result.rows.length === 0) throw new Error('Person not found.');
  return result.rows[0];
}

export async function deleteSavedPerson(ownerUserId: string, personId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM "SavedPerson" WHERE id = $1 AND "ownerUserId" = $2`,
    [personId, ownerUserId]
  );
  if (result.rowCount === 0) throw new Error('Person not found.');
}

export type AuraMomentScope = 'GENERAL' | 'PERSONAL' | 'SHARED';
/** Product Structure V2 -- where the selected timing came from. Every
 * pre-V2 row is backfilled to 'MUHURTHAM' (see migration 0020's doc
 * comment) since that was the only creation path until this PR. */
export type AuraMomentSource = 'PLAN' | 'MUHURTHAM';
export type AuraMomentStatus = 'ACTIVE' | 'REVOKED';
export type AuraMomentResponseState = 'ACCEPTED' | 'ANOTHER_TIME';
/** Structured recipient preference (Aura Moment Rescheduling), only ever
 * meaningful alongside responseState = 'ANOTHER_TIME'. Deliberately small
 * and closed -- no free text in V1 (brief section 2). */
export type AuraMomentAlternativePreference = 'EARLIER' | 'LATER' | 'DIFFERENT_DAY' | 'NO_PREFERENCE';

export interface AuraMoment {
  id: string;
  ownerUserId: string;
  publicToken: string;
  scope: AuraMomentScope;
  source: AuraMomentSource;
  activityId: string;
  activityTitle: string;
  activityIcon: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  savedPersonId: string | null;
  sharedPersonDisplayName: string | null;
  senderDisplayName: string | null;
  ratingLabel: string | null;
  explanationSnapshot: string | null;
  status: AuraMomentStatus;
  responseState: AuraMomentResponseState | null;
  responsePreference: AuraMomentAlternativePreference | null;
  respondedAt: Date | null;
  /** Lineage: set when this moment was created via "Suggest this" on an
   * earlier moment -- see revokeAuraMoment/createAuraMoment's doc comments.
   * The referenced moment is never mutated; this is a one-way pointer. */
  previousMomentId: string | null;
  /** Aura Reminders V1 dedup linkage (brief section 7) -- set only when the
   * client already knows this Moment represents the same real-world event
   * as an existing PlannedActivity (see PlanWithAuraView's handleMakeMoment).
   * When set, deriveAuraReminders() skips the linked Plan's own reminder. */
  plannedActivityId: string | null;
  /** Aura Updates V1 -- when the OWNER last saw this moment's response.
   * "Unread" is ALWAYS derived by comparing this to respondedAt (see
   * lib/auraUpdates.ts), never read as a bare boolean. */
  ownerSeenResponseAt: Date | null;
  /** Product Instrumentation V1 -- set once, on the first successful PUBLIC
   * open of this moment (see markAuraMomentFirstOpened below). Never reset,
   * never touched by refreshes after the first. Exists purely so
   * AURA_MOMENT_OPENED can be recorded exactly once per moment without
   * fingerprinting the anonymous recipient. */
  firstOpenedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreateAuraMomentInput {
  ownerUserId: string;
  publicToken: string;
  scope: AuraMomentScope;
  source: AuraMomentSource;
  activityId: string;
  activityTitle: string;
  activityIcon: string | null;
  startAt: Date;
  endAt: Date;
  timezone: string;
  savedPersonId: string | null;
  sharedPersonDisplayName: string | null;
  senderDisplayName: string | null;
  ratingLabel: string | null;
  explanationSnapshot: string | null;
  expiresAt: Date | null;
  previousMomentId?: string | null;
  /** Aura Reminders V1 dedup linkage (brief section 7) -- see AuraMoment's
   * own field doc comment. Omitted/null for the overwhelming majority of
   * moments, which have no known linked Plan. */
  plannedActivityId?: string | null;
}

/** Every write/read below that's scoped to an owner filters by ownerUserId,
 * never by id/token alone -- same ownership discipline as SavedPerson above.
 * getAuraMomentByToken() is the one deliberate exception: it's the PUBLIC
 * bearer-access lookup (anyone holding the token can read the row), used by
 * the public page and the public response endpoint, never by owner-scoped
 * routes. */
export async function createAuraMoment(input: CreateAuraMomentInput): Promise<AuraMoment> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "AuraMoment"
       (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "activityIcon",
        "startAt", "endAt", timezone, "savedPersonId", "sharedPersonDisplayName", "senderDisplayName",
        "ratingLabel", "explanationSnapshot", "expiresAt", "previousMomentId", "plannedActivityId")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     RETURNING *`,
    [
      id,
      input.ownerUserId,
      input.publicToken,
      input.scope,
      input.source,
      input.activityId,
      input.activityTitle,
      input.activityIcon,
      input.startAt,
      input.endAt,
      input.timezone,
      input.savedPersonId,
      input.sharedPersonDisplayName,
      input.senderDisplayName,
      input.ratingLabel,
      input.explanationSnapshot,
      input.expiresAt,
      input.previousMomentId ?? null,
      input.plannedActivityId ?? null,
    ]
  );
  return result.rows[0];
}

export async function listAuraMomentsForOwner(ownerUserId: string): Promise<AuraMoment[]> {
  const result = await pool.query(
    `SELECT * FROM "AuraMoment" WHERE "ownerUserId" = $1 ORDER BY "createdAt" DESC`,
    [ownerUserId]
  );
  return result.rows;
}

/** PUBLIC lookup -- by publicToken only, no ownership filter. This is the
 * bearer-access read every recipient (and the public response endpoint)
 * uses; it deliberately does not care who owns the row. */
export async function getAuraMomentByToken(publicToken: string): Promise<AuraMoment | null> {
  const result = await pool.query(
    `SELECT * FROM "AuraMoment" WHERE "publicToken" = $1`,
    [publicToken]
  );
  return result.rows[0] ?? null;
}

export async function getAuraMomentForOwner(ownerUserId: string, publicToken: string): Promise<AuraMoment | null> {
  const result = await pool.query(
    `SELECT * FROM "AuraMoment" WHERE "publicToken" = $1 AND "ownerUserId" = $2`,
    [publicToken, ownerUserId]
  );
  return result.rows[0] ?? null;
}

/** Notification Delivery Readiness V1 -- ownership-scoped lookup by
 * INTERNAL id (not publicToken). Needed because AuraReminder.scheduledItemId
 * for a MOMENT_APPROACHING reminder is the moment's internal id (see
 * lib/auraReminders.ts), and POST /api/reminders/seen must verify that id
 * belongs to the requesting owner before ever writing a ReminderAttention
 * row -- never trust a client-supplied id where it can be resolved and
 * checked (same discipline as getPlannedActivityForOwner). */
export async function getAuraMomentByIdForOwner(ownerUserId: string, momentId: string): Promise<AuraMoment | null> {
  const result = await pool.query(
    `SELECT * FROM "AuraMoment" WHERE id = $1 AND "ownerUserId" = $2`,
    [momentId, ownerUserId]
  );
  return result.rows[0] ?? null;
}

export async function revokeAuraMoment(ownerUserId: string, publicToken: string): Promise<AuraMoment> {
  const result = await pool.query(
    `UPDATE "AuraMoment" SET status = 'REVOKED' WHERE "publicToken" = $1 AND "ownerUserId" = $2 RETURNING *`,
    [publicToken, ownerUserId]
  );
  if (result.rows.length === 0) throw new Error('Moment not found.');
  return result.rows[0];
}

/** Permanently removes a moment from the list -- scoped to REVOKED only, so
 * a moment is always revoked first (the deliberate, visible "this link no
 * longer works" step) before it can be cleared away. Safe to hard-delete:
 * previousMomentId/ProductEvent.auraMomentId both reference AuraMoment with
 * ON DELETE SET NULL, so this never breaks lineage or analytics rows. */
export async function deleteAuraMoment(ownerUserId: string, publicToken: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM "AuraMoment" WHERE "publicToken" = $1 AND "ownerUserId" = $2 AND status = 'REVOKED'`,
    [publicToken, ownerUserId]
  );
  if (result.rowCount === 0) throw new Error('Moment not found or cannot be removed.');
}

/** PUBLIC write -- by publicToken only. Guarded entirely in SQL (status must
 * still be ACTIVE and, if set, expiresAt must not have passed) so the
 * check-then-act window can't race a concurrent revoke/expiry -- the caller
 * (resolvePublicAuraMoment in lib/auraMoments.ts) separately determines the
 * exact reason for a rejection (not found / revoked / expired) for the HTTP
 * response, but this function's own guard is the actual source of truth. */
export async function respondToAuraMoment(publicToken: string, response: AuraMomentResponseState, preference: AuraMomentAlternativePreference | null = null): Promise<AuraMoment | null> {
  const result = await pool.query(
    `UPDATE "AuraMoment"
     SET "responseState" = $2, "responsePreference" = $3, "respondedAt" = now()
     WHERE "publicToken" = $1 AND status = 'ACTIVE' AND ("expiresAt" IS NULL OR "expiresAt" > now())
     RETURNING *`,
    [publicToken, response, preference]
  );
  return result.rows[0] ?? null;
}

/** PUBLIC-safe existence check -- "has ANY moment been created via 'Suggest
 * this' with this one as its previousMomentId", never the successor's own
 * token/id (brief section 15: "only if that can be done without leaking the
 * new token publicly"). Used by resolvePublicAuraMoment() so the ORIGINAL
 * link can say "a new time was suggested" without exposing where. */
export async function hasSuccessorMoment(momentId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM "AuraMoment" WHERE "previousMomentId" = $1 LIMIT 1`,
    [momentId]
  );
  return result.rows.length > 0;
}

/** Bulk counterpart to hasSuccessorMoment() -- one query for "which of this
 * owner's moments already have a successor", used by the Aura Updates
 * summary so it never does one query per moment. */
export async function listMomentIdsWithSuccessorForOwner(ownerUserId: string): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT DISTINCT "previousMomentId" FROM "AuraMoment" WHERE "ownerUserId" = $1 AND "previousMomentId" IS NOT NULL`,
    [ownerUserId]
  );
  return new Set(result.rows.map((row) => row.previousMomentId as string));
}

/** The ONLY moments Aura Updates cares about: this owner's, still ACTIVE
 * (a revoked moment is a closed matter, not an update -- see
 * lib/auraUpdates.ts), with an actual response, most-recently-responded
 * first, capped at `limit`. Scoped in SQL rather than filtering
 * listAuraMomentsForOwner()'s full history in application code -- cheap,
 * ordinary retrieval (brief section 17), backed by migration 0018's partial
 * index on exactly this shape. */
export async function listRecentRespondedAuraMomentsForOwner(ownerUserId: string, limit: number): Promise<AuraMoment[]> {
  const result = await pool.query(
    `SELECT * FROM "AuraMoment"
     WHERE "ownerUserId" = $1 AND status = 'ACTIVE' AND "responseState" IS NOT NULL
     ORDER BY "respondedAt" DESC
     LIMIT $2`,
    [ownerUserId, limit]
  );
  return result.rows;
}

/** Owner-authenticated only (brief section 6: "Do not use the public
 * bearer-link response endpoint"). Ownership-scoped like revokeAuraMoment --
 * a token that doesn't belong to this owner silently updates nothing. */
export async function markAuraMomentResponseSeen(ownerUserId: string, publicToken: string): Promise<AuraMoment | null> {
  const result = await pool.query(
    `UPDATE "AuraMoment" SET "ownerSeenResponseAt" = now() WHERE "publicToken" = $1 AND "ownerUserId" = $2 RETURNING *`,
    [publicToken, ownerUserId]
  );
  return result.rows[0] ?? null;
}

/** PUBLIC write -- by publicToken only, same bearer-access shape as
 * respondToAuraMoment. Idempotent: only ever sets firstOpenedAt when it was
 * previously NULL, so `result.rows.length > 0` tells the caller whether this
 * was genuinely the FIRST open (the caller uses that to decide whether to
 * record an AURA_MOMENT_OPENED product event -- see app/moment/[token]/page.tsx). */
export async function markAuraMomentFirstOpened(publicToken: string): Promise<AuraMoment | null> {
  const result = await pool.query(
    `UPDATE "AuraMoment" SET "firstOpenedAt" = now() WHERE "publicToken" = $1 AND "firstOpenedAt" IS NULL RETURNING *`,
    [publicToken]
  );
  return result.rows[0] ?? null;
}

export interface HabitLogRow {
  id: string;
  userId: string;
  activityTitle: string;
  activeWindow: string;
  logTimestamp: Date;
  logMinuteOfDay: number;
  durationMinutes: number;
  notes?: string | null;
  logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
  activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface Habit {
  id: string;
  userId: string;
  title: string;
  category: string;
  targetWindowType: string;
  currentStreak: number;
  longestStreak: number;
  createdAt: Date;
  archivedAt: Date | null;
}

export interface DailyReflection {
  id: string;
  userId: string;
  reflectionDate: Date;
  outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
  followedGuidance: boolean;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlannedActivity {
  id: string;
  userId: string;
  title: string;
  activityType: string | null;
  icon: string | null;
  status: 'UPCOMING' | 'LOGGED' | 'CANCELLED';
  plannedStartAt: Date;
  plannedEndAt: Date;
  durationMinutes: number;
  windowType: string;
  windowLabel: string | null;
  matchLabel: string | null;
  score: number | null;
  recommendation: string | null;
  calendarUrl: string | null;
  loggedAt: Date | null;
  habitLogId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlannedActivityInput {
  userId: string;
  title: string;
  activityType?: string | null;
  icon?: string | null;
  plannedStartAt: Date;
  plannedEndAt: Date;
  durationMinutes: number;
  windowType: string;
  windowLabel?: string | null;
  matchLabel?: string | null;
  score?: number | null;
  recommendation?: string | null;
  calendarUrl?: string | null;
}

export async function createHabit(input: {
  userId: string;
  title: string;
  category: string;
  targetWindowType: string;
}): Promise<Habit> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "Habit" (id, "userId", title, category, "targetWindowType")
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, input.userId, input.title, input.category, input.targetWindowType]
  );
  return result.rows[0];
}

export async function listHabits(userId: string): Promise<Habit[]> {
  const result = await pool.query(
    `SELECT * FROM "Habit" WHERE "userId" = $1 AND "archivedAt" IS NULL ORDER BY "createdAt"`,
    [userId]
  );
  return result.rows;
}

export async function archiveHabit(userId: string, habitId: string): Promise<void> {
  await pool.query(`UPDATE "Habit" SET "archivedAt" = now() WHERE id = $1 AND "userId" = $2`, [habitId, userId]);
}

/**
 * Logs a completion for a specific recurring habit and updates its streak.
 * Distinct from createHabitLog (the fixed 3-card flow) — this one tracks
 * per-habit consecutive-day streaks, not just a flat activity log. Idempotent
 * per calendar day: logging the same habit twice today doesn't double-count
 * or re-bump the streak.
 */
export async function logHabitCompletion(
  userId: string,
  habitId: string,
  activeWindow: string,
  logMinuteOfDay: number
): Promise<Habit> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const habitRes = await client.query(`SELECT * FROM "Habit" WHERE id = $1 AND "userId" = $2 FOR UPDATE`, [
      habitId,
      userId,
    ]);
    if (habitRes.rows.length === 0) throw new Error('Habit not found.');
    const habit: Habit = habitRes.rows[0];

    const todayLog = await client.query(
      `SELECT 1 FROM "HabitLog" WHERE "habitId" = $1 AND "logTimestamp"::date = CURRENT_DATE LIMIT 1`,
      [habitId]
    );
    if (todayLog.rows.length > 0) {
      await client.query('COMMIT');
      return habit; // already logged today — no-op, don't double-bump the streak
    }

    const yesterdayLog = await client.query(
      `SELECT 1 FROM "HabitLog" WHERE "habitId" = $1 AND "logTimestamp"::date = CURRENT_DATE - INTERVAL '1 day' LIMIT 1`,
      [habitId]
    );
    const newStreak = yesterdayLog.rows.length > 0 ? habit.currentStreak + 1 : 1;
    const newLongest = Math.max(habit.longestStreak, newStreak);

    await client.query(
      `INSERT INTO "HabitLog" (id, "userId", "habitId", "activityTitle", "activeWindow", "logMinuteOfDay", "logSource", "activitySignificance")
       VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', 'MEDIUM')`,
      [randomUUID(), userId, habitId, habit.title, activeWindow, logMinuteOfDay]
    );

    const updated = await client.query(
      `UPDATE "Habit" SET "currentStreak" = $2, "longestStreak" = $3 WHERE id = $1 RETURNING *`,
      [habitId, newStreak, newLongest]
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listPlannedActivities(userId: string): Promise<PlannedActivity[]> {
  const result = await pool.query(
    `SELECT *
     FROM "PlannedActivity"
     WHERE "userId" = $1 AND status <> 'CANCELLED'
     ORDER BY
       CASE WHEN status = 'UPCOMING' THEN 0 ELSE 1 END,
       "plannedStartAt" ASC,
       "createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

export async function listAllPlannedActivitiesForExport(userId: string): Promise<PlannedActivity[]> {
  const result = await pool.query(
    `SELECT *
     FROM "PlannedActivity"
     WHERE "userId" = $1
     ORDER BY "plannedStartAt" DESC, "createdAt" DESC`,
    [userId]
  );
  return result.rows;
}

/** Ownership-scoped single-row lookup -- used by POST /api/aura-moments to
 * validate a client-supplied plannedActivityId (Aura Reminders V1 dedup
 * linkage, brief section 7) actually belongs to the requesting owner before
 * ever writing it onto an AuraMoment row. */
export async function getPlannedActivityForOwner(userId: string, planId: string): Promise<PlannedActivity | null> {
  const result = await pool.query(`SELECT * FROM "PlannedActivity" WHERE id = $1 AND "userId" = $2`, [planId, userId]);
  return result.rows[0] ?? null;
}

/** Aura Reminders V1 (brief section 25): a BOUNDED query, not full history
 * -- only plans whose plannedStartAt could plausibly produce an active
 * reminder right now (see lib/auraReminders.ts's REMINDER_GRACE_PERIOD_MINUTES/
 * MAX_REMINDER_LEAD_MINUTES, which the caller uses to compute [from, to]).
 * Only UPCOMING (never LOGGED/CANCELLED -- brief section 8's lifecycle
 * rule applied to Plans). */
export async function listPlannedActivitiesForReminders(userId: string, from: Date, to: Date): Promise<PlannedActivity[]> {
  const result = await pool.query(
    `SELECT * FROM "PlannedActivity"
     WHERE "userId" = $1 AND status = 'UPCOMING' AND "plannedStartAt" BETWEEN $2 AND $3
     ORDER BY "plannedStartAt" ASC`,
    [userId, from, to]
  );
  return result.rows;
}

/** My Day V1 -- the bounded-by-local-day counterpart to
 * listPlannedActivitiesForReminders above. That query exists for a
 * different purpose (only UPCOMING plans that could plausibly produce an
 * active reminder right now) and deliberately excludes LOGGED ones; the
 * daily agenda needs BOTH UPCOMING and LOGGED plans for today (brief
 * section 4), just never CANCELLED. */
export async function listPlannedActivitiesForDay(userId: string, from: Date, to: Date): Promise<PlannedActivity[]> {
  const result = await pool.query(
    `SELECT * FROM "PlannedActivity"
     WHERE "userId" = $1 AND status <> 'CANCELLED' AND "plannedStartAt" BETWEEN $2 AND $3
     ORDER BY "plannedStartAt" ASC`,
    [userId, from, to]
  );
  return result.rows;
}

/** Aura Reminders V1 (brief section 25) -- the AuraMoment counterpart to
 * listPlannedActivitiesForReminders above. Only ACTIVE, unexpired moments
 * (mirrors resolveAuraMomentByToken's own ACTIVE + expiry check) within the
 * bounded [from, to] window; response-state/lineage lifecycle rules (brief
 * section 8/9) are applied by deriveAuraReminders(), not here -- this stays
 * ordinary, cheap retrieval, backed by migration 0021's
 * (ownerUserId, startAt) index. */
export async function listAuraMomentsForReminders(ownerUserId: string, from: Date, to: Date): Promise<AuraMoment[]> {
  const result = await pool.query(
    `SELECT * FROM "AuraMoment"
     WHERE "ownerUserId" = $1 AND status = 'ACTIVE' AND ("expiresAt" IS NULL OR "expiresAt" > now())
       AND "startAt" BETWEEN $2 AND $3
     ORDER BY "startAt" ASC`,
    [ownerUserId, from, to]
  );
  return result.rows;
}

export async function updateUserReminderPrefs(
  userId: string,
  prefs: { remindersEnabled: boolean; reminderLeadMinutes: number }
): Promise<User> {
  const result = await pool.query(
    `UPDATE "User" SET "remindersEnabled" = $2, "reminderLeadMinutes" = $3 WHERE id = $1 RETURNING *`,
    [userId, prefs.remindersEnabled, prefs.reminderLeadMinutes]
  );
  return result.rows[0];
}

// ============================================================
// Notification Delivery Readiness V1 -- ReminderAttention (seen state) and
// ReminderDelivery (future Web Push idempotency). See
// lib/reminderAttention.ts / lib/reminderDelivery.ts for the domain logic
// built on top of these; this section is pure persistence.
// ============================================================

export type ReminderScheduledItemType = 'PLANNED_ACTIVITY' | 'AURA_MOMENT';

export interface ReminderAttention {
  id: string;
  userId: string;
  scheduledItemType: ReminderScheduledItemType;
  scheduledItemId: string;
  reminderAt: Date;
  seenAt: Date;
}

/** Idempotent upsert, keyed by the occurrence identity (userId,
 * scheduledItemType, scheduledItemId, reminderAt) -- brief section 3/4:
 * never a bare boolean, so a rescheduled item's NEW occurrence has no
 * matching row and is unread again automatically. Re-marking the SAME
 * occurrence seen just refreshes seenAt (harmless, idempotent). */
export async function markReminderSeen(
  userId: string,
  scheduledItemType: ReminderScheduledItemType,
  scheduledItemId: string,
  reminderAt: Date
): Promise<ReminderAttention> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "ReminderAttention" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("userId", "scheduledItemType", "scheduledItemId", "reminderAt")
     DO UPDATE SET "seenAt" = now()
     RETURNING *`,
    [id, userId, scheduledItemType, scheduledItemId, reminderAt]
  );
  return result.rows[0];
}

/** Bounded query mirroring listPlannedActivitiesForReminders/
 * listAuraMomentsForReminders' own [from, to] window (brief section 25) --
 * only attention rows that could plausibly matter for a currently-relevant
 * reminder, never full history. */
export async function listReminderAttentionForOwner(userId: string, from: Date, to: Date): Promise<ReminderAttention[]> {
  const result = await pool.query(
    `SELECT * FROM "ReminderAttention" WHERE "userId" = $1 AND "reminderAt" BETWEEN $2 AND $3`,
    [userId, from, to]
  );
  return result.rows;
}

export type ReminderDeliveryChannel = 'WEB_PUSH';
// Web Push V1 (brief section 22/24): PROCESSING is the real claim
// transition (see claimReminderDeliveryForSending below) -- the row's
// creation-time uniqueness alone stops duplicate CREATION, not duplicate
// SENDING. SKIPPED means the occurrence was re-validated against
// deriveAuraReminders() immediately before sending and was no longer
// eligible (rescheduled/revoked/superseded) -- never sent.
export type ReminderDeliveryStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface ReminderDelivery {
  id: string;
  userId: string;
  scheduledItemType: ReminderScheduledItemType;
  scheduledItemId: string;
  reminderAt: Date;
  channel: ReminderDeliveryChannel;
  status: ReminderDeliveryStatus;
  createdAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
}

/** Idempotent claim (brief section 11/15): INSERT ... ON CONFLICT DO
 * NOTHING against the (userId, scheduledItemType, scheduledItemId,
 * reminderAt, channel) unique constraint, so two concurrent workers
 * calling this for the SAME occurrence can never both create a row -- the
 * DB constraint is the source of truth, not an in-memory check. Always
 * returns a real, persisted row: on conflict, re-reads and returns the
 * EXISTING one, so callers get idempotent read-or-create semantics without
 * needing to branch on which happened. */
export async function ensureReminderDelivery(
  userId: string,
  scheduledItemType: ReminderScheduledItemType,
  scheduledItemId: string,
  reminderAt: Date,
  channel: ReminderDeliveryChannel
): Promise<ReminderDelivery> {
  const id = randomUUID();
  const inserted = await pool.query(
    `INSERT INTO "ReminderDelivery" (id, "userId", "scheduledItemType", "scheduledItemId", "reminderAt", channel)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("userId", "scheduledItemType", "scheduledItemId", "reminderAt", channel) DO NOTHING
     RETURNING *`,
    [id, userId, scheduledItemType, scheduledItemId, reminderAt, channel]
  );
  if (inserted.rows.length > 0) return inserted.rows[0];

  const existing = await pool.query(
    `SELECT * FROM "ReminderDelivery"
     WHERE "userId" = $1 AND "scheduledItemType" = $2 AND "scheduledItemId" = $3 AND "reminderAt" = $4 AND channel = $5`,
    [userId, scheduledItemType, scheduledItemId, reminderAt, channel]
  );
  return existing.rows[0];
}

/** Owner-scoped delivery status update -- the ONLY writer of status/sentAt/
 * failedAt/failureReason (brief section 19: allow FAILED with a safe
 * reason, never a huge provider payload -- callers must pass a short,
 * app-generated string, not raw provider response bodies). Not called by
 * anything in this PR (no worker exists yet); exists so the future Web
 * Push worker has a real function to call instead of hand-writing SQL. */
export async function markReminderDeliveryStatus(
  deliveryId: string,
  status: 'SENT' | 'FAILED' | 'SKIPPED',
  failureReason?: string
): Promise<ReminderDelivery | null> {
  const result = await pool.query(
    status === 'SENT'
      ? `UPDATE "ReminderDelivery" SET status = 'SENT', "sentAt" = now() WHERE id = $1 RETURNING *`
      : status === 'FAILED'
        ? `UPDATE "ReminderDelivery" SET status = 'FAILED', "failedAt" = now(), "failureReason" = $2 WHERE id = $1 RETURNING *`
        : `UPDATE "ReminderDelivery" SET status = 'SKIPPED', "failureReason" = $2 WHERE id = $1 RETURNING *`,
    status === 'SENT' ? [deliveryId] : [deliveryId, (failureReason ?? '').slice(0, 500)]
  );
  return result.rows[0] ?? null;
}

/** Web Push V1 (brief section 22) -- the actual concurrency-safety
 * primitive: an atomic conditional UPDATE that only succeeds if the row is
 * STILL 'PENDING' at the moment it runs. Two workers racing on the same
 * delivery row: exactly one UPDATE matches the WHERE clause and returns a
 * row; the other affects 0 rows and gets null back. This is what stops two
 * workers from both sending the same occurrence -- the delivery row's own
 * creation-time uniqueness (ensureReminderDelivery) only stops duplicate
 * CREATION, which is a different race. */
export async function claimReminderDeliveryForSending(deliveryId: string): Promise<ReminderDelivery | null> {
  const result = await pool.query(
    `UPDATE "ReminderDelivery"
     SET status = 'PROCESSING', "attemptCount" = "attemptCount" + 1, "lastAttemptAt" = now()
     WHERE id = $1 AND status = 'PENDING'
     RETURNING *`,
    [deliveryId]
  );
  return result.rows[0] ?? null;
}

/** Web Push V1 (brief section 21) -- bounded due-user discovery: which
 * owners have a PlannedActivity/AuraMoment whose startAt falls inside the
 * SAME reminder-plausible window listPlannedActivitiesForReminders/
 * listAuraMomentsForReminders already use, so the dispatch worker never
 * loads every User row and never re-derives its own time bounds. Returns
 * bare userIds only -- ensureDueReminderDeliveries still does its own
 * per-user eligibility work (this is discovery, not eligibility). */
export async function listUserIdsWithPotentialReminders(from: Date, to: Date): Promise<string[]> {
  const result = await pool.query(
    `SELECT "userId" FROM "PlannedActivity" WHERE status = 'UPCOMING' AND "plannedStartAt" BETWEEN $1 AND $2
     UNION
     SELECT "ownerUserId" AS "userId" FROM "AuraMoment" WHERE status = 'ACTIVE' AND "startAt" BETWEEN $1 AND $2 AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
    [from, to]
  );
  return result.rows.map((row) => row.userId as string);
}

// ============================================================
// Web Push V1 -- PushSubscription persistence. Ownership-scoped
// everywhere: a subscription belongs to exactly one authenticated user,
// never exposed to another (brief section 3).
// ============================================================

export interface PushSubscriptionRow {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastSuccessfulAt: Date | null;
  disabledAt: Date | null;
}

/** Upsert keyed on `endpoint` (globally unique -- brief section 4): the
 * same browser re-registering (e.g. after a service worker update) updates
 * the existing row in place -- including re-ENABLING a previously-disabled
 * one (a stale/expired subscription re-subscribing is, by definition, live
 * again) -- rather than accumulating duplicates. Re-registering under a
 * DIFFERENT userId reassigns ownership to the new user (the only way that
 * can legitimately happen is the same browser signing into a different
 * Aura account and re-subscribing, which SHOULD hand this endpoint to the
 * new owner). */
export async function upsertPushSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<PushSubscriptionRow> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth, "userAgent")
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET
       "userId" = EXCLUDED."userId",
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       "userAgent" = EXCLUDED."userAgent",
       "updatedAt" = now(),
       "disabledAt" = NULL
     RETURNING *`,
    [id, input.userId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null]
  );
  return result.rows[0];
}

/** Owner-scoped disable -- used both by the user's own "Turn off" action
 * and (with a different caller) by stale-subscription cleanup after a
 * provider 404/410 (brief section 18). Never a hard delete (brief: "don't
 * delete state that's cheap to keep"). No-ops silently if the endpoint
 * doesn't belong to this owner (same discipline as revokeAuraMoment). */
export async function disablePushSubscriptionForOwner(userId: string, endpoint: string): Promise<void> {
  await pool.query(`UPDATE "PushSubscription" SET "disabledAt" = now() WHERE "userId" = $1 AND endpoint = $2`, [userId, endpoint]);
}

/** Endpoint-only disable, no ownership check -- used by the delivery
 * service when the PROVIDER (not the user) reports the endpoint is gone.
 * The delivery service already resolved this subscription via its owner's
 * own subscription list, so this is trusted, internal-only usage, never
 * exposed to a client-facing route. */
export async function disablePushSubscriptionByEndpoint(endpoint: string, reason: string): Promise<void> {
  await pool.query(`UPDATE "PushSubscription" SET "disabledAt" = now() WHERE endpoint = $1`, [endpoint]);
  void reason; // Reserved for future structured logging; never persisted (brief section 18: no raw provider payloads).
}

export async function markPushSubscriptionSuccessful(endpoint: string): Promise<void> {
  await pool.query(`UPDATE "PushSubscription" SET "lastSuccessfulAt" = now() WHERE endpoint = $1`, [endpoint]);
}

/** Only ACTIVE (never-disabled) subscriptions -- the delivery service's
 * one and only read path for "who do we send this owner's push to". */
export async function listActivePushSubscriptionsForOwner(userId: string): Promise<PushSubscriptionRow[]> {
  const result = await pool.query(`SELECT * FROM "PushSubscription" WHERE "userId" = $1 AND "disabledAt" IS NULL`, [userId]);
  return result.rows;
}

/** The owner's OWN view of their device notification state (brief section
 * 7/27): "is there at least one active subscription right now" is the
 * entire V1 "device notifications enabled" signal -- no separate boolean
 * preference column (see the completion report for why this was judged
 * sufficient for V1). */
export async function hasActivePushSubscription(userId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM "PushSubscription" WHERE "userId" = $1 AND "disabledAt" IS NULL LIMIT 1`, [userId]);
  return result.rows.length > 0;
}

export async function createPlannedActivity(input: CreatePlannedActivityInput): Promise<PlannedActivity> {
  const existing = await pool.query(
    `SELECT *
     FROM "PlannedActivity"
     WHERE "userId" = $1
       AND status = 'UPCOMING'
       AND lower(title) = lower($2)
       AND "plannedStartAt" = $3
       AND "plannedEndAt" = $4
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [input.userId, input.title, input.plannedStartAt, input.plannedEndAt]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "PlannedActivity"
       (id, "userId", title, "activityType", icon, "plannedStartAt", "plannedEndAt",
        "durationMinutes", "windowType", "windowLabel", "matchLabel", score,
        recommendation, "calendarUrl")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      id,
      input.userId,
      input.title,
      input.activityType ?? null,
      input.icon ?? null,
      input.plannedStartAt,
      input.plannedEndAt,
      input.durationMinutes,
      input.windowType,
      input.windowLabel ?? null,
      input.matchLabel ?? null,
      input.score ?? null,
      input.recommendation ?? null,
      input.calendarUrl ?? null,
    ]
  );
  return result.rows[0];
}

export async function cancelPlannedActivity(userId: string, planId: string): Promise<PlannedActivity> {
  const result = await pool.query(
    `UPDATE "PlannedActivity"
     SET status = 'CANCELLED',
         "updatedAt" = now()
     WHERE id = $1 AND "userId" = $2 AND status = 'UPCOMING'
     RETURNING *`,
    [planId, userId]
  );
  if (result.rows.length === 0) throw new Error('Plan not found or cannot be cancelled.');
  return result.rows[0];
}

/** Permanently removes a plan from the list -- scoped to LOGGED/CANCELLED
 * only, never UPCOMING (that's what cancelPlannedActivity is for). Lets the
 * user actually clear old completed plans instead of them only ever
 * accumulating in "Recently Completed". */
export async function deletePlannedActivity(userId: string, planId: string): Promise<void> {
  const result = await pool.query(
    `DELETE FROM "PlannedActivity" WHERE id = $1 AND "userId" = $2 AND status IN ('LOGGED', 'CANCELLED')`,
    [planId, userId]
  );
  if (result.rowCount === 0) throw new Error('Plan not found or cannot be removed.');
}

export async function logPlannedActivity(userId: string, planId: string): Promise<{ plan: PlannedActivity; habitLog: HabitLogRow }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const planRes = await client.query(
      `SELECT * FROM "PlannedActivity" WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
      [planId, userId]
    );
    if (planRes.rows.length === 0) throw new Error('Plan not found.');
    const plan: PlannedActivity = planRes.rows[0];

    if (plan.status === 'LOGGED' && plan.habitLogId) {
      const existingLog = await client.query(
        `SELECT id, "userId", "activityTitle", "activeWindow", "logTimestamp", "logMinuteOfDay", "durationMinutes", notes, "logSource", "activitySignificance"
         FROM "HabitLog"
         WHERE id = $1 AND "userId" = $2`,
        [plan.habitLogId, userId]
      );
      if (existingLog.rows.length === 0) {
        throw new Error('Logged plan is missing its activity log.');
      }
      await client.query('COMMIT');
      return { plan, habitLog: existingLog.rows[0] };
    }

    if (plan.status !== 'UPCOMING') {
      throw new Error('Plan is not available to log.');
    }

    const userRes = await client.query(
      `SELECT timezone FROM "User" WHERE id = $1`,
      [userId]
    );
    const userTimezone = userRes.rows[0]?.timezone || 'UTC';
    const habitLogId = randomUUID();
    const loggedAt = new Date();
    const logTimestamp = new Date(plan.plannedStartAt);
    const logMinuteOfDay = getMinuteOfDayInTimezone(userTimezone, logTimestamp);
    const notes = `Logged from planned Aura activity${plan.recommendation ? `: ${plan.recommendation}` : '.'}`;

    const habitLogRes = await client.query(
      `INSERT INTO "HabitLog"
         (id, "userId", "activityTitle", "activeWindow", "logMinuteOfDay",
          "logTimestamp", "durationMinutes", notes, "logSource", "activitySignificance")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'AURA_PLANNED', 'MEDIUM')
       RETURNING id, "userId", "activityTitle", "activeWindow", "logTimestamp", "logMinuteOfDay", "durationMinutes", notes, "logSource", "activitySignificance"`,
      [
        habitLogId,
        userId,
        plan.title,
        plan.windowType,
        logMinuteOfDay,
        logTimestamp,
        plan.durationMinutes,
        notes,
      ]
    );

    const updatedPlanRes = await client.query(
      `UPDATE "PlannedActivity"
       SET status = 'LOGGED',
           "loggedAt" = $3,
           "habitLogId" = $4,
           "updatedAt" = now()
       WHERE id = $1 AND "userId" = $2
       RETURNING *`,
      [planId, userId, loggedAt, habitLogId]
    );

    await client.query('COMMIT');
    return { plan: updatedPlanRes.rows[0], habitLog: habitLogRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function upsertUserByEmail(input: {
  email: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}): Promise<User> {
  // Emails are case-insensitive identities. Both auth flows lowercase before
  // hashing/looking up codes, so the user lookup must too — otherwise
  // Foo@x.com and foo@x.com become two accounts and the second login lands
  // in an empty one. Migration 0012 enforces this with a unique index on
  // lower(email).
  const email = input.email.trim().toLowerCase();
  const existing = await pool.query('SELECT * FROM "User" WHERE lower(email) = $1', [email]);
  if (existing.rows.length > 0) return existing.rows[0];

  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "User" (id, email, "cityName", latitude, longitude, timezone)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, email, input.cityName, input.latitude, input.longitude, input.timezone]
  );
  return result.rows[0];
}

export async function updateUserLocation(
  userId: string,
  location: { cityName: string; latitude: number; longitude: number; timezone: string }
): Promise<User> {
  const result = await pool.query(
    `UPDATE "User" SET "cityName" = $2, latitude = $3, longitude = $4, timezone = $5
     WHERE id = $1 RETURNING *`,
    [userId, location.cityName, location.latitude, location.longitude, location.timezone]
  );
  return result.rows[0];
}

export async function getUserById(userId: string): Promise<User | null> {
  const result = await pool.query('SELECT * FROM "User" WHERE id = $1', [userId]);
  return result.rows[0] ?? null;
}

// v1 has no location-onboarding step yet (see MVP spec / README) — every new user
// defaults to Chennai until a location picker exists.
const DEFAULT_SIGNUP_LOCATION = {
  cityName: 'Chennai',
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
};

// Records at most one visit per user per calendar day — deliberately deduped so
// repeated page loads/refreshes in a session don't inflate the retention numbers
// this exists to measure.
export async function recordVisit(userId: string): Promise<void> {
  const existing = await pool.query(
    `SELECT 1 FROM "VisitLog" WHERE "userId" = $1 AND "visitedAt"::date = CURRENT_DATE LIMIT 1`,
    [userId]
  );
  if (existing.rows.length > 0) return;

  await pool.query(`INSERT INTO "VisitLog" (id, "userId") VALUES ($1, $2)`, [randomUUID(), userId]);
}

/** Per-day log counts for a given month, for the calendar view. Counts both fixed
 * action-card logs and custom-habit logs (habitId is nullable in HabitLog, so this
 * naturally covers both without a UNION). */
export async function getMonthlyActivity(
  userId: string,
  year: number,
  month: number // 1-12
): Promise<{ day: number; count: number }[]> {
  const result = await pool.query(
    `SELECT EXTRACT(DAY FROM "logTimestamp")::int AS day, COUNT(*)::int AS count
     FROM "HabitLog"
     WHERE "userId" = $1
       AND EXTRACT(YEAR FROM "logTimestamp") = $2
       AND EXTRACT(MONTH FROM "logTimestamp") = $3
     GROUP BY day
     ORDER BY day`,
    [userId, year, month]
  );
  return result.rows;
}

export async function getLogsForDay(
  userId: string,
  year: number,
  month: number,
  day: number
): Promise<HabitLogRow[]> {
  const result = await pool.query(
    `SELECT id, "userId", "activityTitle", "activeWindow", "logTimestamp", "logMinuteOfDay", "durationMinutes", notes, "logSource", "activitySignificance"
     FROM "HabitLog"
     WHERE "userId" = $1
       AND EXTRACT(YEAR FROM "logTimestamp") = $2
       AND EXTRACT(MONTH FROM "logTimestamp") = $3
       AND EXTRACT(DAY FROM "logTimestamp") = $4
     ORDER BY "logTimestamp"`,
    [userId, year, month, day]
  );
  return result.rows;
}

export async function checkDbConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function getOrCreateUserForAuth(email: string): Promise<User> {
  return upsertUserByEmail({ email, ...DEFAULT_SIGNUP_LOCATION });
}

// --- One-time sign-in codes (AuthCode table, migration 0011) ----------------

export interface AuthCodeRow {
  id: string;
  email: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export async function createAuthCode(input: {
  email: string;
  codeHash: string;
  expiresAt: Date;
  requestIp?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO "AuthCode" (id, email, "codeHash", "expiresAt", "requestIp")
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), input.email.toLowerCase(), input.codeHash, input.expiresAt, input.requestIp ?? null]
  );
}

/** Requests in the last `windowMinutes` from this email or IP — rate limiting. */
export async function countRecentAuthRequests(
  email: string,
  requestIp: string | null,
  windowMinutes: number
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM "AuthCode"
     WHERE "createdAt" > now() - ($1 || ' minutes')::interval
       AND (email = $2 OR ("requestIp" IS NOT NULL AND "requestIp" = $3))`,
    [windowMinutes, email.toLowerCase(), requestIp]
  );
  return result.rows[0].count;
}

/** Latest unconsumed, unexpired code row for this email. */
export async function findActiveAuthCode(email: string): Promise<AuthCodeRow | null> {
  const result = await pool.query(
    `SELECT id, email, "codeHash", attempts, "expiresAt", "consumedAt"
     FROM "AuthCode"
     WHERE email = $1 AND "consumedAt" IS NULL AND "expiresAt" > now()
     ORDER BY "createdAt" DESC LIMIT 1`,
    [email.toLowerCase()]
  );
  return result.rows[0] ?? null;
}

/**
 * Atomically spends one verification attempt and returns the code hash to
 * compare against, or null once the attempt cap is reached. The gate and the
 * increment are a single UPDATE so N concurrent guesses cost N attempts —
 * a read-check-increment sequence would let parallel requests all see
 * attempts=0 and bypass the cap entirely.
 */
export async function spendAuthCodeAttempt(
  id: string,
  maxAttempts: number
): Promise<{ codeHash: string } | null> {
  const result = await pool.query(
    `UPDATE "AuthCode" SET attempts = attempts + 1
     WHERE id = $1 AND attempts < $2 AND "consumedAt" IS NULL
     RETURNING "codeHash"`,
    [id, maxAttempts]
  );
  return result.rows[0] ?? null;
}

/**
 * Marks the code used. Returns false if it was already consumed — the caller
 * must NOT issue a session in that case, or two concurrent redemptions of the
 * same code would both mint sessions.
 */
export async function consumeAuthCode(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE "AuthCode" SET "consumedAt" = now() WHERE id = $1 AND "consumedAt" IS NULL RETURNING id`,
    [id]
  );
  return result.rowCount === 1;
}

export async function createHabitLog(input: {
  userId: string;
  activityTitle: string;
  activeWindow: string;
  logMinuteOfDay: number;
  logTimestamp?: Date;
  durationMinutes?: number;
  notes?: string;
  logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
  activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH';
}): Promise<HabitLogRow> {
  const id = randomUUID();
  const timestamp = input.logTimestamp ?? new Date();

  const result = await pool.query(
    `INSERT INTO "HabitLog" (id, "userId", "activityTitle", "activeWindow", "logMinuteOfDay", "logTimestamp", "durationMinutes", notes, "logSource", "activitySignificance")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      id,
      input.userId,
      input.activityTitle,
      input.activeWindow,
      input.logMinuteOfDay,
      timestamp,
      input.durationMinutes ?? 30,
      input.notes ?? null,
      input.logSource ?? 'MANUAL',
      input.activitySignificance ?? 'MEDIUM',
    ]
  );
  return result.rows[0];
}

export async function listHabitLogs(userId: string): Promise<HabitLogRow[]> {
  const result = await pool.query(
    `SELECT * FROM "HabitLog" WHERE "userId" = $1 ORDER BY "logTimestamp" DESC LIMIT 50`,
    [userId]
  );
  return result.rows;
}

export async function listAllHabitLogsForExport(userId: string): Promise<HabitLogRow[]> {
  const result = await pool.query(
    `SELECT * FROM "HabitLog" WHERE "userId" = $1 ORDER BY "logTimestamp" DESC`,
    [userId]
  );
  return result.rows;
}

export async function upsertDailyReflection(input: {
  userId: string;
  reflectionDate: Date;
  outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
  followedGuidance: boolean;
  notes?: string;
}): Promise<DailyReflection> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "DailyReflection"
       (id, "userId", "reflectionDate", "outputLevel", "followedGuidance", notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("userId", "reflectionDate")
     DO UPDATE SET "outputLevel" = EXCLUDED."outputLevel",
                   "followedGuidance" = EXCLUDED."followedGuidance",
                   notes = EXCLUDED.notes,
                   "updatedAt" = now()
     RETURNING *`,
    [
      id,
      input.userId,
      input.reflectionDate,
      input.outputLevel,
      input.followedGuidance,
      input.notes ?? null,
    ]
  );
  return result.rows[0];
}

export async function getDailyReflection(userId: string, reflectionDate: Date): Promise<DailyReflection | null> {
  const result = await pool.query(
    `SELECT * FROM "DailyReflection" WHERE "userId" = $1 AND "reflectionDate" = $2 LIMIT 1`,
    [userId, reflectionDate]
  );
  return result.rows[0] ?? null;
}

export async function listDailyReflections(userId: string, limit = 60): Promise<DailyReflection[]> {
  const result = await pool.query(
    `SELECT * FROM "DailyReflection" WHERE "userId" = $1 ORDER BY "reflectionDate" DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

export async function listAllDailyReflectionsForExport(userId: string): Promise<DailyReflection[]> {
  const result = await pool.query(
    `SELECT * FROM "DailyReflection" WHERE "userId" = $1 ORDER BY "reflectionDate" DESC`,
    [userId]
  );
  return result.rows;
}

// ============================================================
// Product Instrumentation V1
//
// This table is written to ONLY via lib/productEvents.ts's
// validateProductEvent() -- see that module for the closed event-name
// vocabulary and per-event metadata allow-list. createProductEvent() below
// trusts its input completely (no validation here); that is intentional so
// the validation logic stays independently unit-testable without a database.
// ============================================================

export interface ProductEvent {
  id: string;
  eventName: string;
  userId: string | null;
  auraMomentId: string | null;
  metadata: Record<string, string | number | boolean>;
  createdAt: Date;
}

export interface CreateProductEventInput {
  eventName: string;
  userId?: string | null;
  auraMomentId?: string | null;
  metadata: Record<string, string | number | boolean>;
}

export async function createProductEvent(input: CreateProductEventInput): Promise<ProductEvent> {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "ProductEvent" (id, "eventName", "userId", "auraMomentId", metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, input.eventName, input.userId ?? null, input.auraMomentId ?? null, JSON.stringify(input.metadata)]
  );
  return result.rows[0];
}

/** One row per (eventName, metadata->>groupKey) pair within the window --
 * the raw material for both the volume table and the scope/mode breakdowns
 * on the internal metrics endpoint. `group` is null for events that don't
 * carry the requested key (e.g. AURA_HOME_VIEWED has no "scope"). */
export interface ProductEventCountRow {
  eventName: string;
  group: string | null;
  count: number;
}

export async function listProductEventCountsSince(since: Date, groupMetadataKey: string): Promise<ProductEventCountRow[]> {
  const result = await pool.query(
    `SELECT "eventName", metadata->>$2 as group, COUNT(*)::int as count
     FROM "ProductEvent"
     WHERE "createdAt" >= $1
     GROUP BY "eventName", metadata->>$2`,
    [since, groupMetadataKey]
  );
  return result.rows.map((row) => ({ eventName: row.eventName, group: row.group ?? null, count: row.count }));
}

/** Distinct AURA MOMENTS (not raw event rows) that fired a given event within
 * the window -- the correct denominator for the Moment lifecycle funnel,
 * since a recipient can (for example) reopen a moment or an owner can click
 * "share" more than once for the same moment. */
export async function countDistinctMomentsForEventSince(eventName: string, since: Date): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT "auraMomentId")::int as count
     FROM "ProductEvent"
     WHERE "eventName" = $1 AND "createdAt" >= $2 AND "auraMomentId" IS NOT NULL`,
    [eventName, since]
  );
  return result.rows[0]?.count ?? 0;
}

/** Distinct authenticated USERS that fired a given event within the window
 * -- used for the "unique users" side of Plan activation / personalization
 * rate, as distinct from total event volume. */
export async function countDistinctUsersForEventSince(eventName: string, since: Date): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT "userId")::int as count
     FROM "ProductEvent"
     WHERE "eventName" = $1 AND "createdAt" >= $2 AND "userId" IS NOT NULL`,
    [eventName, since]
  );
  return result.rows[0]?.count ?? 0;
}

/** Union counterpart to countDistinctMomentsForEventSince -- distinct
 * moments that fired ANY of the given events within the window. Needed
 * because a single moment CAN fire more than one response-type event over
 * its lifetime (e.g. ANOTHER_TIME, revisited, then ACCEPTED), so naively
 * summing per-event distinct counts would double count; this runs one
 * query against the true union instead. */
export async function countDistinctMomentsForAnyEventSince(eventNames: string[], since: Date): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT "auraMomentId")::int as count
     FROM "ProductEvent"
     WHERE "eventName" = ANY($1) AND "createdAt" >= $2 AND "auraMomentId" IS NOT NULL`,
    [eventNames, since]
  );
  return result.rows[0]?.count ?? 0;
}

/** Raw durationMs values for an event within the window, optionally grouped
 * by another metadata key (e.g. "scope") -- the input to p50/p95 percentile
 * computation in lib/productMetrics.ts. Grouped entries with no such
 * metadata key come back under the `null` group. */
export interface ProductEventDurationGroup {
  group: string | null;
  durationsMs: number[];
}

export async function listProductEventDurationsSince(eventName: string, since: Date, groupMetadataKey: string | null = null): Promise<ProductEventDurationGroup[]> {
  const result = await pool.query(
    groupMetadataKey
      ? `SELECT metadata->>$3 as group, (metadata->>'durationMs')::numeric as duration
         FROM "ProductEvent"
         WHERE "eventName" = $1 AND "createdAt" >= $2 AND metadata ? 'durationMs'`
      : `SELECT NULL as group, (metadata->>'durationMs')::numeric as duration
         FROM "ProductEvent"
         WHERE "eventName" = $1 AND "createdAt" >= $2 AND metadata ? 'durationMs'`,
    groupMetadataKey ? [eventName, since, groupMetadataKey] : [eventName, since]
  );
  const byGroup = new Map<string | null, number[]>();
  for (const row of result.rows) {
    const key = row.group ?? null;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(Number(row.duration));
  }
  return Array.from(byGroup.entries()).map(([group, durationsMs]) => ({ group, durationsMs }));
}
