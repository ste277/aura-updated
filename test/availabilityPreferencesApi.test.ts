/**
 * Availability Settings V1 -- PR H2 API live-database regression suite.
 * Exercises the actual route handlers directly (GET/PUT/DELETE), the
 * SAME pattern test/activityPreferencesApi.test.ts already establishes
 * (a duck-typed fake NextRequest, no next/server import in this file --
 * see that file's own header comment for why).
 *
 * Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/availabilityPreferencesApi.test.ts
 */
import { upsertUserByEmail } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { GET as getAvailability, PUT as saveAvailability, DELETE as resetAvailability } from '../apps/web/app/api/users/availability-preferences/route';

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
  const userA = await upsertUserByEmail({ email: 'test-availability-preferences-api-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-availability-preferences-api-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  try {
    // Clean slate.
    await resetAvailability(fakeRequest({ cookie: tokenA }));
    await resetAvailability(fakeRequest({ cookie: tokenB }));

    // ============================================================
    // 21/22/23. UNAUTHENTICATED
    // ============================================================
    {
      const getRes = await getAvailability(fakeRequest({}));
      check('21. GET without session -> 401', getRes.status === 401);
      const putRes = await saveAvailability(fakeRequest({ jsonBody: { periods: [] } }));
      check('22. PUT without session -> 401', putRes.status === 401);
      const delRes = await resetAvailability(fakeRequest({}));
      check('23. DELETE without session -> 401', delRes.status === 401);
    }

    // ============================================================
    // 24. GET UNCONFIGURED
    // ============================================================
    {
      const res = await getAvailability(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('24. GET (never saved) -> 200', res.status === 200);
      check('24. GET (never saved) -> configured:false', body.configured === false);
      check('24. GET (never saved) -> periods: []', Array.isArray(body.periods) && body.periods.length === 0);
      check('24. GET always returns the authoritative User.timezone', body.timezone === TZ);
    }

    // ============================================================
    // 28/29/30. SAVE sets configured=true, multiple periods, then REPLACE.
    // ============================================================
    {
      const res1 = await saveAvailability(
        fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 3, startTime: '09:00', endTime: '12:00' }] } })
      );
      const body1 = await readJson(res1);
      check('28. PUT -> 200', res1.status === 200);
      check('28. PUT sets configured=true', body1.configured === true);
      check('30. PUT accepts multiple periods on different weekdays', body1.periods.length === 2);

      const getRes1 = await getAvailability(fakeRequest({ cookie: tokenA }));
      const getBody1 = await readJson(getRes1);
      check('25. GET (after save) -> configured:true', getBody1.configured === true);
      check('25. GET (after save) reflects the saved periods', getBody1.periods.length === 2);

      // 29. REPLACE semantics -- a second PUT with a different set replaces
      // the first entirely, never merges/appends.
      const res2 = await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 2, startTime: '08:00', endTime: '16:00' }] } }));
      const body2 = await readJson(res2);
      check('29. PUT REPLACES the prior period set (1 period now, not 3)', body2.periods.length === 1 && body2.periods[0].weekday === 2);
      const getRes2 = await getAvailability(fakeRequest({ cookie: tokenA }));
      const getBody2 = await readJson(getRes2);
      check('29b. GET confirms the replacement -- Monday/Wednesday periods are gone', getBody2.periods.length === 1 && getBody2.periods[0].weekday === 2);
    }

    // ============================================================
    // 26. GET configured with an empty weekday (some days have periods,
    // others deliberately don't).
    // ============================================================
    {
      await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }] } }));
      const body = await readJson(await getAvailability(fakeRequest({ cookie: tokenA })));
      check('26. a weekday with no saved period is simply absent from the periods array (not a zero-length placeholder entry)', !body.periods.some((p: any) => p.weekday === 0) && body.periods.some((p: any) => p.weekday === 1));
    }

    // ============================================================
    // 27/31. Entire week empty -- CONFIGURED_EMPTY, not a reset.
    // ============================================================
    {
      const res = await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [] } }));
      const body = await readJson(res);
      check('27/31. saving an empty periods array keeps configured=true (CONFIGURED_EMPTY), never treated as a reset', res.status === 200 && body.configured === true && body.periods.length === 0);
      const getBody = await readJson(await getAvailability(fakeRequest({ cookie: tokenA })));
      check('27b. GET after an empty-array save still reports configured:true', getBody.configured === true && getBody.periods.length === 0);
    }

    // ============================================================
    // 32/33. RESET clears periods and sets configured=false.
    // ============================================================
    {
      await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 4, startTime: '09:00', endTime: '17:00' }] } }));
      const res = await resetAvailability(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('33. DELETE (reset) -> 200, configured:false', res.status === 200 && body.configured === false);
      const getBody = await readJson(await getAvailability(fakeRequest({ cookie: tokenA })));
      check('32. reset clears every saved period', getBody.periods.length === 0);
      check('33b. GET after reset reports configured:false (genuinely UNCONFIGURED again)', getBody.configured === false);
    }

    // ============================================================
    // 34/35. Client-supplied userId/timezone are ignored -- the request
    // still lands under the AUTHENTICATED user with the AUTHENTICATED
    // user's own timezone.
    // ============================================================
    {
      const res = await saveAvailability(
        fakeRequest({ cookie: tokenA, jsonBody: { userId: userB.id, timezone: 'America/New_York', periods: [{ weekday: 5, startTime: '09:00', endTime: '17:00' }] } })
      );
      check('34/35. PUT with a spoofed userId/timezone in the body still succeeds (fields silently ignored)', res.status === 200);
      const bodyA = await readJson(await getAvailability(fakeRequest({ cookie: tokenA })));
      const bodyB = await readJson(await getAvailability(fakeRequest({ cookie: tokenB })));
      check('34. the write landed under the AUTHENTICATED user (A), not the body\'s spoofed userId (B)', bodyA.periods.some((p: any) => p.weekday === 5));
      check('34b. user B is completely unaffected by A\'s spoof attempt', !bodyB.periods.some((p: any) => p.weekday === 5));
      check('35. GET.timezone always reflects the real User.timezone, never a client-submitted value', bodyA.timezone === TZ);
    }

    // ============================================================
    // 36/37/38/39. Server-side validation.
    // ============================================================
    {
      const res = await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 9, startTime: '09:00', endTime: '17:00' }] } }));
      check('36. an out-of-range weekday is rejected with 400', res.status === 400);
    }
    {
      const res = await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 1, startTime: '9:00', endTime: '17:00' }] } }));
      check('37. an invalid (non-zero-padded) time is rejected with 400', res.status === 400);
    }
    {
      const res = await saveAvailability(fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 1, startTime: '20:00', endTime: '01:00' }] } }));
      check('38. a cross-midnight period is rejected with 400', res.status === 400);
    }
    {
      const res = await saveAvailability(
        fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 1, startTime: '11:00', endTime: '14:00' }] } })
      );
      check('39. two overlapping periods on the same weekday are rejected with 400', res.status === 400);
    }
    {
      // Touching periods are accepted server-side too (same policy as the client, this ticket's own section 17).
      const res = await saveAvailability(
        fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }, { weekday: 1, startTime: '12:00', endTime: '14:00' }] } })
      );
      check('39b. touching periods on the same weekday are ACCEPTED, matching the chosen touching-period policy', res.status === 200);
    }

    // ============================================================
    // 40. Deterministic GET response order, independent of insertion order.
    // ============================================================
    {
      await saveAvailability(
        fakeRequest({ cookie: tokenA, jsonBody: { periods: [{ weekday: 5, startTime: '09:00', endTime: '17:00' }, { weekday: 1, startTime: '14:00', endTime: '18:00' }, { weekday: 1, startTime: '09:00', endTime: '12:00' }] } })
      );
      const body = await readJson(await getAvailability(fakeRequest({ cookie: tokenA })));
      const order = body.periods.map((p: any) => `${p.weekday}:${p.startTime}`);
      check('40. GET returns periods sorted by weekday then startTime, regardless of submission order', JSON.stringify(order) === JSON.stringify(['1:09:00', '1:14:00', '5:09:00']));
    }

    // ============================================================
    // GET response never leaks unnecessary DB metadata (mirrors
    // activityPreferencesApi.test.ts's own check 42).
    // ============================================================
    {
      const body = await readJson(await getAvailability(fakeRequest({ cookie: tokenA })));
      check('GET periods expose only weekday/startTime/endTime, no DB id/userId/timestamps', body.periods.every((p: any) => Object.keys(p).sort().join(',') === 'endTime,startTime,weekday'));
    }
  } finally {
    await resetAvailability(fakeRequest({ cookie: tokenA })).catch(() => undefined);
    await resetAvailability(fakeRequest({ cookie: tokenB })).catch(() => undefined);
  }

  if (!allPassed) {
    console.error('\nSome Availability Preferences API checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL AVAILABILITY PREFERENCES API CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
