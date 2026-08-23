import { summarizeAuraUpdates } from '../apps/web/lib/auraUpdates';
import type { AuraMoment } from '../apps/web/lib/db';

/**
 * Product Structure V2 (brief section 27): Home no longer has its own
 * multi-card selection logic (selectHomeMomentCards/MAX_HOME_MOMENT_CARDS
 * are gone) -- it now just takes summarizeAuraUpdates(...).updates[0], the
 * single most-actionable/most-recent item, so it never duplicates the
 * bell's own Updates screen. This test proves that pattern behaves
 * correctly against the real summarizeAuraUpdates() (already unit-tested
 * for its own sort in auraUpdates.test.ts), not a reimplementation.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakeMoment(overrides: Partial<AuraMoment>): AuraMoment {
  return {
    id: overrides.id ?? 'moment-1',
    ownerUserId: 'owner-1',
    publicToken: overrides.publicToken ?? 'token-1',
    scope: 'SHARED',
    source: 'MUHURTHAM',
    activityId: 'griha-pravesh',
    activityTitle: 'Griha Pravesh',
    activityIcon: '🏡',
    startAt: new Date('2026-10-18T04:42:00.000Z'),
    endAt: new Date('2026-10-18T06:04:00.000Z'),
    timezone: 'Asia/Kolkata',
    savedPersonId: 'person-1',
    sharedPersonDisplayName: 'Anu',
    senderDisplayName: 'Stephen',
    ratingLabel: 'STRONG_SHARED_FIT',
    explanationSnapshot: 'x',
    status: 'ACTIVE',
    responseState: 'ACCEPTED',
    responsePreference: null,
    respondedAt: new Date('2026-08-22T10:00:00.000Z'),
    previousMomentId: null,
    plannedActivityId: null,
    ownerSeenResponseAt: null,
    firstOpenedAt: null,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}

// ============================================================
// No updates -> no card (Home renders nothing for undefined, never an
// empty-array placeholder section)
// ============================================================

check('No moments -> updates[0] is undefined -> Home renders no card', summarizeAuraUpdates([], new Set()).updates[0] === undefined);

// ============================================================
// Home's card is ALWAYS exactly the single highest-priority item, never a
// list -- even when several updates exist
// ============================================================

const oldAccepted = fakeMoment({ id: 'm-old', publicToken: 'old-accepted', responseState: 'ACCEPTED', respondedAt: new Date('2026-08-20T09:00:00.000Z') });
const newAccepted = fakeMoment({ id: 'm-new', publicToken: 'new-accepted', responseState: 'ACCEPTED', respondedAt: new Date('2026-08-22T09:00:00.000Z') });
const actionable = fakeMoment({ id: 'm-actionable', publicToken: 'actionable', responseState: 'ANOTHER_TIME', responsePreference: 'DIFFERENT_DAY', respondedAt: new Date('2026-08-19T09:00:00.000Z') });

const summary = summarizeAuraUpdates([oldAccepted, newAccepted, actionable], new Set());
check('Home\'s single card is the actionable ANOTHER_TIME, even though it is chronologically oldest', summary.updates[0].momentToken === 'actionable');
check('Home never sees more than one card worth of data from this pattern (updates[0] is a single item, not a slice)', typeof summary.updates[0] === 'object' && !Array.isArray(summary.updates[0]));

// When nothing is actionable, the single card is just the most recent informational one.
const onlyInformational = summarizeAuraUpdates([oldAccepted, newAccepted], new Set());
check('With no actionable updates, Home\'s single card is the most recent informational one', onlyInformational.updates[0].momentToken === 'new-accepted');

console.log(allPassed ? '\nALL HOME DASHBOARD LOGIC CHECKS PASSED' : '\nSOME HOME DASHBOARD LOGIC CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
