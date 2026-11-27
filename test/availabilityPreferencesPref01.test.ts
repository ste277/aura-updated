/**
 * AURA-PREF-01 (PV-F01) -- availability and work-hour preferences applied
 * consistently, plus how they are discovered. Pure + real engine (no DB):
 * runs the real Panchang/Muhurta timing search through the same wrapper
 * Find a Time, the weekly rhythm proposal and goal planning use.
 *
 *   npx ts-node test/availabilityPreferencesPref01.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { runTimingSearch, type TimingCandidate, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { buildWorkHoursPreferenceExclusions, runTimingSearchWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import { applyDailyRhythmPreference, resolveDailyRhythmSearchLimit, explainDailyRhythmPlacement } from '../apps/web/lib/dailyRhythmScheduling';
import { describeFindATimePreferenceHint, preferenceSectionIdFromSearch, preferenceSettingsHref, PREFERENCE_SECTION_IDS } from '../apps/web/lib/preferenceLinks';
import { getDatePartsInTimezone, localDateTimeToUTC } from '../apps/web/lib/timezone';
import { createEmptyWeekDraft } from '../apps/web/lib/availabilitySettings';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-11-29T00:00:00.000Z'); // Sunday 05:30 IST
const CONTEXT = { latitude: 13.0827, longitude: 80.2707, timezone: TZ, tzOffsetMinutes: 330, now: NOW };
const WEEK = { start: '2026-11-30', end: '2026-12-06' }; // Mon..Sun
const MON_FRI_9_18 = { workStart: '09:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] };
const UNCONFIGURED = { workStart: null, workEnd: null, workDays: [] as number[] };

const find = (activityId: string, extra: Partial<TimingSearchRequest> = {}): TimingSearchRequest => ({
  mode: 'FIND',
  activityId,
  durationMinutes: 45,
  dateRange: WEEK,
  limit: 12,
  timePreference: 'ANY',
  context: CONTEXT,
  ...extra,
});

const local = (c: TimingCandidate) => getDatePartsInTimezone(TZ, new Date(c.start));
const weekdayOf = (c: TimingCandidate) => new Date(`${local(c).dateStr}T00:00:00Z`).getUTCDay();
const workWindow = (dateStr: string, start = '09:00', end = '18:00') => ({ start: localDateTimeToUTC(dateStr, start, TZ), end: localDateTimeToUTC(dateStr, end, TZ) });
const overlapsWork = (c: TimingCandidate, start = '09:00', end = '18:00') => {
  const w = workWindow(local(c).dateStr, start, end);
  return new Date(c.start) < w.end && w.start < new Date(c.end);
};
const insideWork = (c: TimingCandidate, start = '09:00', end = '18:00') => {
  const w = workWindow(local(c).dateStr, start, end);
  return new Date(c.start) >= w.start && new Date(c.end) <= w.end;
};
const isWorkday = (c: TimingCandidate, days: number[]) => days.includes(weekdayOf(c));
const starts = (list: readonly TimingCandidate[]) => list.map((c) => c.start).join(',');

// ---------------------------------------------------------------
// 1. New users: no preferences -> exactly the engine's own result.
// ---------------------------------------------------------------
{
  const plain = runTimingSearch(find('workout'));
  const wrapped = runTimingSearchWithDailyRhythm(find('workout'), TZ, UNCONFIGURED);
  check('1a. No preferences: Find a Time returns the engine result unchanged', starts(plain.candidates.slice(0, 12)) === starts(wrapped.candidates));
  check('1b. No preferences: no work-hours notes', !wrapped.dailyRhythmNotes);
  check('1c. No preferences: useful results for a new user (one per day of the week)', wrapped.candidates.length === 7);
}

// ---------------------------------------------------------------
// 2. Work hours Mon-Fri 09:00-18:00, personal activity (workout).
// ---------------------------------------------------------------
{
  const before = runTimingSearch(find('workout'));
  const result = runTimingSearchWithDailyRhythm(find('workout'), TZ, MON_FRI_9_18);
  const weekdayCandidates = result.candidates.filter((c) => isWorkday(c, MON_FRI_9_18.workDays));
  check('2a. Baseline shows the old gap: the engine alone puts weekday workouts inside 09:00-18:00', before.candidates.some((c) => isWorkday(c, MON_FRI_9_18.workDays) && overlapsWork(c)));
  check('2b. With work hours: every weekday suggestion is outside working hours', weekdayCandidates.length > 0 && weekdayCandidates.every((c) => !overlapsWork(c)));
  check('2c. Still one suggestion for each day of the week (soft, nothing dropped)', new Set(result.candidates.map((c) => local(c).dateStr)).size === 7);
  check('2d. Weekend suggestions are unaffected by work hours', result.candidates.filter((c) => !isWorkday(c, MON_FRI_9_18.workDays)).every((c) => before.candidates.some((b) => b.start === c.start)));
  check('2e. Each weekday suggestion carries the preferred note', weekdayCandidates.every((c) => result.dailyRhythmNotes?.[c.start] === 'Fits your preferred personal time.'));
}

// ---------------------------------------------------------------
// 3. Panchang ranking preserved: every suggestion is one the engine itself
//    ranks best for that day within the time that is still allowed.
// ---------------------------------------------------------------
{
  const exclusions = buildWorkHoursPreferenceExclusions('PERSONAL', MON_FRI_9_18, TZ, '2026-11-29', '2026-12-07');
  const engineOutsideWork = runTimingSearch({ ...find('workout'), excludedIntervals: exclusions });
  const result = runTimingSearchWithDailyRhythm(find('workout'), TZ, MON_FRI_9_18);
  check('3a. Suggestions are exactly the engine\'s own per-day best outside working hours (no re-scoring)', starts([...engineOutsideWork.candidates].sort((a, b) => a.start.localeCompare(b.start))) === starts([...result.candidates].sort((a, b) => a.start.localeCompare(b.start))));
  const keys = result.candidates.map((c) => c.auraFitScore ?? c.muhurtaScore * 5 + 55);
  check('3b. Order follows the engine\'s own ranking key (best first)', keys.every((k, i) => i === 0 || keys[i - 1] >= k));
  check('3c. Panchang friction windows are still never suggested', result.candidates.every((c) => !(c.conflicts ?? []).some((x) => x.type === 'FRICTION_WINDOW_BLOCKED')));
}

// ---------------------------------------------------------------
// 4. Custom working days and hours (not Monday-Friday).
// ---------------------------------------------------------------
{
  const TUE_SAT_13_21 = { workStart: '13:00', workEnd: '21:00', workDays: [2, 3, 4, 5, 6] };
  const result = runTimingSearchWithDailyRhythm(find('workout'), TZ, TUE_SAT_13_21);
  const workdays = result.candidates.filter((c) => isWorkday(c, TUE_SAT_13_21.workDays));
  check('4a. Tue-Sat 13:00-21:00: workday suggestions avoid 13:00-21:00', workdays.length > 0 && workdays.every((c) => !overlapsWork(c, '13:00', '21:00')));
  const before = runTimingSearch(find('workout'));
  const monday = result.candidates.find((c) => weekdayOf(c) === 1);
  check('4b. Monday (a day off in this schedule) keeps the engine\'s own choice', !!monday && before.candidates.some((b) => b.start === monday.start));
  check('4c. Saturday is treated as a workday when configured', result.candidates.filter((c) => weekdayOf(c) === 6).every((c) => !overlapsWork(c, '13:00', '21:00')));
}

// ---------------------------------------------------------------
// 5. Work activities prefer working hours (new); personal avoid them.
// ---------------------------------------------------------------
{
  const result = runTimingSearchWithDailyRhythm(find('deep-work'), TZ, MON_FRI_9_18);
  const weekday = result.candidates.filter((c) => isWorkday(c, MON_FRI_9_18.workDays));
  check('5a. Deep Work on workdays: suggestions fall inside working hours', weekday.length > 0 && weekday.every((c) => insideWork(c)));
  check('5b. Deep Work notes say it fits working hours', weekday.every((c) => result.dailyRhythmNotes?.[c.start] === 'Fits your working hours.'));
  check('5c. Deep Work at the weekend is unaffected', result.candidates.filter((c) => !isWorkday(c, MON_FRI_9_18.workDays)).every((c) => !result.dailyRhythmNotes?.[c.start]));
  const breakResult = runTimingSearchWithDailyRhythm(find('tea-break', { durationMinutes: 10 }), TZ, MON_FRI_9_18);
  const breakPlain = runTimingSearch(find('tea-break', { durationMinutes: 10 }));
  check('5d. Flexible breaks are not steered (same times as the engine)', starts(breakResult.candidates) === starts(breakPlain.candidates.slice(0, 12)));
}

// ---------------------------------------------------------------
// 6. Explicit user choices win over the work-hours preference.
// ---------------------------------------------------------------
{
  const afternoon = runTimingSearchWithDailyRhythm(find('workout', { timePreference: 'AFTERNOON' }), TZ, MON_FRI_9_18);
  const weekdays = afternoon.candidates.filter((c) => isWorkday(c, MON_FRI_9_18.workDays));
  check('6a. Explicit "afternoon" on workdays is kept even though it is inside working hours', weekdays.length === 5);
  check('6b. ...and each is labelled as inside working hours, not hidden', weekdays.every((c) => !!afternoon.dailyRhythmNotes?.[c.start]));
  const checkMode = runTimingSearchWithDailyRhythm({ mode: 'CHECK', activityId: 'workout', durationMinutes: 45, candidateStart: '2026-12-01T07:30:00.000Z', context: CONTEXT } as TimingSearchRequest, TZ, MON_FRI_9_18);
  const requested = (checkMode as unknown as { requestedCandidate?: TimingCandidate }).requestedCandidate;
  check('6c. Checking a specific time inside work hours is evaluated, never moved (with an overlap note)', !!requested && requested.start === '2026-12-01T07:30:00.000Z' && checkMode.dailyRhythmNotes?.[requested.start] === 'This time overlaps your usual working hours.');
}

// ---------------------------------------------------------------
// 7. Availability (hard) and existing commitments still apply.
// ---------------------------------------------------------------
{
  const busy = { start: localDateTimeToUTC('2026-12-01', '18:00', TZ), end: localDateTimeToUTC('2026-12-01', '23:59', TZ) };
  const morning = { start: localDateTimeToUTC('2026-12-01', '00:00', TZ), end: localDateTimeToUTC('2026-12-01', '09:00', TZ) };
  const result = runTimingSearchWithDailyRhythm(find('workout', { excludedIntervals: [busy, morning] }), TZ, MON_FRI_9_18);
  const tuesday = result.candidates.filter((c) => local(c).dateStr === '2026-12-01');
  const hits = (c: TimingCandidate, x: { start: Date; end: Date }) => new Date(c.start) < x.end && x.start < new Date(c.end);
  check('7a. Times blocked by plans/availability are never suggested, even as a fallback', result.candidates.every((c) => !hits(c, busy) && !hits(c, morning)));
  check('7b. A workday with only work-hour time left falls back to it (soft, not excluded)', tuesday.length === 1 && overlapsWork(tuesday[0]) && result.dailyRhythmNotes?.[tuesday[0].start] === 'No preferred outside-work option was found in the available results.');
}

// ---------------------------------------------------------------
// 8. Plan My Day / tomorrow / Home (single-day filter) -- same rules.
// ---------------------------------------------------------------
{
  const tomorrow = '2026-12-01'; // Tuesday
  const day = runTimingSearch({ mode: 'FIND', activityId: 'deep-work', durationMinutes: 60, dateRange: { start: tomorrow, end: tomorrow }, limit: 12, timePreference: 'ANY', context: CONTEXT });
  const ctx = { targetDate: tomorrow, timezone: TZ, prefs: MON_FRI_9_18 };
  const work = applyDailyRhythmPreference(day.candidates, 'deep-work', ctx);
  check('8a. Tomorrow, Deep Work: only candidates inside working hours are kept when some exist', day.candidates.some((c) => insideWork(c)) ? work.every((c) => insideWork(c)) : work.length === day.candidates.length);
  check('8b. Deep Work now gets the wider candidate pool, like personal activities', resolveDailyRhythmSearchLimit('deep-work', ctx) === 12 && resolveDailyRhythmSearchLimit('workout', ctx) === 12);
  const personalDay = runTimingSearch({ mode: 'FIND', activityId: 'workout', durationMinutes: 45, dateRange: { start: tomorrow, end: tomorrow }, limit: 12, timePreference: 'ANY', context: CONTEXT });
  const personal = applyDailyRhythmPreference(personalDay.candidates, 'workout', ctx);
  check('8c. Tomorrow, Workout: unchanged DR2 rule -- outside working hours when possible', personal.every((c) => !overlapsWork(c)) || personal.length === personalDay.candidates.length);
  check('8d. No work hours: Plan My Day candidates unchanged', applyDailyRhythmPreference(day.candidates, 'deep-work', { ...ctx, prefs: UNCONFIGURED }).length === day.candidates.length);
  check('8e. Saturday (not a workday): Deep Work unchanged', applyDailyRhythmPreference(day.candidates, 'deep-work', { ...ctx, targetDate: '2026-12-05' }).length === day.candidates.length);
  check('8f. Work placements add no new Plan My Day warning code (preview contract unchanged)', explainDailyRhythmPlacement('deep-work', new Date(work[0].start), new Date(work[0].end), ctx) === null);
}

// ---------------------------------------------------------------
// 9. Time zones and day boundaries.
// ---------------------------------------------------------------
{
  const ny = buildWorkHoursPreferenceExclusions('PERSONAL', { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] }, 'America/New_York', '2026-03-06', '2026-03-10');
  const fmt = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
  check('9a. Across the US DST change, work hours stay 09:00-17:00 local on each workday', ny.length === 3 && ny.every((x) => fmt(x.start) === '09:00' && fmt(x.end) === '17:00'));
  const work = buildWorkHoursPreferenceExclusions('WORK', MON_FRI_9_18, TZ, '2026-11-30', '2026-11-30');
  check('9b. Work activities: the steered-away time is the rest of the local day (midnight to 09:00, 18:00 to midnight)', work.length === 2 && work[0].start.toISOString() === '2026-11-29T18:30:00.000Z' && work[0].end.toISOString() === '2026-11-30T03:30:00.000Z' && work[1].end.toISOString() === '2026-11-30T18:30:00.000Z');
  check('9c. Empty workDays ("no work days") steers nothing', buildWorkHoursPreferenceExclusions('PERSONAL', { workStart: '09:00', workEnd: '17:00', workDays: [] }, TZ, '2026-11-30', '2026-12-06').length === 0);
}

// ---------------------------------------------------------------
// 10. Goal and rhythm compatibility (the weekly proposal's own call).
// ---------------------------------------------------------------
{
  // Same request shape generateWeeklyRhythmProposal sends; it then keeps
  // only the rhythm's preferred weekdays (a strict filter).
  const response = runTimingSearchWithDailyRhythm(find('workout', { limit: 14 }), TZ, MON_FRI_9_18);
  const monWedFri = response.candidates.filter((c) => [1, 3, 5].includes(weekdayOf(c)));
  check('10a. Rhythm on Mon/Wed/Fri still gets one option on each preferred day', new Set(monWedFri.map((c) => local(c).dateStr)).size === 3);
  check('10b. ...and those options sit outside working hours', monWedFri.every((c) => !overlapsWork(c)));
  const evening = runTimingSearchWithDailyRhythm(find('workout', { timePreference: 'EVENING', limit: 14 }), TZ, MON_FRI_9_18);
  check('10c. A rhythm\'s preferred time of day is still honoured (evening stays evening)', evening.candidates.length > 0 && evening.candidates.every((c) => Number(new Date(c.start).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).slice(0, 2)) >= 16));
}

// ---------------------------------------------------------------
// 11. Discovery: one optional hint, deep links, no imposed defaults.
// ---------------------------------------------------------------
{
  check('11a. Hint when neither is set', describeFindATimePreferenceHint({ availability: 'UNCONFIGURED', workHours: 'UNCONFIGURED' })?.href === '/?tab=you&section=availability');
  check('11b. Hint for work hours only', describeFindATimePreferenceHint({ availability: 'CONFIGURED', workHours: 'UNCONFIGURED' })?.href === '/?tab=you&section=work-hours');
  check('11c. Hint for availability only', describeFindATimePreferenceHint({ availability: 'UNCONFIGURED', workHours: 'CONFIGURED' })?.linkLabel === 'Set your available hours');
  check('11d. No hint once both are set, or for guest/unknown responses', describeFindATimePreferenceHint({ availability: 'CONFIGURED', workHours: 'CONFIGURED' }) === null && describeFindATimePreferenceHint(undefined) === null);
  check('11e. Deep links resolve to the You settings cards', preferenceSectionIdFromSearch('?tab=you&section=work-hours') === PREFERENCE_SECTION_IDS.workHours && preferenceSectionIdFromSearch('?tab=you&section=availability') === PREFERENCE_SECTION_IDS.availability && preferenceSectionIdFromSearch('?tab=you') === null);
  check('11f. preferenceSettingsHref stays on the existing You tab (no new route)', preferenceSettingsHref('workHours').startsWith('/?tab=you&'));
  check('11g. A new user\'s availability draft has no periods on any day (no Mon-Fri assumption)', createEmptyWeekDraft().every((d) => d.periods.length === 0));

  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const you = read('apps/web/components/YouView.tsx');
  const rhythm = read('apps/web/components/DailyRhythmSettings.tsx');
  const availability = read('apps/web/components/AvailabilitySettings.tsx');
  const planDay = read('apps/web/app/plan-day/PlanDayClient.tsx');
  const findView = read('apps/web/components/PlanWithAuraView.tsx');
  check('11h. You: cards have deep-link anchors; "Daily Rhythm" renamed "Work hours"', you.includes('id={PREFERENCE_SECTION_IDS.availability}') && you.includes('id={PREFERENCE_SECTION_IDS.workHours}') && you.includes('<SectionHeader label="Work hours" />') && !you.includes('label="Daily Rhythm"'));
  check('11i. Work-hours copy names every planning surface and says it is soft', /Find a Time, Plan My Day, Home and weekly planning/.test(rhythm) && /preference, not a hard limit/.test(rhythm) && !/when you use Plan My Day/.test(rhythm));
  check('11j. Availability copy explains its effect and that it is optional', /Optional\./.test(availability) && /Without them, Aura considers your whole day\./.test(availability));
  check('11j2. Unsaved availability reads "Not set", never "Not available" (empty means whole day considered)', /notSetYet=\{!load\.configured\}/.test(availability) && /notSetYet && periods\.length === 0 \? 'Not set'/.test(availability));
  check('11j3. The clear action says "Clear work hours" (no leftover "daily rhythm" wording)', /Clear work hours/.test(rhythm) && !/Clear daily rhythm/.test(rhythm));
  check('11k. Both settings say confirmed plans are never moved', /never moves plans you&apos;ve already confirmed/.test(rhythm) && /never moves plans you&apos;ve already confirmed/.test(availability));
  check('11l. Plan My Day links straight to the Availability card and says today works without it', (planDay.match(/preferenceSettingsHref\('availability'\)/g) ?? []).length === 3 && /You can still plan today without it\./.test(planDay));
  check('11m. Find a Time shows the hint only when results exist', /findResult\.candidates\.length > 0 && \(\(\) => \{[\s\S]{0,400}describeFindATimePreferenceHint/.test(findView));
  check('11n. No mandatory onboarding step was added', !/work hours|availability/i.test(read('apps/web/components/OnboardingJourney.tsx').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('11o. No new migration (re-baselined by AURA-MP-1: only its own additive 0056 is allowed)', !fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).some((d) => d !== '0056_my_people_foundation' && /^005[5-9]_|^00[6-9]\d_/.test(d)));
}

console.log(allPassed ? '\nALL PREF-01 AVAILABILITY PREFERENCE CHECKS PASSED' : '\nSOME PREF-01 AVAILABILITY PREFERENCE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
