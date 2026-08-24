import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { E2E_EMAIL_DOMAIN } from './testUser';

/**
 * Product Journey / E2E Hardening V1 (brief section 2/29) -- Playwright
 * globalTeardown. Deletes every row created by this E2E run, scoped
 * STRICTLY to the e2e-tagged email domain (e2e-<label>-<uuid>@e2e.aura.local)
 * -- never a broader wipe, never a developer's own rows.
 *
 * Deletion order matters: HabitLog/VisitLog/Habit reference User with
 * ON DELETE RESTRICT (see prisma/migrations/0001_init, 0002_visit_log,
 * 0004_habits), so they must be removed before the User row itself. Every
 * other table already cascades from User (SavedPerson, PlannedActivity,
 * AuraMoment, ProductEvent, ReminderAttention/Delivery, PushSubscription,
 * GuestConversionRedemption, DailyReflection, CustomCity).
 */
function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, '../../apps/web/.env.local');
  const raw = fs.readFileSync(envPath, 'utf8');
  const match = raw.match(/^DATABASE_URL="(.*)"$/m);
  if (!match) throw new Error(`DATABASE_URL not found in ${envPath} and not set in the environment.`);
  return match[1];
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_SKIP_CLEANUP === 'true') {
    console.log('[e2e cleanup] E2E_SKIP_CLEANUP=true -- leaving fixture data in place for inspection.');
    return;
  }

  const pool = new Pool({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  try {
    const pattern = `%@${E2E_EMAIL_DOMAIN}`;
    const users = await pool.query('SELECT id FROM "User" WHERE email LIKE $1', [pattern]);
    const userIds = users.rows.map((row) => row.id);
    if (userIds.length === 0) {
      console.log('[e2e cleanup] No e2e-tagged users found -- nothing to clean up.');
      return;
    }

    await pool.query('DELETE FROM "HabitLog" WHERE "userId" = ANY($1)', [userIds]);
    await pool.query('DELETE FROM "VisitLog" WHERE "userId" = ANY($1)', [userIds]);
    await pool.query('DELETE FROM "Habit" WHERE "userId" = ANY($1)', [userIds]);
    const result = await pool.query('DELETE FROM "User" WHERE id = ANY($1)', [userIds]);
    console.log(`[e2e cleanup] Removed ${result.rowCount} e2e-tagged user(s) (email LIKE '${pattern}') and their dependent rows.`);
  } finally {
    await pool.end();
  }
}
