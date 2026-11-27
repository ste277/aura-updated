/**
 * Good Right Now / Log Activity Failure State Correctness V1 -- live-
 * database round-trip test, requires a real, reachable DATABASE_URL. Run
 * locally with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/habitLogIdempotencyDb.test.ts
 *
 * Proves the migration-0032 clientRequestId dedup guarantee actually
 * holds through real INSERTs, not just in a mocked unit test: the SAME
 * (userId, clientRequestId) pair never produces two rows -- covering both
 * createHabitLog's own pre-check-then-insert path AND its race-safe
 * catch(23505) fallback (simulated here via two genuinely concurrent
 * createHabitLog calls with the same id, matching what a real
 * fetch-retry-before-original-response-lands race looks like) -- while
 * two DIFFERENT request ids for the same user create two independent
 * rows, and the SAME request id for two DIFFERENT users never collides
 * (scoped per-user, matching the partial index's own column list).
 * Matches this repo's established live-DB test pattern (see
 * test/habitLogActivityIdentityDb.test.ts). No delete function exists for
 * HabitLog anywhere in this codebase, so this does not attempt cleanup;
 * repeated runs accumulate a few extra rows for the test users rather
 * than staying flat, an accepted, low-cost tradeoff.
 */
import { createHabitLog, getHabitLogByClientRequestId, listHabitLogs, listHabitLogsForInsights, upsertUserByEmail } from '../apps/web/lib/db';
import { bindServerRow } from '../apps/web/lib/habitLogSyncPolicy';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-habit-log-idempotency-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const otherUser = await upsertUserByEmail({ email: 'test-habit-log-idempotency-other@example.com', cityName: 'Mumbai', latitude: 19.076, longitude: 72.8777, timezone: 'Asia/Kolkata' });

  // ============================================================
  // Same clientRequestId, submitted twice sequentially (the ordinary
  // "client retried after losing the response" case) -- second call must
  // return the SAME row, not create a second one.
  // ============================================================
  const requestId = `test-idempotency-${Date.now()}`;
  const first = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Hydration check',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 600,
    durationMinutes: 5,
    logSource: 'MANUAL',
    activitySignificance: 'LOW',
    clientRequestId: requestId,
  });
  const second = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Hydration check',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 600,
    durationMinutes: 5,
    logSource: 'MANUAL',
    activitySignificance: 'LOW',
    clientRequestId: requestId,
  });
  check('A sequential retry with the SAME clientRequestId returns the SAME row id', first.id === second.id);

  const logsAfterRetry = await listHabitLogs(owner.id);
  const matchingRows = logsAfterRetry.filter((l) => l.clientRequestId === requestId);
  check('Exactly one HabitLog row exists for this clientRequestId after the retry (no duplicate)', matchingRows.length === 1);

  // ============================================================
  // Genuine concurrent race: two INSERTs with the same clientRequestId
  // fired at the same time (neither has committed when the other starts) --
  // this is what actually exercises createHabitLog's catch(23505) fallback
  // rather than its pre-check.
  // ============================================================
  const raceRequestId = `test-idempotency-race-${Date.now()}`;
  const raceInput = {
    userId: owner.id,
    activityTitle: 'Short walk',
    activeWindow: 'NEUTRAL' as const,
    logMinuteOfDay: 650,
    durationMinutes: 10,
    logSource: 'MANUAL' as const,
    activitySignificance: 'LOW' as const,
    clientRequestId: raceRequestId,
  };
  const [raceA, raceB] = await Promise.all([createHabitLog(raceInput), createHabitLog(raceInput)]);
  check('A genuine concurrent race with the SAME clientRequestId still resolves to the SAME row id', raceA.id === raceB.id);
  const logsAfterRace = await listHabitLogs(owner.id);
  const raceRows = logsAfterRace.filter((l) => l.clientRequestId === raceRequestId);
  check('Exactly one HabitLog row exists after the concurrent race (unique index + catch(23505) fallback both held)', raceRows.length === 1);

  // ============================================================
  // Different clientRequestIds for the same user -- independent rows.
  // ============================================================
  const distinctA = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Deep work',
    activeWindow: 'BRAHMA',
    logMinuteOfDay: 300,
    durationMinutes: 60,
    logSource: 'AURA_DO_NOW',
    activitySignificance: 'HIGH',
    clientRequestId: `test-idempotency-distinct-a-${Date.now()}`,
  });
  const distinctB = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Deep work',
    activeWindow: 'BRAHMA',
    logMinuteOfDay: 300,
    durationMinutes: 60,
    logSource: 'AURA_DO_NOW',
    activitySignificance: 'HIGH',
    clientRequestId: `test-idempotency-distinct-b-${Date.now()}`,
  });
  check('Two different clientRequestIds for the same user create two independent rows', distinctA.id !== distinctB.id);

  // ============================================================
  // User-scoped: the SAME clientRequestId string for a DIFFERENT user must
  // never resolve to the first user's row.
  // ============================================================
  const sharedRequestId = `test-idempotency-shared-${Date.now()}`;
  const ownerLog = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Coffee',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 500,
    durationMinutes: 10,
    logSource: 'MANUAL',
    activitySignificance: 'LOW',
    clientRequestId: sharedRequestId,
  });
  const otherLog = await createHabitLog({
    userId: otherUser.id,
    activityTitle: 'Coffee',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 500,
    durationMinutes: 10,
    logSource: 'MANUAL',
    activitySignificance: 'LOW',
    clientRequestId: sharedRequestId,
  });
  check('The same clientRequestId string for two different users creates two independent rows', ownerLog.id !== otherLog.id);
  check("Looking up the shared id scoped to the OTHER user's own id returns their own row, not the first user's", (await getHabitLogByClientRequestId(otherUser.id, sharedRequestId))?.id === otherLog.id);
  check("Looking up the shared id scoped to the owner's own id returns the owner's row, not the other user's", (await getHabitLogByClientRequestId(owner.id, sharedRequestId))?.id === ownerLog.id);

  // ============================================================
  // Legacy/backward compatibility: omitting clientRequestId entirely still
  // works exactly as before -- every existing caller that doesn't send one
  // keeps creating a fresh row every time, non-idempotent, unchanged.
  // ============================================================
  const legacyA = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Family time',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 720,
    durationMinutes: 30,
    logSource: 'MANUAL',
    activitySignificance: 'MEDIUM',
    // clientRequestId intentionally omitted
  });
  const legacyB = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Family time',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 720,
    durationMinutes: 30,
    logSource: 'MANUAL',
    activitySignificance: 'MEDIUM',
  });
  check('Two calls with clientRequestId omitted both persist (null does not dedupe against itself)', legacyA.id !== legacyB.id);
  check('clientRequestId reads back null for a legacy/non-idempotent call', legacyA.clientRequestId === null);

  // ============================================================
  // AURA-ANDROID-REL-04 R15 (39256) -- the client's shared row-binding rule against REAL persisted rows (the JSON
  // the route returns is the RETURNING * row): it binds the exact operation, and refuses a row for the same request
  // id whose persisted intent differs -- the server returns the EXISTING row for a reused id without comparing
  // fields, so only the client's intent comparison can tell them apart.
  // ============================================================
  const asJson = (r: unknown) => JSON.parse(JSON.stringify(r));
  const r15Id = `test-r15-binding-${Date.now()}`;
  const ts = new Date('2026-11-24T06:00:00.000Z');
  const dispatched = { activityTitle: 'Workout', logTimestamp: ts.toISOString(), durationMinutes: 30, logSource: 'AURA_DO_NOW', activitySignificance: 'MEDIUM', activeWindow: 'NEUTRAL', logMinuteOfDay: 690, clientRequestId: r15Id };
  const persisted = await createHabitLog({ userId: owner.id, activityTitle: 'Workout', activeWindow: 'AMRIT', logMinuteOfDay: 690, logTimestamp: ts, durationMinutes: 30, logSource: 'AURA_DO_NOW', activitySignificance: 'MEDIUM', clientRequestId: r15Id });
  const bound = bindServerRow(asJson(persisted), { account: owner.id, clientRequestId: r15Id, body: dispatched });
  check('R15 the real persisted row (as JSON) binds to its exact operation (account + request id + persisted intent; server-derived activeWindow excluded)', bound.ok && bound.ok === true && bound.row.id === persisted.id);
  const reused = await createHabitLog({ userId: owner.id, activityTitle: 'A different activity', activeWindow: 'NEUTRAL', logMinuteOfDay: 700, logTimestamp: new Date(ts.getTime() + 600_000), durationMinutes: 45, logSource: 'MANUAL', activitySignificance: 'HIGH', clientRequestId: r15Id });
  const reusedBinding = bindServerRow(asJson(reused), { account: owner.id, clientRequestId: r15Id, body: { ...dispatched, activityTitle: 'A different activity', durationMinutes: 45, logSource: 'MANUAL', activitySignificance: 'HIGH', logTimestamp: new Date(ts.getTime() + 600_000).toISOString() } });
  check('R15 a reused request id with a DIFFERENT payload gets the EXISTING row back (one row), and the client refuses it as evidence (reason intent)', reused.id === persisted.id && !reusedBinding.ok && (reusedBinding as { reason: string }).reason === 'intent' && (await listHabitLogs(owner.id)).filter((r) => r.clientRequestId === r15Id).length === 1);
  const twinA = await createHabitLog({ userId: owner.id, activityTitle: 'Workout', activeWindow: 'NEUTRAL', logMinuteOfDay: 690, logTimestamp: ts, durationMinutes: 30, logSource: 'AURA_DO_NOW', activitySignificance: 'MEDIUM', clientRequestId: `${r15Id}-twin-a` });
  const twinB = await createHabitLog({ userId: owner.id, activityTitle: 'Workout', activeWindow: 'NEUTRAL', logMinuteOfDay: 690, logTimestamp: ts, durationMinutes: 30, logSource: 'AURA_DO_NOW', activitySignificance: 'MEDIUM', clientRequestId: `${r15Id}-twin-b` });
  check('R15 two separate operations with IDENTICAL payloads and different ids persist two rows (never deduplicated by payload)', twinA.id !== twinB.id);
  const listed = (await listHabitLogsForInsights(owner.id, new Date(ts.getTime() - 86_400_000))).map(asJson);
  const fromList = listed.filter((r: any) => r.clientRequestId === r15Id).map((r: any) => bindServerRow(r, { account: owner.id, clientRequestId: r15Id, body: dispatched }));
  const otherAccount = bindServerRow(asJson(otherLog), { account: owner.id, clientRequestId: sharedRequestId, body: { ...dispatched, clientRequestId: sharedRequestId } });
  check('R15 GET evidence uses the SAME binding: the collection row binds; another account\'s row with the same request id never does (reason account)', fromList.length === 1 && fromList[0].ok && !otherAccount.ok && (otherAccount as { reason: string }).reason === 'account');

  console.log(allPassed ? '\nALL HABITLOG IDEMPOTENCY DB CHECKS PASSED' : '\nSOME HABITLOG IDEMPOTENCY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
