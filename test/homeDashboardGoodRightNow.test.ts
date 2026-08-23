import { selectGoodRightNowCards } from '../apps/web/components/HomeDashboard';
import { getActionCards } from '../packages/recommendation/src/actionCards';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Nothing logged -- identical to the existing plain getActionCards() table
// (no regression to the pre-existing ordering/content).
// ============================================================

check(
  'With nothing logged today, NEUTRAL cards are unchanged from getActionCards()',
  JSON.stringify(selectGoodRightNowCards('NEUTRAL', [])) === JSON.stringify(getActionCards('NEUTRAL').slice(0, 3))
);

// ============================================================
// The actual bug report: an activity logged/started earlier today must
// NOT reappear as an active Good Right Now card after navigating away and
// back (a fresh call with no justLoggedTitles, simulating a fresh mount).
// ============================================================

{
  // NEUTRAL's own cards resolve to Deep Work / Light Stretch & Mobility /
  // Active Rest & Hydration Check (see actionCards.ts) -- "Deep Work" is
  // the canonical title logged via neutral-focus.
  const cards = selectGoodRightNowCards('NEUTRAL', ['Deep Work']);
  check('An already-logged activity (Deep Work) is NOT present among the cards', !cards.some((c) => c.activityId === 'deep-work'));
  check('Exactly 3 cards are still shown (swapped for an alternative, not just removed)', cards.length === 3);
  check('The two untouched NEUTRAL cards remain (task-7, task-6)', cards.some((c) => c.activityId === 'task-7') && cards.some((c) => c.activityId === 'task-6'));
  check('No duplicate activityId across the result', new Set(cards.map((c) => c.activityId ?? c.id)).size === cards.length);
}

{
  // Case-insensitive / whitespace-tolerant match, matching how
  // loggedActivitiesToday is actually produced in page.tsx (trim + lowercase).
  const cards = selectGoodRightNowCards('NEUTRAL', ['  deep work  ']);
  check('Matching is case-insensitive and whitespace-tolerant', !cards.some((c) => c.activityId === 'deep-work'));
}

{
  // All three NEUTRAL activities logged -- every card should be replaced by
  // catalog alternatives (or, if truly exhausted, gracefully return fewer
  // than 3 rather than crash).
  const cards = selectGoodRightNowCards('NEUTRAL', ['Deep Work', 'Light Stretch & Mobility', 'Active Rest & Hydration Check']);
  check('All three logged -> none of the original NEUTRAL activityIds remain', !cards.some((c) => ['deep-work', 'task-7', 'task-6'].includes(c.activityId ?? '')));
  check('Alternatives never include a PLAN-only activity', cards.every((c) => c.activityId !== 'date-night' && c.activityId !== 'griha-pravesh'));
}

// ============================================================
// justLoggedTitles exemption -- a card just logged THIS visit keeps its
// slot instead of being swapped (brief: "Aura should feel fast" / show
// inline confirmation, not vanish it mid-interaction).
// ============================================================

{
  const cards = selectGoodRightNowCards('NEUTRAL', ['Deep Work'], new Set(['deep work']));
  check('A title present in BOTH loggedActivitiesToday AND justLoggedTitles keeps its original card (exempted from swap)', cards.some((c) => c.activityId === 'deep-work'));
}

if (!allPassed) {
  console.error('\nSome Home Dashboard Good Right Now selection checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME DASHBOARD GOOD RIGHT NOW SELECTION CHECKS PASSED');
}
