/**
 * AURA-MR2 -- pure tests (no DB, no real clock) for My Rhythm scheduling
 * preferences and next-week planning:
 *   - planning-week resolution (timezone-free civil dates, week/year bounds);
 *   - the ONE shared weekday interpretation;
 *   - generateWeeklyRhythmProposal: backward compatibility, weekday filter,
 *     time-of-day via the engine's own timePreference + explained fallback,
 *     duration preference, Daily Rhythm notes, engine (Panchang) ranking left
 *     untouched, next-week capacity/duplicate handling;
 *   - Home view model and card actions;
 *   - Plan My Day intent defaults and the preview parser's timePreference.
 * The DB/route behavior is proved in test/myRhythmSchedulingDb.test.ts.
 */
import { generateWeeklyRhythmProposal, selectDistinctDayProposals, describeTimeOfDayCompromise, type WeeklyRhythmProposalDeps } from '../apps/web/lib/goalRhythmWeeklyProposal';
import { resolveRhythmPlanningWeek, isPreferredRhythmDate, isRhythmPlanningWeek, NO_RHYTHM_PREFERENCES } from '../apps/web/lib/goalActivityRhythmPreferences';
import { buildHomeGoalRhythmSuggestions, mapGoalDemandToHomeRhythmSuggestions, resolveGoalRhythmCardActions, formatNextOccurrenceLabel } from '../apps/web/lib/homeGoalRhythmSuggestions';
import { createIntentRowFromAutoGoalSuggestion, createIntentRowFromGoalHandoffItem, buildRequestedIntentsForSubmission } from '../apps/web/lib/planDayEntry';
import { parseConstructDayPreviewRequestBody } from '../apps/web/lib/dayConstructorPreviewRequest';
import { durationMinutesFor } from '../apps/web/lib/dayBuilderOrchestrator';
import type { CandidateGoalActivityForRhythmDemandRow } from '../apps/web/lib/db';
import type { GoalActivityRhythmOccurrenceFact } from '../apps/web/lib/goalActivityRhythm';
import type { GoalDemandCandidate } from '../apps/web/lib/goalDemandCandidates';
import type { TimingCandidate, TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import type { TimingSearchResponseWithDailyRhythm } from '../apps/web/lib/timingSearchDailyRhythm';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const TZ = 'Asia/Kolkata'; // UTC+05:30, no DST
// Wednesday 2026-11-25, 05:30 IST.
const NOW = new Date('2026-11-25T00:00:00.000Z');
const TODAY = '2026-11-25';
const CONTEXT = { now: NOW, latitude: 13.08, longitude: 80.27, timezone: TZ, tzOffsetMinutes: 330 } as unknown as DailyAssistantContext;
const NO_DAILY_RHYTHM = { workStart: null, workEnd: null, workDays: [] };

/** A candidate at `hhmm` IST on `date`, 30 minutes long. */
function cand(date: string, hhmm: string, score: number, minutes = 30): TimingCandidate {
  const [h, m] = hhmm.split(':').map(Number);
  const startMs = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m) - 330 * 60000;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + minutes * 60000).toISOString(),
    score,
    label: 'GOOD',
    muhurtaScore: 0,
    reasons: [],
    metadata: { windowType: 'NEUTRAL' as never, windowLabel: '', activityType: 'running', dateLabel: date },
  } as TimingCandidate;
}
function istHour(iso: string): number {
  return (new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes() + 330) / 60 % 24;
}
const isMorning = (c: TimingCandidate) => istHour(c.start) >= 5 && istHour(c.start) < 12;

function row(overrides: Partial<CandidateGoalActivityForRhythmDemandRow> = {}): CandidateGoalActivityForRhythmDemandRow {
  return { goalActivityId: 'ga-run', goalId: 'goal-1', goalTitle: 'Get fit', title: 'Run', activityId: 'running', rhythmKind: 'N_PER_WEEK', rhythmTargetPerWeek: 3, ...overrides };
}

/** A fake engine that honours timePreference the way runFind does (filters
 * candidate START hours) and returns the pool in the given (ranked) order. */
function depsFor(rows: CandidateGoalActivityForRhythmDemandRow[], pool: TimingCandidate[], facts: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]> = new Map(), dailyRhythmNotes?: Record<string, string>) {
  const calls: TimingSearchRequest[] = [];
  const deps: WeeklyRhythmProposalDeps = {
    loadCandidateGoalActivities: async () => rows,
    loadRhythmFacts: async () => facts,
    runFind: (request: TimingSearchRequest): TimingSearchResponseWithDailyRhythm => {
      calls.push(request);
      const inRange = pool.filter((c) => {
        const d = c.metadata.dateLabel;
        return d >= request.dateRange!.start && d <= request.dateRange!.end;
      });
      const filtered = request.timePreference === 'MORNING' ? inRange.filter(isMorning) : inRange;
      return { mode: 'FIND', candidates: filtered, ...(dailyRhythmNotes ? { dailyRhythmNotes } : {}) };
    },
  };
  return { deps, calls };
}
const params = (week?: 'CURRENT' | 'NEXT') => ({ userId: 'u1', goalActivityId: 'ga-run', planningLocalDate: TODAY, timezone: TZ, context: CONTEXT, dailyRhythmPrefs: NO_DAILY_RHYTHM, ...(week ? { week } : {}) });

async function main() {
  // ---------------- planning weeks ----------------
  check('W1. CURRENT on a Wednesday = today..Sunday', same(resolveRhythmPlanningWeek('2026-11-25', 'CURRENT'), { week: 'CURRENT', planningLocalDate: '2026-11-25', startDate: '2026-11-25', endDate: '2026-11-29' }));
  check('W2. NEXT on a Wednesday = next Monday..Sunday, capacity evaluated for next Monday', same(resolveRhythmPlanningWeek('2026-11-25', 'NEXT'), { week: 'NEXT', planningLocalDate: '2026-11-30', startDate: '2026-11-30', endDate: '2026-12-06' }));
  check('W3. NEXT on a Sunday (last day of the week) = the very next day..', same(resolveRhythmPlanningWeek('2026-11-29', 'NEXT'), { week: 'NEXT', planningLocalDate: '2026-11-30', startDate: '2026-11-30', endDate: '2026-12-06' }));
  check('W4. NEXT on a Monday skips the rest of this week', resolveRhythmPlanningWeek('2026-11-30', 'NEXT').startDate === '2026-12-07');
  check('W5. CURRENT on a Sunday = just that Sunday', same(resolveRhythmPlanningWeek('2026-11-29', 'CURRENT'), { week: 'CURRENT', planningLocalDate: '2026-11-29', startDate: '2026-11-29', endDate: '2026-11-29' }));
  check('W6. NEXT across a year boundary (Thu 2026-12-31 -> Mon 2027-01-04..Sun 2027-01-10)', same(resolveRhythmPlanningWeek('2026-12-31', 'NEXT'), { week: 'NEXT', planningLocalDate: '2027-01-04', startDate: '2027-01-04', endDate: '2027-01-10' }));
  check('W7. NEXT across a US DST change is still 7 civil days (Sun 2027-03-14 -> 2027-03-15..2027-03-21)', same(resolveRhythmPlanningWeek('2027-03-14', 'NEXT'), { week: 'NEXT', planningLocalDate: '2027-03-15', startDate: '2027-03-15', endDate: '2027-03-21' }));
  check('W8. isRhythmPlanningWeek accepts only CURRENT/NEXT', isRhythmPlanningWeek('CURRENT') && isRhythmPlanningWeek('NEXT') && !isRhythmPlanningWeek('next') && !isRhythmPlanningWeek(undefined));

  // ---------------- shared weekday interpretation ----------------
  check('D1. no weekday preference: every date qualifies', isPreferredRhythmDate(NO_RHYTHM_PREFERENCES, '2026-11-29'));
  check('D2. Mon/Wed/Fri: Wednesday 2026-11-25 qualifies, Sunday 2026-11-29 does not', isPreferredRhythmDate({ ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [1, 3, 5] }, '2026-11-25') && !isPreferredRhythmDate({ ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [1, 3, 5] }, '2026-11-29'));

  // ---------------- weekly proposal ----------------
  // Pool: this week Wed..Sun and next week Mon..Sun; morning (07:00) and evening (19:00) each day.
  const days = ['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
  const pool = days.flatMap((d, i) => [cand(d, '07:00', 8 - (i % 3)), cand(d, '19:00', 5)]);

  {
    const { deps, calls } = depsFor([row()], pool);
    const r = await generateWeeklyRhythmProposal(deps, params());
    check('P1. no preferences: one engine call with timePreference ANY over today..Sunday', calls.length === 1 && calls[0].timePreference === 'ANY' && same(calls[0].dateRange, { start: TODAY, end: '2026-11-29' }));
    check('P1. no preferences: duration is the existing catalog default', calls[0].durationMinutes === durationMinutesFor('running'));
    const expected = selectDistinctDayProposals(pool.filter((c) => c.metadata.dateLabel <= '2026-11-29'), TZ, 3).map((c) => c.start).sort();
    check('P1. no preferences: exactly the pre-MR2 distinct-day selection', r.status === 'OK' && same(r.proposals.map((p) => p.start), expected));
    check('P1. no preferences: every item matched, no notes; result reports CURRENT week and no preferences', r.status === 'OK' && r.proposals.every((p) => p.matchedPreferences === true && (p.notes ?? []).length === 0) && r.week === 'CURRENT' && same(r.preferences, NO_RHYTHM_PREFERENCES));
  }
  {
    const prefs = { rhythmPreferredWeekdays: [1, 3, 5], rhythmPreferredTimeOfDay: null, rhythmPreferredDurationMinutes: null };
    const facts = new Map([['ga-run', [{ localDate: '2026-11-26', contribution: 'COMMITTED' as const }, { localDate: '2026-12-02', contribution: 'COMMITTED' as const }]]]);
    const { deps, calls } = depsFor([row(prefs)], pool, facts);
    const r = await generateWeeklyRhythmProposal(deps, params('NEXT'));
    check('P2. NEXT: searches only next Monday..Sunday', same(calls[0].dateRange, { start: '2026-11-30', end: '2026-12-06' }));
    check("P2. NEXT: capacity is next week's (this week's commitment ignored, next week's counted) -> 2 remaining", r.status === 'OK' && r.remainingThisWeek === 2 && r.requestedCount === 2);
    check('P2. weekday preference is strict: only Mon 2026-11-30 and Fri 2026-12-04 (Wed already committed -> no duplicate)', r.status === 'OK' && same(r.proposals.map((p) => p.localDate), ['2026-11-30', '2026-12-04']));
    check('P2. result carries week NEXT and its bounds', r.status === 'OK' && r.week === 'NEXT' && r.weekStartDate === '2026-11-30' && r.weekEndDate === '2026-12-06');
  }
  {
    // Morning preferred; Wednesday 2026-12-02 has NO morning slot.
    const pool2 = pool.filter((c) => !(c.metadata.dateLabel === '2026-12-02' && isMorning(c)));
    const prefs = { rhythmPreferredWeekdays: [1, 3, 5], rhythmPreferredTimeOfDay: 'MORNING', rhythmPreferredDurationMinutes: null };
    const { deps, calls } = depsFor([row(prefs)], pool2);
    const r = await generateWeeklyRhythmProposal(deps, params('NEXT'));
    check("P3. time-of-day goes to the engine's own timePreference first, then an ANY fallback pass", calls.length === 2 && calls[0].timePreference === 'MORNING' && calls[1].timePreference === 'ANY');
    const byDate = r.status === 'OK' ? new Map(r.proposals.map((p) => [p.localDate, p])) : new Map();
    check('P3. Mon and Fri sessions are mornings and marked matched', byDate.get('2026-11-30')?.matchedPreferences === true && isMorning({ start: byDate.get('2026-11-30')!.start } as TimingCandidate) && byDate.get('2026-12-04')?.matchedPreferences === true);
    check('P3. Wednesday falls back to the best time that day and explains the compromise', byDate.get('2026-12-02')?.matchedPreferences === false && (byDate.get('2026-12-02')?.notes ?? []).includes(describeTimeOfDayCompromise('MORNING')));
    check('P3. the fallback never moves a session to a non-preferred day', r.status === 'OK' && r.proposals.every((p) => ['2026-11-30', '2026-12-02', '2026-12-04'].includes(p.localDate)));
  }
  {
    const prefs = { rhythmPreferredWeekdays: [], rhythmPreferredTimeOfDay: 'MORNING', rhythmPreferredDurationMinutes: 45 };
    const { deps, calls } = depsFor([row(prefs)], pool);
    const r = await generateWeeklyRhythmProposal(deps, params());
    check('P4. all preferred days have a morning: no fallback call', calls.length === 1);
    check('P5. duration preference (45) is used for the search and every item', calls[0].durationMinutes === 45 && r.status === 'OK' && r.proposals.every((p) => p.durationMinutes === 45));
  }
  {
    // Weekday-limited shortfall: Mon/Wed preferred, 2 remaining, Monday has nothing usable.
    const pool3 = pool.filter((c) => c.metadata.dateLabel !== '2026-11-30');
    const prefs = { rhythmPreferredWeekdays: [1, 3], rhythmPreferredTimeOfDay: null, rhythmPreferredDurationMinutes: null };
    const { deps } = depsFor([row({ ...prefs, rhythmTargetPerWeek: 2 })], pool3);
    const r = await generateWeeklyRhythmProposal(deps, params('NEXT'));
    check('P6. shortfall instead of relaxing weekdays, explained with the preferred day names', r.status === 'OK' && r.proposals.length === 1 && r.shortfallReason === 'FEWER_SUITABLE_DAYS_THAN_REQUESTED' && /Monday, Wednesday/.test(r.shortfallExplanation ?? ''));
  }
  {
    const target = cand('2026-11-30', '07:00', 9);
    const note = 'Outside your work hours.';
    const { deps } = depsFor([row({ rhythmPreferredWeekdays: [1], rhythmTargetPerWeek: 1 })], [target], new Map(), { [target.start]: note });
    const r = await generateWeeklyRhythmProposal(deps, params('NEXT'));
    check('P7. the existing Daily Rhythm work-hours note is carried on the session', r.status === 'OK' && (r.proposals[0].notes ?? []).includes(note));
  }
  {
    // Engine-ranked order for Monday: the 9-scored 10:30 slot outranks the 6-scored 07:00 slot.
    const ranked = [cand('2026-11-30', '10:30', 9), cand('2026-11-30', '07:00', 6)];
    const { deps } = depsFor([row({ rhythmPreferredWeekdays: [1], rhythmPreferredTimeOfDay: 'MORNING', rhythmTargetPerWeek: 1 })], ranked);
    const r = await generateWeeklyRhythmProposal(deps, params('NEXT'));
    check("P8. Panchang/Aura Fit ranking decides the time within the preferred window (engine's top candidate, never re-sorted by clock time)", r.status === 'OK' && r.proposals[0].start === ranked[0].start && r.proposals[0].score === 9);
  }
  {
    const { deps, calls } = depsFor([], pool); // a paused rhythm is not a demand row (SQL excludes it)
    const r = await generateWeeklyRhythmProposal(deps, params('NEXT'));
    check('P9. a rhythm absent from demand (e.g. paused) -> NOT_ELIGIBLE and no engine call', r.status === 'NOT_ELIGIBLE' && calls.length === 0);
  }

  // ---------------- Home view model ----------------
  const c = (overrides: Partial<GoalDemandCandidate> = {}): GoalDemandCandidate => ({ goalActivityId: 'ga-a', goalId: 'g', goalTitle: 'G', title: 'Walk', activityId: null, remainingThisWeek: 2, rhythm: { targetPerWeek: 3, completedThisWeek: 1, committedThisWeek: 0, remainingOccurrences: 2 }, ...overrides });
  check('H1. without MR2 extras the Home suggestions are byte-identical to the pre-MR2 mapping', same(buildHomeGoalRhythmSuggestions({ status: 'OK', candidates: [c()] }), mapGoalDemandToHomeRhythmSuggestions([c()])));
  const prefC = c({ preferences: { preferredWeekdays: [1], preferredTimeOfDay: null, preferredDurationMinutes: null }, preferredOnPlanningDate: false });
  const view = buildHomeGoalRhythmSuggestions({ status: 'OK', candidates: [prefC], planningLocalDate: TODAY, nextWeekCandidates: [c({ goalActivityId: 'ga-a', remainingThisWeek: 3 }), c({ goalActivityId: 'ga-b', title: 'Yoga', remainingThisWeek: 2 })], nextOccurrenceByGoalActivityId: { 'ga-a': { plannedActivityId: 'p1', start: '2026-11-30T01:30:00.000Z', end: '2026-11-30T02:00:00.000Z' } } });
  const a = view.find((s) => s.goalActivityId === 'ga-a')!;
  const b = view.find((s) => s.goalActivityId === 'ga-b')!;
  check('H2. a non-preferred day: flagged, and no "today" handoff is offered', a.notPreferredToday === true && resolveGoalRhythmCardActions(a, true).todayHandoff === null && resolveGoalRhythmCardActions(a, true).weeklyReview === true);
  check('H3. confirmed next session and next-week remaining are attached', a.nextOccurrence?.plannedActivityId === 'p1' && a.nextWeekRemaining === 3 && resolveGoalRhythmCardActions(a, true).offerNextWeek === true);
  check("H4. a rhythm open only next week gets a 'Plan next week' card (this week complete)", b.currentWeekComplete === true && b.nextWeekRemaining === 2 && resolveGoalRhythmCardActions(b, true).primaryWeek === 'NEXT' && resolveGoalRhythmCardActions(b, true).primaryLabel === 'Plan next week');
  check('H5. the next-session label is local time and always says Confirmed (never a suggestion)', formatNextOccurrenceLabel(a.nextOccurrence!, TZ) === 'Next: Mon, Nov 30 · 7:00 AM · Confirmed');
  check('H6. pre-MR2 card actions are unchanged when no MR2 fields are present', same(resolveGoalRhythmCardActions({ remainingThisWeek: 2 }, true), { todayHandoff: 'JUST_TODAY', weeklyReview: true, primaryLabel: 'Plan remaining 2', scheduledTodayNote: null }) && same(resolveGoalRhythmCardActions({ remainingThisWeek: 1 }, false), { todayHandoff: 'PLAN_IT', weeklyReview: false, primaryLabel: 'Plan it', scheduledTodayNote: null }));

  // ---------------- Plan My Day ----------------
  const prefs = { preferredTimeOfDay: 'MORNING' as const, preferredDurationMinutes: 45 };
  const autoRow = createIntentRowFromAutoGoalSuggestion({ title: 'Run', activityId: 'running', goalActivityId: 'ga-run', preferences: prefs }, 'goal-demand:2026-11-25:ga-run');
  const [autoIntent] = buildRequestedIntentsForSubmission([autoRow], TZ, TODAY);
  check('E1. a rhythm suggestion row sends the preferred time of day and duration as defaults', autoIntent.timePreference === 'MORNING' && autoIntent.durationMinutes === 45);
  const [explicitIntent] = buildRequestedIntentsForSubmission([{ ...autoRow, durationMinutes: 90 }], TZ, TODAY);
  check("E2. the row's explicit duration wins over the preference", explicitIntent.durationMinutes === 90 && explicitIntent.timePreference === 'MORNING');
  const [fixedIntent] = buildRequestedIntentsForSubmission([{ ...autoRow, timeMode: 'FIXED', fixedTime: '18:00' }], TZ, TODAY);
  check('E3. an explicit fixed time wins: no timePreference is sent', fixedIntent.timePreference === undefined && fixedIntent.flexibility === 'FIXED');
  const plainRow = createIntentRowFromGoalHandoffItem({ id: 'ga-x', title: 'Read', activityId: null }, null);
  const [plainIntent] = buildRequestedIntentsForSubmission([plainRow], TZ, TODAY);
  check('E4. without preferences the intent is unchanged (no timePreference, no duration)', plainIntent.timePreference === undefined && plainIntent.durationMinutes === undefined);
  const handoffRow = createIntentRowFromGoalHandoffItem({ id: 'ga-y', title: 'Walk', activityId: null, preferences: { preferredTimeOfDay: 'EVENING', preferredDurationMinutes: null } }, null);
  check('E5. a Goal handoff item carries its rhythm time-of-day preference too', buildRequestedIntentsForSubmission([handoffRow], TZ, TODAY)[0].timePreference === 'EVENING');

  const parseCtx = { timezone: TZ, now: NOW };
  const okParse = parseConstructDayPreviewRequestBody({ targetDate: TODAY, intents: [{ id: 'i1', title: 'Run', flexibility: 'FLEXIBLE', timePreference: 'MORNING' }] }, parseCtx);
  check('E6. the preview parser accepts a FLEXIBLE intent timePreference', okParse.ok && okParse.request.intents[0].timePreference === 'MORNING');
  check('E7. the preview parser rejects an unknown or ANY timePreference', !parseConstructDayPreviewRequestBody({ targetDate: TODAY, intents: [{ id: 'i1', title: 'Run', flexibility: 'FLEXIBLE', timePreference: 'ANY' }] }, parseCtx).ok && !parseConstructDayPreviewRequestBody({ targetDate: TODAY, intents: [{ id: 'i1', title: 'Run', flexibility: 'FLEXIBLE', timePreference: 'morning' }] }, parseCtx).ok);
  check('E8. the preview parser rejects timePreference on a FIXED intent', !parseConstructDayPreviewRequestBody({ targetDate: TODAY, intents: [{ id: 'i1', title: 'Run', flexibility: 'FIXED', fixedStart: '2026-11-25T12:00:00.000Z', timePreference: 'MORNING' }] }, parseCtx).ok);
  const noPrefParse = parseConstructDayPreviewRequestBody({ targetDate: TODAY, intents: [{ id: 'i1', title: 'Run', flexibility: 'FLEXIBLE' }] }, parseCtx);
  check('E9. an intent without timePreference parses exactly as before (no key added)', noPrefParse.ok && !('timePreference' in noPrefParse.request.intents[0]));

  if (!allPassed) {
    console.error('\nSome checks FAILED.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
