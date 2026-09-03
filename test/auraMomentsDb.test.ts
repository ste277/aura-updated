/**
 * Live-database test for AuraMoment CRUD + ownership + public resolution.
 * Requires a real, reachable DATABASE_URL (makes actual INSERT/SELECT/
 * UPDATE calls via apps/web/lib/db.ts's pg Pool) -- NOT part of ci.yml's
 * math-core-tests job, which has no Postgres service provisioned. Run
 * locally with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/auraMomentsDb.test.ts
 *
 * Creates one throwaway test user (idempotent via email upsert) and cleans
 * up every AuraMoment row it creates, but leaves the User row in place
 * (matches test/savedPersonDb.test.ts's own convention).
 */
import { createAuraMoment, getAuraMomentByToken, getAuraMomentForOwner, hasSuccessorMoment, listAuraMomentsForOwner, respondToAuraMoment, revokeAuraMoment, upsertUserByEmail } from '../apps/web/lib/db';
import { generatePublicMomentToken, resolvePublicAuraMoment } from '../apps/web/lib/auraMoments';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-aura-moment-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const ownerB = await upsertUserByEmail({ email: 'test-aura-moment-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  const createdTokens: string[] = [];
  const baseInput = {
    activityId: 'griha-pravesh',
    source: 'MUHURTHAM' as const,
    activityTitle: 'Griha Pravesh',
    activityIcon: '🏡',
    startAt: new Date('2026-10-18T04:42:00.000Z'),
    endAt: new Date('2026-10-18T06:04:00.000Z'),
    timezone: 'Asia/Kolkata',
    locationName: null,
  };

  try {
    // ============================================================
    // CREATE
    // ============================================================
    const tokenA = generatePublicMomentToken();
    createdTokens.push(tokenA);
    const moment = await createAuraMoment({
      ...baseInput,
      ownerUserId: ownerA.id,
      publicToken: tokenA,
      scope: 'SHARED',
      savedPersonId: null,
      sharedPersonDisplayName: 'Anu',
      senderDisplayName: 'Stephen',
      ratingLabel: 'STRONG_SHARED_FIT',
      explanationSnapshot: 'Aura found this timing to work well for both of you.',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    check('createAuraMoment returns a persisted row with an id', Boolean(moment.id));
    check('createAuraMoment persists the exact snapshot fields submitted', moment.activityTitle === 'Griha Pravesh' && moment.sharedPersonDisplayName === 'Anu' && moment.ratingLabel === 'STRONG_SHARED_FIT');
    check('createAuraMoment defaults status to ACTIVE', moment.status === 'ACTIVE');
    check('createAuraMoment defaults responseState to null', moment.responseState === null);
    check('createAuraMoment is owned by the creating user', moment.ownerUserId === ownerA.id);

    // ============================================================
    // TOKEN UNIQUENESS (DB constraint, not just app-level generation)
    // ============================================================
    const tokenB = generatePublicMomentToken();
    createdTokens.push(tokenB);
    const momentB = await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: tokenB, scope: 'GENERAL', savedPersonId: null, sharedPersonDisplayName: null, senderDisplayName: 'Stephen', ratingLabel: 'STRONG', explanationSnapshot: 'Aura found this to be a favorable time.', expiresAt: null });
    check('A second moment with a different token is created successfully', momentB.publicToken === tokenB && momentB.publicToken !== moment.publicToken);

    let duplicateTokenThrew = false;
    try {
      await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: tokenA, scope: 'GENERAL', savedPersonId: null, sharedPersonDisplayName: null, senderDisplayName: 'Stephen', ratingLabel: null, explanationSnapshot: null, expiresAt: null });
    } catch {
      duplicateTokenThrew = true;
    }
    check('Attempting to reuse an existing publicToken is rejected by the DB unique constraint', duplicateTokenThrew);

    // ============================================================
    // PUBLIC RESOLUTION -- bearer-access by token, no ownership needed
    // ============================================================
    const publicOutcome = await resolvePublicAuraMoment(tokenA);
    check('resolvePublicAuraMoment resolves an active moment to status OK', publicOutcome.status === 'OK');
    check('resolvePublicAuraMoment for a random/nonexistent token returns NOT_FOUND', (await resolvePublicAuraMoment('this-token-does-not-exist-' + Date.now())).status === 'NOT_FOUND');

    const publicByToken = await getAuraMomentByToken(tokenA);
    check('getAuraMomentByToken resolves purely by token, with no ownership check', publicByToken !== null && publicByToken.id === moment.id);

    // ============================================================
    // OWNERSHIP: cross-owner access
    // ============================================================
    const crossOwnerFetch = await getAuraMomentForOwner(ownerB.id, tokenA);
    check('getAuraMomentForOwner returns null when the token belongs to a DIFFERENT owner', crossOwnerFetch === null);

    let crossOwnerRevokeThrew = false;
    try {
      await revokeAuraMoment(ownerB.id, tokenA);
    } catch {
      crossOwnerRevokeThrew = true;
    }
    check('revokeAuraMoment throws when a different owner attempts to revoke', crossOwnerRevokeThrew);

    const stillActive = await getAuraMomentByToken(tokenA);
    check('The cross-owner revoke attempt left the moment untouched (still ACTIVE)', stillActive?.status === 'ACTIVE');

    const listA = await listAuraMomentsForOwner(ownerA.id);
    check('listAuraMomentsForOwner returns both of ownerA\'s moments', listA.filter((m) => createdTokens.includes(m.publicToken)).length === 2);
    const listB = await listAuraMomentsForOwner(ownerB.id);
    check('listAuraMomentsForOwner for ownerB never includes ownerA\'s moments', !listB.some((m) => createdTokens.includes(m.publicToken)));

    // ============================================================
    // RESPONSE (public, by token)
    // ============================================================
    const responded = await respondToAuraMoment(tokenA, 'ACCEPTED');
    check('respondToAuraMoment updates responseState on an active moment', responded?.responseState === 'ACCEPTED');
    check('respondToAuraMoment sets respondedAt', responded?.respondedAt !== null);

    const afterResponseOutcome = await resolvePublicAuraMoment(tokenA);
    check('The public DTO reflects the new responseState after responding', afterResponseOutcome.status === 'OK' && afterResponseOutcome.moment.responseState === 'ACCEPTED');

    // ============================================================
    // RESCHEDULE PREFERENCE (public, by token)
    // ============================================================
    const tokenC = generatePublicMomentToken();
    createdTokens.push(tokenC);
    const momentC = await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: tokenC, scope: 'SHARED', savedPersonId: null, sharedPersonDisplayName: 'Anu', senderDisplayName: 'Stephen', ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'Aura found this timing to work well for both of you.', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });

    const respondedWithPreference = await respondToAuraMoment(tokenC, 'ANOTHER_TIME', 'LATER');
    check('respondToAuraMoment stores the structured preference alongside ANOTHER_TIME', respondedWithPreference?.responseState === 'ANOTHER_TIME' && respondedWithPreference?.responsePreference === 'LATER');

    const preferenceOutcome = await resolvePublicAuraMoment(tokenC);
    check('The public DTO reflects the stored preference (safe -- the recipient\'s own input)', preferenceOutcome.status === 'OK' && preferenceOutcome.moment.responsePreference === 'LATER');

    const reRespondedAccepted = await respondToAuraMoment(tokenC, 'ACCEPTED', null);
    check('Responding again with ACCEPTED clears the stale preference (most recent response wins, no stale LATER left over)', reRespondedAccepted?.responseState === 'ACCEPTED' && reRespondedAccepted?.responsePreference === null);

    // ============================================================
    // LINEAGE ("Suggest this" creates a new moment, original stays immutable)
    // ============================================================
    const tokenD = generatePublicMomentToken();
    createdTokens.push(tokenD);
    const momentD = await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: tokenD, scope: 'SHARED', savedPersonId: null, sharedPersonDisplayName: 'Anu', senderDisplayName: 'Stephen', ratingLabel: 'STRONG_SHARED_FIT', explanationSnapshot: 'Aura found this timing to work well for both of you.', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
    check('hasSuccessorMoment is false before any successor exists', (await hasSuccessorMoment(momentD.id)) === false);

    const tokenE = generatePublicMomentToken();
    createdTokens.push(tokenE);
    const newStartAt = new Date('2026-10-20T03:40:00.000Z');
    const newEndAt = new Date('2026-10-20T04:55:00.000Z');
    const momentE = await createAuraMoment({
      ownerUserId: ownerA.id,
      publicToken: tokenE,
      scope: 'SHARED',
      source: 'MUHURTHAM',
      activityId: momentD.activityId,
      activityTitle: momentD.activityTitle,
      activityIcon: momentD.activityIcon,
      startAt: newStartAt,
      endAt: newEndAt,
      timezone: momentD.timezone,
      locationName: momentD.locationName,
      savedPersonId: momentD.savedPersonId,
      sharedPersonDisplayName: momentD.sharedPersonDisplayName,
      senderDisplayName: momentD.senderDisplayName,
      ratingLabel: 'GOOD_SHARED_FIT',
      explanationSnapshot: 'Aura found this timing to work well for both of you.',
      expiresAt: new Date(newEndAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      previousMomentId: momentD.id,
    });
    check('The new moment via "Suggest this" gets its own distinct token', momentE.publicToken !== momentD.publicToken);
    check('The new moment carries previousMomentId pointing at the original', momentE.previousMomentId === momentD.id);
    check('The new moment preserves the exact activity from the original (never broadened)', momentE.activityId === momentD.activityId && momentE.activityTitle === momentD.activityTitle);
    check('The new moment carries the SAME savedPersonId (SavedPerson context preserved privately)', momentE.savedPersonId === momentD.savedPersonId);
    check('The new moment gets a FRESH expiresAt derived from its OWN endAt, not inherited from the original', momentE.expiresAt !== null && momentE.expiresAt.getTime() === newEndAt.getTime() + 7 * 24 * 60 * 60 * 1000);

    const originalAfterSuggest = await getAuraMomentByToken(tokenD);
    check('The ORIGINAL moment is completely unchanged after a successor is created (immutable historical snapshot)', originalAfterSuggest?.startAt.getTime() === momentD.startAt.getTime() && originalAfterSuggest?.previousMomentId === null);
    check('hasSuccessorMoment is now true for the original', (await hasSuccessorMoment(momentD.id)) === true);

    const originalPublicOutcome = await resolvePublicAuraMoment(tokenD);
    check('The ORIGINAL public page can now see hasSuccessor=true, but the public DTO never leaks the new token anywhere', originalPublicOutcome.status === 'OK' && originalPublicOutcome.moment.hasSuccessor === true && !JSON.stringify(originalPublicOutcome.moment).includes(tokenE));

    // ============================================================
    // REVOKE (owner-scoped) -- after revoke, public resolution reports REVOKED
    // ============================================================
    const revoked = await revokeAuraMoment(ownerA.id, tokenB);
    check('revokeAuraMoment (correct owner) sets status to REVOKED', revoked.status === 'REVOKED');

    const revokedOutcome = await resolvePublicAuraMoment(tokenB);
    check('resolvePublicAuraMoment reports REVOKED for a revoked moment', revokedOutcome.status === 'REVOKED');

    const respondToRevoked = await respondToAuraMoment(tokenB, 'ACCEPTED');
    check('respondToAuraMoment is a no-op (returns null) against a REVOKED moment -- guarded entirely in SQL', respondToRevoked === null);

    // ============================================================
    // EXPIRY (evaluated on read, not a stored boolean)
    // ============================================================
    const expiredToken = generatePublicMomentToken();
    createdTokens.push(expiredToken);
    await createAuraMoment({ ...baseInput, ownerUserId: ownerA.id, publicToken: expiredToken, scope: 'PERSONAL', savedPersonId: null, sharedPersonDisplayName: null, senderDisplayName: 'Stephen', ratingLabel: null, explanationSnapshot: null, expiresAt: new Date(Date.now() - 60_000) });

    const expiredOutcome = await resolvePublicAuraMoment(expiredToken);
    check('resolvePublicAuraMoment reports EXPIRED for a moment whose expiresAt has passed, even though status is still ACTIVE', expiredOutcome.status === 'EXPIRED');

    const respondToExpired = await respondToAuraMoment(expiredToken, 'ANOTHER_TIME');
    check('respondToAuraMoment is also guarded against an expired-but-still-ACTIVE moment', respondToExpired === null);
  } finally {
    // Best-effort cleanup: revoke every moment this test created (no hard
    // delete function exists by design -- brief section 15: "do not delete
    // the owner's historical record unless current data conventions
    // strongly favor deletion", and revoking is sufficient to make this
    // test re-runnable without leaving ACTIVE junk behind).
    for (const token of createdTokens) {
      await revokeAuraMoment(ownerA.id, token).catch(() => {});
    }
  }

  console.log(allPassed ? '\nALL AURA MOMENT DB CHECKS PASSED' : '\nSOME AURA MOMENT DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
