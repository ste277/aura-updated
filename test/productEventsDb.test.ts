/**
 * Live-database test for Product Instrumentation V1. Requires a real,
 * reachable DATABASE_URL -- NOT part of ci.yml's math-core-tests job, which
 * has no Postgres service provisioned. Run locally with a real
 * DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/productEventsDb.test.ts
 *
 * Creates one throwaway test user (idempotent via email upsert, left in
 * place afterward -- matches test/auraUpdatesDb.test.ts's own convention)
 * and one throwaway AuraMoment (revoked, never deleted, in the `finally`
 * block). ProductEvent rows themselves are NOT cleaned up: they're inert
 * analytics rows with no effect on any other test's behavior, so leaving
 * them is simpler than adding a delete path to production code solely for
 * test teardown. Every metric assertion scopes its `since` window to
 * `testStartedAt` (captured before this test creates anything) so
 * pre-existing rows from earlier runs or real app usage never affect the
 * counts checked here.
 */
import {
  countDistinctMomentsForAnyEventSince,
  countDistinctMomentsForEventSince,
  countDistinctUsersForEventSince,
  createAuraMoment,
  createProductEvent,
  listProductEventCountsSince,
  listProductEventDurationsSince,
  markAuraMomentFirstOpened,
  revokeAuraMoment,
  upsertUserByEmail,
} from '../apps/web/lib/db';
import { generatePublicMomentToken } from '../apps/web/lib/auraMoments';
import { recordProductEvent } from '../apps/web/lib/productEvents';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const testStartedAt = new Date();
  const owner = await upsertUserByEmail({ email: 'test-product-events-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  let momentToken = '';
  try {
    // ============================================================
    // createProductEvent -- raw write round-trips metadata as an object
    // ============================================================
    const raw = await createProductEvent({
      eventName: 'AURA_HOME_VIEWED',
      userId: owner.id,
      metadata: { foo: 'bar' },
    });
    check('createProductEvent returns a row with an id', typeof raw.id === 'string' && raw.id.length > 0);
    check('createProductEvent round-trips metadata as a JS object (JSONB auto-parsed), not a JSON string', typeof raw.metadata === 'object' && raw.metadata.foo === 'bar');

    // ============================================================
    // recordProductEvent -- validated write path
    // ============================================================
    const beforeValid = await listProductEventCountsSince(testStartedAt, 'scope');
    const validResult = await recordProductEvent({
      eventName: 'MUHURTHAM_SCOPE_SELECTED',
      userId: owner.id,
      metadata: { scope: 'SHARED' },
    });
    check('recordProductEvent accepts a valid known event', validResult.ok === true);
    const afterValid = await listProductEventCountsSince(testStartedAt, 'scope');
    const scopeSelectedCount = (rows: typeof afterValid) => rows.filter((r) => r.eventName === 'MUHURTHAM_SCOPE_SELECTED').reduce((s, r) => s + r.count, 0);
    check('A valid recordProductEvent call actually persists a row', scopeSelectedCount(afterValid) === scopeSelectedCount(beforeValid) + 1);

    const beforeInvalid = await listProductEventCountsSince(testStartedAt, 'scope');
    const unknownEventResult = await recordProductEvent({ eventName: 'NOT_A_REAL_EVENT', userId: owner.id, metadata: {} });
    check('recordProductEvent rejects an unknown event name', unknownEventResult.ok === false);

    const forbiddenKeyResult = await recordProductEvent({
      eventName: 'MUHURTHAM_SCOPE_SELECTED',
      userId: owner.id,
      metadata: { scope: 'SHARED', email: 'leak@example.com' },
    });
    check('recordProductEvent rejects metadata containing a forbidden key (email)', forbiddenKeyResult.ok === false);
    const afterInvalid = await listProductEventCountsSince(testStartedAt, 'scope');
    check('Neither the unknown-event nor the forbidden-key attempt persisted anything', afterInvalid.reduce((s, r) => s + r.count, 0) === beforeInvalid.reduce((s, r) => s + r.count, 0));

    // ============================================================
    // markAuraMomentFirstOpened -- idempotent, first-open-only marker
    // ============================================================
    momentToken = generatePublicMomentToken();
    const moment = await createAuraMoment({
      ownerUserId: owner.id,
      publicToken: momentToken,
      scope: 'GENERAL',
      source: 'PLAN',
      activityId: 'start-journey',
      activityTitle: 'Start a Journey',
      activityIcon: '🧳',
      startAt: new Date('2026-10-18T04:42:00.000Z'),
      endAt: new Date('2026-10-18T06:04:00.000Z'),
      timezone: 'Asia/Kolkata',
      savedPersonId: null,
      sharedPersonDisplayName: null,
      senderDisplayName: 'Test Owner',
      ratingLabel: 'STRONG',
      explanationSnapshot: 'x',
      expiresAt: null,
    });
    check('A freshly created AuraMoment has no firstOpenedAt yet', moment.firstOpenedAt === null);

    const firstOpen = await markAuraMomentFirstOpened(momentToken);
    check('markAuraMomentFirstOpened returns the row on the true first open', firstOpen !== null && firstOpen.id === moment.id);

    const secondOpen = await markAuraMomentFirstOpened(momentToken);
    check('markAuraMomentFirstOpened returns null on a second call (refresh does not re-fire)', secondOpen === null);

    // ============================================================
    // Distinct-moment / distinct-user counting (the funnel's denominators)
    // ============================================================
    await recordProductEvent({ eventName: 'AURA_MOMENT_SHARE_INITIATED', userId: owner.id, auraMomentId: moment.id, metadata: { scope: 'GENERAL', method: 'copy_link' } });
    await recordProductEvent({ eventName: 'AURA_MOMENT_SHARE_INITIATED', userId: owner.id, auraMomentId: moment.id, metadata: { scope: 'GENERAL', method: 'copy_link' } });
    const shareInitiatedDistinct = await countDistinctMomentsForEventSince('AURA_MOMENT_SHARE_INITIATED', testStartedAt);
    check('countDistinctMomentsForEventSince dedupes repeated events on the SAME moment down to 1', shareInitiatedDistinct === 1);

    await recordProductEvent({ eventName: 'AURA_MOMENT_ANOTHER_TIME', auraMomentId: moment.id, metadata: { scope: 'GENERAL', preference: 'LATER' } });
    const respondedUnion = await countDistinctMomentsForAnyEventSince(['AURA_MOMENT_ACCEPTED', 'AURA_MOMENT_ANOTHER_TIME'], testStartedAt);
    check('countDistinctMomentsForAnyEventSince counts the union across two event names for one moment as 1', respondedUnion === 1);

    const scopeSelectedUsers = await countDistinctUsersForEventSince('MUHURTHAM_SCOPE_SELECTED', testStartedAt);
    check('countDistinctUsersForEventSince counts the one test user who fired MUHURTHAM_SCOPE_SELECTED', scopeSelectedUsers === 1);

    // ============================================================
    // Duration percentile input, grouped by a metadata key
    // ============================================================
    await recordProductEvent({ eventName: 'MUHURTHAM_SEARCH_COMPLETED', userId: owner.id, metadata: { scope: 'GENERAL', activityId: 'start-journey', resultCount: 3, durationMs: 120 } });
    await recordProductEvent({ eventName: 'MUHURTHAM_SEARCH_COMPLETED', userId: owner.id, metadata: { scope: 'SHARED', activityId: 'start-journey', resultCount: 1, durationMs: 340 } });
    const durationsByScope = await listProductEventDurationsSince('MUHURTHAM_SEARCH_COMPLETED', testStartedAt, 'scope');
    const generalGroup = durationsByScope.find((g) => g.group === 'GENERAL');
    const sharedGroup = durationsByScope.find((g) => g.group === 'SHARED');
    check('listProductEventDurationsSince groups durations by the requested metadata key (GENERAL)', generalGroup?.durationsMs.includes(120) === true);
    check('listProductEventDurationsSince groups durations by the requested metadata key (SHARED)', sharedGroup?.durationsMs.includes(340) === true);
  } finally {
    if (momentToken) await revokeAuraMoment(owner.id, momentToken).catch(() => {});
  }

  console.log(allPassed ? '\nALL PRODUCT EVENTS DB CHECKS PASSED' : '\nSOME PRODUCT EVENTS DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
