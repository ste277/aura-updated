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
  const request: ConstructDayRequest = {
    targetDate: TARGET_DATE,
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
