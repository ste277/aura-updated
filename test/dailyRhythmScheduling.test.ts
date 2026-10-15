/**
 * Daily Rhythm V1 PR DR2 -- pure unit suite for dailyRhythmScheduling.ts.
 * No DB, no network -- every function under test is pure (explicit
 * date/timezone/preference inputs only), same convention as
 * availabilityContext.test.ts.
 *
 *   npx ts-node test/dailyRhythmScheduling.test.ts
 */
import {
  classifyActivityForDailyRhythm,
  isDailyRhythmConfigured,
  isConfiguredWorkday,
  resolveWorkWindowInstants,
  applyDailyRhythmPreference,
  explainDailyRhythmPlacement,
  type DailyRhythmPreferencesInput,
} from '../apps/web/lib/dailyRhythmScheduling';
import { FULL_ACTIVITY_CATALOG, type ActivityCategory } from '../packages/recommendation/src/personalizedTasks';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function candidate(start: string, end: string, label: TimingCandidateLabel = 'GOOD'): TimingCandidate {
  return { start, end, score: 5, label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: '2026-09-21' } };
}

const CONFIGURED: DailyRhythmPreferencesInput = { workStart: '10:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] };
const UNCONFIGURED: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };
// 2026-09-21 is a Monday (confirmed weekday 1 below); 2026-09-19 is the preceding Saturday.
const MONDAY = '2026-09-21';
const SATURDAY = '2026-09-19';
const TZ = 'Asia/Kolkata';

function main() {
  // ============================================================
  // Classification -- every category covered, no gap, no inference from
  // name alone (see the module's own audit comment for the rationale of
  // each mapping).
  // ============================================================
  check('WORK (task-1) -> WORK', classifyActivityForDailyRhythm('task-1') === 'WORK');
  check('WORK (task-2) -> WORK', classifyActivityForDailyRhythm('task-2') === 'WORK');
  check('FOCUS (task-4) -> WORK', classifyActivityForDailyRhythm('task-4') === 'WORK');
  check('FOCUS (deep-work) -> WORK', classifyActivityForDailyRhythm('deep-work') === 'WORK');
  check('ROUTINE (task-5) -> WORK', classifyActivityForDailyRhythm('task-5') === 'WORK');
  check('WORKOUT (workout) -> PERSONAL', classifyActivityForDailyRhythm('workout') === 'PERSONAL');
  check('SPIRITUAL (meditation) -> PERSONAL', classifyActivityForDailyRhythm('meditation') === 'PERSONAL');
  check('MICRO_BREAK (tea-break) -> FLEXIBLE_BREAK', classifyActivityForDailyRhythm('tea-break') === 'FLEXIBLE_BREAK');
  check('REST (task-6, brief rest) -> FLEXIBLE_BREAK', classifyActivityForDailyRhythm('task-6') === 'FLEXIBLE_BREAK');
  check('REST (task-7, light stretch) -> FLEXIBLE_BREAK', classifyActivityForDailyRhythm('task-7') === 'FLEXIBLE_BREAK');
  check('REST override (quiet-time, 45min unstructured downtime) -> PERSONAL, not the category default', classifyActivityForDailyRhythm('quiet-time') === 'PERSONAL');
  check('SOCIAL (walk-together, a 45min two-person activity, NOT forced into FLEXIBLE_BREAK by name) -> PERSONAL', classifyActivityForDailyRhythm('walk-together') === 'PERSONAL');
  check('LEARNING (learning) -> PERSONAL (DR2\'s own "personal learning" example)', classifyActivityForDailyRhythm('learning') === 'PERSONAL');
  check('RELATIONSHIP (marriage) -> PERSONAL', classifyActivityForDailyRhythm('marriage') === 'PERSONAL');
  check('unresolvable activityId -> null (unknown, retains previous behavior)', classifyActivityForDailyRhythm('not-a-real-activity-id') === null);
  check('undefined activityId -> null', classifyActivityForDailyRhythm(undefined) === null);

  // Every category in the real enum has an explicit mapping entry -- no
  // silent gap that would make classifyActivityForDailyRhythm return
  // `undefined` (a type error) for a real catalog category.
  {
    const allCategories = new Set<ActivityCategory>(FULL_ACTIVITY_CATALOG.map((a) => a.category));
    const unclassifiable = [...allCategories].filter((category) => {
      const sample = FULL_ACTIVITY_CATALOG.find((a) => a.category === category)!;
      return classifyActivityForDailyRhythm(sample.id) === null;
    });
    check('every real catalog category currently in use resolves to a real behavior (no silent gap)', unclassifiable.length === 0);
  }

  // ============================================================
  // Configured / workday checks.
  // ============================================================
  check('both null -> unconfigured', !isDailyRhythmConfigured(UNCONFIGURED));
  check('both set -> configured', isDailyRhythmConfigured(CONFIGURED));
  check('2026-09-21 is a Monday (weekday 1), confirmed via isConfiguredWorkday against [1]', isConfiguredWorkday(MONDAY, [1]));
  check('2026-09-19 (Saturday) is not a workday when workDays = [1,2,3,4,5]', !isConfiguredWorkday(SATURDAY, [1, 2, 3, 4, 5]));
  check('Monday IS a workday when workDays = [1,2,3,4,5]', isConfiguredWorkday(MONDAY, [1, 2, 3, 4, 5]));
  check('an empty workDays set -> never a workday', !isConfiguredWorkday(MONDAY, []));

  // ============================================================
  // Work window resolution -- resolves against the given timezone, not a
  // fixed UTC offset (Asia/Kolkata is UTC+5:30, a genuine half-hour
  // offset, chosen deliberately to catch an accidental whole-hour-only
  // implementation).
  // ============================================================
  {
    const window = resolveWorkWindowInstants(MONDAY, TZ, '10:00', '18:00');
    check('work window start resolves to the correct UTC instant for Asia/Kolkata 10:00 (04:30 UTC)', window.start.toISOString() === '2026-09-21T04:30:00.000Z');
    check('work window end resolves to the correct UTC instant for Asia/Kolkata 18:00 (12:30 UTC)', window.end.toISOString() === '2026-09-21T12:30:00.000Z');
  }
  {
    // America/New_York DST boundary sanity: 2026-03-08 is the US spring-forward date (02:00 -> 03:00 EST->EDT).
    // A work window entirely on the far side of the transition still resolves to a real, internally consistent instant pair.
    const beforeDst = resolveWorkWindowInstants('2026-03-07', 'America/New_York', '10:00', '18:00'); // EST (UTC-5)
    const afterDst = resolveWorkWindowInstants('2026-03-09', 'America/New_York', '10:00', '18:00'); // EDT (UTC-4)
    check('pre-DST New York 10:00 resolves to 15:00 UTC (UTC-5)', beforeDst.start.toISOString() === '2026-03-07T15:00:00.000Z');
    check('post-DST New York 10:00 resolves to 14:00 UTC (UTC-4) -- the timezone offset genuinely shifted, not hardcoded', afterDst.start.toISOString() === '2026-03-09T14:00:00.000Z');
  }

  // ============================================================
  // applyDailyRhythmPreference -- the core filter-with-fallback.
  // ============================================================

  // No work preferences -> unchanged behavior (DR2's own explicit rule).
  {
    const candidates = [candidate(`${MONDAY}T16:41:00.000Z`, `${MONDAY}T17:11:00.000Z`, 'CAUTION')];
    const result = applyDailyRhythmPreference(candidates, 'workout', { targetDate: MONDAY, timezone: TZ, prefs: UNCONFIGURED });
    check('unconfigured preferences -> candidates returned completely unchanged', result.length === 1 && result[0].start === candidates[0].start);
  }

  // Non-workday -> unchanged behavior, even though the candidate's clock
  // time would fall inside the configured HH:mm work window.
  {
    const candidates = [candidate(`${SATURDAY}T06:00:00.000Z`, `${SATURDAY}T06:30:00.000Z`)]; // 11:30am IST, "inside" work hours by clock time
    const result = applyDailyRhythmPreference(candidates, 'workout', { targetDate: SATURDAY, timezone: TZ, prefs: CONFIGURED });
    check('a non-workday (Saturday) -> unchanged behavior, even for a PERSONAL activity at a clock time matching the work window', result.length === 1);
  }

  // WORK/FLEXIBLE_BREAK/unknown -> unchanged regardless of overlap.
  {
    const insideWork = [candidate(`${MONDAY}T06:00:00.000Z`, `${MONDAY}T06:30:00.000Z`)]; // 11:30am IST, inside 10-18 work hours
    const workResult = applyDailyRhythmPreference(insideWork, 'task-1', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('WORK activity during work hours -> candidates unchanged (remains eligible)', workResult.length === 1 && workResult[0].start === insideWork[0].start);
    const breakResult = applyDailyRhythmPreference(insideWork, 'tea-break', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('FLEXIBLE_BREAK during work hours -> candidates unchanged (no work-hour penalty)', breakResult.length === 1);
    const unknownResult = applyDailyRhythmPreference(insideWork, undefined, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('unknown activity (no activityId) -> candidates unchanged (retains previous behavior)', unknownResult.length === 1);
  }

  // PERSONAL: outside-work candidate preferred when one exists -- the
  // Get-Fitter reference scenario itself.
  {
    const outside = candidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE'); // 7:00am IST
    const inside = candidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'CAUTION'); // 4:41pm IST
    const result = applyDailyRhythmPreference([inside, outside], 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('PERSONAL activity: when an outside-work candidate exists, ONLY outside-work candidates are returned (the 4:41pm one is filtered out)', result.length === 1 && result[0].start === outside.start);
  }

  // PERSONAL: no outside-work candidate -> fallback to the full original set (never excluded outright).
  {
    const onlyInside = [candidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'CAUTION')];
    const result = applyDailyRhythmPreference(onlyInside, 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('PERSONAL activity: no suitable outside-work candidate -> falls back to the full original set, never an empty result', result.length === 1 && result[0].start === onlyInside[0].start);
  }

  // Activity spanning the ENTIRE working window -- correctly treated as overlapping ("inside"), not outside.
  {
    const spansWholeWindow = candidate(`${MONDAY}T02:00:00.000Z`, `${MONDAY}T14:00:00.000Z`); // 7:30am-19:30 IST, encloses 10-18
    const genuinelyOutside = candidate(`${MONDAY}T15:00:00.000Z`, `${MONDAY}T15:30:00.000Z`); // 8:30pm IST
    const result = applyDailyRhythmPreference([spansWholeWindow, genuinelyOutside], 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('a PERSONAL candidate spanning the entire working window is treated as overlapping (filtered out when a genuine outside-work option exists)', result.length === 1 && result[0].start === genuinelyOutside.start);
  }

  // Personal activity overlapping just the work BOUNDARY (not fully inside, not fully outside).
  {
    // 17:45-18:15 IST-equivalent local time crosses the 18:00 work-end boundary by 15 minutes.
    const crossesBoundary = candidate(`${MONDAY}T12:15:00.000Z`, `${MONDAY}T12:45:00.000Z`); // 17:45-18:15 IST
    const result = applyDailyRhythmPreference([crossesBoundary], 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('a PERSONAL candidate that only partially overlaps the work boundary is still treated as "during work" (falls back when it is the only option)', result.length === 1 && result[0].start === crossesBoundary.start);
  }
  {
    // A candidate ending EXACTLY at work start (half-open: touching, not overlapping) is genuinely outside.
    const touchesStart = candidate(`${MONDAY}T03:30:00.000Z`, `${MONDAY}T04:30:00.000Z`); // 09:00-10:00 IST, ends exactly at work start
    const insideOption = candidate(`${MONDAY}T06:00:00.000Z`, `${MONDAY}T06:30:00.000Z`); // 11:30am IST
    const result = applyDailyRhythmPreference([touchesStart, insideOption], 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('a candidate ending exactly at the work-start boundary (touching, half-open) is treated as outside, preferred over the inside-work option', result.length === 1 && result[0].start === touchesStart.start);
  }

  // Deterministic: running the same inputs twice yields the identical result.
  {
    const inputCandidates = [candidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'GOOD'), candidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE')];
    const run1 = applyDailyRhythmPreference(inputCandidates, 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    const run2 = applyDailyRhythmPreference(inputCandidates, 'workout', { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED });
    check('applyDailyRhythmPreference is deterministic: identical input yields identical output across repeated calls', JSON.stringify(run1) === JSON.stringify(run2));
  }

  // ============================================================
  // explainDailyRhythmPlacement.
  // ============================================================
  {
    const outsideStart = new Date(`${MONDAY}T01:30:00.000Z`);
    const outsideEnd = new Date(`${MONDAY}T02:00:00.000Z`);
    check(
      'PERSONAL placed outside work -> PERSONAL_OUTSIDE_WORK_HOURS',
      explainDailyRhythmPlacement('workout', outsideStart, outsideEnd, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED }) === 'PERSONAL_OUTSIDE_WORK_HOURS'
    );
    const insideStart = new Date(`${MONDAY}T11:11:00.000Z`);
    const insideEnd = new Date(`${MONDAY}T11:41:00.000Z`);
    check(
      'PERSONAL placed during work (fallback) -> PERSONAL_DURING_WORK_HOURS_FALLBACK',
      explainDailyRhythmPlacement('workout', insideStart, insideEnd, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED }) === 'PERSONAL_DURING_WORK_HOURS_FALLBACK'
    );
    check(
      'FLEXIBLE_BREAK placed during work -> FLEXIBLE_BREAK_DURING_WORK_HOURS',
      explainDailyRhythmPlacement('tea-break', insideStart, insideEnd, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED }) === 'FLEXIBLE_BREAK_DURING_WORK_HOURS'
    );
    check('FLEXIBLE_BREAK placed outside work -> null (nothing noteworthy to say)', explainDailyRhythmPlacement('tea-break', outsideStart, outsideEnd, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED }) === null);
    check('WORK activity -> always null (no DR2 explanation for V1)', explainDailyRhythmPlacement('task-1', insideStart, insideEnd, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED }) === null);
    check('unconfigured -> null', explainDailyRhythmPlacement('workout', insideStart, insideEnd, { targetDate: MONDAY, timezone: TZ, prefs: UNCONFIGURED }) === null);
    check('non-workday -> null', explainDailyRhythmPlacement('workout', insideStart, insideEnd, { targetDate: SATURDAY, timezone: TZ, prefs: CONFIGURED }) === null);
    check('unknown activity -> null', explainDailyRhythmPlacement(undefined, insideStart, insideEnd, { targetDate: MONDAY, timezone: TZ, prefs: CONFIGURED }) === null);
  }

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Scheduling checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM SCHEDULING CHECKS PASSED');
  }
}

main();
