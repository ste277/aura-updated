/**
 * Quick Capture V1 PR A -- API route tests against a live database. Same
 * duck-typed fake-NextRequest pattern as availabilityPreferencesApi.test.ts.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/capturesApi.test.ts
 */
import { upsertUserByEmail, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { GET as listCaptures, POST as postCapture } from '../apps/web/app/api/captures/route';
import { DELETE as deleteCapture } from '../apps/web/app/api/captures/[captureId]/route';
import { POST as completeCaptureRoute } from '../apps/web/app/api/captures/[captureId]/complete/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakeRequest(opts: { cookie?: string; jsonBody?: unknown; malformed?: boolean } = {}): any {
  return {
    cookies: { get: (name: string) => (opts.cookie !== undefined && name === 'as_session' ? { value: opts.cookie } : undefined) },
    json: async () => {
      if (opts.malformed) throw new SyntaxError('bad json');
      return opts.jsonBody;
    },
  };
}

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const client = await beginTransaction();
  try {
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows;
  } finally {
    client.release();
  }
}

async function main() {
  const TZ = 'Asia/Kolkata';
  const userA = await upsertUserByEmail({ email: 'test-capture-api-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-capture-api-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const tokenA = createSessionToken(userA.id, userA.email);
  const tokenB = createSessionToken(userB.id, userB.email);
  const post = (cookie: string | undefined, jsonBody: unknown, malformed = false) => postCapture(fakeRequest({ cookie, jsonBody, malformed }));

  try {
    await sql(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[userA.id, userB.id]]);

    // authentication on every route
    check('GET without a session -> 401', (await listCaptures(fakeRequest())).status === 401);
    check('POST without a session -> 401', (await post(undefined, { title: 'x' })).status === 401);
    check('complete without a session -> 401', (await completeCaptureRoute(fakeRequest(), { params: { captureId: 'x' } })).status === 401);
    check('DELETE without a session -> 401', (await deleteCapture(fakeRequest(), { params: { captureId: 'x' } })).status === 401);
    check('a forged/invalid session token -> 401', (await listCaptures(fakeRequest({ cookie: 'not-a-token' }))).status === 401);

    // POST validation
    check('malformed JSON body -> 400', (await post(tokenA, undefined, true)).status === 400);
    check('non-object body -> 400', (await post(tokenA, ['x'])).status === 400 && (await post(tokenA, 'x')).status === 400);
    check('missing title -> 400', (await post(tokenA, {})).status === 400);
    check('empty title -> 400', (await post(tokenA, { title: '' })).status === 400);
    check('whitespace-only title -> 400', (await post(tokenA, { title: '   ' })).status === 400);
    check('too-long title -> 400', (await post(tokenA, { title: 'x'.repeat(201) })).status === 400);
    check('non-string title -> 400', (await post(tokenA, { title: 7 })).status === 400 && (await post(tokenA, { title: { a: 1 } })).status === 400);
    check('nothing was persisted by the rejected requests', Number((await sql(`SELECT count(*)::int AS n FROM "Capture" WHERE "userId" = $1`, [userA.id]))[0].n) === 0);

    // POST success + contract
    const okRes = await post(tokenA, { title: '  Call John ', plannedActivityId: 'attacker-supplied', status: 'DISMISSED', completedAt: '2020-01-01', activityId: 'WORKOUT', userId: userB.id });
    const created = await okRes.json();
    check('POST valid -> 200', okRes.status === 200);
    check('response contract is exactly { id, title, derivedState, createdAt }', Object.keys(created).sort().join(',') === 'createdAt,derivedState,id,title');
    check('created capture is trimmed and OPEN', created.title === 'Call John' && created.derivedState === 'OPEN');
    const stored = (await sql(`SELECT * FROM "Capture" WHERE id = $1`, [created.id]))[0];
    check('user-supplied plannedActivityId/status/completedAt/userId/activityId are ignored', stored.plannedActivityId === null && stored.status === 'OPEN' && stored.completedAt === null && stored.userId === userA.id);
    const dup = await (await post(tokenA, { title: 'Call John' })).json();
    check('duplicate titles create distinct captures', dup.id !== created.id);
    const nl = await (await post(tokenA, { title: 'Book dentist appointment tomorrow' })).json();
    check('natural-language titles are not parsed', nl.title === 'Book dentist appointment tomorrow');

    // GET scoping and active filter
    const listedA = await (await listCaptures(fakeRequest({ cookie: tokenA }))).json();
    check('GET lists the caller\'s open captures with the safe contract', listedA.length === 3 && listedA.every((c: any) => Object.keys(c).sort().join(',') === 'createdAt,derivedState,id,title'));
    const listedB = await (await listCaptures(fakeRequest({ cookie: tokenB }))).json();
    check('GET is scoped per user', listedB.length === 0);

    // complete
    const idA = created.id;
    const done = await completeCaptureRoute(fakeRequest({ cookie: tokenA }), { params: { captureId: idA } });
    check('complete -> 200 with derivedState COMPLETED', done.status === 200 && (await done.json()).derivedState === 'COMPLETED');
    check('completing again is idempotent 200', (await completeCaptureRoute(fakeRequest({ cookie: tokenA }), { params: { captureId: idA } })).status === 200);
    const afterComplete = await (await listCaptures(fakeRequest({ cookie: tokenA }))).json();
    check('a completed capture leaves the active list', !afterComplete.some((c: any) => c.id === idA) && afterComplete.length === 2);

    // cross-user + unknown
    check('user B completing user A capture -> 404', (await completeCaptureRoute(fakeRequest({ cookie: tokenB }), { params: { captureId: dup.id } })).status === 404);
    check('user B removing user A capture -> 404', (await deleteCapture(fakeRequest({ cookie: tokenB }), { params: { captureId: dup.id } })).status === 404);
    check('unknown id -> 404 (complete and delete)', (await completeCaptureRoute(fakeRequest({ cookie: tokenA }), { params: { captureId: 'nope' } })).status === 404 && (await deleteCapture(fakeRequest({ cookie: tokenA }), { params: { captureId: 'nope' } })).status === 404);
    check('user A capture untouched by the cross-user attempts', (await sql(`SELECT status, "completedAt" FROM "Capture" WHERE id = $1`, [dup.id]))[0].completedAt === null);

    // delete semantics
    const rm = await deleteCapture(fakeRequest({ cookie: tokenA }), { params: { captureId: dup.id } });
    check('DELETE never-used capture -> 200 removed: DELETED', rm.status === 200 && (await rm.json()).removed === 'DELETED');
    const rmDone = await deleteCapture(fakeRequest({ cookie: tokenA }), { params: { captureId: idA } });
    check('DELETE completed capture -> 200 removed: DISMISSED (history kept)', rmDone.status === 200 && (await rmDone.json()).removed === 'DISMISSED');
    check('completing a dismissed capture -> 409', (await completeCaptureRoute(fakeRequest({ cookie: tokenA }), { params: { captureId: idA } })).status === 409);
  } finally {
    await sql(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[userA.id, userB.id]]).catch(() => {});
  }

  if (!allPassed) {
    console.error('SOME CAPTURE API CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CAPTURE API CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
