import { Pool } from 'pg';
import { randomUUID } from 'crypto';

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

export interface HabitLogRow {
  id: string;
  userId: string;
  activityTitle: string;
  activeWindow: string;
  logTimestamp: Date;
  logMinuteOfDay: number;
  durationMinutes: number;
  notes?: string | null; // Added notes field
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
      `INSERT INTO "HabitLog" (id, "userId", "habitId", "activityTitle", "activeWindow", "logMinuteOfDay")
       VALUES ($1, $2, $3, $4, $5, $6)`,
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

export async function upsertUserByEmail(input: {
  email: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}): Promise<User> {
  const existing = await pool.query('SELECT * FROM "User" WHERE email = $1', [input.email]);
  if (existing.rows.length > 0) return existing.rows[0];

  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO "User" (id, email, "cityName", latitude, longitude, timezone)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id, input.email, input.cityName, input.latitude, input.longitude, input.timezone]
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
    `SELECT id, "userId", "activityTitle", "activeWindow", "logTimestamp", "logMinuteOfDay", "durationMinutes", notes
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

export async function incrementAuthCodeAttempts(id: string): Promise<void> {
  await pool.query(`UPDATE "AuthCode" SET attempts = attempts + 1 WHERE id = $1`, [id]);
}

export async function consumeAuthCode(id: string): Promise<void> {
  await pool.query(`UPDATE "AuthCode" SET "consumedAt" = now() WHERE id = $1`, [id]);
}

export async function createHabitLog(input: {
  userId: string;
  activityTitle: string;
  activeWindow: string;
  logMinuteOfDay: number;
  logTimestamp?: Date;
  durationMinutes?: number;
  notes?: string; // Added optional notes parameter
}): Promise<HabitLogRow> {
  const id = randomUUID();
  const timestamp = input.logTimestamp ?? new Date();

  const result = await pool.query(
    `INSERT INTO "HabitLog" (id, "userId", "activityTitle", "activeWindow", "logMinuteOfDay", "logTimestamp", "durationMinutes", notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [id, input.userId, input.activityTitle, input.activeWindow, input.logMinuteOfDay, timestamp, input.durationMinutes ?? 30, input.notes ?? null]
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
