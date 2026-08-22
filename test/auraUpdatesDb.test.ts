/**
 * Live-database test for Aura Updates V1 (in-app owner attention state).
 * Requires a real, reachable DATABASE_URL -- NOT part of ci.yml's
 * math-core-tests job, which has no Postgres service provisioned. Run
 * locally with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/auraUpdatesDb.test.ts
 *
 * Creates one throwaway test user (idempotent via email upsert) and cleans
 * up every AuraMoment row it creates, but leaves the User row in place
 * (matches test/savedPersonDb.test.ts's own convention).
 */
import {
  createAuraMoment,
  listMomentIdsWithSuccessorForOwner,
  listRecentRespondedAuraMomentsForOwner,
  markAuraMomentResponseSeen,
  respondToAuraMoment,
  revokeAuraMoment,
  upsertUserByEmail,
} from '../apps/web/lib/db';
import { generatePublicMomentToken } from '../apps/web/lib/auraMoments';
import { summarizeAuraUpdates } from '../apps/web/lib/auraUpdates';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-aura-updates-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const ownerB = await upsertUserByEmail({ email: 'test-aura-updates-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  const createdTokens: string[] = [];
  let tokenOwnerB = '';
  const baseInput = {
    activityId: 'griha-pravesh',
    source: 'MUHURTHAM' as const,
    activityTitle: 'Griha Pravesh',
    activityIcon: '🏡',
    startAt: new Date('2026-10-18T04:42:00.000Z'),
    endAt: new Date('2026-10-18T06:04:00.000Z'),
    timezone: 'Asia/Kolkata',
  };

  try {
    // ============================================================
    // ACCEPTED creates an unseen owner update
    // ============================================================
    const tokenAccepted = generatePublicMomentToken();
    createdTokens.push(tokenAccepted);
    await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: tokenAccepted, scope: 'SHARED', savedPersonId: null, sharedPersonDisplayName: 'Anu', senderDisplayName: 'Stephen', ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'x', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await respondToAuraMoment(tokenAccepted, 'ACCEPTED');

    // ============================================================
    // ANOTHER_TIME creates an unseen, actionable owner update; preference preserved
    // ============================================================
    const tokenAnother = generatePublicMomentToken();
    createdTokens.push(tokenAnother);
    await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: tokenAnother, scope: 'SHARED', savedPersonId: null, sharedPersonDisplayName: 'Rahul', senderDisplayName: 'Stephen', ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'x', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await respondToAuraMoment(tokenAnother, 'ANOTHER_TIME', 'LATER');

    // ============================================================
    // CROSS-OWNER ISOLATION
    // ============================================================
    tokenOwnerB = generatePublicMomentToken();
    await createAuraMoment({ ...baseInput, ownerUserId: ownerB.id, publicToken: tokenOwnerB, scope: 'SHARED', savedPersonId: null, sharedPersonDisplayName: 'Other', senderDisplayName: 'SomeoneElse', ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'x', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    await respondToAuraMoment(tokenOwnerB, 'ACCEPTED');

    const ownerAMoments = await listRecentRespondedAuraMomentsForOwner(ownerA.id, 50);
    check('listRecentRespondedAuraMomentsForOwner returns both of ownerA\'s responded moments', ownerAMoments.filter((m) => createdTokens.includes(m.publicToken)).length === 2);
    check('listRecentRespondedAuraMomentsForOwner for ownerA never includes ownerB\'s moment', !ownerAMoments.some((m) => m.publicToken === tokenOwnerB));

    const ownerBMoments = await listRecentRespondedAuraMomentsForOwner(ownerB.id, 50);
    check('listRecentRespondedAuraMomentsForOwner for ownerB only returns ownerB\'s own moment', ownerBMoments.length === 1 && ownerBMoments[0].publicToken === tokenOwnerB);

    // ============================================================
    // SUMMARY: unread + actionable state before any "seen" mark
    // ============================================================
    const successorSetA = await listMomentIdsWithSuccessorForOwner(ownerA.id);
    const summaryBefore = summarizeAuraUpdates(ownerAMoments, successorSetA);
    check('Both of ownerA\'s updates are unread before any seen mark', summaryBefore.unreadCount === 2);
    const acceptedUpdate = summaryBefore.updates.find((u) => u.momentToken === tokenAccepted);
    const anotherUpdate = summaryBefore.updates.find((u) => u.momentToken === tokenAnother);
    check('The ACCEPTED update is present and does not require action', acceptedUpdate !== undefined && acceptedUpdate.requiresAction === false);
    check('The ANOTHER_TIME update is present, requires action, and preserves its preference', anotherUpdate !== undefined && anotherUpdate.requiresAction === true && anotherUpdate.preference === 'LATER');

    // ============================================================
    // MARK SEEN -- ownership enforced, unread flips to false
    // ============================================================
    let crossOwnerSeenNoOp = false;
    const crossOwnerSeenResult = await markAuraMomentResponseSeen(ownerB.id, tokenAccepted);
    crossOwnerSeenNoOp = crossOwnerSeenResult === null;
    check('markAuraMomentResponseSeen is a no-op when the token belongs to a DIFFERENT owner', crossOwnerSeenNoOp);

    const seenResult = await markAuraMomentResponseSeen(ownerA.id, tokenAccepted);
    check('markAuraMomentResponseSeen (correct owner) sets ownerSeenResponseAt', seenResult?.ownerSeenResponseAt !== null && seenResult?.ownerSeenResponseAt !== undefined);

    const ownerAMomentsAfterSeen = await listRecentRespondedAuraMomentsForOwner(ownerA.id, 50);
    const summaryAfterSeen = summarizeAuraUpdates(ownerAMomentsAfterSeen, successorSetA);
    check('unreadCount drops to 1 after marking exactly one update seen', summaryAfterSeen.unreadCount === 1);
    check('The seen ACCEPTED update reports unread=false', summaryAfterSeen.updates.find((u) => u.momentToken === tokenAccepted)?.unread === false);
    check('The un-seen ANOTHER_TIME update still reports unread=true', summaryAfterSeen.updates.find((u) => u.momentToken === tokenAnother)?.unread === true);
    check('Marking ACCEPTED seen does not affect the still-actionable ANOTHER_TIME update\'s requiresAction', summaryAfterSeen.updates.find((u) => u.momentToken === tokenAnother)?.requiresAction === true);

    // ============================================================
    // SUPERSEDED: a replacement AuraMoment resolves the original's actionable state
    // ============================================================
    const tokenReplacement = generatePublicMomentToken();
    createdTokens.push(tokenReplacement);
    const originalMoment = ownerAMomentsAfterSeen.find((m) => m.publicToken === tokenAnother)!;
    await createAuraMoment({
      ownerUserId: ownerA.id,
      publicToken: tokenReplacement,
      scope: 'SHARED',
      source: 'MUHURTHAM',
      activityId: originalMoment.activityId,
      activityTitle: originalMoment.activityTitle,
      activityIcon: originalMoment.activityIcon,
      startAt: new Date('2026-10-20T04:42:00.000Z'),
      endAt: new Date('2026-10-20T06:04:00.000Z'),
      timezone: originalMoment.timezone,
      savedPersonId: originalMoment.savedPersonId,
      sharedPersonDisplayName: originalMoment.sharedPersonDisplayName,
      senderDisplayName: originalMoment.senderDisplayName,
      ratingLabel: 'GOOD_SHARED_FIT',
      explanationSnapshot: 'x',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      previousMomentId: originalMoment.id,
    });

    const successorSetAfterSuggest = await listMomentIdsWithSuccessorForOwner(ownerA.id);
    check('listMomentIdsWithSuccessorForOwner now includes the original ANOTHER_TIME moment\'s id', successorSetAfterSuggest.has(originalMoment.id));

    const ownerAMomentsAfterSuggest = await listRecentRespondedAuraMomentsForOwner(ownerA.id, 50);
    const summaryAfterSuggest = summarizeAuraUpdates(ownerAMomentsAfterSuggest, successorSetAfterSuggest);
    const resolvedUpdate = summaryAfterSuggest.updates.find((u) => u.momentToken === tokenAnother);
    check('The ORIGINAL ANOTHER_TIME update no longer requires action once a successor exists', resolvedUpdate !== undefined && resolvedUpdate.requiresAction === false);
    check('The original update is NOT deleted -- historical response state is preserved', resolvedUpdate !== undefined);
  } finally {
    // Best-effort cleanup: revoke every moment this test created.
    for (const token of createdTokens) {
      await revokeAuraMoment(ownerA.id, token).catch(() => {});
    }
    await revokeAuraMoment(ownerB.id, tokenOwnerB).catch(() => {});
  }

  console.log(allPassed ? '\nALL AURA UPDATES DB CHECKS PASSED' : '\nSOME AURA UPDATES DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
