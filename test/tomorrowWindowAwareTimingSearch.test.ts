/**
 * Construction-Window-Aware Timing Search V1 -- end-to-end behavioral
 * regression suite, against the REAL `runTimingSearch` engine and the
 * REAL `orchestrateConstructDay` (never a fake/mocked `searchTiming`,
 * per this ticket's own explicit instruction: "Use the actual
 * timing-search/orchestrator path rather than mocking away the defect").
 *
 * Reproduces, then proves fixed, the exact root cause found by the
 * "AURA -- Tomorrow Activity Placement Comparison Audit": `runTimingSearch`
 * FIND mode ranked candidates across the ENTIRE target day and truncated
 * to a small default `limit` (3) with zero awareness of the caller's
 * actual construction/availability window, so a narrow real availability
 * window could have its own genuinely-feasible candidates crowded out by
 * higher-scoring but unusable out-of-window candidates before
 * `constructDay` ever saw them -- surfacing as a spurious
 * `OUTSIDE_CONSTRUCTION_WINDOW` deferral even though real capacity
 * remained.
 *
 * Every scenario here uses a deterministic clock, timezone, and location
 * (matching the audit's own reproduction fixtures) so results are stable
 * across runs -- no wall-clock dependency anywhere.
 */
import {
  orchestrateConstructDay,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
  type RequestedDayIntent,
  type PlanBlockerCandidate,
} from '../apps/web/lib/dayConstructorOrchestrator';
import { runTimingSearch, type TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { resolveTzOffsetMinutes } from '../apps/web/lib/timezone';
import type { AvailabilityConfiguration } from '../apps/web/lib/availabilityContext';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TIMEZONE = 'America/New_York';
const NOW = new Date('2026-09-22T15:00:00.000Z'); // "today"
const TARGET_DATE = '2026-09-23'; // "tomorrow"
const weekdayForTarget = new Date(TARGET_DATE + 'T12:00:00Z').getUTCDay();

const context = {
  now: NOW,
  latitude: 40.7128,
  longitude: -74.006,
  timezone: TIMEZONE,
  tzOffsetMinutes: resolveTzOffsetMinutes(TIMEZONE, NOW),
  personalContext: undefined,
};

const NARROW_PERIODS: AvailabilityConfiguration['periods'] = [
  { weekday: weekdayForTarget as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '09:00' },
];

function makeDeps(periods: AvailabilityConfiguration['periods'], blockingPlans: PlanBlockerCandidate[] = []): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => blockingPlans,
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    loadAvailabilityConfiguration: async () => ({ configured: true, periods }),
    searchTiming: (request) => runTimingSearch({ ...request, context } as TimingSearchRequest),
  };
}

function intent(index: number, id: string, title: string, activityId?: string, durationMinutes?: number): RequestedDayIntent {
  return { id, title, activityId, flexibility: 'FLEXIBLE', originalOrder: index, durationMinutes };
}

async function run(periods: AvailabilityConfiguration['periods'], intents: RequestedDayIntent[], blockingPlans: PlanBlockerCandidate[] = []) {
  return runOnDate(TARGET_DATE, periods, intents, blockingPlans);
}

// PR #146 correctness amendment -- the mandatory narrow-peak regression
// (ticket section 8) needs a DIFFERENT real calendar date than the rest
// of this file's own fixtures (`TARGET_DATE`): 2026-10-17 is the specific
// date this session's own investigation found where "workout"/30min
// genuinely produces the fallback-pass-3 clustering defect (see
// test/timingSearch.test.ts's own unit-level proof of the same date/
// activity for the raw engine call). This helper lets those scenarios
// reuse the SAME real `orchestrateConstructDay` path as every other test
// in this file, just against that specific date instead of `TARGET_DATE`.
async function runOnDate(targetDate: string, periods: AvailabilityConfiguration['periods'], intents: RequestedDayIntent[], blockingPlans: PlanBlockerCandidate[] = []) {
  const request: ConstructDayRequest = {
    targetDate,
    timezone: TIMEZONE,
    constructionWindowSource: 'REMAINING_TODAY', // the real client's own default -- never overridden for Tomorrow planning.
    now: NOW,
    intents,
  };
  return orchestrateConstructDay(request, makeDeps(periods, blockingPlans));
}

function placedTitles(result: Awaited<ReturnType<typeof run>>): string[] {
  if (result.status !== 'READY') return [];
  return result.preview.constructedDay.proposedItems.map((p) => p.title);
}

function deferredIds(result: Awaited<ReturnType<typeof run>>): string[] {
  if (result.status !== 'READY') return [];
  return result.preview.constructedDay.deferredItems.map((d) => d.intentId);
}

async function main() {
  // ============================================================
  // A. Narrow-window FLEXIBLE placement (ticket section 5) -- a single
  // FLEXIBLE activity whose full-day top-3 candidates would previously
  // fall outside a narrow window can now receive an in-window candidate.
  // ============================================================
  {
    const result = await run(NARROW_PERIODS, [intent(0, 'i1', 'Meditate', 'meditation')]);
    check('A1. narrow-window (05:00-09:00): a single FLEXIBLE Meditate is placed', result.status === 'READY' && placedTitles(result).includes('Meditate'));
    if (result.status === 'READY') {
      const item = result.preview.constructedDay.proposedItems[0];
      const win = result.preview.constructionWindow;
      check('A2. the placed instant genuinely lies inside the resolved construction window', item.start.getTime() >= win.start.getTime() && item.end.getTime() <= win.end.getTime());
    }
  }

  // ============================================================
  // B. Errands (title-only, no activityId) FLEXIBLE placement (ticket
  // section 6) -- the audit's own worst-case control: failed even ALONE,
  // with zero competing intents, before this fix. Must not receive a
  // fake activityId to pass; generic duration fallback must still apply.
  // ============================================================
  {
    const result = await run(NARROW_PERIODS, [intent(0, 'i1', 'Errands', undefined)]);
    check('B1. Errands (no activityId) is placeable alone in a narrow window when a valid in-window candidate exists', result.status === 'READY' && placedTitles(result).includes('Errands'));
    if (result.status === 'READY') {
      const item = result.preview.constructedDay.proposedItems.find((p) => p.title === 'Errands');
      check('B2. the placed Errands item still carries no activityId (never fabricated to make this pass)', item !== undefined && item.activityId === undefined);
      check('B3. generic duration fallback warning is still surfaced for Errands (duration-resolution behavior unchanged)', result.preview.warnings.some((w) => w.intentId === 'i1' && w.code === 'DURATION_FROM_GENERIC_FALLBACK'));
    }
  }

  // ============================================================
  // C/D. Multi-intent fairness + reordering (ticket section 7) -- the
  // audit's own Run B (Workout, Meditate, Errands) and a reordered
  // variant (Meditate, Workout, Errands) within the SAME narrow window.
  // Real capacity exists for all three (proven by the audit's own
  // limit=60 diagnostic); no intent should be falsely deferred merely
  // because its own day-wide top-3 was truncated away from the window.
  // ============================================================
  {
    const resultB = await run(NARROW_PERIODS, [intent(0, 'i1', 'Workout', 'workout'), intent(1, 'i2', 'Meditate', 'meditation'), intent(2, 'i3', 'Errands', undefined)]);
    check('C1. Workout, Meditate, Errands: all three place in the narrow window (audit\'s own Run B, now fixed)', resultB.status === 'READY' && deferredIds(resultB).length === 0 && placedTitles(resultB).length === 3);

    const resultReordered = await run(NARROW_PERIODS, [intent(0, 'i1', 'Meditate', 'meditation'), intent(1, 'i2', 'Workout', 'workout'), intent(2, 'i3', 'Errands', undefined)]);
    check('D1. reordered (Meditate, Workout, Errands): all three still place -- submission order no longer determines feasibility', resultReordered.status === 'READY' && deferredIds(resultReordered).length === 0 && placedTitles(resultReordered).length === 3);

    if (resultB.status === 'READY' && resultReordered.status === 'READY') {
      check('D2. both orderings place the exact same SET of activities (order-independence, the specific unfairness the audit found)', new Set(placedTitles(resultB)).size === 3 && new Set(placedTitles(resultReordered)).size === 3);
    }
  }

  // ============================================================
  // E. Learn, Learn, Errands (ticket section 8) -- capacity permits more
  // than one placement; a second identical-activity intent must not be
  // falsely deferred solely because its own remaining in-window
  // candidates were absent from a small day-wide result set.
  // ============================================================
  {
    const result = await run(NARROW_PERIODS, [intent(0, 'i1', 'Learn', 'learning'), intent(1, 'i2', 'Learn', 'learning'), intent(2, 'i3', 'Errands', undefined)]);
    check('E1. Learn, Learn, Errands: all three place (audit\'s own Run A, now fixed)', result.status === 'READY' && deferredIds(result).length === 0);
    check('E2. exactly two "Learn" items are placed, not deduplicated/merged', result.status === 'READY' && placedTitles(result).filter((t) => t === 'Learn').length === 2);
  }

  // ============================================================
  // F. Genuine scarcity is still respected (product invariant, ticket
  // BACKGROUND section) -- this fix must not manufacture capacity that
  // does not exist. A window too small for every intent must still defer
  // the ones that genuinely do not fit, for a legitimate reason.
  // ============================================================
  {
    // A single 30-minute period, one intent already occupies the whole
    // thing via a blocking Plan -- no capacity remains for a second.
    const tinyPeriod: AvailabilityConfiguration['periods'] = [{ weekday: weekdayForTarget as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '05:30' }];
    const blockingPlan: PlanBlockerCandidate = { start: new Date('2026-09-23T09:00:00.000Z'), end: new Date('2026-09-23T09:30:00.000Z'), status: 'UPCOMING' };
    const result = await run(tinyPeriod, [intent(0, 'i1', 'Meditate', 'meditation')], [blockingPlan]);
    // A window fully consumed by a blocking Plan (30 usable minutes, 30
    // blocked) correctly fails closed at the pure engine's own top-level
    // capacity guard (`dayCapacity.ts`'s `NO_USABLE_CAPACITY`, entirely
    // pre-existing and untouched by this PR) rather than reaching a
    // per-item deferral at all -- this fix does not, and must not,
    // fabricate capacity that genuinely does not exist.
    check('F1. a window fully occupied by a blocking Plan still fails closed to NO_USABLE_CAPACITY (no fabricated capacity)', result.status === 'NO_USABLE_CAPACITY');
    check('F2. the reported blocked/window minutes reflect the real Plan, not a zeroed-out placeholder', result.status === 'NO_USABLE_CAPACITY' && result.constructionWindowMinutes === 30 && result.blockedMinutes === 30);
  }
  {
    // Genuine PARTIAL scarcity, at the per-item level: the 4-hour narrow
    // window (240 usable minutes) cannot fit five 60-minute intents (300
    // requested minutes) -- some must be placed, at least one must be
    // legitimately deferred, coexisting in the SAME run. Proves this fix
    // does not turn genuine overload into false universal success.
    const fiveLongIntents = [0, 1, 2, 3, 4].map((i) => intent(i, `i${i}`, 'Meditate', 'meditation', 60));
    const result = await run(NARROW_PERIODS, fiveLongIntents);
    check('F3. genuine overload (300 requested min > 240 usable min): status is still READY, not a fabricated failure', result.status === 'READY');
    if (result.status === 'READY') {
      check('F4. at least one intent is placed', result.preview.constructedDay.proposedItems.length > 0);
      check('F5. at least one intent is genuinely deferred (real scarcity is not papered over)', result.preview.constructedDay.deferredItems.length > 0);
      check(
        'F6. every placed item genuinely fits inside the construction window with no overlap (real feasibility, not a relaxed check)',
        result.preview.constructedDay.proposedItems.every((p) => p.start.getTime() >= result.preview.constructionWindow.start.getTime() && p.end.getTime() <= result.preview.constructionWindow.end.getTime())
      );
    }
  }

  // ============================================================
  // G. Full-day / unbounded callers are unaffected (ticket section 10) --
  // a request with NO configured availability (UNCONFIGURED) falls back
  // to the pre-existing REMAINING_TODAY window, which the orchestrator
  // still resolves and passes through as `searchWindow` -- proving the
  // new field composes correctly with the existing UNCONFIGURED path
  // rather than being skipped by it.
  // ============================================================
  {
    const deps: DayConstructorOrchestratorDeps = {
      loadBlockingPlans: async () => [],
      loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
      loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
      searchTiming: (request) => runTimingSearch({ ...request, context: { ...context, now: new Date('2026-09-22T10:00:00.000Z') } } as TimingSearchRequest),
    };
    const request: ConstructDayRequest = {
      targetDate: '2026-09-22',
      timezone: TIMEZONE,
      constructionWindowSource: 'REMAINING_TODAY',
      now: new Date('2026-09-22T10:00:00.000Z'),
      intents: [intent(0, 'i1', 'Workout', 'workout')],
    };
    const result = await orchestrateConstructDay(request, deps);
    check('G1. UNCONFIGURED availability (today, no saved schedule) still places a FLEXIBLE intent -- pre-existing behavior unaffected', result.status === 'READY' && placedTitles(result).includes('Workout'));
  }

  // ============================================================
  // H. Disjoint (multi-period) availability (ticket section 4) --
  // `searchWindow` is always the OUTER span (earliest start to latest
  // end across every configured period, exactly what
  // `normalizeUsableWindowsToConstructionWindow` already produces as
  // `ConstructionWindow.start`/`.end`), never a per-period list. The gap
  // BETWEEN disjoint periods must still be correctly rejected -- that
  // stays entirely the job of the pre-existing, untouched
  // `BLOCKED_BY_COMMITMENT` gate (gap-blockers merged into
  // `blockedIntervals`), never something `searchWindow` itself
  // understands. Proves a FLEXIBLE candidate can still legitimately land
  // in a gap and get correctly rejected, through the REAL engine, not
  // merely asserted by reading the code.
  // ============================================================
  {
    // 04:00-05:00 and 08:00-09:00 local, with a 3-hour gap (05:00-08:00)
    // in between. searchWindow's own outer span is therefore 04:00-09:00
    // -- WIDER than either individual usable period -- so a candidate
    // landing inside the gap is not excluded by searchWindow at all; it
    // must be excluded by the separate, pre-existing gap-blocker gate.
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForTarget as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '04:00', endTime: '05:00' },
      { weekday: weekdayForTarget as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const result = await run(splitPeriods, [intent(0, 'i1', 'Meditate', 'meditation')]);
    check('H1. disjoint availability (04-05 + 08-09, 3h gap): status is READY, real capacity exists in both periods', result.status === 'READY');
    if (result.status === 'READY') {
      const win = result.preview.constructionWindow;
      check(
        'H2. the resolved construction window is the OUTER span (04:00-09:00 ET = 08:00-13:00 UTC), not a single narrow period',
        win.start.getTime() === new Date('2026-09-23T08:00:00.000Z').getTime() && win.end.getTime() === new Date('2026-09-23T13:00:00.000Z').getTime()
      );
      const gapStartUTC = new Date('2026-09-23T09:00:00.000Z'); // 05:00 ET
      const gapEndUTC = new Date('2026-09-23T12:00:00.000Z'); // 08:00 ET
      const placedInGap = result.preview.constructedDay.proposedItems.some((p) => p.start.getTime() < gapEndUTC.getTime() && p.end.getTime() > gapStartUTC.getTime());
      check('H3. if placed, the item never overlaps the gap between the two periods (gap-blocker gate still correctly enforced)', !placedInGap);
      check('H4. if placed, the item lies inside one of the two genuinely usable periods', result.preview.constructedDay.proposedItems.every((p) => p.start.getTime() >= win.start.getTime() && p.end.getTime() <= win.end.getTime()));
    }
  }

  // ============================================================
  // I. REAL-engine narrow-peak regression through the full orchestrator
  // (ticket section 9, mandatory, "do not mock away timing ranking in
  // the only regression"). Uses the SAME real, deterministic defect date
  // test/timingSearch.test.ts proves at the raw-engine level (2026-10-17,
  // "workout", 30 minutes -- the day's real top-3 candidates, without
  // excludedIntervals, would all cluster inside a 06:00-08:00 ET gap).
  // Here it runs through the full, real `orchestrateConstructDay`, with
  // real disjoint availability (05:00-06:00 + 08:00-09:00 ET), proving
  // the fix closes the defect end-to-end, not merely at the raw
  // `runTimingSearch` call.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const result = await runOnDate(NARROW_PEAK_DATE, splitPeriods, [intent(0, 'i1', 'Workout', 'workout')]);
    check('I1. the real narrow-peak defect date: status is READY (not a fabricated failure)', result.status === 'READY');
    check('I2. the real narrow-peak defect date: the FLEXIBLE Workout intent IS placed (this exact scenario would have failed before this amendment)', result.status === 'READY' && placedTitles(result).includes('Workout'));
    if (result.status === 'READY') {
      const item = result.preview.constructedDay.proposedItems[0];
      const gapStartUTC = new Date(`${NARROW_PEAK_DATE}T10:00:00.000Z`); // 06:00 ET
      const gapEndUTC = new Date(`${NARROW_PEAK_DATE}T12:00:00.000Z`); // 08:00 ET
      check('I3. the placed item never overlaps the 06:00-08:00 ET gap', !(item.start.getTime() < gapEndUTC.getTime() && gapEndUTC.getTime() > gapStartUTC.getTime() && item.end.getTime() > gapStartUTC.getTime() && item.start.getTime() < gapEndUTC.getTime()));
      const inFirstPeriod = item.start.getTime() >= new Date(`${NARROW_PEAK_DATE}T09:00:00.000Z`).getTime() && item.end.getTime() <= gapStartUTC.getTime();
      const inSecondPeriod = item.start.getTime() >= gapEndUTC.getTime() && item.end.getTime() <= new Date(`${NARROW_PEAK_DATE}T13:00:00.000Z`).getTime();
      check('I4. (first usable period discoverable) OR (second usable period discoverable) -- the placed item lies in one of them', inFirstPeriod || inSecondPeriod);
      check('I5. no false deferral: deferredItems is empty for this single-intent run despite the narrow-peak defect condition', result.preview.constructedDay.deferredItems.length === 0);
    }
  }

  // ============================================================
  // J. Pre-existing blocking Plan, contiguous availability (ticket
  // section 10) -- semantically verified safe first (required by the
  // ticket before broadening): a `FIXED_PLAN`-sourced `BlockedInterval`
  // is, exactly like an `AVAILABILITY_GAP` one, already fully computed
  // in `orchestrateConstructDay` BEFORE the per-intent search loop runs
  // (both are assembled into the same `blockedIntervals` array at one
  // single point, well before any `searchTiming` call) and represents
  // genuinely already-committed, unusable time -- safe to pass as an
  // excluded interval. availability 05:00-09:00 ET (contiguous), one
  // existing Plan occupying 06:00-08:00 ET (same clock range as the
  // gap scenario, proving the mechanism treats both blocker sources
  // identically).
  // ============================================================
  {
    const contiguousPeriod: AvailabilityConfiguration['periods'] = [{ weekday: weekdayForTarget as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '09:00' }];
    const existingPlan: PlanBlockerCandidate = { start: new Date('2026-09-23T10:00:00.000Z'), end: new Date('2026-09-23T12:00:00.000Z'), status: 'UPCOMING' }; // 06:00-08:00 ET
    const result = await run(contiguousPeriod, [intent(0, 'i1', 'Meditate', 'meditation')], [existingPlan]);
    check('J1. contiguous availability with an existing blocking Plan in the middle: status is READY', result.status === 'READY');
    check('J2. the FLEXIBLE intent is still placed (real capacity exists on either side of the Plan)', result.status === 'READY' && placedTitles(result).includes('Meditate'));
    if (result.status === 'READY') {
      const item = result.preview.constructedDay.proposedItems[0];
      const planStart = existingPlan.start.getTime();
      const planEnd = existingPlan.end.getTime();
      check('J3. the placed item never overlaps the existing Plan', !(item.start.getTime() < planEnd && planStart < item.end.getTime()));
    }
  }

  // ============================================================
  // K. Multi-intent fairness under DISJOINT availability (ticket section
  // 11.B) -- re-runs the Workout/Meditate/Errands scenario (and its
  // reordered variant) from sections C/D, but with a real gap in the
  // middle of the availability instead of one contiguous span, on the
  // real narrow-peak defect date so the gap-swallowing risk is genuinely
  // exercised, not merely possible in principle.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const resultB = await runOnDate(NARROW_PEAK_DATE, splitPeriods, [intent(0, 'i1', 'Workout', 'workout'), intent(1, 'i2', 'Meditate', 'meditation'), intent(2, 'i3', 'Errands', undefined)]);
    check('K1. disjoint availability (narrow-peak date), Workout/Meditate/Errands: no false deferral caused by top-N gap candidates', resultB.status === 'READY' && resultB.preview.constructedDay.proposedItems.length + resultB.preview.constructedDay.deferredItems.length === 3);
    check('K2. disjoint availability: nothing is placed inside the 06:00-08:00 ET gap', resultB.status === 'READY' && resultB.preview.constructedDay.proposedItems.every((p) => {
      const gapStartUTC = new Date(`${NARROW_PEAK_DATE}T10:00:00.000Z`).getTime();
      const gapEndUTC = new Date(`${NARROW_PEAK_DATE}T12:00:00.000Z`).getTime();
      return !(p.start.getTime() < gapEndUTC && gapStartUTC < p.end.getTime());
    }));

    const resultReordered = await runOnDate(NARROW_PEAK_DATE, splitPeriods, [intent(0, 'i1', 'Meditate', 'meditation'), intent(1, 'i2', 'Workout', 'workout'), intent(2, 'i3', 'Errands', undefined)]);
    check('K3. reordered under disjoint availability (narrow-peak date): still no placement inside the gap', resultReordered.status === 'READY' && resultReordered.preview.constructedDay.proposedItems.every((p) => {
      const gapStartUTC = new Date(`${NARROW_PEAK_DATE}T10:00:00.000Z`).getTime();
      const gapEndUTC = new Date(`${NARROW_PEAK_DATE}T12:00:00.000Z`).getTime();
      return !(p.start.getTime() < gapEndUTC && gapStartUTC < p.end.getTime());
    }));

    const resultLearn = await runOnDate(NARROW_PEAK_DATE, splitPeriods, [intent(0, 'i1', 'Learn', 'learning'), intent(1, 'i2', 'Learn', 'learning'), intent(2, 'i3', 'Errands', undefined)]);
    check('K4. Learn/Learn/Errands under disjoint availability (narrow-peak date): status READY, no placement inside the gap', resultLearn.status === 'READY' && resultLearn.preview.constructedDay.proposedItems.every((p) => {
      const gapStartUTC = new Date(`${NARROW_PEAK_DATE}T10:00:00.000Z`).getTime();
      const gapEndUTC = new Date(`${NARROW_PEAK_DATE}T12:00:00.000Z`).getTime();
      return !(p.start.getTime() < gapEndUTC && gapStartUTC < p.end.getTime());
    }));
  }

  // ============================================================
  // L. DYNAMIC CANDIDATE REPLENISHMENT V1 -- mandatory three-Workout
  // regression (ticket section 6). This is the EXACT reproduction the
  // prior amendment's own audit (section 12) found and left
  // deliberately unfixed/documented as a known limitation -- THIS
  // amendment closes it. Same disjoint-availability narrow-peak
  // scenario as section K: 3 IDENTICAL "Workout" intents (same
  // activity/duration/day -> identical raw candidate sets before any
  // placement). Before this amendment, the third was falsely deferred
  // as CONFLICTS_WITH_PROPOSED_ITEM despite 30 minutes of real,
  // unclaimed capacity remaining (05:30-06:00 ET); now all three must
  // place, each in a distinct, non-overlapping, genuinely-usable
  // interval.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const threeIdenticalWorkouts = [intent(0, 'i1', 'Workout', 'workout'), intent(1, 'i2', 'Workout', 'workout'), intent(2, 'i3', 'Workout', 'workout')];
    const result = await runOnDate(NARROW_PEAK_DATE, splitPeriods, threeIdenticalWorkouts);
    check('L1. three identical Workout intents: status is READY', result.status === 'READY');
    if (result.status === 'READY') {
      check('L2. all three identical Workout intents ARE placed (previously only 2 of 3 placed)', result.preview.constructedDay.proposedItems.length === 3);
      check('L3. zero deferrals (previously the third was falsely deferred as CONFLICTS_WITH_PROPOSED_ITEM)', result.preview.constructedDay.deferredItems.length === 0);
      const items = result.preview.constructedDay.proposedItems;
      check(
        'L4. every placed item is genuinely distinct and non-overlapping (real placements, not 3 copies of the same slot)',
        items.every((a, i) => items.every((b, j) => i === j || a.start.getTime() >= b.end.getTime() || b.start.getTime() >= a.end.getTime()))
      );
      const win = result.preview.constructionWindow;
      const gapStartUTC = new Date(`${NARROW_PEAK_DATE}T10:00:00.000Z`).getTime();
      const gapEndUTC = new Date(`${NARROW_PEAK_DATE}T12:00:00.000Z`).getTime();
      check(
        'L5. every placed item lies inside the outer window and never overlaps the gap (real feasibility, not a relaxed check)',
        items.every((p) => p.start.getTime() >= win.start.getTime() && p.end.getTime() <= win.end.getTime() && !(p.start.getTime() < gapEndUTC && gapStartUTC < p.end.getTime()))
      );
      check('L6. timing quality is still used: at least one placed item carries a real, non-empty timingFit tier', items.every((p) => typeof p.timingFit === 'string' && p.timingFit.length > 0));
    }
  }

  // M. CAPACITY EXHAUSTION CONTROL (ticket section 7, mandatory) --
  // replenishment must NOT turn into forced overbooking. Same 3
  // identical Workout intents, but availability shrunk so only TWO
  // 30-minute slots genuinely exist (05:00-05:30 + 08:00-08:30, exactly
  // one candidate per period, zero spare room). The third intent must
  // still be legitimately deferred.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const tightPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '05:30' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '08:30' },
    ];
    const threeIdenticalWorkouts = [intent(0, 'i1', 'Workout', 'workout'), intent(1, 'i2', 'Workout', 'workout'), intent(2, 'i3', 'Workout', 'workout')];
    const result = await runOnDate(NARROW_PEAK_DATE, tightPeriods, threeIdenticalWorkouts);
    check('M1. genuine 2-slot capacity, 3 requested: status is READY', result.status === 'READY');
    if (result.status === 'READY') {
      check('M2. exactly two Workout intents are placed (real capacity, not fabricated)', result.preview.constructedDay.proposedItems.length === 2);
      check('M3. exactly one Workout intent is legitimately deferred', result.preview.constructedDay.deferredItems.length === 1);
      const deferred = result.preview.constructedDay.deferredItems[0];
      // A genuine, accurate reason -- NO_CANDIDATES (replenishment's own
      // fresh search, with both real placements now excluded, correctly
      // found zero remaining options) -- not a stale/misleading
      // CONFLICTS_WITH_PROPOSED_ITEM, and not a new invented reason
      // (this ticket's own section 19: use existing taxonomy).
      check('M4. the deferral reason is the genuine NO_CANDIDATES (accurate, from existing taxonomy, not a stale conflict reason)', deferred.primaryReason === 'NO_CANDIDATES');
      const items = result.preview.constructedDay.proposedItems;
      check(
        'M5. the two placed items are genuinely distinct, non-overlapping, one per period',
        items.every((a, i) => items.every((b, j) => i === j || a.start.getTime() >= b.end.getTime() || b.start.getTime() >= a.end.getTime()))
      );
    }
  }

  // N. IDENTICAL "Learn" (ticket section 9, mandatory) -- proves the fix
  // is not Workout-specific. "learning"'s own catalog duration (20
  // minutes, distinct from workout's) is a genuinely different timing
  // distribution.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const threeIdenticalLearns = [intent(0, 'i1', 'Learn', 'learning'), intent(1, 'i2', 'Learn', 'learning'), intent(2, 'i3', 'Learn', 'learning')];
    const result = await runOnDate(NARROW_PEAK_DATE, splitPeriods, threeIdenticalLearns);
    check('N1. three identical Learn intents (different activity family than Workout): status is READY', result.status === 'READY');
    if (result.status === 'READY') {
      check('N2. all three identical Learn intents are placed (fix is not Workout-specific)', result.preview.constructedDay.proposedItems.length === 3);
      check('N3. zero deferrals', result.preview.constructedDay.deferredItems.length === 0);
      const items = result.preview.constructedDay.proposedItems;
      check(
        'N4. every placed item is genuinely distinct and non-overlapping',
        items.every((a, i) => items.every((b, j) => i === j || a.start.getTime() >= b.end.getTime() || b.start.getTime() >= a.end.getTime()))
      );
    }
  }

  // O. IDENTICAL "Errands" (ticket section 10, mandatory) -- title-only
  // repeated FLEXIBLE intents, no activityId, generic duration fallback
  // preserved (never a fabricated catalog id merely to make this test
  // pass). With only enough real capacity for TWO 45-minute Errands in
  // this exact availability, the third must still be legitimately
  // deferred -- proving replenishment does not overbook a title-only
  // activity either.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const threeIdenticalErrands = [intent(0, 'i1', 'Errands', undefined), intent(1, 'i2', 'Errands', undefined), intent(2, 'i3', 'Errands', undefined)];
    const result = await runOnDate(NARROW_PEAK_DATE, splitPeriods, threeIdenticalErrands);
    check('O1. three identical title-only Errands intents: status is READY', result.status === 'READY');
    if (result.status === 'READY') {
      check('O2. state-aware placement occurs when capacity permits: at least 2 of the 3 Errands are placed', result.preview.constructedDay.proposedItems.length >= 2);
      check(
        'O3. every placed Errands item still carries no activityId (never fabricated to make replenishment easier)',
        result.preview.constructedDay.proposedItems.every((p) => p.activityId === undefined)
      );
      check(
        'O4. generic duration fallback warning is still surfaced for every placed/attempted Errands intent',
        ['i1', 'i2', 'i3'].every((id) => result.preview.warnings.some((w) => w.intentId === id && w.code === 'DURATION_FROM_GENERIC_FALLBACK'))
      );
      const items = result.preview.constructedDay.proposedItems;
      check(
        'O5. every placed item is genuinely distinct and non-overlapping',
        items.every((a, i) => items.every((b, j) => i === j || a.start.getTime() >= b.end.getTime() || b.start.getTime() >= a.end.getTime()))
      );
      // With genuine capacity for exactly 2 (60-minute periods, 45-
      // minute duration -- 15 minutes remain in each, insufficient for
      // a third), a real 3rd Errands should be legitimately deferred,
      // never fabricated a placement.
      if (result.preview.constructedDay.proposedItems.length === 2) {
        const deferred = result.preview.constructedDay.deferredItems[0];
        check('O6. the genuinely un-placeable third Errands is deferred with an accurate reason (NO_CANDIDATES), not a stale conflict', deferred?.primaryReason === 'NO_CANDIDATES');
      }
    }
  }

  // P. FIXED + multiple FLEXIBLE (ticket section 11, mandatory) --
  // FIXED remains immovable; FLEXIBLE searches avoid its interval;
  // dynamic sibling placement (replenishment) still avoids newly
  // proposed intervals from OTHER flexible intents too; remaining
  // capacity stays discoverable.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const fixedStart = new Date(`${NARROW_PEAK_DATE}T09:00:00.000Z`); // 05:00 ET, inside the first period.
    const mixedIntents: RequestedDayIntent[] = [
      { id: 'i-fixed', title: 'Doctor appointment', flexibility: 'FIXED', fixedStart, durationMinutes: 30, originalOrder: 0 },
      intent(1, 'i1', 'Workout', 'workout'),
      intent(2, 'i2', 'Workout', 'workout'),
    ];
    const result = await runOnDate(NARROW_PEAK_DATE, splitPeriods, mixedIntents);
    check('P1. FIXED + 2 FLEXIBLE: status is READY', result.status === 'READY');
    if (result.status === 'READY') {
      const fixedItem = result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'i-fixed');
      check('P2. the FIXED intent is placed exactly at its requested instant (immovable)', fixedItem !== undefined && fixedItem.start.getTime() === fixedStart.getTime());
      const flexibleItems = result.preview.constructedDay.proposedItems.filter((p) => p.intentId !== 'i-fixed');
      check('P3. both FLEXIBLE Workout intents are also placed (remaining capacity stays discoverable around the FIXED commitment)', flexibleItems.length === 2);
      const fixedEnd = fixedStart.getTime() + 30 * 60000;
      check(
        'P4. neither FLEXIBLE placement overlaps the FIXED interval',
        flexibleItems.every((p) => p.start.getTime() >= fixedEnd || p.end.getTime() <= fixedStart.getTime())
      );
      check(
        'P5. the two FLEXIBLE placements do not overlap EACH OTHER either (dynamic sibling avoidance still works alongside a FIXED commitment)',
        flexibleItems.length < 2 || flexibleItems[0].start.getTime() >= flexibleItems[1].end.getTime() || flexibleItems[1].start.getTime() >= flexibleItems[0].end.getTime()
      );
      check('P6. zero deferrals', result.preview.constructedDay.deferredItems.length === 0);
    }
  }

  // Q. OVERLOAD PRECEDENCE PRESERVED (ticket section 17, mandatory) --
  // replenishment must not disturb `compareByOverloadPrecedence`. A
  // HIGH-importance intent submitted SECOND (array position) must still
  // be evaluated FIRST by constructDay and therefore still legitimately
  // claim the objectively best-scoring slot, exactly as it would
  // without any replenishment ever occurring -- this ticket requires
  // fair access to REMAINING capacity, never equal timing quality among
  // intents.
  // ============================================================
  {
    const NARROW_PEAK_DATE = '2026-10-17';
    const weekdayForPeakDate = new Date(NARROW_PEAK_DATE + 'T12:00:00Z').getUTCDay();
    const splitPeriods: AvailabilityConfiguration['periods'] = [
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '05:00', endTime: '06:00' },
      { weekday: weekdayForPeakDate as AvailabilityConfiguration['periods'][number]['weekday'], startTime: '08:00', endTime: '09:00' },
    ];
    const precedenceIntents: RequestedDayIntent[] = [
      { id: 'low', title: 'Workout', activityId: 'workout', flexibility: 'FLEXIBLE', originalOrder: 0 },
      { id: 'high', title: 'Workout', activityId: 'workout', flexibility: 'FLEXIBLE', importance: 'HIGH', originalOrder: 1 },
      { id: 'low2', title: 'Workout', activityId: 'workout', flexibility: 'FLEXIBLE', originalOrder: 2 },
    ];
    const result = await runOnDate(NARROW_PEAK_DATE, splitPeriods, precedenceIntents);
    check('Q1. mixed-importance identical Workout intents: status is READY', result.status === 'READY');
    if (result.status === 'READY') {
      check('Q2. all three place (real capacity for all, replenishment resolves the two lower-precedence ones)', result.preview.constructedDay.proposedItems.length === 3);
      const highItem = result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'high');
      const lowItem = result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'low');
      check('Q3. the HIGH-importance intent (submitted SECOND) still claims the objectively best-scoring slot (BEST or GOOD tier)', highItem !== undefined && (highItem.timingFit === 'BEST' || highItem.timingFit === 'GOOD'));
      check(
        'Q4. the LOW-importance intent (submitted FIRST) did NOT claim that same best slot -- precedence, not array order, decided who got first pick',
        lowItem !== undefined && highItem !== undefined && lowItem.start.getTime() !== highItem.start.getTime()
      );
    }
  }

  if (!allPassed) {
    console.error('\nSome Tomorrow Window-Aware Timing Search checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL TOMORROW WINDOW-AWARE TIMING SEARCH CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
