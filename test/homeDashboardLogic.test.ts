import { MAX_HOME_MOMENT_CARDS, selectHomeMomentCards } from '../apps/web/components/HomeDashboard';
import type { AuraUpdate } from '../apps/web/lib/auraUpdates';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakeUpdate(momentToken: string, requiresAction: boolean): AuraUpdate {
  return {
    id: momentToken,
    type: requiresAction ? 'MOMENT_ANOTHER_TIME' : 'MOMENT_ACCEPTED',
    momentToken,
    activityTitle: 'Griha Pravesh',
    recipientDisplayName: 'Anu',
    eventStartAt: '2026-10-18T04:42:00.000Z',
    occurredAt: '2026-08-22T10:00:00.000Z',
    requiresAction,
    unread: true,
  };
}

// ============================================================
// HOME: no updates -> no section (an empty array is what page.tsx passes
// when there is nothing to show; the component itself renders nothing for
// an empty list -- see HomeDashboard.tsx's `momentUpdates.length > 0` guard)
// ============================================================

check('selectHomeMomentCards on an empty list returns an empty list', selectHomeMomentCards([]).length === 0);

// ============================================================
// HOME: maximum display limit (brief section 7 -- "Maximum: 2-3 recent/actionable cards")
// ============================================================

const five = [fakeUpdate('a', true), fakeUpdate('b', true), fakeUpdate('c', false), fakeUpdate('d', false), fakeUpdate('e', false)];
check(`MAX_HOME_MOMENT_CARDS is small (2-3, matching the brief's "2-3" cap)`, MAX_HOME_MOMENT_CARDS >= 2 && MAX_HOME_MOMENT_CARDS <= 3);
check('selectHomeMomentCards never returns more than MAX_HOME_MOMENT_CARDS', selectHomeMomentCards(five).length === MAX_HOME_MOMENT_CARDS);
check('selectHomeMomentCards preserves the incoming order (priority sort is summarizeAuraUpdates\'s job, not this function\'s)', selectHomeMomentCards(five).map((u) => u.momentToken).join(',') === five.slice(0, MAX_HOME_MOMENT_CARDS).map((u) => u.momentToken).join(','));

const fewer = [fakeUpdate('a', true), fakeUpdate('b', false)];
check('selectHomeMomentCards returns fewer than the cap when fewer updates exist (never pads with placeholders)', selectHomeMomentCards(fewer).length === 2);

console.log(allPassed ? '\nALL HOME DASHBOARD LOGIC CHECKS PASSED' : '\nSOME HOME DASHBOARD LOGIC CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
