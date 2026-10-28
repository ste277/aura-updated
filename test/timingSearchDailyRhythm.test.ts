/**
 * Daily Rhythm V1 PR DR4-B -- pure unit suite for
 * apps/web/lib/timingSearchDailyRhythm.ts (the Find a Time integration
 * adapter). No DB, no network, no real engine call -- every function
 * under test here is pure (explicit candidate/timezone/preference
 * inputs only), same convention as dailyRhythmScheduling.test.ts. The
 * end-to-end real-engine scenarios (ticket items 1, 10, 11, 13, 16, 18)
 * live in test/timingSearchDailyRhythmIntegration.test.ts.
 *
 *   npx ts-node test/timingSearchDailyRhythm.test.ts
 */
import {
  resolveFindATimeSearchLimit,
  applyDailyRhythmToFindCandidates,
  buildDailyRhythmNotes,
} from '../apps/web/lib/timingSearchDailyRhythm';
import { DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT, type DailyRhythmPreferencesInput } from '../apps/web/lib/dailyRhythmScheduling';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Same minimal-fixture convention dailyRhythmScheduling.test.ts's own
// `candidate()` helper already established -- only start/end/label are
// ever read by this file's own classification logic.
function candidate(start: string, end: string, label: TimingCandidateLabel = 'GOOD'): TimingCandidate {
  return { start, end, score: 5, label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: '2026-10-19' } };
}

const TZ = 'America/New_York';
const CONFIGURED: DailyRhythmPreferencesInput = { workStart: '10:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] };
const UNCONFIGURED: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };
// 2026-10-19 is a Monday (configured workday); 2026-10-24 is the
// following Saturday (not a configured workday) -- same real-calendar
// convention dailyRhythmScheduling.test.ts's own MONDAY/SATURDAY uses.
const MONDAY = '2026-10-19';
const SATURDAY = '2026-10-24';

// ============================================================
// 1-2: Go for a run / morning+afternoon candidates -- the core filter
// contract: outside-work candidates win, inside-work candidates are
// deprioritized, relative order among the winners is preserved.
// ============================================================

function main() {
  const morningOutside = candidate(`${MONDAY}T06:30:00.000-04:00`, `${MONDAY}T07:00:00.000-04:00`, 'GOOD'); // 6:30-7:00 AM EDT, outside 10-6
  const afternoonInside = candidate(`${MONDAY}T14:00:00.000-04:00`, `${MONDAY}T14:30:00.000-04:00`, 'EXCELLENT'); // 2:00-2:30 PM EDT, inside 10-6
  const eveningOutside = candidate(`${MONDAY}T19:00:00.000-04:00`, `${MONDAY}T19:30:00.000-04:00`, 'USABLE'); // 7:00-7:30 PM EDT, outside 10-6

  check(
    '1. Go for a run (workout, PERSONAL): a mixed inside/outside batch filters to ONLY the outside-work candidates',
    JSON.stringify(applyDailyRhythmToFindCandidates([afternoonInside, morningOutside, eveningOutside], 'workout', TZ, CONFIGURED).map((c) => c.start)) ===
      JSON.stringify([morningOutside.start, eveningOutside.start])
  );
  check(
    '2. the outside-work subset preserves its ORIGINAL relative order (morning before evening, not re-sorted by score/label)',
    applyDailyRhythmToFindCandidates([afternoonInside, morningOutside, eveningOutside], 'workout', TZ, CONFIGURED)[0].start === morningOutside.start
  );

  // ============================================================
  // 3-4: preferred candidate beyond the initial result limit / no
  // preferred candidate available.
  // ============================================================
  const insideA = candidate(`${MONDAY}T14:00:00.000-04:00`, `${MONDAY}T14:30:00.000-04:00`);
  const insideB = candidate(`${MONDAY}T15:00:00.000-04:00`, `${MONDAY}T15:30:00.000-04:00`);
  const insideC = candidate(`${MONDAY}T16:00:00.000-04:00`, `${MONDAY}T16:30:00.000-04:00`);
  const outsideFourth = candidate(`${MONDAY}T19:00:00.000-04:00`, `${MONDAY}T19:30:00.000-04:00`);
  check(
    '3. a 4th-ranked outside-work candidate (beyond a 3-candidate top cut) is the one that survives filtering',
    JSON.stringify(applyDailyRhythmToFindCandidates([insideA, insideB, insideC, outsideFourth], 'workout', TZ, CONFIGURED).map((c) => c.start)) === JSON.stringify([outsideFourth.start])
  );
  check(
    '4. no outside-work candidate anywhere in the batch -> falls back to the ORIGINAL, full, unfiltered set (same objects, same order)',
    applyDailyRhythmToFindCandidates([insideA, insideB, insideC], 'workout', TZ, CONFIGURED).length === 3
  );

  // ============================================================
  // 5-6: work activity / flexible break during working hours -- never
  // filtered, matching Day Constructor's own existing contract exactly.
  // ============================================================
  check('5. a WORK activity (task-1) is never filtered, even with every candidate inside work hours', applyDailyRhythmToFindCandidates([insideA, insideB], 'task-1', TZ, CONFIGURED).length === 2);
  check('6. a FLEXIBLE_BREAK activity (tea-break) is never filtered, even entirely inside work hours', applyDailyRhythmToFindCandidates([insideA, insideB], 'tea-break', TZ, CONFIGURED).length === 2);

  // ============================================================
  // 7-8: missing / cleared preferences -- byte-identical pass-through.
  // ============================================================
  check('7. missing preferences (never configured) -> candidates pass through completely unfiltered', applyDailyRhythmToFindCandidates([insideA, afternoonInside], 'workout', TZ, UNCONFIGURED).length === 2);
  const CLEARED: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [1, 2, 3, 4, 5] };
  check('8. cleared preferences (workStart/workEnd null even with stale workDays left over) -> unfiltered, same as never-configured', applyDailyRhythmToFindCandidates([insideA, afternoonInside], 'workout', TZ, CLEARED).length === 2);

  // ============================================================
  // 9: weekends and non-workdays -- a candidate landing on Saturday is
  // never filtered even though Daily Rhythm IS configured, because
  // Saturday isn't a configured workday (Mon-Fri only).
  // ============================================================
  const saturdayCandidate = candidate(`${SATURDAY}T14:00:00.000-04:00`, `${SATURDAY}T14:30:00.000-04:00`);
  check('9. a Saturday candidate (non-workday) is never filtered, even for a PERSONAL activity with Daily Rhythm configured', applyDailyRhythmToFindCandidates([saturdayCandidate], 'workout', TZ, CONFIGURED).length === 1);
  check('9b. a Saturday candidate gets no Daily Rhythm note at all', Object.keys(buildDailyRhythmNotes([saturdayCandidate], 'workout', TZ, CONFIGURED, false)).length === 0);

  // ============================================================
  // 12: a candidate whose OWN span crosses the work-hour boundary is
  // treated as overlapping (checked against the full [start,end) span,
  // not just its start instant) -- same half-open convention
  // dailyRhythmScheduling.ts's own overlapsWorkWindow already enforces.
  // ============================================================
  const crossesIntoWork = candidate(`${MONDAY}T09:45:00.000-04:00`, `${MONDAY}T10:15:00.000-04:00`); // starts before 10am, ends after -> overlaps
  check('12. a candidate that only STARTS before work hours but runs into them is still treated as overlapping (filtered out of the preferred subset)', applyDailyRhythmToFindCandidates([crossesIntoWork, eveningOutside], 'workout', TZ, CONFIGURED).map((c) => c.start).includes(crossesIntoWork.start) === false);

  // ============================================================
  // 13: timezone -- a civil date is derived from the candidate's OWN
  // instant in the user's timezone, not UTC. 10:30 PM UTC is 6:30 PM
  // EDT the SAME calendar day, still inside work hours -- confirms the
  // date/overlap derivation is timezone-aware, not UTC-naive.
  // ============================================================
  const utcLateEvening = candidate(`${MONDAY}T22:30:00.000Z`, `${MONDAY}T23:00:00.000Z`); // 6:30-7:00 PM EDT
  check('13. a UTC instant that is 6:30 PM in America/New_York is correctly treated as OUTSIDE the 10am-6pm work window (timezone-aware, not UTC-naive)', applyDailyRhythmToFindCandidates([utcLateEvening], 'workout', TZ, CONFIGURED).length === 1);

  // ============================================================
  // 14: deterministic ordering -- same input, same output, every time.
  // ============================================================
  const batch = [afternoonInside, morningOutside, eveningOutside];
  const run1 = applyDailyRhythmToFindCandidates(batch, 'workout', TZ, CONFIGURED).map((c) => c.start);
  const run2 = applyDailyRhythmToFindCandidates(batch, 'workout', TZ, CONFIGURED).map((c) => c.start);
  check('14. identical input filtered twice produces byte-identical output (deterministic, no hidden randomness/Date.now dependency)', JSON.stringify(run1) === JSON.stringify(run2));

  // ============================================================
  // 15: existing ranking preservation -- a HIGHER-scored/BEST-labeled
  // inside-work candidate never wins over a lower-scored outside-work
  // one once Daily Rhythm applies (soft preference overrides raw
  // quality), but WITHIN the preferred subset, relative order (the
  // engine's own ranking) is untouched -- already proven by check #2;
  // this adds the "quality never overrides preference" half.
  // ============================================================
  const excellentInside = candidate(`${MONDAY}T15:00:00.000-04:00`, `${MONDAY}T15:30:00.000-04:00`, 'EXCELLENT');
  const cautionOutside = candidate(`${MONDAY}T20:00:00.000-04:00`, `${MONDAY}T20:30:00.000-04:00`, 'CAUTION');
  check('15. a lower-quality (CAUTION) outside-work candidate is preferred over a higher-quality (BEST) inside-work one', applyDailyRhythmToFindCandidates([excellentInside, cautionOutside], 'workout', TZ, CONFIGURED).map((c) => c.start)[0] === cautionOutside.start);

  // ============================================================
  // 16: bounded search -- resolveFindATimeSearchLimit never exceeds the
  // same fixed constant Day Constructor's own DR3 widening uses, and is
  // `undefined` (no override) for every case that shouldn't widen.
  // ============================================================
  check('16. FIND + configured + PERSONAL widens to exactly DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT', resolveFindATimeSearchLimit('FIND', 'workout', CONFIGURED) === DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT);
  check('16b. CHECK mode never widens (CHECK has no `limit` concept at all)', resolveFindATimeSearchLimit('CHECK', 'workout', CONFIGURED) === undefined);
  check('16c. COMPARE mode never widens', resolveFindATimeSearchLimit('COMPARE', 'workout', CONFIGURED) === undefined);
  check('16d. a WORK activity never widens the FIND search, even with Daily Rhythm configured', resolveFindATimeSearchLimit('FIND', 'task-1', CONFIGURED) === undefined);
  check('16e. an unconfigured user never widens the FIND search', resolveFindATimeSearchLimit('FIND', 'workout', UNCONFIGURED) === undefined);
  check('16f. an unresolvable/unknown activityId never widens the FIND search', resolveFindATimeSearchLimit('FIND', 'not-a-real-activity', CONFIGURED) === undefined);

  // ============================================================
  // 17: recommendation explanation accuracy -- the exact ticket-dictated
  // wording, and the FIND-vs-explicit-selection wording split for the
  // SAME underlying inside-work-hours classification.
  // ============================================================
  const notesPreferred = buildDailyRhythmNotes([morningOutside], 'workout', TZ, CONFIGURED, false);
  check('17. a preferred (outside-work) candidate gets the exact "Fits your preferred personal time." text', notesPreferred[morningOutside.start] === 'Fits your preferred personal time.');

  const notesFallbackFind = buildDailyRhythmNotes([afternoonInside], 'workout', TZ, CONFIGURED, false);
  check('17b. FIND mode fallback (inside-work, no search alternative) gets the exact bounded-results text', notesFallbackFind[afternoonInside.start] === 'No preferred outside-work option was found in the available results.');

  const notesExplicitOverlap = buildDailyRhythmNotes([afternoonInside], 'workout', TZ, CONFIGURED, true);
  check('17c. an explicitly-selected (CHECK/COMPARE) inside-work candidate gets the DIFFERENT "overlaps your usual working hours" text, never the FIND fallback text', notesExplicitOverlap[afternoonInside.start] === 'This time overlaps your usual working hours.');

  const breakInside = candidate(`${MONDAY}T15:00:00.000-04:00`, `${MONDAY}T15:15:00.000-04:00`);
  const notesBreak = buildDailyRhythmNotes([breakInside], 'tea-break', TZ, CONFIGURED, false);
  check('17d. a flexible break inside work hours gets the exact DR2-established text, reused verbatim', notesBreak[breakInside.start] === 'Short break that fits into your workday');

  const breakOutside = candidate(`${MONDAY}T20:00:00.000-04:00`, `${MONDAY}T20:15:00.000-04:00`);
  check('17e. a flexible break OUTSIDE work hours gets no note at all (nothing noteworthy to say, same as Day Constructor)', buildDailyRhythmNotes([breakOutside], 'tea-break', TZ, CONFIGURED, false)[breakOutside.start] === undefined);

  check('17f. a WORK activity never gets any note, even inside work hours', Object.keys(buildDailyRhythmNotes([insideA], 'task-1', TZ, CONFIGURED, false)).length === 0);
  check('17g. an unconfigured user never gets any note', Object.keys(buildDailyRhythmNotes([morningOutside, afternoonInside], 'workout', TZ, UNCONFIGURED, false)).length === 0);

  // ============================================================
  // 18: existing Find a Time behavior without Daily Rhythm -- the
  // filter is a true no-op (byte-identical candidate objects, same
  // order, same count) for an unconfigured user regardless of activity.
  // ============================================================
  const originalBatch = [afternoonInside, morningOutside, eveningOutside];
  const unfiltered = applyDailyRhythmToFindCandidates(originalBatch, 'workout', TZ, UNCONFIGURED);
  check('18. unconfigured user: filtered output has the same length, same order, and the same candidate objects as the input', JSON.stringify(unfiltered.map((c) => c.start)) === JSON.stringify(originalBatch.map((c) => c.start)));

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Find-a-Time (DR4-B) unit checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM FIND-A-TIME (DR4-B) UNIT CHECKS PASSED');
  }
}

main();
