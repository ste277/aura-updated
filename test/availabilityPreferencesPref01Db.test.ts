/**
 * AURA-PREF-01 (PV-F01) -- changing availability or work hours never
 * modifies existing confirmed plans. Real database:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/availabilityPreferencesPref01Db.test.ts
 */
import { randomUUID } from 'crypto';
import {
  beginTransaction,
  clearDailyWorkPreferences,
  createPlannedActivity,
  getDailyWorkPreferences,
  getUserAvailabilityConfiguration,
  replaceUserAvailabilityConfiguration,
  resetUserAvailabilityConfiguration,
  setDailyWorkPreferences,
  upsertUserByEmail,
} from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function planSnapshot(userId: string): Promise<string> {
  const client = await beginTransaction();
  try {
    const rows = (await client.query(`SELECT id, status, "plannedStartAt", "plannedEndAt", "updatedAt", title FROM "PlannedActivity" WHERE "userId" = $1 ORDER BY id`, [userId])).rows;
    await client.query('COMMIT');
    return JSON.stringify(rows);
  } finally {
    client.release();
  }
}

async function main() {
  const user = await upsertUserByEmail({ email: `pref01-${randomUUID().slice(0, 8)}@e2e.aura.local`, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  const fresh = await getDailyWorkPreferences(user.id);
  const freshAvailability = await getUserAvailabilityConfiguration(user.id);
  check('D1. A newly registered user has no work hours and no work days', !!fresh && fresh.workStart === null && fresh.workEnd === null && fresh.workDays.length === 0);
  check('D2. A newly registered user has no availability configured', !!freshAvailability && freshAvailability.configured === false);

  // Confirmed plans inside what will become working hours / outside availability.
  const start = new Date(Date.now() + 2 * 86400_000);
  start.setUTCHours(6, 0, 0, 0); // 11:30 IST
  await createPlannedActivity({ userId: user.id, title: 'Gym', activityType: 'Workout', icon: '🏋️', plannedStartAt: start, plannedEndAt: new Date(start.getTime() + 45 * 60_000), durationMinutes: 45, windowType: 'NEUTRAL' });
  await createPlannedActivity({ userId: user.id, title: 'Late call', activityType: 'Deep Work', icon: '🧠', plannedStartAt: new Date(start.getTime() + 12 * 3600_000), plannedEndAt: new Date(start.getTime() + 13 * 3600_000), durationMinutes: 60, windowType: 'NEUTRAL' });
  const before = await planSnapshot(user.id);

  await setDailyWorkPreferences(user.id, { workStart: '09:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] });
  check('D3. Setting work hours leaves confirmed plans untouched', (await planSnapshot(user.id)) === before);
  const saved = await getDailyWorkPreferences(user.id);
  check('D4. Custom work hours and days are stored as given', saved?.workStart === '09:00' && saved?.workEnd === '18:00' && JSON.stringify(saved?.workDays) === '[1,2,3,4,5]');

  await setDailyWorkPreferences(user.id, { workStart: '13:00', workEnd: '21:00', workDays: [2, 3, 4, 5, 6] });
  check('D5. Changing to a non-Monday-Friday schedule leaves confirmed plans untouched', (await planSnapshot(user.id)) === before);

  await replaceUserAvailabilityConfiguration(user.id, [{ weekday: 1, startTime: '06:00', endTime: '08:00' }, { weekday: 6, startTime: '10:00', endTime: '20:00' }]);
  check('D6. Setting availability that excludes a planned time leaves confirmed plans untouched', (await planSnapshot(user.id)) === before);

  await clearDailyWorkPreferences(user.id);
  await resetUserAvailabilityConfiguration(user.id);
  check('D7. Clearing both preferences leaves confirmed plans untouched', (await planSnapshot(user.id)) === before);
  const cleared = await getDailyWorkPreferences(user.id);
  check('D8. Clearing returns the user to the unconfigured default (skip is always possible)', cleared?.workStart === null && cleared?.workDays.length === 0 && (await getUserAvailabilityConfiguration(user.id))?.configured === false);

  console.log(allPassed ? '\nALL PREF-01 DB CHECKS PASSED' : '\nSOME PREF-01 DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
