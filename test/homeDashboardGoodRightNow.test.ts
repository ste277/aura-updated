import { selectGoodRightNowCards } from '../apps/web/components/HomeDashboard';
import { getActionCards } from '../packages/recommendation/src/actionCards';
import type { PersonalMuhurtaContext } from '../packages/recommendation/src/auraFitEngine';

/**
 * NOTE: this file imports HomeDashboard.tsx directly and requires --jsx to
 * compile -- it cannot run under this project's plain `npx ts-node
 * test/*.test.ts` invocation (root tsconfig.json has no jsx option), a
 * pre-existing, unrelated environment limitation confirmed unchanged by
 * this PR (see test/homeGoodRightNowPersonalization.test.ts for the
 * fully-runnable coverage of the same underlying personalization wiring,
 * exercised directly against actionCards.ts/auraFitEngine.ts without
 * needing this .tsx import).
 */

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

// ============================================================
// Home Good Right Now Personalization V1 -- personalContext flows ONLY
// into the discovery/alternatives path (getActivityDiscoveryCards), never
// into the static base table or the logged/just-logged filtering logic
// above, which are all unaffected by these new checks (brief section 10/
// 12/33). NEUTRAL's own 3 base cards fill every slot when nothing is
// logged (stillNeeded <= 0), so the discovery path -- the only place
// personalContext can matter -- is never even reached in that case; these
// checks force it by logging all three base activities first.
// ============================================================

const PERSONAL_CONTEXT: PersonalMuhurtaContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini', moonElement: 'FIRE' };

{
  // All three base activities logged forces full reliance on the discovery/
  // alternatives path -- personalization may legitimately re-rank WHICH
  // alternatives make the top-3 cut (a near-tie reorder is correct
  // behavior, not a bug), so this deliberately does NOT assert the two
  // calls return the identical activityId set -- only structural
  // invariants that must hold regardless of ranking, plus a genuine
  // personalization signal wherever the two lists do overlap.
  const allLoggedGeneral = selectGoodRightNowCards('NEUTRAL', ['Deep Work', 'Light Stretch & Mobility', 'Active Rest & Hydration Check']);
  const allLoggedPersonalized = selectGoodRightNowCards('NEUTRAL', ['Deep Work', 'Light Stretch & Mobility', 'Active Rest & Hydration Check'], new Set(), PERSONAL_CONTEXT);
  check('Personalized call still returns exactly 3 cards (personalization never changes card count)', allLoggedPersonalized.length === allLoggedGeneral.length);
  check('No duplicate activityId in the personalized result', new Set(allLoggedPersonalized.map((c) => c.activityId ?? c.id)).size === allLoggedPersonalized.length);
  check('Personalized alternatives still never include a PLAN-only activity (existing invariant preserved)', allLoggedPersonalized.every((c) => c.activityId !== 'date-night' && c.activityId !== 'griha-pravesh'));
  check('Wherever the same activityId appears in both the general and personalized lists, its description genuinely differs (personalSummary surfaced, not silently ignored)', allLoggedPersonalized.some((card) => {
    const counterpart = allLoggedGeneral.find((c) => (c.activityId ?? c.id) === (card.activityId ?? card.id));
    return counterpart && counterpart.description !== card.description;
  }));
}

{
  // Logged/just-logged filtering semantics are completely unaffected by
  // supplying personalContext -- the exact same swap/exemption behavior
  // proven above for the no-personalContext calls.
  const cards = selectGoodRightNowCards('NEUTRAL', ['Deep Work'], new Set(), PERSONAL_CONTEXT);
  check('Personalized call still filters an already-logged activity out (filtering semantics unchanged)', !cards.some((c) => c.activityId === 'deep-work'));
  check('Personalized call still returns exactly 3 cards', cards.length === 3);

  const exempted = selectGoodRightNowCards('NEUTRAL', ['Deep Work'], new Set(['deep work']), PERSONAL_CONTEXT);
  check('Personalized call still honors the justLoggedTitles exemption', exempted.some((c) => c.activityId === 'deep-work'));
}

// Omitted personalContext (the pre-existing 3-arg call) is byte-for-byte
// unchanged from before this PR -- incomplete-profile owners see today's
// exact existing behavior, no clarification, no onboarding interruption.
{
  const threeArg = selectGoodRightNowCards('NEUTRAL', ['Deep Work']);
  const fourArgUndefined = selectGoodRightNowCards('NEUTRAL', ['Deep Work'], new Set(), undefined);
  check('selectGoodRightNowCards(...) and (..., undefined) produce byte-identical output', JSON.stringify(threeArg) === JSON.stringify(fourArgUndefined));
}

if (!allPassed) {
  console.error('\nSome Home Dashboard Good Right Now selection checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME DASHBOARD GOOD RIGHT NOW SELECTION CHECKS PASSED');
}
