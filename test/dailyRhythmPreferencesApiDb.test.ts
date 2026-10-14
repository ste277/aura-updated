/**
 * Daily Rhythm V1 PR DR1 -- Preferences Foundation API live-database
 * regression suite. Exercises the actual route handlers directly
 * (GET/PUT/DELETE), the same established pattern
 * test/availabilityPreferencesApi.test.ts already uses (a duck-typed
 * fake NextRequest, no next/server import in this file).
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/dailyRhythmPreferencesApiDb.test.ts
 */
import { upsertUserByEmail } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { GET as getDailyRhythm, PUT as saveDailyRhythm, DELETE as clearDailyRhythm } from '../apps/web/app/api/users/daily-rhythm-preferences/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

interface FakeRequestOptions {
  cookie?: string;
  jsonBody?: unknown;
}

function fakeRequest(opts: FakeRequestOptions = {}): any {
  return {
    cookies: { get: (name: string) => (opts.cookie !== undefined && name === 'as_session' ? { value: opts.cookie } : undefined) },
    json: async () => opts.jsonBody,
  };
}

async function readJson(res: { json: () => Promise<any> }): Promise<any> {
  return res.json();
}

const TZ = 'Asia/Kolkata';

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-daily-rhythm-preferences-api-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-daily-rhythm-preferences-api-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  try {
    // Clean slate.
    await clearDailyRhythm(fakeRequest({ cookie: tokenA }));
    await clearDailyRhythm(fakeRequest({ cookie: tokenB }));

    // ============================================================
    // 1-3. UNAUTHENTICATED
    // ============================================================
    {
      const getRes = await getDailyRhythm(fakeRequest({}));
      check('1. GET without session -> 401', getRes.status === 401);
      const putRes = await saveDailyRhythm(fakeRequest({ jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [] } }));
      check('2. PUT without session -> 401', putRes.status === 401);
      const delRes = await clearDailyRhythm(fakeRequest({}));
      check('3. DELETE without session -> 401', delRes.status === 401);
    }

    // ============================================================
    // 4. GET UNCONFIGURED -- an existing user who never touched this
    // preference (regression: "preserve existing behavior when
    // preferences are unset").
    // ============================================================
    {
      const res = await getDailyRhythm(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('4. GET (never saved) -> 200', res.status === 200);
      check('4. GET (never saved) -> configured:false', body.configured === false);
      check('4. GET (never saved) -> workStart/workEnd null', body.workStart === null && body.workEnd === null);
      check('4. GET (never saved) -> workDays: []', Array.isArray(body.workDays) && body.workDays.length === 0);
      check('4. GET always returns the authoritative User.timezone', body.timezone === TZ);
    }

    // ============================================================
    // 5/6. SAVE then reload.
    // ============================================================
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '10:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] } }));
      const body = await readJson(res);
      check('5. PUT -> 200', res.status === 200);
      check('5. PUT sets configured=true', body.configured === true);
      check('5. PUT returns the saved workStart/workEnd', body.workStart === '10:00' && body.workEnd === '18:00');
      check('5. PUT returns the saved workDays', JSON.stringify(body.workDays) === JSON.stringify([1, 2, 3, 4, 5]));

      const getBody = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenA })));
      check('6. GET (after save) -> configured:true', getBody.configured === true);
      check('6. GET (after save) reflects the saved values', getBody.workStart === '10:00' && getBody.workEnd === '18:00' && JSON.stringify(getBody.workDays) === JSON.stringify([1, 2, 3, 4, 5]));
    }

    // ============================================================
    // 7. UPDATE -- a second PUT with different values REPLACES, never
    // merges.
    // ============================================================
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:30', workDays: [1, 3] } }));
      const body = await readJson(res);
      check('7. PUT replaces the prior values entirely', body.workStart === '09:00' && body.workEnd === '17:30' && JSON.stringify(body.workDays) === JSON.stringify([1, 3]));
      const getBody = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenA })));
      check('7b. GET confirms the replacement, not a merge of [1,2,3,4,5] and [1,3]', JSON.stringify(getBody.workDays) === JSON.stringify([1, 3]));
    }

    // ============================================================
    // 8. Empty workday selection -- a valid, deliberate state, not an
    // error (ticket's own explicit validation scenario).
    // ============================================================
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [] } }));
      const body = await readJson(res);
      check('8. PUT with an empty workDays array -> 200, still configured', res.status === 200 && body.configured === true);
      check('8b. workDays saved as empty', Array.isArray(body.workDays) && body.workDays.length === 0);
      const getBody = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenA })));
      check('8c. GET after an empty-workDays save still reports configured:true with empty workDays (never reinterpreted as a clear)', getBody.configured === true && getBody.workDays.length === 0);
    }

    // ============================================================
    // 9/10. CLEAR resets to unconfigured.
    // ============================================================
    {
      await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [1, 2] } }));
      const res = await clearDailyRhythm(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('9. DELETE (clear) -> 200, configured:false', res.status === 200 && body.configured === false);
      check('9b. DELETE response reports null times and empty workDays', body.workStart === null && body.workEnd === null && body.workDays.length === 0);
      const getBody = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenA })));
      check('10. GET after clear reports configured:false (genuinely unconfigured again)', getBody.configured === false && getBody.workStart === null && getBody.workEnd === null);
      check('10b. GET after clear reports an empty workDays array', getBody.workDays.length === 0);
    }

    // ============================================================
    // 11. Isolation -- client-supplied userId/timezone are ignored, and
    // one user's write never touches another's.
    // ============================================================
    {
      const res = await saveDailyRhythm(
        fakeRequest({ cookie: tokenA, jsonBody: { userId: userB.id, timezone: 'America/New_York', workStart: '08:00', workEnd: '16:00', workDays: [6] } })
      );
      check('11. PUT with a spoofed userId/timezone in the body still succeeds (fields silently ignored)', res.status === 200);
      const bodyA = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenA })));
      const bodyB = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenB })));
      check('11b. the write landed under the AUTHENTICATED user (A), not the body\'s spoofed userId (B)', bodyA.workStart === '08:00');
      check('11c. user B is completely unaffected by A\'s spoof attempt', bodyB.configured === false);
      check('11d. GET.timezone always reflects the real User.timezone, never a client-submitted value', bodyA.timezone === TZ);
    }

    // ============================================================
    // 12-16. Server-side validation.
    // ============================================================
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '9:00', workEnd: '17:00', workDays: [] } }));
      check('12. a non-zero-padded time is rejected with 400', res.status === 400);
    }
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '25:00', workEnd: '17:00', workDays: [] } }));
      check('13. an out-of-range hour is rejected with 400', res.status === 400);
    }
    {
      // Overnight work window -- rejected per the approved audit's
      // explicit V1 policy ("overnight shifts are future scope").
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '22:00', workEnd: '06:00', workDays: [] } }));
      check('14. an overnight (cross-midnight) work window is rejected with 400, matching the approved audit\'s V1 policy', res.status === 400);
    }
    {
      // workStart === workEnd is also an invalid (zero-width) range.
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '09:00', workDays: [] } }));
      check('15. workStart === workEnd (zero-width range) is rejected with 400', res.status === 400);
    }
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [7] } }));
      check('16. an out-of-range weekday (7) in workDays is rejected with 400', res.status === 400);
    }
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [-1] } }));
      check('16b. a negative weekday in workDays is rejected with 400', res.status === 400);
    }
    {
      // Only one of the two times supplied -- rejected by the route's own
      // type guard before validation even runs.
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workDays: [] } }));
      check('17. PUT missing workEnd entirely is rejected with 400', res.status === 400);
    }
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: 'not-an-array' } }));
      check('17b. a non-array workDays is rejected with 400', res.status === 400);
    }

    // ============================================================
    // 18. Duplicate weekdays are deduplicated, never stored twice.
    // ============================================================
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [1, 1, 2, 1] } }));
      const body = await readJson(res);
      check('18. duplicate weekdays in the input are deduplicated', JSON.stringify(body.workDays) === JSON.stringify([1, 2]));
    }

    // ============================================================
    // 19. workDays is always returned sorted ascending, regardless of
    // submission order.
    // ============================================================
    {
      const res = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '09:00', workEnd: '17:00', workDays: [5, 1, 3] } }));
      const body = await readJson(res);
      check('19. workDays is returned sorted ascending, independent of submission order', JSON.stringify(body.workDays) === JSON.stringify([1, 3, 5]));
    }

    // ============================================================
    // 20. A rejected (invalid) PUT never mutates the previously-saved,
    // valid state.
    // ============================================================
    {
      await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '10:00', workEnd: '18:00', workDays: [2] } }));
      const rejected = await saveDailyRhythm(fakeRequest({ cookie: tokenA, jsonBody: { workStart: '22:00', workEnd: '06:00', workDays: [3] } }));
      check('20. the overnight rejection itself returns 400', rejected.status === 400);
      const getBody = await readJson(await getDailyRhythm(fakeRequest({ cookie: tokenA })));
      check('20b. the previously-saved valid state is completely unchanged after a rejected PUT', getBody.workStart === '10:00' && getBody.workEnd === '18:00' && JSON.stringify(getBody.workDays) === JSON.stringify([2]));
    }
  } finally {
    await clearDailyRhythm(fakeRequest({ cookie: tokenA })).catch(() => undefined);
    await clearDailyRhythm(fakeRequest({ cookie: tokenB })).catch(() => undefined);
  }

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Preferences API checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM PREFERENCES API CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
