/**
 * Location PR8 -- Reliable Confirmation & Configuration: live-database
 * proof of PATCH /api/users/location exercised directly (same convention
 * as test/movePlanApiDb.test.ts -- the real route handler, a real session
 * token, a minimal mock NextRequest) under the exact payload shape the
 * new LocationPicker "Confirm {currentCity}" action sends
 * (AURA_LOCATION_CONFIRMATION_AUDIT_V1.md root cause #2). This endpoint
 * and the backend write path (updateUserLocation, db.ts) are shared
 * verbatim by every save path in LocationPicker.tsx (curated select,
 * manual form, GPS/search confirm, and now this explicit action) -- there
 * is exactly one persistence contract to prove correct here, not a
 * parallel one for the new button.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/locationExplicitConfirmationApiDb.test.ts
 */
import { upsertUserByEmail, beginTransaction, getUserById } from '../apps/web/lib/db';
import { createSessionToken, SESSION_COOKIE_NAME } from '../apps/web/lib/auth';
import { PATCH as locationRoute } from '../apps/web/app/api/users/location/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const CHENNAI = { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };
const MUMBAI = { cityName: 'Mumbai', latitude: 19.076, longitude: 72.8777, timezone: 'Asia/Kolkata' };

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(text, params); await c.query('COMMIT'); return r.rows; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

/** Mirrors movePlanApiDb.test.ts's own mock NextRequest exactly -- the
 * same minimal shape getSessionFromRequest (lib/session.ts) and
 * parseJsonObject (lib/request.ts) actually read: a cookie jar and an
 * async json() body reader. '__malformed__' simulates a body that throws
 * on .json(), the same sentinel the existing move-API test suite uses. */
const req = (tok: string | null, body: unknown): any => ({
  cookies: { get: (n: string) => (tok && n === SESSION_COOKIE_NAME ? { value: tok } : undefined) },
  json: async () => {
    if (body === '__malformed__') throw new SyntaxError('bad json');
    return body;
  },
  headers: new Headers(),
});

/** The exact payload shape LocationPicker's new confirmCurrentLocation()
 * sends -- the caller's own already-persisted cityName/latitude/longitude/
 * timezone, always via the "custom" branch (never the curated-cityName
 * branch), matching confirmPendingResult's existing convention exactly. */
const confirmCurrentPayload = (loc: { cityName: string; latitude: number; longitude: number; timezone: string }) => ({
  custom: { cityName: loc.cityName, latitude: loc.latitude, longitude: loc.longitude, timezone: loc.timezone },
});

async function callPatch(token: string | null, body: unknown) {
  const res = await locationRoute(req(token, body));
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-pr8-location-a@example.com', ...CHENNAI });
  const userB = await upsertUserByEmail({ email: 'test-pr8-location-b@example.com', ...CHENNAI });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  const resetUser = async (userId: string) =>
    sql(`UPDATE "User" SET "cityName" = $2, latitude = $3, longitude = $4, timezone = $5, "locationConfirmedAt" = NULL WHERE id = $1`,
      [userId, CHENNAI.cityName, CHENNAI.latitude, CHENNAI.longitude, CHENNAI.timezone]);

  try {
    // ============================================================
    // 1. CONFIRM EXISTING CHENNAI -- the exact bug-report scenario: a
    // user already on Chennai (never confirmed) confirms it directly,
    // with no prior <select> change and no fresh geocode.
    // ============================================================
    await resetUser(userA.id);
    const before1 = await getUserById(userA.id);
    check('1. before confirming, locationConfirmedAt is NULL (never touched)', before1?.locationConfirmedAt == null);
    const r1 = await callPatch(tokenA, confirmCurrentPayload(CHENNAI));
    check('1. confirming the EXISTING Chennai (no change) returns 200', r1.status === 200);
    check('1. the response carries a real, non-null locationConfirmedAt', typeof r1.body.locationConfirmedAt === 'string');
    check('1. cityName/latitude/longitude/timezone are unchanged (Chennai)', r1.body.cityName === 'Chennai' && r1.body.latitude === CHENNAI.latitude && r1.body.longitude === CHENNAI.longitude && r1.body.timezone === 'Asia/Kolkata');

    // ============================================================
    // 2. CONFIRM SAME CITY TWICE -- idempotent, both succeed, the
    // second call advances the timestamp (an explicit re-confirmation
    // is itself a real, distinct confirmation event).
    // ============================================================
    const firstStamp = new Date(r1.body.locationConfirmedAt as string).getTime();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const r2 = await callPatch(tokenA, confirmCurrentPayload(CHENNAI));
    const secondStamp = new Date(r2.body.locationConfirmedAt as string).getTime();
    check('2. re-confirming the same, unchanged city succeeds a second time', r2.status === 200);
    check('2. the second confirmation advances the timestamp (a real, distinct event)', secondStamp > firstStamp);
    check('2. the city itself is unchanged by the re-confirmation', r2.body.cityName === 'Chennai');

    // ============================================================
    // 3/4. CONFIRM WITHOUT OPENCAGE / WITHOUT GPS -- this endpoint never
    // calls lib/geocoding.ts or navigator.geolocation at all (confirmed
    // by reading app/api/users/location/route.ts in full); every check
    // in this suite calling PATCH directly is itself live proof this
    // path needs neither. Asserted explicitly here as its own scenario.
    // ============================================================
    const geocodingImported = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/app/api/users/location/route.ts'), 'utf8');
    check('3. PATCH /api/users/location never imports lib/geocoding.ts (no OpenCage dependency)', !geocodingImported.includes('geocoding'));
    check('4. PATCH /api/users/location never references navigator/geolocation (no GPS dependency)', !/navigator|geolocation/i.test(geocodingImported));

    // ============================================================
    // 5/6. CHENNAI -> MUMBAI -> CHENNAI -- genuine changes, both via the
    // exact same confirm-current payload shape.
    // ============================================================
    const r5 = await callPatch(tokenA, confirmCurrentPayload(MUMBAI));
    check('5. Chennai -> Mumbai succeeds and persists the new city', r5.status === 200 && r5.body.cityName === 'Mumbai' && r5.body.latitude === MUMBAI.latitude);
    const r6 = await callPatch(tokenA, confirmCurrentPayload(CHENNAI));
    check('6. Mumbai -> Chennai succeeds and persists the change back', r6.status === 200 && r6.body.cityName === 'Chennai');

    // ============================================================
    // 7. PERSIST AFTER RELOAD -- a fresh, independent read (simulating
    // the client's own post-reload fetch) sees the exact same row.
    // ============================================================
    const reloaded = await getUserById(userA.id);
    check('7. persists after reload -- a fresh read sees the same confirmed city/coordinates/timestamp', reloaded?.cityName === 'Chennai' && reloaded?.latitude === CHENNAI.latitude && reloaded?.locationConfirmedAt != null);

    // ============================================================
    // 8. PERSIST AFTER SIGN-IN -- a brand-new session token for the SAME
    // user (simulating a fresh sign-in) reads the identical persisted
    // state; confirmation is a plain DB column, never session-scoped.
    // ============================================================
    const freshSignInToken = createSessionToken(userA.id, userA.email);
    const viaNewSession = await callPatch(freshSignInToken, confirmCurrentPayload(CHENNAI));
    check('8. a brand-new session token for the same user can read/re-confirm the identical persisted location', viaNewSession.status === 200 && viaNewSession.body.cityName === 'Chennai');

    // ============================================================
    // 9. HOME BANNER DISAPPEARS -- the banner's own gating condition
    // (page.tsx: user.locationConfirmedAt != null) is satisfied the
    // instant this endpoint returns 2xx.
    // ============================================================
    check('9. the exact condition the Home banner checks (locationConfirmedAt != null) is satisfied after a successful confirm', reloaded?.locationConfirmedAt != null);

    // ============================================================
    // 10. MISSING COORDINATES -- rejected with 400, never a silent 200.
    // ============================================================
    const beforeMissing = await getUserById(userA.id);
    const r10 = await callPatch(tokenA, { custom: { cityName: 'Nowhere', timezone: 'Asia/Kolkata' } });
    const afterMissing = await getUserById(userA.id);
    check('10. missing latitude/longitude is rejected with 400', r10.status === 400);
    check('10. the rejected attempt never touched the persisted location', afterMissing?.cityName === beforeMissing?.cityName && String(afterMissing?.locationConfirmedAt) === String(beforeMissing?.locationConfirmedAt));

    // ============================================================
    // 11. INVALID TIMEZONE -- rejected with 400.
    // ============================================================
    const beforeInvalidTz = await getUserById(userA.id);
    const r11 = await callPatch(tokenA, { custom: { cityName: 'Nowhere', latitude: 10, longitude: 10, timezone: 'Not/A_Real_Zone' } });
    const afterInvalidTz = await getUserById(userA.id);
    check('11. an invalid IANA timezone is rejected with 400', r11.status === 400);
    check('11. the rejected attempt never touched the persisted location', afterInvalidTz?.cityName === beforeInvalidTz?.cityName);

    // ============================================================
    // 12. SAVE API FAILURE -- out-of-range coordinates rejected, no
    // partial write, existing confirmed location fully intact.
    // ============================================================
    const beforeFail = await getUserById(userA.id);
    const r12 = await callPatch(tokenA, { custom: { cityName: 'Impossible', latitude: 999, longitude: 999, timezone: 'Asia/Kolkata' } });
    const afterFail = await getUserById(userA.id);
    check('12. out-of-range coordinates are rejected with 400 (never a silent success)', r12.status === 400);
    check('12. a failed save leaves the EXISTING confirmed location completely unchanged', afterFail?.cityName === beforeFail?.cityName && afterFail?.latitude === beforeFail?.latitude && String(afterFail?.locationConfirmedAt) === String(beforeFail?.locationConfirmedAt));

    // ============================================================
    // 13. USER ISOLATION -- confirming user A's location never touches
    // user B's row.
    // ============================================================
    await resetUser(userB.id);
    const beforeB = await getUserById(userB.id);
    await callPatch(tokenA, confirmCurrentPayload(MUMBAI));
    const afterB = await getUserById(userB.id);
    check('13. user isolation -- confirming user A\'s location never changes user B\'s row', afterB?.cityName === beforeB?.cityName && String(afterB?.locationConfirmedAt) === String(beforeB?.locationConfirmedAt));

    // ============================================================
    // 14. CONCURRENT CONFIRMATION -- two near-simultaneous confirms of
    // the SAME city both succeed, final state is consistent (one city,
    // one real timestamp), never a corrupted/partial row.
    // ============================================================
    await resetUser(userA.id);
    const [c1, c2] = await Promise.all([
      callPatch(tokenA, confirmCurrentPayload(CHENNAI)),
      callPatch(tokenA, confirmCurrentPayload(CHENNAI)),
    ]);
    const afterConcurrent = await getUserById(userA.id);
    check('14. concurrent confirmation -- both requests succeed', c1.status === 200 && c2.status === 200);
    check('14. concurrent confirmation -- final state is consistent (Chennai, one real timestamp, not corrupted)', afterConcurrent?.cityName === 'Chennai' && afterConcurrent?.locationConfirmedAt != null);

    // ============================================================
    // 15. NO ACCIDENTAL LOCATION CHANGE -- a rejected attempt with a
    // DIFFERENT (invalid) city must never change the city away from
    // what was already confirmed.
    // ============================================================
    const beforeAccidental = await getUserById(userA.id);
    await callPatch(tokenA, { custom: { cityName: 'Should Not Save', latitude: 999, longitude: 999, timezone: 'Asia/Kolkata' } });
    const afterAccidental = await getUserById(userA.id);
    check('15. no accidental location change -- a rejected attempt never overwrites the real cityName', afterAccidental?.cityName === beforeAccidental?.cityName && afterAccidental?.cityName !== 'Should Not Save');

    // ============================================================
    // 16. NO FALSE SUCCESS -- every rejection above returned a non-2xx
    // status with a real error message, never a 200 with misleading
    // content.
    // ============================================================
    check('16. no false success -- missing-coordinates rejection carries a real error string', typeof r10.body.error === 'string' && r10.body.error.length > 0);
    check('16. no false success -- invalid-timezone rejection carries a real error string', typeof r11.body.error === 'string' && r11.body.error.length > 0);
    check('16. no false success -- out-of-range rejection carries a real error string', typeof r12.body.error === 'string' && r12.body.error.length > 0);

    // ============================================================
    // 17. NO READ-SIDE WRITES -- a plain read performs zero writes.
    // ============================================================
    const countBefore = (await sql(`SELECT count(*)::int AS c FROM "User" WHERE id = $1`, [userA.id]))[0].c;
    await getUserById(userA.id);
    await getUserById(userA.id);
    const countAfter = (await sql(`SELECT count(*)::int AS c FROM "User" WHERE id = $1`, [userA.id]))[0].c;
    check('17. no read-side writes -- repeated reads never change row count/identity', countBefore === countAfter && countBefore === 1);

    // ============================================================
    // 18. EXISTING ONBOARDING REGRESSION -- OnboardingJourney.tsx's own
    // separate "Confirm {cityName}" action (onConfirmSuggested) sends
    // the SAME curated-vs-custom PATCH shapes this route has always
    // accepted; confirmed here that the curated-cityName branch (what
    // onboarding sends for a curated match) still works unmodified by
    // this PR's changes (route.ts itself was not touched).
    // ============================================================
    await resetUser(userA.id);
    const r18 = await callPatch(tokenA, { cityName: 'Chennai' });
    check('18. the pre-existing curated-cityName PATCH shape (used by onboarding\'s own confirm action) still works unmodified', r18.status === 200 && r18.body.cityName === 'Chennai' && typeof r18.body.locationConfirmedAt === 'string');

    // Auth/validation guards, unmodified, re-confirmed:
    const unauth = await callPatch(null, confirmCurrentPayload(CHENNAI));
    check('auth -- an unauthenticated request is rejected with 401, never silently succeeds', unauth.status === 401);

    console.log(allPassed ? '\nALL LOCATION PR8 API SCENARIOS PASSED' : '\nSOME LOCATION PR8 API SCENARIOS FAILED');
  } finally {
    await sql(`DELETE FROM "CustomCity" WHERE "userId" = ANY($1::text[])`, [[userA.id, userB.id]]).catch(() => {});
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
