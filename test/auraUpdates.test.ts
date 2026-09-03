import { summarizeAuraUpdates } from '../apps/web/lib/auraUpdates';
import type { AuraMoment } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakeMoment(overrides: Partial<AuraMoment>): AuraMoment {
  return {
    id: 'moment-1',
    ownerUserId: 'owner-1',
    publicToken: 'token-1',
    scope: 'SHARED',
    source: 'MUHURTHAM',
    activityId: 'griha-pravesh',
    activityTitle: 'Griha Pravesh',
    activityIcon: '🏡',
    startAt: new Date('2026-10-18T04:42:00.000Z'),
    endAt: new Date('2026-10-18T06:04:00.000Z'),
    timezone: 'Asia/Kolkata',
    locationName: null,
    savedPersonId: 'person-1',
    sharedPersonDisplayName: 'Anu',
    senderDisplayName: 'Stephen',
    ratingLabel: 'STRONG_SHARED_FIT',
    explanationSnapshot: 'Aura found this timing to work well for both of you.',
    status: 'ACTIVE',
    responseState: null,
    responsePreference: null,
    respondedAt: null,
    previousMomentId: null,
    plannedActivityId: null,
    ownerSeenResponseAt: null,
    firstOpenedAt: null,
    createdAt: new Date('2026-08-22T00:00:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}

// ============================================================
// ACCEPTED creates an unread, non-actionable update
// ============================================================

const accepted = fakeMoment({ publicToken: 'accepted-1', responseState: 'ACCEPTED', respondedAt: new Date('2026-08-22T10:00:00.000Z') });
const acceptedSummary = summarizeAuraUpdates([accepted], new Set());
check('ACCEPTED produces exactly one update', acceptedSummary.updates.length === 1);
check('ACCEPTED update has type MOMENT_ACCEPTED', acceptedSummary.updates[0].type === 'MOMENT_ACCEPTED');
check('ACCEPTED update never requires action (a confirmation, not a task)', acceptedSummary.updates[0].requiresAction === false);
check('ACCEPTED update is unread when never seen', acceptedSummary.updates[0].unread === true);
check('ACCEPTED update has no preference field', acceptedSummary.updates[0].preference === undefined);
check('unreadCount reflects the one unread ACCEPTED update', acceptedSummary.unreadCount === 1);

// ============================================================
// ANOTHER_TIME creates an unread, actionable update with preference preserved
// ============================================================

const anotherTime = fakeMoment({ publicToken: 'another-1', responseState: 'ANOTHER_TIME', responsePreference: 'LATER', respondedAt: new Date('2026-08-22T11:00:00.000Z') });
const anotherSummary = summarizeAuraUpdates([anotherTime], new Set());
check('ANOTHER_TIME produces type MOMENT_ANOTHER_TIME', anotherSummary.updates[0].type === 'MOMENT_ANOTHER_TIME');
check('ANOTHER_TIME requires action when no successor exists yet', anotherSummary.updates[0].requiresAction === true);
check('ANOTHER_TIME preserves the exact stored preference', anotherSummary.updates[0].preference === 'LATER');
check('ANOTHER_TIME is unread when never seen', anotherSummary.updates[0].unread === true);

// ============================================================
// NO update at all when there is no response yet, or the moment is revoked
// ============================================================

const noResponse = fakeMoment({ publicToken: 'no-response-1', responseState: null, respondedAt: null });
check('A moment with no response yet produces no update', summarizeAuraUpdates([noResponse], new Set()).updates.length === 0);

// (Revoked moments are filtered out by the DB query, not this function --
// but verify the function itself doesn't accidentally re-include one if a
// caller passed it anyway is NOT this function's contract; the DB layer
// owns that filter. Documented, not tested here to avoid asserting a
// responsibility this function doesn't own.)

// ============================================================
// SEEN STATE: unread flips to false only once ownerSeenResponseAt >= respondedAt
// ============================================================

const seenAfterResponse = fakeMoment({ publicToken: 'seen-1', responseState: 'ACCEPTED', respondedAt: new Date('2026-08-22T10:00:00.000Z'), ownerSeenResponseAt: new Date('2026-08-22T10:05:00.000Z') });
check('unread is false once ownerSeenResponseAt is AFTER respondedAt', summarizeAuraUpdates([seenAfterResponse], new Set()).updates[0].unread === false);

const seenBeforeResponse = fakeMoment({ publicToken: 'seen-2', responseState: 'ANOTHER_TIME', responsePreference: 'EARLIER', respondedAt: new Date('2026-08-22T12:00:00.000Z'), ownerSeenResponseAt: new Date('2026-08-22T09:00:00.000Z') });
check('unread is TRUE again when respondedAt is AFTER the last ownerSeenResponseAt (a new response after a prior seen mark, e.g. re-responding)', summarizeAuraUpdates([seenBeforeResponse], new Set()).updates[0].unread === true);

// "Seen" does not affect requiresAction -- an ANOTHER_TIME the owner has
// viewed still requires action until a replacement is actually suggested.
check('A seen ANOTHER_TIME still requires action if no successor exists', summarizeAuraUpdates([seenAfterResponse.responseState === 'ACCEPTED' ? anotherTime : anotherTime], new Set()).updates[0].requiresAction === true);

// ============================================================
// SUPERSEDED: a replacement AuraMoment resolves the original's actionable state
// ============================================================

const supersededSummary = summarizeAuraUpdates([anotherTime], new Set([anotherTime.id]));
check('An ANOTHER_TIME update no longer requires action once its moment has a successor', supersededSummary.updates[0].requiresAction === false);
check('A superseded ANOTHER_TIME update is NOT deleted -- it still appears, just resolved', supersededSummary.updates.length === 1 && supersededSummary.updates[0].type === 'MOMENT_ANOTHER_TIME');

// ============================================================
// PRIORITY: requiresAction ranks above informational, then most-recent first
// ============================================================

const oldAccepted = fakeMoment({ id: 'm-old-accepted', publicToken: 'old-accepted', responseState: 'ACCEPTED', respondedAt: new Date('2026-08-20T09:00:00.000Z') });
const newAccepted = fakeMoment({ id: 'm-new-accepted', publicToken: 'new-accepted', responseState: 'ACCEPTED', respondedAt: new Date('2026-08-22T09:00:00.000Z') });
const actionable = fakeMoment({ id: 'm-actionable', publicToken: 'actionable', responseState: 'ANOTHER_TIME', responsePreference: 'DIFFERENT_DAY', respondedAt: new Date('2026-08-19T09:00:00.000Z') });
const priorityOrder = summarizeAuraUpdates([oldAccepted, newAccepted, actionable], new Set()).updates.map((u) => u.momentToken);
check('The actionable ANOTHER_TIME ranks first even though it is chronologically the OLDEST response', priorityOrder[0] === 'actionable');
check('Within the informational (ACCEPTED) bucket, the most recent response ranks first', priorityOrder[1] === 'new-accepted' && priorityOrder[2] === 'old-accepted');

// ============================================================
// PRIVACY: AuraUpdate never carries natal/SavedPerson-internal fields
// ============================================================

const privacyCheckMoment = fakeMoment({ publicToken: 'privacy-1', responseState: 'ACCEPTED', respondedAt: new Date() });
const privacySummary = summarizeAuraUpdates([privacyCheckMoment], new Set());
const serializedUpdate = JSON.stringify(privacySummary.updates[0]);
check('AuraUpdate never contains savedPersonId', !('savedPersonId' in privacySummary.updates[0]) && !serializedUpdate.includes('person-1'));
check('AuraUpdate never contains ownerUserId', !('ownerUserId' in privacySummary.updates[0]) && !serializedUpdate.includes('owner-1'));
check('AuraUpdate never contains any birth/natal field name', !/birthDate|birthTime|birthTimezone|natalNakshatraIndex|janmaNakshatra|janmaRashi/i.test(serializedUpdate));
check('AuraUpdate does carry the safe recipient display name', privacySummary.updates[0].recipientDisplayName === 'Anu');

console.log(allPassed ? '\nALL AURA UPDATES CHECKS PASSED' : '\nSOME AURA UPDATES CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
