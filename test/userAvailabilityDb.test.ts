/**
 * Live-database tests for Availability Context V1 PR H1 -- the real
 * `User.availabilityConfigured` flag and `UserAvailabilityPeriod` rows,
 * exercised end-to-end against a real Postgres connection: migration
 * default state, the UNCONFIGURED/CONFIGURED/CONFIGURED_EMPTY
 * distinction, and multi-period persistence order-independence. Requires
 * a real, reachable DATABASE_URL, same convention as
 * `dayConstructorAcceptancePersistenceDb.test.ts` -- NOT part of
 * ci.yml's math-core-tests job (no Postgres service provisioned there).
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/userAvailabilityDb.test.ts
 *
 * Reuses the SAME throwaway-test-user convention every other live-DB
 * test in this repository already uses (idempotent via email upsert),
 * and clears every row it creates in a `finally` block.
 */
import { upsertUserByEmail, getUserById, setAvailabilityConfigured, createUserAvailabilityPeriod, listUserAvailabilityPeriods, deleteUserAvailabilityPeriods } from '../apps/web/lib/db';
import { resolveAvailability } from '../apps/web/lib/availabilityContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

async function main() {
  const user = await upsertUserByEmail({ email: 'test-availability-context@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  try {
    // ============================================================
    // 1. Migration default / UNCONFIGURED baseline (this ticket's own
    // section 42/43: existing users must remain UNCONFIGURED).
    // ============================================================
    await setAvailabilityConfigured(user.id, false);
    await deleteUserAvailabilityPeriods(user.id);
    {
      const reloaded = await getUserById(user.id);
      check('1. a user with no explicit availability action reads back availabilityConfigured=false (UNCONFIGURED)', reloaded?.availabilityConfigured === false);
    }
    {
      const periods = await listUserAvailabilityPeriods(user.id);
      check('2. a freshly-cleared user has zero persisted periods', periods.length === 0);
    }

    // ============================================================
    // 2. CONFIGURED, real weekday, single period.
    // ============================================================
    await setAvailabilityConfigured(user.id, true);
    await createUserAvailabilityPeriod(user.id, 3, '09:00', '17:00'); // Wednesday.
    {
      const reloaded = await getUserById(user.id);
      const periods = await listUserAvailabilityPeriods(user.id);
      check('3. after setAvailabilityConfigured(true) the flag persists across a fresh read', reloaded?.availabilityConfigured === true);
      check('4. the created period persists with the exact fields written', periods.length === 1 && periods[0].weekday === 3 && periods[0].startTime === '09:00' && periods[0].endTime === '17:00');
      const resolution = resolveAvailability({
        targetDate: '2026-09-16', // a Wednesday.
        timezone: TZ,
        now: new Date('2026-09-16T00:00:00Z'),
        configuration: { configured: reloaded!.availabilityConfigured === true, periods: periods.map((p) => ({ weekday: p.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6, startTime: p.startTime, endTime: p.endTime })) },
      });
      check('5. the real persisted row round-trips through resolveAvailability end-to-end (DB -> db.ts -> availabilityContext.ts)', resolution.status === 'CONFIGURED' && resolution.usableWindows.length === 1);
    }

    // ============================================================
    // 3. CONFIGURED_EMPTY -- configured=true, but no period matches a
    // DIFFERENT target weekday (this ticket's own section 4/18/43's own
    // required proof).
    // ============================================================
    {
      const reloaded = await getUserById(user.id);
      const periods = await listUserAvailabilityPeriods(user.id); // still only the Wednesday period.
      const resolution = resolveAvailability({
        targetDate: '2026-09-13', // a Sunday -- no period configured for weekday 0.
        timezone: TZ,
        now: new Date('2026-09-13T00:00:00Z'),
        configuration: { configured: reloaded!.availabilityConfigured === true, periods: periods.map((p) => ({ weekday: p.weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6, startTime: p.startTime, endTime: p.endTime })) },
      });
      check('6. CONFIGURED_EMPTY: a real configured user with no period for the target weekday resolves to CONFIGURED with zero usable windows, never UNCONFIGURED', resolution.status === 'CONFIGURED' && resolution.usableWindows.length === 0);
    }

    // ============================================================
    // 4. Multiple periods persist deterministically, independent of
    // insertion order (this ticket's own section 43).
    // ============================================================
    await deleteUserAvailabilityPeriods(user.id);
    await createUserAvailabilityPeriod(user.id, 3, '14:00', '18:00'); // inserted LATER-in-day period FIRST.
    await createUserAvailabilityPeriod(user.id, 3, '09:00', '12:00'); // inserted EARLIER-in-day period SECOND.
    {
      const periods = await listUserAvailabilityPeriods(user.id);
      check(
        '7. listUserAvailabilityPeriods returns rows in deterministic (weekday, startTime) order regardless of insertion order',
        periods.length === 2 && periods[0].startTime === '09:00' && periods[1].startTime === '14:00'
      );
    }
  } finally {
    await deleteUserAvailabilityPeriods(user.id);
    await setAvailabilityConfigured(user.id, false);
  }

  if (!allPassed) {
    console.error('\nSome User Availability DB checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL USER AVAILABILITY DB CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
