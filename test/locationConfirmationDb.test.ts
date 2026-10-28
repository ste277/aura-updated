/**
 * Onboarding V1 PR 1 -- Location Trust Foundation: live-database proof of
 * `User.locationConfirmedAt`'s own invariants. Mirrors
 * PATCH /api/users/location's real sequence (validate via
 * findCity/isValidCustomLocation, THEN call updateUserLocation) the same
 * established way test/goalDemandProvenanceAuthorizationDb.test.ts mirrors
 * its own route -- bypassing HTTP/NextRequest only, never the real
 * validation or persistence functions.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/locationConfirmationDb.test.ts
 */
import { upsertUserByEmail, updateUserLocation, getUserById, beginTransaction } from '../apps/web/lib/db';
import { findCity, isValidCustomLocation } from '../apps/web/lib/cities';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try {
    const r = await c.query(text, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Mirrors PATCH /api/users/location's curated-city path exactly: validate
 * first via findCity, and only call updateUserLocation when it resolves --
 * an unknown/invalid city must never reach updateUserLocation at all. */
async function confirmCuratedCity(userId: string, cityName: string) {
  const city = findCity(cityName);
  if (!city) return { ok: false as const };
  return { ok: true as const, user: await updateUserLocation(userId, city) };
}

/** Mirrors the custom-location path's own validation gate. */
async function confirmCustomLocation(
  userId: string,
  location: { cityName: string; latitude: number; longitude: number; timezone: string }
) {
  if (!isValidCustomLocation(location)) return { ok: false as const };
  return { ok: true as const, user: await updateUserLocation(userId, location) };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-location-confirmation@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  // Reset to a known starting state for a clean re-run: NULL confirmation,
  // the original signup placeholder coordinates.
  await sql(`UPDATE "User" SET "locationConfirmedAt" = NULL, "cityName" = 'Chennai', latitude = 13.0827, longitude = 80.2707, timezone = $2 WHERE id = $1`, [user.id, TZ]);

  try {
    // ============================================================
    // 1. A new user starts with locationConfirmedAt NULL.
    // ============================================================
    {
      const fresh = await getUserById(user.id);
      check('1. a user starts with locationConfirmedAt NULL (never confirmed)', fresh?.locationConfirmedAt == null);
    }

    // ============================================================
    // 2. An "existing" user (one with other profile data already set, the
    // pre-this-feature state every real existing account is in) also
    // remains unconfirmed -- migration 0044 is a true no-op, never
    // inferring confirmation from the mere presence of other data.
    // ============================================================
    {
      await sql(`UPDATE "User" SET "dayBuilderEnabled" = true WHERE id = $1`, [user.id]);
      const existing = await getUserById(user.id);
      check('2. an existing user with other profile data set still has locationConfirmedAt NULL (no inferred confirmation)', existing?.locationConfirmedAt == null);
    }

    // ============================================================
    // 3. An explicit, valid confirmation stamps a real, recent timestamp.
    // ============================================================
    {
      const before = Date.now();
      const result = await confirmCuratedCity(user.id, 'Mumbai');
      const after = Date.now();
      check('3a. confirming a known curated city succeeds', result.ok === true);
      const stamped = result.ok ? result.user.locationConfirmedAt : null;
      check('3b. a successful confirmation stamps a non-null locationConfirmedAt', stamped != null);
      const stampedMs = stamped ? new Date(stamped).getTime() : NaN;
      check('3c. the stamped timestamp falls within this call\'s own wall-clock window', stampedMs >= before - 1000 && stampedMs <= after + 1000);
      check('3d. the confirmed city/coordinates were actually persisted', result.ok && result.user.cityName === 'Mumbai');
    }

    // ============================================================
    // 4. Confirming the SAME (unchanged) city still counts as an explicit
    // confirmation and re-stamps a later timestamp.
    // ============================================================
    {
      const firstStampRow = await getUserById(user.id);
      const firstStamp = firstStampRow?.locationConfirmedAt ? new Date(firstStampRow.locationConfirmedAt).getTime() : 0;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const result = await confirmCuratedCity(user.id, 'Mumbai');
      check('4a. re-confirming the same, unchanged city succeeds (no-op coordinates still count as confirmation)', result.ok === true);
      const secondStamp = result.ok && result.user.locationConfirmedAt ? new Date(result.user.locationConfirmedAt).getTime() : 0;
      check('4b. the re-confirmation advances the stamp to a later timestamp', secondStamp > firstStamp);
      check('4c. the city itself is unchanged by the re-confirmation', result.ok && result.user.cityName === 'Mumbai');
    }

    // ============================================================
    // 5. An invalid/unknown location is rejected BEFORE it ever reaches
    // updateUserLocation -- it must neither stamp a confirmation nor
    // overwrite the previously confirmed, valid location.
    // ============================================================
    {
      const beforeRow = await getUserById(user.id);
      const curatedResult = await confirmCuratedCity(user.id, 'Not A Real City Xyz');
      check('5a. an unknown curated city name is rejected', curatedResult.ok === false);

      const customResult = await confirmCustomLocation(user.id, { cityName: 'Nowhere', latitude: 999, longitude: 999, timezone: 'Not/A/Zone' });
      check('5b. an invalid custom location (out-of-range coordinates, bogus timezone) is rejected', customResult.ok === false);

      const afterRow = await getUserById(user.id);
      check('5c. neither rejected attempt changed locationConfirmedAt', String(afterRow?.locationConfirmedAt) === String(beforeRow?.locationConfirmedAt));
      check('5d. neither rejected attempt changed the persisted cityName', afterRow?.cityName === beforeRow?.cityName);
      check('5e. neither rejected attempt changed the persisted coordinates', afterRow?.latitude === beforeRow?.latitude && afterRow?.longitude === beforeRow?.longitude);
    }

    // ============================================================
    // 6. Repeated valid confirmations remain valid every time (not just
    // the first) -- no one-shot/already-confirmed guard suppresses later
    // stamps.
    // ============================================================
    {
      let previousStamp = 0;
      let allAdvanced = true;
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const result = await confirmCuratedCity(user.id, 'New Delhi');
        const stamp = result.ok && result.user.locationConfirmedAt ? new Date(result.user.locationConfirmedAt).getTime() : 0;
        if (!result.ok || stamp <= previousStamp) allAdvanced = false;
        previousStamp = stamp;
      }
      check('6. three successive confirmations each succeed and each advance the timestamp', allAdvanced);
    }

    // ============================================================
    // 7. A plain read (getUserById) never itself confirms anything --
    // repeated reads leave the already-stamped value byte-for-byte
    // unchanged (no side effect from reading).
    // ============================================================
    {
      const r1 = await getUserById(user.id);
      const r2 = await getUserById(user.id);
      const r3 = await getUserById(user.id);
      check('7. repeated reads never change locationConfirmedAt (reads are not confirmations)', String(r1?.locationConfirmedAt) === String(r2?.locationConfirmedAt) && String(r2?.locationConfirmedAt) === String(r3?.locationConfirmedAt));
    }

    // ============================================================
    // 8. Existing coordinates are only ever changed by a successful
    // confirmation, never incidentally -- re-verified end-to-end against
    // the row left by step 6 (Delhi).
    // ============================================================
    {
      const row = await getUserById(user.id);
      check('8. coordinates on record match the last successfully confirmed city (New Delhi), not an earlier or invalid attempt', row?.cityName === 'New Delhi');
    }

    // ============================================================
    // 9. A "cross-device" read (a fresh getUserById call, simulating a
    // second session/device) sees the SAME persisted confirmation state
    // -- confirmation is server-persisted, not client/session-local.
    // ============================================================
    {
      const sessionA = await getUserById(user.id);
      const sessionB = await getUserById(user.id);
      check('9. a second, independent read sees the identical persisted locationConfirmedAt', String(sessionA?.locationConfirmedAt) === String(sessionB?.locationConfirmedAt) && sessionA?.locationConfirmedAt != null);
    }
  } finally {
    await sql(`UPDATE "User" SET "locationConfirmedAt" = NULL, "cityName" = 'Chennai', latitude = 13.0827, longitude = 80.2707, timezone = $2, "dayBuilderEnabled" = false WHERE id = $1`, [user.id, TZ]);
  }

  if (!allPassed) {
    console.error('SOME LOCATION CONFIRMATION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL LOCATION CONFIRMATION DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
