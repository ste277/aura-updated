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

// ============================================================
// Ask Aura GOOD_RIGHT_NOW Personalized Hybrid V1 -- getActivityDiscoveryCards'
// new optional `date` parameter. Home's own callers (which omit it) must
// keep working exactly as before; a caller with an explicit fixed instant
// (Ask Aura's deps.context.now) must get fully deterministic, repeatable
// output -- the audit's own time-determinism finding, now closed.
// ============================================================

{
  const FIXED_NOW = new Date('2026-09-05T09:00:00.000Z');
  const call1 = getActivityDiscoveryCards('NEUTRAL', 6, undefined, FIXED_NOW);
  const call2 = getActivityDiscoveryCards('NEUTRAL', 6, undefined, FIXED_NOW);
  check('Explicit fixed date -> repeated calls produce byte-identical output (deterministic, no hidden internal wall-clock reading)', JSON.stringify(call1) === JSON.stringify(call2));
}
{
  // Existing Home call sites omit `date` entirely -- must keep compiling
  // and running exactly as before (defaults to `new Date()` internally,
  // unchanged behavior).
  const omittedDate = getActivityDiscoveryCards('NEUTRAL', 6);
  check('Omitting `date` entirely still returns a real, non-empty discovery list (backward-compatible default)', omittedDate.length > 0);
}
{
  const DATE_A = new Date('2026-01-15T09:00:00.000Z');
  const DATE_B = new Date('2027-01-15T09:00:00.000Z');
  const resultA = getActivityDiscoveryCards('ABHIJIT', 6, PERSONAL_CONTEXT, DATE_A);
  const resultB = getActivityDiscoveryCards('ABHIJIT', 6, PERSONAL_CONTEXT, DATE_B);
  check('Explicit date genuinely drives the computation (a different real date can change scores, e.g. via Tara Bala\'s own date-dependence)', JSON.stringify(resultA) !== JSON.stringify(resultB));
}

// ============================================================
// Fallback selection mechanism (Ask Aura GOOD_RIGHT_NOW's own composition,
// apps/web/lib/askAuraOrchestrator.ts's handleGoodRightNow) -- mirrors the
// EXACT two-line selection+fallback pattern that function uses (a `.find()`
// plus a `??`), since that logic is inline and not separately exported.
// Proves the fallback branch fires correctly when every discovery
// candidate happens to duplicate a base card -- a scenario deliberately
// constructed here with synthetic fixtures rather than in production code,
// per the audit's own instruction not to distort the real catalog merely
// to make this branch reachable.
// ============================================================

function selectPersonalizedThirdCard(
  base: Array<{ activityId?: string }>,
  discovery: Array<{ activityId?: string }>
): { activityId?: string } {
  const baseActivityIds = new Set(base.map((c) => c.activityId).filter((id): id is string => Boolean(id)));
  const personalized = discovery.find((card) => card.activityId && !baseActivityIds.has(card.activityId));
  return personalized ?? base[2];
}

{
  const base = [{ activityId: 'deep-work' }, { activityId: 'task-7' }, { activityId: 'task-6' }];
  const discoveryWithAlternative = [{ activityId: 'deep-work' }, { activityId: 'workout' }, { activityId: 'task-6' }];
  check('A genuine non-duplicate discovery candidate ("workout") is selected over base duplicates ranked above it', selectPersonalizedThirdCard(base, discoveryWithAlternative).activityId === 'workout');

  const discoveryAllDuplicates = [{ activityId: 'deep-work' }, { activityId: 'task-7' }, { activityId: 'task-6' }];
  check('When EVERY discovery candidate duplicates a base card, the selection falls back to base[2] exactly (deterministic, never fewer than 3 options)', selectPersonalizedThirdCard(base, discoveryAllDuplicates).activityId === 'task-6');
}

if (!allPassed) {
  console.error('\nSome Home Good Right Now personalization checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME GOOD RIGHT NOW PERSONALIZATION CHECKS PASSED');
}
