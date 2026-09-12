/**
 * Behavior-aware Day Builder Duration V1: PURE-LOGIC regression suite for
 * apps/web/lib/dayBuilderOrchestrator.ts's own duration resolution and
 * raw-intent discovery -- `durationMinutesFor` and
 * `discoverDayBuilderIntentionCandidates`, both pure/synchronous, neither
 * touching a DB. Fills the naming gap this repo's own convention already
 * uses everywhere else (dailyGuidanceOrchestrator.test.ts/
 * dailyGuidanceOrchestratorDb.test.ts, behavioralAffinity.test.ts/
 * behavioralAffinityDb.test.ts) -- dayBuilderOrchestrator.ts previously had
 * only a live-DB test file (dayBuilderDb.test.ts); everything genuinely
 * pure now lives here instead.
 *
 * A SEPARATE file, test/dayBuilderDb.test.ts, covers the full
 * `buildIntentionalDaySuggestions` end-to-end flow (which needs a real
 * database for `listSavedPeople`/`listDayBuilderDismissals` once raw
 * intent exists) and now also covers the live wiring of behavioral
 * duration into FIND/save.
 */
import { durationMinutesFor, discoverDayBuilderIntentionCandidates } from '../apps/web/lib/dayBuilderOrchestrator';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { User } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24'; // a Monday -- no weekend-only search branches involved
const NOW = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
const MINUTE_OF_DAY = 8 * 60;

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-1',
    email: 'test@example.com',
    cityName: 'Chennai',
    latitude: 13.0827,
    longitude: 80.2707,
    timezone: TZ,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    birthDate: new Date('1990-06-15T00:00:00.000Z'),
    birthTime: '08:30',
    birthCityName: 'Chennai',
    birthLatitude: 13.0827,
    birthLongitude: 80.2707,
    birthTimezone: TZ,
    remindersEnabled: true,
    reminderLeadMinutes: 30,
    dayBuilderEnabled: true,
    dayBuilderMutedGroups: [],
    dayBuilderPriorities: [],
    dayBuilderPriorityPersonIds: [],
    dayBuilderPrioritiesPromptDismissed: false,
    ...overrides,
  };
}

function emptyAgenda(now: Date = NOW) {
  return buildDailyAgenda({ now, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
}

// ============================================================
// durationMinutesFor (Behavior-aware Day Builder Duration V1 / Explicit
// Duration Preferences Controls + Consumption V1's own precedence chain:
// preferred > behavioral > static default > suggestedDurations[0] > 45)
//
// SIGNATURE NOTE: durationMinutesFor(activityId, preferredDurationByActivityId?,
// behavioralDurationByActivityId?) -- every call below that exercises the
// BEHAVIORAL slot explicitly passes `undefined` for the (now second)
// preferred slot, so these calls keep testing exactly what they always
// tested (behavioral precedence over the static chain), unaffected by the
// new leading parameter.
// ============================================================
{
  // 'workout' has no defaultDurationMinutes, suggestedDurations: [30, 45, 60]
  // (packages/recommendation/src/activityDefinitions.ts) -- static
  // fallback is 30.
  check('RESOLVER: behavioral signal present -> behavioral wins over static default', durationMinutesFor('workout', undefined, { workout: 45 }) === 45);
  check('RESOLVER: no behavioral map at all -> exact current static resolver result (30, suggestedDurations[0])', durationMinutesFor('workout') === 30);
  check('RESOLVER: behavioral map present but no entry for this activity -> falls through to static default', durationMinutesFor('workout', undefined, { 'coffee-tea': 30 }) === 30);

  // 'coffee-tea' and 'birthday-party' are both SOCIAL-family, with
  // different static defaults (30 vs 120) -- each activity must resolve
  // its own behavioral entry independently, never blended.
  const sameFamilyMap = { 'coffee-tea': 30, 'birthday-party': 150 };
  check('RESOLVER (same family, different activities): coffee-tea uses its own behavioral value (30)', durationMinutesFor('coffee-tea', undefined, sameFamilyMap) === 30);
  check('RESOLVER (same family, different activities): birthday-party uses its OWN behavioral value (150), never coffee-tea\'s', durationMinutesFor('birthday-party', undefined, sameFamilyMap) === 150);

  // Unknown activityId -> getActivityDefinition returns undefined ->
  // static chain falls all the way through to the final 45 fallback.
  check('RESOLVER: unknown activityId, no behavioral entry -> final 45 fallback', durationMinutesFor('not-a-real-catalog-activity-id') === 45);
  check('RESOLVER: unknown activityId, WITH a behavioral entry for it -> behavioral still wins (resolver never validates the id itself)', durationMinutesFor('not-a-real-catalog-activity-id', undefined, { 'not-a-real-catalog-activity-id': 20 }) === 20);

  // REVIEW COVERAGE STRENGTHENING (pre-PR review): the cases above all
  // exercise the suggestedDurations[0] fallback branch -- 'tea-break' is a
  // real catalog activity whose experience.defaultDurationMinutes (10) is
  // itself set, proving the OTHER static fallback branch (defaultDurationMinutes,
  // which wins over suggestedDurations[0] in the ?? chain) independently.
  check('RESOLVER: no behavioral map -> exact current static resolver result via defaultDurationMinutes (10), the OTHER static fallback branch', durationMinutesFor('tea-break') === 10);
  check('RESOLVER: behavioral signal present for an activity with a defaultDurationMinutes -> behavioral still wins over that branch too', durationMinutesFor('tea-break', undefined, { 'tea-break': 25 }) === 25);

  // ==========================================================
  // Explicit Duration Preferences Controls + Consumption V1 -- the NEW
  // preferred-duration slot's own precedence, added directly (not merely
  // reproven indirectly via the behavioral cases above).
  // ==========================================================

  // A. preferred beats behavioral (both supplied for the same activity).
  check('RESOLVER: preferred beats behavioral when both are supplied', durationMinutesFor('workout', { workout: 60 }, { workout: 45 }) === 60);

  // B. behavioral beats catalog default (already proven above; restated
  // here for the item-by-item precedence-chain record this feature's own
  // implementation ticket asks for).
  check('RESOLVER: behavioral beats catalog default (tea-break, no preferred entry)', durationMinutesFor('tea-break', undefined, { 'tea-break': 25 }) === 25);

  // C. catalog default beats suggestedDurations[0] (already proven above
  // via tea-break with no maps at all; restated for the record).
  check('RESOLVER: catalog default beats suggestedDurations[0] (tea-break, no maps at all)', durationMinutesFor('tea-break') === 10);

  // D. suggestedDurations[0] beats the final 45 (already proven above via
  // workout with no maps; restated for the record).
  check('RESOLVER: suggestedDurations[0] beats the final 45 fallback (workout, no maps at all)', durationMinutesFor('workout') === 30);

  // E. two same-family activities retain distinct PREFERRED durations
  // (never collapsed to a family-level value) -- coffee-tea/birthday-party
  // are both SOCIAL.
  const samePreferredFamilyMap = { 'coffee-tea': 20, 'birthday-party': 180 };
  check('RESOLVER: preferred duration is activity-level, not family-level -- coffee-tea (SOCIAL) uses its own preferred value (20)', durationMinutesFor('coffee-tea', samePreferredFamilyMap) === 20);
  check('RESOLVER: preferred duration is activity-level, not family-level -- birthday-party (SAME SOCIAL family) uses its OWN preferred value (180), never coffee-tea\'s', durationMinutesFor('birthday-party', samePreferredFamilyMap) === 180);

  // F. no preferred entry for THIS activity (map supplied, but sparse) ->
  // restores behavioral, exactly as if no preferred map existed at all.
  check('RESOLVER: preferred map supplied but has no entry for this activity -> falls through to behavioral', durationMinutesFor('workout', { 'coffee-tea': 20 }, { workout: 45 }) === 45);
  check('RESOLVER: preferred map supplied but has no entry for this activity, and no behavioral either -> falls through to static default', durationMinutesFor('workout', { 'coffee-tea': 20 }) === 30);

  // Preferred + unknown activityId: same "resolver never validates the id
  // itself" contract as the pre-existing behavioral case above.
  check('RESOLVER: unknown activityId, WITH a preferred entry for it -> preferred still wins', durationMinutesFor('not-a-real-catalog-activity-id', { 'not-a-real-catalog-activity-id': 99 }) === 99);
}

// ============================================================
// discoverDayBuilderIntentionCandidates -- the cheap, pre-behavioral-fetch
// raw-intent gate.
// ============================================================
{
  const openUser = buildUser();
  const openResult = discoverDayBuilderIntentionCandidates(openUser, emptyAgenda(), MINUTE_OF_DAY);
  check('DISCOVERY: a wide-open day for an enabled user finds raw intention candidates', openResult.intentionCandidates.length > 0);
  check('DISCOVERY: dayProfile is populated when intent is found', openResult.dayProfile !== undefined);

  const disabledUser = buildUser({ dayBuilderEnabled: false });
  const disabledResult = discoverDayBuilderIntentionCandidates(disabledUser, emptyAgenda(), MINUTE_OF_DAY);
  check('DISCOVERY: dayBuilderEnabled=false -> zero raw intent, computed with no wasted work', disabledResult.intentionCandidates.length === 0);
  check('DISCOVERY: disabled user -> dayProfile is NOT computed at all (brief section 6\'s own "nothing computed" short-circuit, preserved exactly)', disabledResult.dayProfile === undefined);

  const nightNow = new Date('2026-08-24T16:30:00.000Z'); // 10:00 PM IST
  const nightResult = discoverDayBuilderIntentionCandidates(buildUser(), emptyAgenda(nightNow), 22 * 60);
  check('DISCOVERY: NIGHT phase -> zero raw intent, dayProfile not computed', nightResult.intentionCandidates.length === 0 && nightResult.dayProfile === undefined);

  const allMutedUser = buildUser({ dayBuilderMutedGroups: ['WORK', 'SELF', 'ENJOYMENT', 'RELATIONSHIPS', 'FAMILY', 'SOCIAL'] as User['dayBuilderMutedGroups'] });
  const allMutedResult = discoverDayBuilderIntentionCandidates(allMutedUser, emptyAgenda(), MINUTE_OF_DAY);
  check('DISCOVERY: every group muted -> zero raw intent candidates (dayProfile IS still computed here -- muting is resolved inside selectIntentionCandidates, past the disabled/NIGHT short-circuit)', allMutedResult.intentionCandidates.length === 0 && allMutedResult.dayProfile !== undefined);
}

if (!allPassed) {
  console.error('\nSome Behavior-aware Day Builder Duration V1 (pure-logic) checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL BEHAVIOR-AWARE DAY BUILDER DURATION V1 (PURE-LOGIC) CHECKS PASSED');
}
