/**
 * AURA-HPG5-V2-I1 -- Find a Time availability and conflict enforcement:
 * pure (no DB) half of the approved T1-T24 matrix. The DB/route half lives
 * in findATimeConstraintsDb.test.ts; the Plan-tab DOM half in
 * findATimeConflictJsdom.test.ts.
 *
 *   npx ts-node test/findATimeConstraints.test.ts
 *
 * Every engine assertion runs the REAL runTimingSearch with the constraints
 * this module builds -- nothing is re-implemented here.
 */
import {
  buildFindATimeConstraints,
  resolveFindATimeSearchDates,
  resolveFindATimeLoadBounds,
  resolveFindATimeEmptyReason,
  summarizeFindATimeConstraints,
  parseOverlapPolicy,
  type FindATimeConstraints,
} from '../apps/web/lib/findATimeConstraints';
import {
  isPlanOverlapResponse,
  parsePlanOverlapConflict,
  presentPlanOverlap,
  presentFindATimeEmptyReason,
} from '../apps/web/lib/schedulingEligibilityPresentation';
import { runTimingSearch, type TimingSearchRequest, type TimingCandidate } from '../packages/recommendation/src/timingSearch';
import { runTimingSearchWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';
import type { PlanBlockerCandidate } from '../apps/web/lib/planBlockerLifecycle';
import { localDateTimeToUTC, resolveTzOffsetMinutes, getDatePartsInTimezone, getMinuteOfDayInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const MIN = 60000;
const IST = 'Asia/Kolkata';
const at = (date: string, hhmm: string, tz = IST) => localDateTimeToUTC(date, hhmm, tz);
const localHHMM = (iso: string | Date, tz = IST) => {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = getDatePartsInTimezone(tz, d);
  const m = getMinuteOfDayInTimezone(tz, d);
  return `${p.dateStr} ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function ctx(now: Date, tz = IST, lat = 13.0827, lon = 80.2707): DailyAssistantContext {
  return { now, latitude: lat, longitude: lon, timezone: tz, tzOffsetMinutes: resolveTzOffsetMinutes(tz, now) };
}
const configured = (periods: AvailabilityConfiguration['periods']): AvailabilityConfiguration => ({ configured: true, periods });
const UNCONFIGURED: AvailabilityConfiguration = { configured: false, periods: [] };
const allDays = (startTime: string, endTime: string) => ([0, 1, 2, 3, 4, 5, 6] as const).map((weekday) => ({ weekday, startTime, endTime }));
const plan = (date: string, s: string, e: string, status: PlanBlockerCandidate['status'] = 'UPCOMING', tz = IST): PlanBlockerCandidate => ({ start: at(date, s, tz), end: at(date, e, tz), status });

function constrain(request: TimingSearchRequest, c: FindATimeConstraints): TimingSearchRequest {
  return { ...request, ...(c.searchWindow ? { searchWindow: c.searchWindow } : {}), excludedIntervals: c.excludedIntervals };
}
function within(candidate: TimingCandidate, windows: { start: Date; end: Date }[]): boolean {
  const s = new Date(candidate.start).getTime();
  const e = new Date(candidate.end).getTime();
  return windows.some((w) => s >= w.start.getTime() && e <= w.end.getTime());
}
function overlapsAny(candidate: TimingCandidate, intervals: { start: Date; end: Date }[]): boolean {
  const s = new Date(candidate.start).getTime();
  const e = new Date(candidate.end).getTime();
  return intervals.some((i) => s < i.end.getTime() && i.start.getTime() < e);
}

// Wednesday 2026-11-18, 05:30 IST (before any availability window starts).
const WED = '2026-11-18';
const NOW = at(WED, '05:30');
const C = ctx(NOW);
const baseFind = (overrides: Partial<TimingSearchRequest> = {}): TimingSearchRequest => ({ mode: 'FIND', context: C, activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', limit: 3, ...overrides });

// ============================================================
// Search dates / load bounds (engine parity)
// ============================================================
check('dates: TODAY -> the request context\'s local date', JSON.stringify(resolveFindATimeSearchDates(baseFind())) === JSON.stringify([WED]));
check('dates: TOMORROW -> next local date', JSON.stringify(resolveFindATimeSearchDates(baseFind({ horizon: 'TOMORROW' }))) === JSON.stringify(['2026-11-19']));
check('dates: SEVEN_DAYS -> 7 consecutive dates from today', resolveFindATimeSearchDates(baseFind({ horizon: 'SEVEN_DAYS' })).length === 7 && resolveFindATimeSearchDates(baseFind({ horizon: 'SEVEN_DAYS' }))[6] === '2026-11-24');
check('dates: WEEKEND (Wed) -> Sat+Sun', JSON.stringify(resolveFindATimeSearchDates(baseFind({ horizon: 'WEEKEND' }))) === JSON.stringify(['2026-11-21', '2026-11-22']));
check('dates: explicit dateRange wins', JSON.stringify(resolveFindATimeSearchDates(baseFind({ dateRange: { start: '2026-11-20', end: '2026-11-21' } }))) === JSON.stringify(['2026-11-20', '2026-11-21']));
check('dates: CUSTOM horizon uses custom dates', JSON.stringify(resolveFindATimeSearchDates(baseFind({ horizon: 'CUSTOM', customStartDate: '2026-11-25', customEndDate: '2026-11-26' }))) === JSON.stringify(['2026-11-25', '2026-11-26']));
{
  const b = resolveFindATimeLoadBounds([WED], IST)!;
  check('load bounds cover the whole local day plus 6h padding on both sides (cross-midnight plans load)', b.start.getTime() === at(WED, '00:00').getTime() - 360 * MIN && b.end.getTime() === at('2026-11-19', '00:00').getTime() + 360 * MIN);
  check('load bounds: empty date list -> null', resolveFindATimeLoadBounds([], IST) === null);
}

// ============================================================
// T1 / T2 -- inside / outside availability
// ============================================================
{
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: configured([{ weekday: 3, startTime: '06:00', endTime: '22:00' }]), plans: [] });
  check('T1 searchWindow = Wed 06:00-22:00 IST', c.availabilityStatus === 'CONFIGURED' && c.searchWindow!.start.getTime() === at(WED, '06:00').getTime() && c.searchWindow!.end.getTime() === at(WED, '22:00').getTime());
  const res = runTimingSearch(constrain(baseFind({ limit: 1000, timePreference: 'ANY' }), c));
  check('T1 every candidate lies fully inside 06:00-22:00', res.candidates.length > 0 && res.candidates.every((x) => within(x, [c.searchWindow!])));
  const unconstrained = runTimingSearch(baseFind({ limit: 1000, timePreference: 'ANY' }));
  check('T1 control: the unconstrained search DOES offer out-of-availability slots (fix is load-bearing)', unconstrained.candidates.some((x) => !within(x, [c.searchWindow!])));
  check('T2 no candidate ends after 22:00 (a slot ending 1 minute past the window is excluded)', res.candidates.every((x) => new Date(x.end).getTime() <= at(WED, '22:00').getTime()));
  const c2 = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: configured([{ weekday: 3, startTime: '06:00', endTime: '07:14' }]), plans: [] });
  const r2 = runTimingSearch(constrain(baseFind({ limit: 1000, timePreference: 'ANY', durationMinutes: 30 }), c2));
  check('T2 boundary: window 06:00-07:14 admits 06:30-07:00 but not 06:45-07:15', r2.candidates.some((x) => localHHMM(x.start) === `${WED} 06:30`) && !r2.candidates.some((x) => localHHMM(x.start) === `${WED} 06:45`));
}

// ============================================================
// T3 -- no availability configured
// ============================================================
{
  const blocker = plan(WED, '06:00', '06:30');
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: UNCONFIGURED, plans: [blocker] });
  check('T3 UNCONFIGURED -> no searchWindow (no availability filter, no new overnight restriction)', c.availabilityStatus === 'UNCONFIGURED' && c.searchWindow === undefined);
  check('T3 UNCONFIGURED -> existing plans are still excluded', c.excludedIntervals.length === 1 && c.blockingPlanCount === 1);
  check('T3 summary reports UNCONFIGURED', JSON.stringify(summarizeFindATimeConstraints(c)) === JSON.stringify({ availability: 'UNCONFIGURED', blockedPlanCount: 1 }));
  const res = runTimingSearch(constrain(baseFind({ limit: 1000, timePreference: 'ANY' }), c));
  check('T3 overnight slots stay possible for unconfigured users (e.g. a 23:00 start)', res.candidates.some((x) => localHHMM(x.start) >= `${WED} 22:00`));
  check('T3 no candidate overlaps the existing plan', res.candidates.every((x) => !overlapsAny(x, [blocker])));
  const configuredFlagButNoRows = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: { configured: false, periods: [{ weekday: 3, startTime: '06:00', endTime: '07:00' }] }, plans: [] });
  check('T3 configured=false ignores stray period rows (UNCONFIGURED wins)', configuredFlagButNoRows.searchWindow === undefined);
}

// ============================================================
// T4 -- configured, no period for that weekday
// ============================================================
{
  const availability = configured([{ weekday: 1, startTime: '07:00', endTime: '09:00' }, { weekday: 3, startTime: '18:00', endTime: '20:00' }]); // Mon + Wed only
  const req = baseFind({ horizon: 'SEVEN_DAYS', limit: 7, timePreference: 'ANY' });
  const dates = resolveFindATimeSearchDates(req);
  const c = buildFindATimeConstraints({ dates, timezone: IST, now: NOW, availability, plans: [] });
  const res = runTimingSearch(constrain(req, c));
  const days = new Set(res.candidates.map((x) => getDatePartsInTimezone(IST, new Date(x.start)).dateStr));
  check('T4 multi-day search returns only Mon/Wed dates (other weekdays fully excluded)', res.candidates.length > 0 && [...days].every((d) => d === WED || d === '2026-11-23'));
  check('T4 Mon and Wed both still searched', days.has(WED) && days.has('2026-11-23'));
  const onlyEmptyDay = buildFindATimeConstraints({ dates: ['2026-11-19'], timezone: IST, now: NOW, availability, plans: [] });
  check('T4 CONFIGURED with nothing on the searched weekday -> hasUsableAvailability false', onlyEmptyDay.hasUsableAvailability === false && onlyEmptyDay.searchWindow!.start.getTime() === onlyEmptyDay.searchWindow!.end.getTime());
  const emptyRes = runTimingSearch(constrain(baseFind({ horizon: 'TOMORROW', timePreference: 'ANY' }), onlyEmptyDay));
  check('T4 ... and the engine returns zero candidates (no out-of-availability fallback)', emptyRes.candidates.length === 0);
}

// ============================================================
// T5 -- disjoint periods in one day
// ============================================================
{
  const availability = configured([{ weekday: 3, startTime: '06:00', endTime: '09:00' }, { weekday: 3, startTime: '17:00', endTime: '21:00' }]);
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability, plans: [] });
  check('T5 gap 09:00-17:00 becomes an excluded interval', c.excludedIntervals.some((i) => i.start.getTime() === at(WED, '09:00').getTime() && i.end.getTime() === at(WED, '17:00').getTime()));
  const r3 = runTimingSearch(constrain(baseFind({ timePreference: 'ANY', limit: 3 }), c));
  const rAll = runTimingSearch(constrain(baseFind({ timePreference: 'ANY', limit: 1000 }), c));
  const windows = [{ start: at(WED, '06:00'), end: at(WED, '09:00') }, { start: at(WED, '17:00'), end: at(WED, '21:00') }];
  check('T5 top-3 (diversified) never lands in the gap', r3.candidates.length === 3 && r3.candidates.every((x) => within(x, windows)));
  check('T5 full list never lands in the gap', rAll.candidates.every((x) => within(x, windows)));
}

// ============================================================
// T6-T9 -- existing-plan overlap, partial, adjacent, multiple
// ============================================================
{
  const availability = configured([{ weekday: 3, startTime: '06:00', endTime: '22:00' }]);
  const learn = plan(WED, '07:00', '08:00');
  const running = plan(WED, '18:00', '18:45');
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability, plans: [learn, running] });
  const res = runTimingSearch(constrain(baseFind({ limit: 1000, timePreference: 'ANY' }), c));
  check('T6 no candidate overlaps either plan (full overlap)', res.candidates.length > 0 && res.candidates.every((x) => !overlapsAny(x, [learn, running])));
  check('T7 partial overlaps excluded: no 06:45 (ends inside Learn) and no 07:45 (starts inside Learn)', !res.candidates.some((x) => [`${WED} 06:45`, `${WED} 07:45`].includes(localHHMM(x.start))));
  check('T8 adjacent allowed: a 30-min slot ending exactly at 07:00 (06:30) is eligible', res.candidates.some((x) => localHHMM(x.start) === `${WED} 06:30`));
  check('T8 adjacent allowed: a slot starting exactly at 08:00 is eligible', res.candidates.some((x) => localHHMM(x.start) === `${WED} 08:00`));
  check('T8 adjacent allowed: a slot starting exactly when Running ends (18:45) is eligible', res.candidates.some((x) => localHHMM(x.start) === `${WED} 18:45`));
  check('T9 both plans counted as blockers', c.blockingPlanCount === 2);
  const sorted = res.candidates.every((x, i, list) => i === 0 || (list[i - 1].auraFitScore ?? 0) >= (x.auraFitScore ?? 0));
  check('T9 remaining candidates keep descending score order', sorted);
}

// ============================================================
// T10 -- blocker lifecycle (isActivePlanBlocker reused)
// ============================================================
{
  const later = (status: PlanBlockerCandidate['status']) => plan(WED, '10:00', '11:00', status);
  const mk = (p: PlanBlockerCandidate) => buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: UNCONFIGURED, plans: [p] }).blockingPlanCount;
  check('T10 CANCELLED does not block', mk(later('CANCELLED')) === 0);
  check('T10 SKIPPED does not block', mk(later('SKIPPED')) === 0);
  check('T10 MOVED does not block (its successor does)', mk(later('MOVED')) === 0);
  check('T10 LOGGED blocks', mk(later('LOGGED')) === 1);
  check('T10 future UPCOMING blocks', mk(later('UPCOMING')) === 1);
  const elapsed = { start: new Date(NOW.getTime() - 120 * MIN), end: new Date(NOW.getTime() - 60 * MIN), status: 'UPCOMING' as const };
  check('T10 elapsed UPCOMING (missed) does not block future slots', mk(elapsed) === 0);
  check('T10 zero-length plan rows are ignored', buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: UNCONFIGURED, plans: [{ start: at(WED, '10:00'), end: at(WED, '10:00'), status: 'UPCOMING' }] }).excludedIntervals.length === 0);
}

// ============================================================
// T11 (pure part) -- cross-midnight existing plan
// ============================================================
{
  const overnight: PlanBlockerCandidate = { start: at(WED, '23:30'), end: at('2026-11-19', '00:30'), status: 'UPCOMING' };
  const thu = '2026-11-19';
  const c = buildFindATimeConstraints({ dates: [WED, thu], timezone: IST, now: NOW, availability: UNCONFIGURED, plans: [overnight] });
  const res = runTimingSearch(constrain(baseFind({ dateRange: { start: WED, end: thu }, limit: 1000, timePreference: 'NIGHT' }), c));
  check('T11 no candidate overlaps 23:30-00:30 on either side of midnight', res.candidates.length > 0 && res.candidates.every((x) => !overlapsAny(x, [overnight])));
  check('T11 Thu 00:00 slot (inside the overnight plan) excluded; Thu 00:30 (adjacent) allowed', !res.candidates.some((x) => localHHMM(x.start) === `${thu} 00:00`) && res.candidates.some((x) => localHHMM(x.start) === `${thu} 00:30`));
  check('T11 Wed 23:00 (ends exactly at 23:30) allowed', res.candidates.some((x) => localHHMM(x.start) === `${WED} 23:00`));
}

// ============================================================
// T12 -- timezone conversion
// ============================================================
{
  const LA = 'America/Los_Angeles';
  const laNow = at(WED, '05:00', LA);
  const c = buildFindATimeConstraints({ dates: [WED], timezone: LA, now: laNow, availability: configured([{ weekday: 3, startTime: '09:00', endTime: '17:00' }]), plans: [] });
  check('T12 Los Angeles: window resolves to local 09:00-17:00', localHHMM(c.searchWindow!.start, LA) === `${WED} 09:00` && localHHMM(c.searchWindow!.end, LA) === `${WED} 17:00`);
  check('T12 Los Angeles 09:00 PST = 17:00Z', c.searchWindow!.start.toISOString() === '2026-11-18T17:00:00.000Z');
  const ci = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: configured([{ weekday: 3, startTime: '09:00', endTime: '17:00' }]), plans: [] });
  check('T12 Kolkata 09:00 IST = 03:30Z', ci.searchWindow!.start.toISOString() === '2026-11-18T03:30:00.000Z');
  const laReq: TimingSearchRequest = { mode: 'FIND', context: ctx(laNow, LA, 34.05, -118.24), activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', limit: 1000, timePreference: 'ANY' };
  const r = runTimingSearch(constrain(laReq, c));
  check('T12 LA engine run: every candidate inside local 09:00-17:00', r.candidates.length > 0 && r.candidates.every((x) => within(x, [c.searchWindow!])));
}

// ============================================================
// T13 -- New York DST boundaries
// ============================================================
{
  const NY = 'America/New_York';
  const spring = '2026-03-08'; // Sunday, 02:00 -> 03:00
  const fall = '2026-11-01'; // Sunday, 02:00 -> 01:00
  const av = configured([{ weekday: 0, startTime: '01:00', endTime: '04:00' }]);
  const cs = buildFindATimeConstraints({ dates: [spring], timezone: NY, now: new Date('2026-03-07T12:00:00Z'), availability: av, plans: [] });
  const cf = buildFindATimeConstraints({ dates: [fall], timezone: NY, now: new Date('2026-10-31T12:00:00Z'), availability: av, plans: [] });
  check('T13 spring-forward 01:00-04:00 is 2 real hours (06:00Z-08:00Z)', cs.searchWindow!.end.getTime() - cs.searchWindow!.start.getTime() === 120 * MIN && cs.searchWindow!.start.toISOString() === '2026-03-08T06:00:00.000Z');
  check('T13 fall-back 01:00-04:00 is 4 real hours (05:00Z-09:00Z)', cf.searchWindow!.end.getTime() - cf.searchWindow!.start.getTime() === 240 * MIN && cf.searchWindow!.start.toISOString() === '2026-11-01T05:00:00.000Z');
  const nyNow = new Date('2026-03-08T05:00:00Z'); // 00:00 EST
  const req: TimingSearchRequest = { mode: 'FIND', context: ctx(nyNow, NY, 40.71, -74.0), activityId: 'workout', durationMinutes: 30, horizon: 'TODAY', limit: 1000, timePreference: 'ANY' };
  const cToday = buildFindATimeConstraints({ dates: [spring], timezone: NY, now: nyNow, availability: av, plans: [] });
  const r = runTimingSearch(constrain(req, cToday));
  check('T13 spring-forward engine run: every candidate inside the 2 real hours', r.candidates.every((x) => within(x, [cToday.searchWindow!])));
  check('T13 no candidate has a real local start in the nonexistent 02:xx hour', r.candidates.every((x) => !localHHMM(x.start, NY).endsWith(' 02:00') && !/ 02:/.test(localHHMM(x.start, NY))));
}

// ============================================================
// T14 -- today clipping
// ============================================================
{
  const tenAm = at(WED, '10:07');
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: tenAm, availability: configured([{ weekday: 3, startTime: '06:00', endTime: '22:00' }]), plans: [] });
  check('T14 today window is clipped at now', c.searchWindow!.start.getTime() === tenAm.getTime());
  const r = runTimingSearch(constrain({ ...baseFind({ limit: 1000, timePreference: 'ANY' }), context: ctx(tenAm) }, c));
  check('T14 no candidate before now', r.candidates.every((x) => new Date(x.start).getTime() >= tenAm.getTime()));
  const late = at(WED, '22:30');
  const cl = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: late, availability: configured([{ weekday: 3, startTime: '06:00', endTime: '22:00' }]), plans: [] });
  check('T14 today\'s window already over -> NO_AVAILABILITY_IN_RANGE', cl.hasUsableAvailability === false && resolveFindATimeEmptyReason(cl, 0) === 'NO_AVAILABILITY_IN_RANGE');
}

// ============================================================
// T15 -- Daily Rhythm stays soft, over eligible candidates only
// ============================================================
{
  const prefs = { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] };
  const insideWorkOnly = configured([{ weekday: 3, startTime: '10:00', endTime: '16:00' }]);
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: insideWorkOnly, plans: [] });
  const res = runTimingSearchWithDailyRhythm(constrain(baseFind({ timePreference: 'ANY' }), c), IST, prefs);
  check('T15 availability entirely inside work hours: Daily Rhythm does not remove the eligible slots (soft)', res.candidates.length === 3 && res.candidates.every((x) => within(x, [c.searchWindow!])));
  check('T15 ... and annotates them as the in-hours fallback', res.candidates.every((x) => typeof res.dailyRhythmNotes?.[x.start] === 'string'));
  const wide = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability: configured([{ weekday: 3, startTime: '06:00', endTime: '22:00' }]), plans: [] });
  const r2 = runTimingSearchWithDailyRhythm(constrain(baseFind({ timePreference: 'ANY' }), wide), IST, prefs);
  const workStart = at(WED, '09:00').getTime();
  const workEnd = at(WED, '17:00').getTime();
  check('T15 with outside-work room available, Daily Rhythm still prefers outside-work slots, all inside availability', r2.candidates.length > 0 && r2.candidates.every((x) => within(x, [wide.searchWindow!]) && (new Date(x.end).getTime() <= workStart || new Date(x.start).getTime() >= workEnd)));
}

// ============================================================
// T16 (pure part) -- CHECK is never constrained by this module's caller
// ============================================================
{
  const checkReq: TimingSearchRequest = { mode: 'CHECK', context: C, activityId: 'workout', durationMinutes: 30, candidateStart: at(WED, '02:00').toISOString() };
  const r = runTimingSearch(checkReq);
  check('T16 CHECK scores the explicit 02:00 instant unchanged (route only builds constraints for FIND)', r.mode === 'CHECK' && r.candidates.length === 1 && r.candidates[0].start === at(WED, '02:00').toISOString());
}

// ============================================================
// T22 -- Panchangam ranking preserved
// ============================================================
{
  const availability = configured([{ weekday: 3, startTime: '06:00', endTime: '22:00' }]);
  const blockers = [plan(WED, '06:00', '06:30'), plan(WED, '18:00', '18:45')];
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability, plans: blockers });
  const all = runTimingSearch(baseFind({ limit: 1000, timePreference: 'ANY' })).candidates;
  const constrained = runTimingSearch(constrain(baseFind({ limit: 1000, timePreference: 'ANY' }), c)).candidates;
  const expected = all.filter((x) => within(x, [c.searchWindow!]) && !overlapsAny(x, c.excludedIntervals));
  // Equal-score ties may be ordered differently (the engine's diversity
  // passes run over a different pool before its final stable score sort), so
  // ranking parity is asserted as: same eligible set, same score sequence.
  const byStart = new Map(expected.map((x) => [x.start, x]));
  check('T22 constrained full list == unconstrained list with ineligible slots removed (same set)', constrained.length > 0 && constrained.length === expected.length && constrained.every((x) => byStart.has(x.start)));
  check('T22 same score sequence (rank order by Panchang/auraFit score preserved)', JSON.stringify(constrained.map((x) => x.auraFitScore)) === JSON.stringify(expected.map((x) => x.auraFitScore)));
  check('T22 identical Panchang/auraFit scores for every surviving slot', constrained.every((x) => { const e = byStart.get(x.start)!; return x.score === e.score && x.auraFitScore === e.auraFitScore && x.muhurtaScore === e.muhurtaScore; }));
  check('T22 reasons still cite Panchang factors', constrained[0].reasons.length > 0);
  const top = runTimingSearch(constrain(baseFind({ limit: 3, timePreference: 'ANY' }), c)).candidates;
  check('T22 best constrained candidate has the highest eligible score', top[0].auraFitScore === expected[0].auraFitScore);
}

// ============================================================
// T23 -- empty result
// ============================================================
{
  const availability = configured([{ weekday: 3, startTime: '06:00', endTime: '07:00' }]);
  const fill = plan(WED, '06:00', '07:00');
  const c = buildFindATimeConstraints({ dates: [WED], timezone: IST, now: NOW, availability, plans: [fill] });
  const r = runTimingSearch(constrain(baseFind({ timePreference: 'ANY' }), c));
  check('T23 window fully occupied -> zero candidates', r.candidates.length === 0);
  check('T23 emptyReason NO_ELIGIBLE_TIME', resolveFindATimeEmptyReason(c, r.candidates.length) === 'NO_ELIGIBLE_TIME');
  check('T23 non-empty result -> no emptyReason', resolveFindATimeEmptyReason(c, 2) === undefined);
  check('T23 copy for NO_ELIGIBLE_TIME mentions availability and existing plans', /availability/.test(presentFindATimeEmptyReason('NO_ELIGIBLE_TIME') ?? '') && /plans/.test(presentFindATimeEmptyReason('NO_ELIGIBLE_TIME') ?? ''));
  check('T23 copy for NO_AVAILABILITY_IN_RANGE', /availability/.test(presentFindATimeEmptyReason('NO_AVAILABILITY_IN_RANGE') ?? ''));
  check('T23 unknown/absent reason -> null (generic copy kept)', presentFindATimeEmptyReason(undefined) === null && presentFindATimeEmptyReason('X') === null);
}

// ============================================================
// overlapPolicy parsing + PLAN_OVERLAP presentation (T17/T24 support)
// ============================================================
check('overlapPolicy absent -> ALLOW (legacy callers unchanged)', parseOverlapPolicy(undefined) === 'ALLOW' && parseOverlapPolicy(null) === 'ALLOW');
check('overlapPolicy REJECT_ACTIVE_OVERLAP accepted', parseOverlapPolicy('REJECT_ACTIVE_OVERLAP') === 'REJECT_ACTIVE_OVERLAP');
check('overlapPolicy explicit ALLOW accepted', parseOverlapPolicy('ALLOW') === 'ALLOW');
check('overlapPolicy unknown/garbage -> null (400)', parseOverlapPolicy('reject') === null && parseOverlapPolicy(1) === null && parseOverlapPolicy({}) === null);
{
  const body = { code: 'PLAN_OVERLAP', error: 'That time overlaps another plan.', conflict: { title: 'Running', plannedStartAt: '2026-11-18T14:00:00.000Z', plannedEndAt: '2026-11-18T14:30:00.000Z' } };
  check('isPlanOverlapResponse recognizes the 409 body', isPlanOverlapResponse(body) && !isPlanOverlapResponse({ code: 'CAPACITY_EXCEEDED' }) && !isPlanOverlapResponse(null));
  const conflict = parsePlanOverlapConflict(body);
  check('parsePlanOverlapConflict extracts title/start/end', conflict?.title === 'Running');
  check('parsePlanOverlapConflict rejects malformed details', parsePlanOverlapConflict({ conflict: { title: 1 } }) === null && parsePlanOverlapConflict({ conflict: { title: 'x', plannedStartAt: 'nope', plannedEndAt: 'nope' } }) === null && parsePlanOverlapConflict({}) === null);
  const p = presentPlanOverlap(conflict, IST);
  check('presentPlanOverlap names the plan and its local time', p.detail.includes('“Running”') && p.detail.includes('7:30 PM') && p.detail.includes('8:00 PM') && p.detail.includes('Wed'));
  check('presentPlanOverlap says nothing was saved', /Nothing was saved/.test(p.detail));
  check('presentPlanOverlap Save anyway label names the conflict for screen readers', p.saveAnywayLabel === 'Save anyway, overlapping Running');
  const g = presentPlanOverlap(null, IST);
  check('presentPlanOverlap without details (deleted/raced plan) still renders a safe message', /another plan/.test(g.detail) && g.saveAnywayLabel.length > 0);
}

console.log(`\n${count} checks`);
if (!allPassed) {
  console.log('SOME CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
