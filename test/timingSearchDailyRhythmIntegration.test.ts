/**
 * Daily Rhythm V1 PR DR4-B -- real-engine end-to-end suite for
 * runTimingSearchWithDailyRhythm (apps/web/lib/timingSearchDailyRhythm.ts),
 * exercising the REAL runTimingSearch/evaluateTimingCandidate (real
 * Panchang/Muhurta scoring), same "real engine, real dates, no mocking"
 * convention test/timingSearchApi.test.ts already uses for this exact
 * API surface. Complements timingSearchDailyRhythm.test.ts's own pure,
 * hand-built-fixture unit suite (which covers the filter/annotation
 * logic itself in isolation) with proof that the REAL request ->
 * runTimingSearchWithDailyRhythm -> response pipeline composes
 * correctly end-to-end.
 *
 * Deliberately INVARIANT-based, not exact-time-based: this file never
 * asserts "the engine will pick time X on date Y" (the DR3 completion
 * report's own real-engine evidence script found real divergence on
 * only 3 of 9 sampled dates -- hardcoding one would be fragile against
 * ephemeris/catalog drift). Instead it asserts properties that MUST
 * hold regardless of which exact candidate the real engine ranks
 * highest: bounded candidate count, a "preferred" label only ever on a
 * genuinely outside-work candidate, explicit selections never altered.
 *
 *   npx ts-node test/timingSearchDailyRhythmIntegration.test.ts
 */
import { buildTimingSearchRequest } from '../apps/web/lib/timingSearchRequest';
import { runTimingSearchWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import type { DailyRhythmPreferencesInput } from '../apps/web/lib/dailyRhythmScheduling';
import { resolveTzOffsetMinutes } from '../apps/web/lib/timezone';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// New York, real coordinates -- matches the ticket's own reference
// scenario timezone. 2026-10-19 is a real Monday (confirmed against the
// 2026-10-15 Thursday "today" this whole DR4 line has been run against).
const NY_CONTEXT = (now: Date): DailyAssistantContext => ({
  now,
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York',
  tzOffsetMinutes: resolveTzOffsetMinutes('America/New_York', now),
});

const CONFIGURED: DailyRhythmPreferencesInput = { workStart: '10:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] };
const UNCONFIGURED: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };

function localHourMinute(iso: string, timezone: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

const WORK_START_MIN = 10 * 60;
const WORK_END_MIN = 18 * 60;

function main() {
  // ============================================================
  // 1. Get fitter -> Go for a run (FIND, invariant-based).
  // ============================================================
  {
    const now = new Date(Date.UTC(2026, 9, 19, 4, 0, 0)); // 2026-10-19T04:00Z = 12:00 AM EDT Monday
    const context = NY_CONTEXT(now);
    const validated = buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', timePreference: 'ANY', limit: 3 }, context);
    check('1. a valid FIND request for workout is accepted', validated.ok === true);
    if (validated.ok) {
      const result = runTimingSearchWithDailyRhythm(validated.request, 'America/New_York', CONFIGURED);
      check('1b. FIND never returns more than the real client-requested limit (3), even though the search itself may have been widened internally', result.candidates.length <= 3);
      const notes = result.dailyRhythmNotes ?? {};
      const preferredCandidates = result.candidates.filter((c) => notes[c.start] === 'Fits your preferred personal time.');
      check(
        '1c. every candidate labeled "preferred" is genuinely, independently verified to fall OUTSIDE the configured 10am-6pm window (start AND end both clear of it)',
        preferredCandidates.every((c) => {
          const startMin = localHourMinute(c.start, 'America/New_York');
          const endMin = localHourMinute(c.end, 'America/New_York');
          // half-open overlap would be startMin < WORK_END_MIN && WORK_START_MIN < endMin -- assert the NEGATION holds.
          return !(startMin < WORK_END_MIN && WORK_START_MIN < endMin);
        })
      );
      const fallbackCandidates = result.candidates.filter((c) => notes[c.start] === 'No preferred outside-work option was found in the available results.');
      check(
        '1d. every candidate labeled "fallback" is genuinely, independently verified to OVERLAP the configured work window (confirms the fallback text is only ever shown when actually true)',
        fallbackCandidates.every((c) => {
          const startMin = localHourMinute(c.start, 'America/New_York');
          const endMin = localHourMinute(c.end, 'America/New_York');
          return startMin < WORK_END_MIN && WORK_START_MIN < endMin;
        })
      );
      check('1e. "preferred" and "fallback" notes never BOTH appear in the same result (the filter-with-fallback contract is exclusive: outside-work candidates win outright, or the whole set falls back)', preferredCandidates.length === 0 || fallbackCandidates.length === 0);
    }
  }

  // ============================================================
  // 9/16. Weekends/non-workdays + bounded search together: a Saturday
  // FIND for the same activity must carry no Daily Rhythm notes at all.
  // ============================================================
  {
    const now = new Date(Date.UTC(2026, 9, 24, 4, 0, 0)); // 2026-10-24 Saturday, 12:00 AM EDT
    const context = NY_CONTEXT(now);
    const validated = buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', timePreference: 'ANY', limit: 3 }, context);
    if (validated.ok) {
      const result = runTimingSearchWithDailyRhythm(validated.request, 'America/New_York', CONFIGURED);
      check('9. a Saturday FIND search (non-workday) carries no dailyRhythmNotes field at all', result.dailyRhythmNotes === undefined);
    }
  }

  // ============================================================
  // 10. Explicit time selection (CHECK) -- never silently moved, exact
  // ISO preserved, annotated (not altered) whether it overlaps or not.
  // ============================================================
  {
    const now = new Date(Date.UTC(2026, 9, 19, 4, 0, 0));
    const context = NY_CONTEXT(now);
    const explicitInsideWork = '2026-10-19T18:00:00.000Z'; // 2:00 PM EDT -- inside 10-6
    const validated = buildTimingSearchRequest({ mode: 'CHECK', activityId: 'workout', durationMinutes: 30, candidateStart: explicitInsideWork, checkNearbyWindowMinutes: 0 }, context);
    check('10. a valid CHECK request is accepted', validated.ok === true);
    if (validated.ok) {
      const result = runTimingSearchWithDailyRhythm(validated.request, 'America/New_York', CONFIGURED);
      check('10b. the requested candidate\'s own start is EXACTLY the instant requested -- never moved', result.requestedCandidate?.start === explicitInsideWork);
      check('10c. an explicitly-checked time that overlaps work hours gets the explicit-selection text, never the FIND fallback text', result.dailyRhythmNotes?.[explicitInsideWork] === 'This time overlaps your usual working hours.');
    }

    const explicitOutsideWork = '2026-10-19T10:30:00.000Z'; // 6:30 AM EDT -- outside 10-6
    const validatedOutside = buildTimingSearchRequest({ mode: 'CHECK', activityId: 'workout', durationMinutes: 30, candidateStart: explicitOutsideWork, checkNearbyWindowMinutes: 0 }, context);
    if (validatedOutside.ok) {
      const result = runTimingSearchWithDailyRhythm(validatedOutside.request, 'America/New_York', CONFIGURED);
      check('10d. an explicitly-checked time OUTSIDE work hours still gets the positive "fits your preferred personal time" note (a gentle confirmation, never blocking)', result.dailyRhythmNotes?.[explicitOutsideWork] === 'Fits your preferred personal time.');
      check('10e. the requested candidate is STILL exactly the instant requested, even when Daily Rhythm has something positive to say about it', result.requestedCandidate?.start === explicitOutsideWork);
    }
  }

  // ============================================================
  // 11. Time-of-day restriction (FIND, timePreference) -- Daily Rhythm
  // composes with, never overrides, the user's own time-of-day pick:
  // MORNING and EVENING requests for the identical activity/day must
  // never return the same clock time (proving timePreference still
  // reaches the real engine through this wrapper, unchanged).
  // ============================================================
  {
    const now = new Date(Date.UTC(2026, 9, 19, 4, 0, 0));
    const context = NY_CONTEXT(now);
    const morningReq = buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', timePreference: 'MORNING', limit: 3 }, context);
    const eveningReq = buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', timePreference: 'EVENING', limit: 3 }, context);
    if (morningReq.ok && eveningReq.ok) {
      const morningResult = runTimingSearchWithDailyRhythm(morningReq.request, 'America/New_York', CONFIGURED);
      const eveningResult = runTimingSearchWithDailyRhythm(eveningReq.request, 'America/New_York', CONFIGURED);
      const morningStarts = new Set(morningResult.candidates.map((c) => c.start));
      const eveningStarts = new Set(eveningResult.candidates.map((c) => c.start));
      const overlap = [...morningStarts].some((s) => eveningStarts.has(s));
      check('11. MORNING and EVENING requests for the identical activity/date return disjoint candidate times (the time-of-day picker still reaches the real engine unchanged through this wrapper)', !overlap && morningResult.candidates.length > 0 && eveningResult.candidates.length > 0);
    }
  }

  // ============================================================
  // 13. Timezone / DST boundary -- 2026-11-01 is the real DST-end date
  // for America/New_York (clocks fall back at 2am). A search on
  // 2026-11-02 (the Monday immediately after) must still correctly
  // resolve the civil date/work window in the NEW (EST, UTC-5) offset,
  // not the stale EDT (UTC-4) one.
  // ============================================================
  {
    const now = new Date(Date.UTC(2026, 10, 2, 5, 0, 0)); // 2026-11-02T05:00Z = 12:00 AM EST Monday (UTC-5, post-DST)
    const context = NY_CONTEXT(now);
    const validated = buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', timePreference: 'ANY', limit: 3 }, context);
    if (validated.ok) {
      const result = runTimingSearchWithDailyRhythm(validated.request, 'America/New_York', CONFIGURED);
      const notes = result.dailyRhythmNotes ?? {};
      const preferredCandidates = result.candidates.filter((c) => notes[c.start] === 'Fits your preferred personal time.');
      check(
        '13. post-DST (EST, UTC-5): a "preferred" candidate is still correctly verified outside 10am-6pm using the NEW offset, confirming date/overlap derivation tracks the real DST transition rather than a stale UTC-4 assumption',
        preferredCandidates.every((c) => {
          const startMin = localHourMinute(c.start, 'America/New_York');
          const endMin = localHourMinute(c.end, 'America/New_York');
          return !(startMin < WORK_END_MIN && WORK_START_MIN < endMin);
        })
      );
    }
  }

  // ============================================================
  // 18. Existing Find a Time behavior without Daily Rhythm -- the
  // response carries NO dailyRhythmNotes field at all (not even an
  // empty object) for an unconfigured user, confirming the wire shape
  // is byte-identical to pre-DR4-B for every user who never set this up.
  // ============================================================
  {
    const now = new Date(Date.UTC(2026, 9, 19, 4, 0, 0));
    const context = NY_CONTEXT(now);
    const validated = buildTimingSearchRequest({ mode: 'FIND', activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', timePreference: 'ANY', limit: 3 }, context);
    if (validated.ok) {
      const result = runTimingSearchWithDailyRhythm(validated.request, 'America/New_York', UNCONFIGURED);
      check('18. an unconfigured user\'s FIND response has NO dailyRhythmNotes key at all', !('dailyRhythmNotes' in result));
      check('18b. an unconfigured user still gets up to the real requested limit of candidates, unaffected', result.candidates.length <= 3 && result.candidates.length > 0);
    }

    const checkValidated = buildTimingSearchRequest({ mode: 'CHECK', activityId: 'workout', durationMinutes: 30, candidateStart: '2026-10-19T18:00:00.000Z', checkNearbyWindowMinutes: 0 }, context);
    if (checkValidated.ok) {
      const result = runTimingSearchWithDailyRhythm(checkValidated.request, 'America/New_York', UNCONFIGURED);
      check('18c. an unconfigured user\'s CHECK response also has no dailyRhythmNotes key', !('dailyRhythmNotes' in result));
    }
  }

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Find-a-Time (DR4-B) integration checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM FIND-A-TIME (DR4-B) INTEGRATION CHECKS PASSED');
  }
}

main();
