/**
 * Home Good Right Now Personalization V1 -- coverage for the pieces that
 * don't require importing a .tsx file (HomeDashboard.tsx's own
 * selectGoodRightNowCards is covered separately in
 * test/homeDashboardGoodRightNow.test.ts, which already requires --jsx to
 * compile under this project's plain ts-node harness -- a pre-existing,
 * unrelated environment limitation, not something this PR introduces).
 *
 * Everything here calls REAL, unmodified functions (buildPersonalMuhurtaContextForUser,
 * evaluateActivityFit, getActivityDiscoveryCards, buildActivityDiscoveryDescription)
 * -- no mocking, no fabricated engine behavior.
 */
import { getActionCards, getActivityDiscoveryCards, buildActivityDiscoveryDescription } from '../packages/recommendation/src/actionCards';
import { evaluateActivityFit, PersonalMuhurtaContext } from '../packages/recommendation/src/auraFitEngine';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { buildPersonalMuhurtaContextForUser } from '../apps/web/lib/natalContext';
import type { User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'owner@example.com',
    cityName: 'Chennai',
    latitude: 13.0827,
    longitude: 80.2707,
    timezone: 'Asia/Kolkata',
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    birthDate: new Date('1990-05-15T00:00:00.000Z'),
    birthTime: '08:30',
    birthCityName: 'Chennai',
    birthLatitude: 13.0827,
    birthLongitude: 80.2707,
    birthTimezone: 'Asia/Kolkata',
    remindersEnabled: true,
    reminderLeadMinutes: 15,
    dayBuilderEnabled: false,
    dayBuilderMutedGroups: [],
    dayBuilderPriorities: [],
    dayBuilderPriorityPersonIds: [],
    dayBuilderPrioritiesPromptDismissed: false,
    ...overrides,
  };
}

// ============================================================
// Section 27 -- context construction (buildPersonalMuhurtaContextForUser is
// pure/DB-free itself: the DB lookup happens BEFORE it's called, via
// getUserById in the route -- so this is fully testable here without a
// live DATABASE_URL).
// ============================================================

{
  const complete = buildPersonalMuhurtaContextForUser(fakeUser());
  check('Complete birth profile (birthDate+birthTime+birthTimezone) -> derived personalContext is defined', Boolean(complete));
  check('Derived personalContext carries natalNakshatraIndex', typeof complete?.natalNakshatraIndex === 'number');
  const keys = Object.keys(complete ?? {});
  check(
    'Derived personalContext NEVER carries raw birth fields (data minimization) -- only the derived natal shape',
    !keys.includes('birthDate') && !keys.includes('birthTime') && !keys.includes('birthTimezone') && !keys.includes('birthLatitude') && !keys.includes('birthLongitude')
  );
}
{
  const noExactTime = buildPersonalMuhurtaContextForUser(fakeUser({ birthTime: null }));
  check('Birth date but no exact birth time -> undefined (incomplete profile), no error', noExactTime === undefined);
}
{
  const noProfile = buildPersonalMuhurtaContextForUser(fakeUser({ birthDate: null, birthTime: null, birthTimezone: null }));
  check('No usable natal profile at all -> undefined, no error', noProfile === undefined);
}

// ============================================================
// Fixed fixture reused from test/muhurta.test.ts's own already-proven
// Tara-Bala-affecting pairing (natalNakshatraIndex: 1, same date) --
// deterministic, not re-derived here. 'workout' (elementAffinity: FIRE,
// significance: HIGH) is used so the moon-element-affinity bonus is
// exercised alongside Tara Bala.
// ============================================================

const FIXED_DATE = new Date(Date.UTC(2026, 6, 28, 6, 45, 0));
const PERSONAL_CONTEXT: PersonalMuhurtaContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini', moonElement: 'FIRE' };
const workout = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'workout')!;
check('Fixture sanity: "workout" resolves from the real catalog', Boolean(workout));

// ============================================================
// Section 16/28 -- ranking/score impact, direct evaluator call at a FIXED
// date (mirrors muhurta.test.ts's own proven-safe pattern; getActivityDiscoveryCards
// itself always evaluates against the real current wall-clock time, so a
// fixed-date comparison must go through evaluateActivityFit directly to be
// deterministic regardless of when this test runs).
// ============================================================

{
  const general = evaluateActivityFit({ activity: workout, date: FIXED_DATE, windowType: 'ABHIJIT' });
  const personal = evaluateActivityFit({ activity: workout, date: FIXED_DATE, windowType: 'ABHIJIT', personalContext: PERSONAL_CONTEXT });
  check('Personal context changes the evaluator\'s score for the identical activity/date/window (no new scoring model -- same evaluateActivityFit, same weights)', general.score !== personal.score);
  check('Personal context produces a genuine personalSummary the general call does not have', Boolean(personal.personalSummary) && !general.personalSummary);
  check('Personalization is additive re-ranking, never a hard AVOID gate: an otherwise-usable activity does not become AVOID solely from personal signals', personal.label !== 'AVOID' || general.label === 'AVOID');
}

// ============================================================
// Section 28 -- discovery-card wiring: getActivityDiscoveryCards forwards
// personalContext into evaluateActivityFit exactly as Ask Aura/Day Builder/
// Plan already do. Uses today's real date (unavoidable, since the function
// itself always calls `new Date()` internally, unchanged by this PR) --
// so this checks the STRUCTURALLY GUARANTEED signal (personalSummary
// presence, which never depends on which day Tara Bala happens to favor)
// rather than an exact score delta, to avoid any date-dependent flakiness.
// ============================================================

{
  const general = getActivityDiscoveryCards('ABHIJIT', 50);
  const personalized = getActivityDiscoveryCards('ABHIJIT', 50, PERSONAL_CONTEXT);
  const generalWorkout = general.find((c) => c.activityId === 'workout');
  const personalizedWorkout = personalized.find((c) => c.activityId === 'workout');
  check('"workout" resolves in both the general and personalized discovery lists', Boolean(generalWorkout) && Boolean(personalizedWorkout));
  check('Personalized description differs from the general one (personalSummary is genuinely surfaced)', generalWorkout?.description !== personalizedWorkout?.description);
  check('Personalized description still contains the original general summary text (additive, not a replacement)', Boolean(generalWorkout && personalizedWorkout?.description.startsWith(generalWorkout.description)));
}

// Omitted personalContext (undefined, or the 2-arg call) is byte-for-byte
// unchanged -- proves backward compatibility / neutral degradation for an
// incomplete-profile owner (section 15/31).
{
  const twoArg = getActivityDiscoveryCards('NEUTRAL', 12);
  const threeArgUndefined = getActivityDiscoveryCards('NEUTRAL', 12, undefined);
  check('getActivityDiscoveryCards(window, limit) and (window, limit, undefined) produce byte-identical output', JSON.stringify(twoArg) === JSON.stringify(threeArgUndefined));
}

// ============================================================
// Section 30 -- ranking: the discovery list must remain sorted by the
// canonical (possibly personalized) score, never a separate personalization
// bonus or a resort by personalSummary/reason count.
// ============================================================

{
  const personalized = getActivityDiscoveryCards('ABHIJIT', 50, PERSONAL_CONTEXT);
  const scores = personalized.map((c) => c.fitScore ?? 0);
  const isSorted = scores.every((score, i) => i === 0 || scores[i - 1] >= score);
  check('Personalized discovery list remains sorted strictly by the canonical fitScore (descending), no separate personalization ranking', isSorted);
}

// ============================================================
// Section 29 -- description composition helper, fully deterministic (no
// engine call needed).
// ============================================================

check(
  'No personalSummary -> description is fit.summary byte-for-byte, unchanged from before this PR',
  buildActivityDiscoveryDescription({ summary: 'A clean start suits deep work right now.', personalSummary: undefined }) === 'A clean start suits deep work right now.'
);
check(
  'Meaningful personalSummary -> general summary first, then personal summary, space-joined',
  buildActivityDiscoveryDescription({ summary: 'A clean start suits deep work right now.', personalSummary: 'Your personal timing is also supportive.' }) ===
    'A clean start suits deep work right now. Your personal timing is also supportive.'
);
check(
  'Empty-string personalSummary is treated as "no personalSummary" (falsy), never an empty trailing space',
  buildActivityDiscoveryDescription({ summary: 'General text.', personalSummary: '' }) === 'General text.'
);

// ============================================================
// Section 32 -- static getActionCards() must remain completely unaffected;
// it doesn't accept a personalContext parameter at all, and this PR never
// touches ACTION_CARDS or the function's own implementation.
// ============================================================

{
  const before = JSON.stringify(getActionCards('NEUTRAL'));
  const after = JSON.stringify(getActionCards('NEUTRAL'));
  check('getActionCards("NEUTRAL") is a pure, unaffected static lookup (identical across calls, no hidden natal-context dependency)', before === after);
  check('getActionCards("RAHU_KALAM") still returns exactly 3 pre-authored cards, unaffected', getActionCards('RAHU_KALAM').length === 3);
}

if (!allPassed) {
  console.error('\nSome Home Good Right Now personalization checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME GOOD RIGHT NOW PERSONALIZATION CHECKS PASSED');
}
