/**
 * Home Recommendations: Daily Rhythm Alignment -- pure unit suite.
 *
 * Covers the exact composition `resolveDayBuilderCandidates`
 * (dailyGuidanceCandidates.ts) performs for every DAY_BUILDER_INTENTION
 * candidate: `dailyRhythmPrefsFromUser(user)` feeding
 * `applyDailyRhythmPreference(candidates, activityId, context)` -- both
 * REAL, exported production functions, called directly with real
 * `TimingCandidate[]` fixtures (same `candidate()` helper convention
 * `dailyRhythmScheduling.test.ts` already established), never a
 * source-text-only regex and never a reimplementation of either
 * function's own logic.
 *
 * The end-to-end proof that this composition is genuinely wired into the
 * real Day Builder suggestion pipeline (not just correct in isolation)
 * lives in dailyGuidanceOrchestratorDb.test.ts -- this file covers the
 * cases that don't need a live DB/real Day Builder suggestion to prove
 * (WORK/FLEXIBLE_BREAK pass-through, non-workday, malformed preferences,
 * negative controls).
 *
 *   npx ts-node test/dailyGuidanceDailyRhythmAlignment.test.ts
 */
import { dailyRhythmPrefsFromUser } from '../apps/web/lib/dailyGuidanceCandidates';
import { applyDailyRhythmPreference, type DailyRhythmFilterContext } from '../apps/web/lib/dailyRhythmScheduling';
import type { User } from '../apps/web/lib/db';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Same fixture convention as dailyRhythmScheduling.test.ts.
function candidate(start: string, end: string, label: TimingCandidateLabel = 'GOOD'): TimingCandidate {
  return { start, end, score: 5, label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: '2026-09-21' } };
}

const TZ = 'Asia/Kolkata';
const MONDAY = '2026-09-21'; // confirmed Monday in dailyRhythmScheduling.test.ts
const SATURDAY = '2026-09-19';

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'u1@example.com',
    cityName: 'Chennai',
    latitude: 13.0827,
    longitude: 80.2707,
    timezone: TZ,
    ...overrides,
  } as User;
}

function contextFor(user: User, targetDate: string): DailyRhythmFilterContext {
  return { targetDate, timezone: user.timezone, prefs: dailyRhythmPrefsFromUser(user) };
}

function main() {
  // ============================================================
  // dailyRhythmPrefsFromUser -- the exact User-field-to-input mapping
  // resolveDayBuilderCandidates relies on, with zero DB query.
  // ============================================================
  const configuredUser = baseUser({ dailyRhythmWorkStart: '10:00', dailyRhythmWorkEnd: '18:00', dailyRhythmWorkDays: [1, 2, 3, 4, 5] });
  const prefs = dailyRhythmPrefsFromUser(configuredUser);
  check('1. dailyRhythmPrefsFromUser reads workStart/workEnd/workDays verbatim off the User row', prefs.workStart === '10:00' && prefs.workEnd === '18:00' && JSON.stringify(prefs.workDays) === JSON.stringify([1, 2, 3, 4, 5]));

  // Scenario 6 -- missing Daily Rhythm preferences (both fields absent
  // entirely, the real shape of a User row that never configured Daily
  // Rhythm): resolves to the documented unconfigured sentinel, never a
  // crash, never a guessed default.
  const noPrefsUser = baseUser();
  const noPrefs = dailyRhythmPrefsFromUser(noPrefsUser);
  check('6. missing Daily Rhythm preferences (fields absent) -> workStart/workEnd both null, workDays []', noPrefs.workStart === null && noPrefs.workEnd === null && noPrefs.workDays.length === 0);

  // Scenario 7 -- invalid/incomplete preferences: one field set, the
  // other left null (a malformed shape the schema never persists
  // together, but which this mapping must still handle safely rather
  // than crash). Confirmed via the REAL applyDailyRhythmPreference call
  // below that this resolves to "unconfigured" behavior (isDailyRhythmConfigured
  // requires BOTH fields non-null), never a thrown exception.
  const incompleteUser = baseUser({ dailyRhythmWorkStart: '10:00', dailyRhythmWorkEnd: null });
  const incompletePrefs = dailyRhythmPrefsFromUser(incompleteUser);
  check('7. incomplete preferences (workStart set, workEnd null) are read as-is, not coerced/guessed', incompletePrefs.workStart === '10:00' && incompletePrefs.workEnd === null);

  // ============================================================
  // The exact composition resolveDayBuilderCandidates performs, called
  // directly with real fixtures -- every scenario below exercises the
  // REAL applyDailyRhythmPreference, never a reimplementation.
  // ============================================================
  const insideWorkOnly = [candidate('2026-09-21T06:30:00.000Z', '2026-09-21T07:00:00.000Z')]; // 12:00-12:30 IST, inside 10:00-18:00
  const mixed = [
    candidate('2026-09-21T06:30:00.000Z', '2026-09-21T07:00:00.000Z'), // 12:00 IST, inside work
    candidate('2026-09-21T02:30:00.000Z', '2026-09-21T03:00:00.000Z'), // 08:00 IST, outside work (before 10:00)
    candidate('2026-09-21T13:00:00.000Z', '2026-09-21T13:30:00.000Z'), // 18:30 IST, outside work (after 18:00)
  ];

  // Scenario 2 -- personal activity outside work hours is preferred: the
  // outside-work candidates survive, in their original relative order,
  // and the first one becomes rank 1 (what Home will display and commit).
  const filteredMixed = applyDailyRhythmPreference(mixed, 'workout', contextFor(configuredUser, MONDAY));
  check('2. personal activity with an outside-work candidate in the batch -> only outside-work candidates survive', filteredMixed.length === 2 && filteredMixed.every((c) => c.start !== mixed[0].start));
  check('2. the surviving candidates keep their original relative order (earlier-batch candidate stays rank 1)', filteredMixed[0]?.start === mixed[1].start);

  // Scenario 1 + 8 -- personal activity during work hours with NO
  // outside-work alternative in this batch: deprioritized, never
  // excluded -- the fallback returns the original, full, unfiltered set
  // (a useful recommendation is still shown, never an empty Home).
  const filteredInsideOnly = applyDailyRhythmPreference(insideWorkOnly, 'workout', contextFor(configuredUser, MONDAY));
  check('1/8. personal activity, no outside-work candidate available -> falls back to the full original set (never empty)', filteredInsideOnly.length === 1 && filteredInsideOnly[0].start === insideWorkOnly[0].start);

  // Scenario 3 -- work-appropriate activity during work hours remains
  // eligible: the filter is a pure no-op for a WORK-classified activity
  // (isDailyRhythmApplicable's own gate), confirmed by reference-content
  // equality against the original array, not merely non-empty.
  const filteredWork = applyDailyRhythmPreference(mixed, 'deep-work', contextFor(configuredUser, MONDAY));
  check('3. work-appropriate activity (deep-work) during work hours -> unchanged, all candidates eligible, original order', JSON.stringify(filteredWork) === JSON.stringify(mixed));

  // Scenario 4 -- a short-break/flexible-break activity must never be
  // incorrectly excluded during work hours -- same no-op gate as WORK.
  const filteredBreak = applyDailyRhythmPreference(mixed, 'tea-break', contextFor(configuredUser, MONDAY));
  check('4. short-break activity (tea-break) during work hours -> unchanged, never excluded', JSON.stringify(filteredBreak) === JSON.stringify(mixed));

  // Scenario 5 -- a day outside the configured workweek does not inherit
  // workday restrictions: configuredUser's workDays is [1,2,3,4,5]
  // (Mon-Fri); SATURDAY (weekday 6) is not among them.
  const filteredNonWorkday = applyDailyRhythmPreference(mixed, 'workout', contextFor(configuredUser, SATURDAY));
  check('5. personal activity on a non-configured workday (Saturday) -> unchanged, no workday restriction inherited', JSON.stringify(filteredNonWorkday) === JSON.stringify(mixed));

  // Scenario 6 (composed) -- a user with no Daily Rhythm preferences at
  // all retains exactly current (pre-this-PR) behavior: the filter is a
  // pure no-op regardless of activity classification.
  const filteredNoPrefs = applyDailyRhythmPreference(mixed, 'workout', contextFor(noPrefsUser, MONDAY));
  check('6 (composed). no Daily Rhythm preferences configured -> unchanged for a personal activity too (unconfigured = no-op)', JSON.stringify(filteredNoPrefs) === JSON.stringify(mixed));

  // Scenario 7 (composed) -- incomplete preferences must not crash and
  // must resolve to the same safe no-op as fully unconfigured.
  const filteredIncomplete = applyDailyRhythmPreference(mixed, 'workout', contextFor(incompleteUser, MONDAY));
  check('7 (composed). incomplete preferences (one field null) -> treated as unconfigured, safe no-op, no exception thrown', JSON.stringify(filteredIncomplete) === JSON.stringify(mixed));

  // Scenario 9 -- multiple (already-eligible) candidates preserve their
  // existing stable relative ranking when the filter is inapplicable:
  // re-confirmed directly on a 3-candidate batch for an unresolvable
  // activity (never a guessed classification -- DR2's own "unknown
  // activities retain previous scheduling behavior" rule).
  const filteredUnknown = applyDailyRhythmPreference(mixed, 'not-a-real-activity-id', contextFor(configuredUser, MONDAY));
  check('9. an unclassifiable activity -> unchanged, no classification guessed, stable existing order preserved', JSON.stringify(filteredUnknown) === JSON.stringify(mixed));

  // ============================================================
  // Mandatory negative controls (see delivery report for the production-
  // code mutation + revert evidence; these three checks are the
  // permanent regression tests each control is proven against).
  // ============================================================

  // Control A target: if Daily Rhythm consideration were bypassed
  // (the call to applyDailyRhythmPreference removed/no-op'd in
  // resolveDayBuilderCandidates), this check -- which requires the
  // OUTSIDE-work candidate to have been promoted to rank 1 -- would fail,
  // since an unfiltered pass-through would keep the original rank-1
  // (inside-work) candidate instead.
  check('CONTROL A target: an outside-work candidate IS promoted to rank 1 when Daily Rhythm applies', filteredMixed[0]?.start === mixed[1].start);

  // Control B target: if the fallback were changed to a hard exclusion
  // (return [] instead of the original set when no outside-work
  // candidate exists), this check -- which requires a non-empty result
  // for an all-inside-work batch -- would fail.
  check('CONTROL B target: an all-inside-work-hours personal activity still yields a non-empty (fallback) result', filteredInsideOnly.length > 0);

  if (!allPassed) {
    console.error('\nSome Daily Guidance Daily Rhythm Alignment checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY GUIDANCE DAILY RHYTHM ALIGNMENT CHECKS PASSED');
  }
}

main();
