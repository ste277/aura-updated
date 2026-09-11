/**
 * Explicit Duration Preferences API V1: live-database regression suite that
 * exercises the actual route handlers directly (GET/PUT/DELETE), the same
 * way every other *Db.test.ts file in this repo exercises service
 * functions directly -- no HTTP server, no Jest/Vitest (none is installed
 * in this repo), no `next/server` import in THIS file.
 *
 * WHY NO `next/server` IMPORT HERE: this file lives under repo-root
 * `test/`, which has no module-resolution path to `next` (only
 * `apps/web/node_modules` has it -- there is no npm workspace hoisting in
 * this repo). The route files themselves (under `apps/web/app/api/**`)
 * import `next/server` just fine, because *their own* directory resolves
 * to `apps/web/node_modules`. So this file never imports `NextRequest`/
 * `NextResponse` itself -- it duck-types a minimal fake request object
 * (`fakeRequest`, below) satisfying only what the route handlers actually
 * call (`req.cookies.get(name)?.value`, `req.json()`), and reads the real
 * `NextResponse` the handlers return via its own `.status`/`.json()`
 * methods (already available on the returned instance -- no import
 * needed). This is a deliberate, minimal, first-of-its-kind pattern in
 * this repo (no prior route-handler-level test exists to follow), used
 * because the API surface itself has real per-route behavior (auth check,
 * body parsing, status-code selection) that the already-passing
 * service-layer tests (test/activityPreferences.test.ts,
 * test/activityPreferencesDb.test.ts) cannot exercise.
 *
 * Requires a real, reachable DATABASE_URL, same convention as every other
 * *Db.test.ts file:
 *
 *   DATABASE_URL="postgresql://..." npx tsx test/activityPreferencesApi.test.ts
 */
import { upsertUserByEmail, listUserActivityPreferenceRows, upsertUserActivityPreference, deleteUserActivityPreference } from '../apps/web/lib/db';
import { clearPreferredActivityDuration } from '../apps/web/lib/activityPreferences';
import { createSessionToken } from '../apps/web/lib/auth';
import { GET as listPreferences } from '../apps/web/app/api/activity-preferences/route';
import { PUT as setPreference, DELETE as clearPreference } from '../apps/web/app/api/activity-preferences/[activityId]/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

interface FakeRequestOptions {
  cookie?: string;
  malformed?: boolean;
  jsonBody?: unknown;
  noBody?: boolean;
}

/** Duck-typed stand-in for NextRequest -- see this file's own header
 * comment for why a real NextRequest is never imported here. Satisfies
 * exactly the two members the route handlers actually call. */
function fakeRequest(opts: FakeRequestOptions = {}): any {
  return {
    cookies: {
      get: (name: string) => (opts.cookie !== undefined && name === 'as_session' ? { value: opts.cookie } : undefined),
    },
    json: async () => {
      if (opts.malformed) throw new SyntaxError('Unexpected token in JSON');
      if (opts.noBody) throw new SyntaxError('Unexpected end of JSON input');
      return opts.jsonBody;
    },
  };
}

async function readJson(res: { json: () => Promise<any> }): Promise<any> {
  return res.json();
}

const TZ = 'Asia/Kolkata';

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-activity-preferences-api-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-activity-preferences-api-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);

  try {
    // Clean slate for both test users.
    for (const activityId of ['workout', 'deep-work', 'coffee-tea']) {
      await clearPreferredActivityDuration({ userId: userA.id, activityId });
      await clearPreferredActivityDuration({ userId: userB.id, activityId });
    }

    // ============================================================
    // 27. UNAUTHENTICATED
    // ============================================================
    {
      const getRes = await listPreferences(fakeRequest({}));
      check('27. GET without session -> 401', getRes.status === 401);
      check('27. GET without session -> error body', (await readJson(getRes)).error === 'Not authenticated.');

      const putRes = await setPreference(fakeRequest({ jsonBody: { preferredDurationMinutes: 45 } }), { params: { activityId: 'workout' } });
      check('27. PUT without session -> 401', putRes.status === 401);

      const delRes = await clearPreference(fakeRequest({}), { params: { activityId: 'workout' } });
      check('27. DELETE without session -> 401', delRes.status === 401);
    }

    // ============================================================
    // 28. GET EMPTY
    // ============================================================
    {
      const res = await listPreferences(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('28. GET (no preferences yet) -> 200', res.status === 200);
      check('28. GET (no preferences yet) -> []', Array.isArray(body) && body.length === 0);
    }

    // ============================================================
    // 31/32. SET + UPDATE
    // ============================================================
    {
      const res1 = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 45 } }), { params: { activityId: 'workout' } });
      const body1 = await readJson(res1);
      check('31. PUT workout=45 -> 200', res1.status === 200);
      check('31. PUT workout=45 -> saved app contract', body1.activityId === 'workout' && body1.preferredDurationMinutes === 45);

      const res2 = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 30 } }), { params: { activityId: 'workout' } });
      const res3 = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 45 } }), { params: { activityId: 'workout' } });
      check('32. PUT workout 30 then 45 both succeed', res2.status === 200 && res3.status === 200);

      const rawRows = (await listUserActivityPreferenceRows(userA.id)).filter((r) => r.activityId === 'workout');
      check('32. exactly one row survives, value = 45 (no duplicate)', rawRows.length === 1 && rawRows[0].preferredDurationMinutes === 45);
    }

    // ============================================================
    // 29. GET POPULATED
    // ============================================================
    {
      await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 30 } }), { params: { activityId: 'coffee-tea' } });
      const res = await listPreferences(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('29. GET returns both app-contract rows', body.some((p: any) => p.activityId === 'workout' && p.preferredDurationMinutes === 45) && body.some((p: any) => p.activityId === 'coffee-tea' && p.preferredDurationMinutes === 30));
      check('42. GET response leaks no DB metadata (id/userId/createdAt/updatedAt)', body.every((p: any) => Object.keys(p).sort().join(',') === 'activityId,preferredDurationMinutes'));
    }

    // ============================================================
    // 41. SORTING
    // ============================================================
    {
      const res = await listPreferences(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      const ids = body.map((p: any) => p.activityId);
      const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      check('41. GET preserves service ordering (activityId ascending)', JSON.stringify(ids) === JSON.stringify(sorted));
    }

    // ============================================================
    // 30. USER ISOLATION
    // ============================================================
    {
      await setPreference(fakeRequest({ cookie: tokenB, jsonBody: { preferredDurationMinutes: 60 } }), { params: { activityId: 'workout' } });
      const resA = await listPreferences(fakeRequest({ cookie: tokenA }));
      const resB = await listPreferences(fakeRequest({ cookie: tokenB }));
      const bodyA = await readJson(resA);
      const bodyB = await readJson(resB);
      check('30. GET as A returns only A\'s workout=45', bodyA.find((p: any) => p.activityId === 'workout')?.preferredDurationMinutes === 45);
      check('30. GET as B returns only B\'s workout=60', bodyB.find((p: any) => p.activityId === 'workout')?.preferredDurationMinutes === 60);
    }

    // ============================================================
    // 39. USER ID SPOOF
    // ============================================================
    {
      const res = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { userId: userB.id, preferredDurationMinutes: 90 } }), { params: { activityId: 'deep-work' } });
      check('39. PUT with a spoofed userId in body still succeeds (field silently ignored)', res.status === 200);
      const bodyA = await readJson(await listPreferences(fakeRequest({ cookie: tokenA })));
      const bodyB = await readJson(await listPreferences(fakeRequest({ cookie: tokenB })));
      check('39. spoofed write landed under the AUTHENTICATED user (A), not the body\'s userId (B)', bodyA.find((p: any) => p.activityId === 'deep-work')?.preferredDurationMinutes === 90);
      check('39. user B is completely unaffected by A\'s spoof attempt', !bodyB.some((p: any) => p.activityId === 'deep-work'));
    }

    // ============================================================
    // 35 (isolation). DELETE USER ISOLATION -- A's delete of an activityId
    // that ALSO has a row for B must never touch B's row. Uses a dedicated
    // activityId ('learning', a real catalog id untouched anywhere else in
    // this file) rather than 'workout', so this block does not disturb
    // 'workout's value relied on by later assertions.
    // ============================================================
    {
      await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 20 } }), { params: { activityId: 'learning' } });
      await setPreference(fakeRequest({ cookie: tokenB, jsonBody: { preferredDurationMinutes: 40 } }), { params: { activityId: 'learning' } });

      const res = await clearPreference(fakeRequest({ cookie: tokenA }), { params: { activityId: 'learning' } });
      const body = await readJson(res);
      check('DELETE isolation: A clearing learning -> 200 { cleared: true }', res.status === 200 && body.cleared === true);

      const afterA = (await listUserActivityPreferenceRows(userA.id)).find((r) => r.activityId === 'learning');
      const afterB = (await listUserActivityPreferenceRows(userB.id)).find((r) => r.activityId === 'learning');
      check('DELETE isolation: A\'s learning row is gone', afterA === undefined);
      check('DELETE isolation: B\'s learning row (40) is completely untouched by A\'s delete', afterB?.preferredDurationMinutes === 40);

      await clearPreferredActivityDuration({ userId: userB.id, activityId: 'learning' });
    }

    // ============================================================
    // 33/34. CLEAR + CLEAR MISSING
    // ============================================================
    {
      const res = await clearPreference(fakeRequest({ cookie: tokenA }), { params: { activityId: 'coffee-tea' } });
      const body = await readJson(res);
      check('33. DELETE existing preference -> 200 { cleared: true }', res.status === 200 && body.cleared === true);
      const rows = (await listUserActivityPreferenceRows(userA.id)).filter((r) => r.activityId === 'coffee-tea');
      check('33. DB row is actually gone', rows.length === 0);

      const res2 = await clearPreference(fakeRequest({ cookie: tokenA }), { params: { activityId: 'coffee-tea' } });
      const body2 = await readJson(res2);
      check('34. DELETE already-missing preference -> 200 { cleared: true }, no error', res2.status === 200 && body2.cleared === true);
    }

    // ============================================================
    // 35. INVALID DURATION
    // ============================================================
    {
      const invalidValues: unknown[] = [14, 361, 45.5, '45', null, true, {}, []];
      for (const value of invalidValues) {
        const res = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: value } }), { params: { activityId: 'workout' } });
        check(`35. PUT preferredDurationMinutes=${JSON.stringify(value)} -> 400`, res.status === 400);
      }
      // Confirm none of the rejected attempts altered the stored value.
      const rows = (await listUserActivityPreferenceRows(userA.id)).filter((r) => r.activityId === 'workout');
      check('35. rejected writes never partially apply -- workout still reads back 45', rows[0]?.preferredDurationMinutes === 45);
    }

    // ============================================================
    // 36. MALFORMED JSON
    // ============================================================
    {
      const res = await setPreference(fakeRequest({ cookie: tokenA, malformed: true }), { params: { activityId: 'workout' } });
      check('36. PUT malformed JSON -> 400 (never 500)', res.status === 400);
    }

    // ============================================================
    // 37. UNKNOWN ACTIVITY
    // ============================================================
    {
      const putRes = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 45 } }), { params: { activityId: 'not-a-real-activity-xyz' } });
      check('37. PUT unknown activityId -> 400', putRes.status === 400);
      const delRes = await clearPreference(fakeRequest({ cookie: tokenA }), { params: { activityId: 'not-a-real-activity-xyz' } });
      check('37. DELETE unknown activityId -> 400', delRes.status === 400);
      const rows = await listUserActivityPreferenceRows(userA.id);
      check('37. no DB mutation occurred for the unknown activityId', !rows.some((r) => r.activityId === 'not-a-real-activity-xyz'));
    }

    // ============================================================
    // 38. ARBITRARY VALID VALUE
    // ============================================================
    {
      const res = await setPreference(fakeRequest({ cookie: tokenA, jsonBody: { preferredDurationMinutes: 50 } }), { params: { activityId: 'deep-work' } });
      const body = await readJson(res);
      check('38. PUT an arbitrary valid duration (50, not in suggestedDurations) -> 200, stored', res.status === 200 && body.preferredDurationMinutes === 50);
    }

    // ============================================================
    // 40. RETIRED STORED ROW
    // ============================================================
    {
      const retiredRow = await upsertUserActivityPreference(userA.id, 'retired-activity-that-no-longer-exists', 99);
      const res = await listPreferences(fakeRequest({ cookie: tokenA }));
      const body = await readJson(res);
      check('40. GET omits a stored row whose activityId no longer resolves', !body.some((p: any) => p.activityId === 'retired-activity-that-no-longer-exists'));
      const rawRows = await listUserActivityPreferenceRows(userA.id);
      check('40. the retired row itself still exists in the DB after the GET', rawRows.some((r) => r.id === retiredRow.id));
      await deleteUserActivityPreference(userA.id, 'retired-activity-that-no-longer-exists');
    }
  } finally {
    for (const activityId of ['workout', 'deep-work', 'coffee-tea', 'learning']) {
      await clearPreferredActivityDuration({ userId: userA.id, activityId }).catch(() => undefined);
      await clearPreferredActivityDuration({ userId: userB.id, activityId }).catch(() => undefined);
    }
    await deleteUserActivityPreference(userA.id, 'retired-activity-that-no-longer-exists').catch(() => undefined);
  }

  if (!allPassed) {
    console.error('\nSome Explicit Duration Preferences API checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL EXPLICIT DURATION PREFERENCES API CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
