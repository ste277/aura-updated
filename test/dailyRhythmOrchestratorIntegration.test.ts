/**
 * Daily Rhythm V1 PR DR2 -- orchestrator integration suite. Exercises
 * `orchestrateConstructDay` end to end through injected fake dependencies
 * -- no live DB, no network, no real Panchang/Muhurta computation -- same
 * convention as test/dayConstructorOrchestrator.test.ts (this file's own
 * `noopDeps` is a local, self-contained copy of that same shape, not an
 * import, matching this repo's established per-file self-containment
 * convention for this test style).
 *
 *   npx ts-node test/dailyRhythmOrchestratorIntegration.test.ts
 */
import {
  orchestrateConstructDay,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
  type RequestedDayIntent,
} from '../apps/web/lib/dayConstructorOrchestrator';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';
import type { DailyRhythmPreferencesInput } from '../apps/web/lib/dailyRhythmScheduling';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

// 2026-09-21 is a Monday; 2026-09-19 is the preceding Saturday (verified: new Date('2026-09-21T00:00:00Z').getUTCDay() === 1).
const MONDAY = '2026-09-21';
const SATURDAY = '2026-09-19';
const TZ = 'Asia/Kolkata';
const CONFIGURED: DailyRhythmPreferencesInput = { workStart: '10:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] };
const UNCONFIGURED: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };

function noopDeps(overrides: Partial<DayConstructorOrchestratorDeps> = {}): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: () => ({ candidates: [] }),
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
    loadDailyRhythmPreferences: async () => UNCONFIGURED,
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ConstructDayRequest> = {}): ConstructDayRequest {
  return {
    targetDate: MONDAY,
    timezone: TZ,
    constructionWindowSource: 'EXPLICIT_RANGE',
    now: iso(`${MONDAY}T00:30:00.000Z`), // 6:00am IST -- before every candidate used in this file
    explicitStart: iso(`${MONDAY}T00:00:00.000Z`),
    explicitEnd: iso(`${MONDAY}T18:30:00.000Z`), // covers the whole IST day
    intents: [],
    ...overrides,
  };
}

function requestedIntent(overrides: Partial<RequestedDayIntent> = {}): RequestedDayIntent {
  return { id: overrides.id ?? 'req-1', title: overrides.title ?? 'Go for a run', flexibility: overrides.flexibility ?? 'FLEXIBLE', originalOrder: overrides.originalOrder ?? 0, ...overrides };
}

function timingCandidate(start: string, end: string, label: TimingCandidateLabel): TimingCandidate {
  return { start, end, score: 5, label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: MONDAY } };
}

async function main() {
  // ============================================================
  // 1. Get fitter -> Go for a run: the reference scenario. The afternoon
  // (inside-work) candidate is deliberately the ASTROLOGICALLY BETTER
  // one (GOOD beats USABLE/WORKABLE on the existing [timingFit] ranking)
  // -- so without Daily Rhythm, the engine's own ranking alone would
  // pick the afternoon slot; this proves DR2 itself, not mere chance,
  // is what flips the choice to the morning (outside-work) one.
  // ============================================================
  {
    const afternoon = timingCandidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'GOOD'); // 4:41-5:11pm IST -- astrologically better
    const morning = timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE'); // 7:00-7:30am IST -- astrologically weaker
    const intent = requestedIntent({ id: 'run', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [afternoon, morning] }), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run') : undefined;
    check('1. Get fitter -> Go for a run: Aura prefers the morning (outside-work) candidate over the 4:41pm one', result.status === 'READY' && placed?.start.toISOString() === morning.start);
    check('1b. the chosen placement carries the "fits your preferred personal time" explanation', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'run' && w.code === 'DAILY_RHYTHM_PERSONAL_OUTSIDE_WORK_HOURS'));
  }

  // ============================================================
  // 2. Work meeting during work hours -- eligible, unaffected, no
  // explanation needed.
  // ============================================================
  {
    const duringWork = timingCandidate(`${MONDAY}T05:30:00.000Z`, `${MONDAY}T06:00:00.000Z`, 'GOOD'); // 11:00-11:30am IST
    const intent = requestedIntent({ id: 'meeting', title: 'Team sync', activityId: 'task-1', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [duringWork] }), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'meeting') : undefined;
    check('2. a WORK activity during work hours is placed exactly where the engine chose, unaffected by Daily Rhythm', result.status === 'READY' && placed?.start.toISOString() === duringWork.start);
    check('2b. no Daily Rhythm warning is attached for a WORK placement', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'meeting' && w.code.startsWith('DAILY_RHYTHM_')));
  }

  // ============================================================
  // 3. Short break (tea-break, FLEXIBLE_BREAK) during work hours --
  // allowed without penalty, with its own reassuring explanation.
  // ============================================================
  {
    const duringWork = timingCandidate(`${MONDAY}T05:30:00.000Z`, `${MONDAY}T05:40:00.000Z`, 'GOOD');
    const intent = requestedIntent({ id: 'break', title: 'Tea break', activityId: 'tea-break', durationMinutes: 10 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [duringWork] }), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'break') : undefined;
    check('3. a FLEXIBLE_BREAK during work hours is placed exactly where the engine chose, no work-hour penalty', result.status === 'READY' && placed?.start.toISOString() === duringWork.start);
    check('3b. the placement carries the "short break fits into your workday" explanation', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'break' && w.code === 'DAILY_RHYTHM_FLEXIBLE_BREAK_DURING_WORK_HOURS'));
  }

  // ============================================================
  // 4. No suitable outside-work candidate -- falls back to the in-work
  // option rather than deferring the intent.
  // ============================================================
  {
    const onlyDuringWork = timingCandidate(`${MONDAY}T05:30:00.000Z`, `${MONDAY}T06:00:00.000Z`, 'CAUTION');
    const intent = requestedIntent({ id: 'run2', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [onlyDuringWork] }), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run2') : undefined;
    check('4. no outside-work candidate exists -> Aura still places the activity (never deferred outright)', result.status === 'READY' && placed !== undefined);
    check('4b. the fallback placement carries the "no outside-work time was available" explanation', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'run2' && w.code === 'DAILY_RHYTHM_PERSONAL_DURING_WORK_HOURS_FALLBACK'));
  }

  // ============================================================
  // 5. Weekends and configured non-workdays -- unchanged behavior.
  // ============================================================
  {
    const insideClockWindow = timingCandidate(`${SATURDAY}T06:00:00.000Z`, `${SATURDAY}T06:30:00.000Z`, 'GOOD'); // 11:30am IST Saturday
    const intent = requestedIntent({ id: 'run3', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [insideClockWindow] }), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(
      baseRequest({ targetDate: SATURDAY, now: iso(`${SATURDAY}T00:30:00.000Z`), explicitStart: iso(`${SATURDAY}T00:00:00.000Z`), explicitEnd: iso(`${SATURDAY}T18:30:00.000Z`), intents: [intent] }),
      deps
    );
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run3') : undefined;
    check('5. a non-configured-workday (Saturday) -> unchanged placement, Daily Rhythm never applies', result.status === 'READY' && placed?.start.toISOString() === insideClockWindow.start);
    check('5b. no Daily Rhythm warning on a non-workday', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'run3' && w.code.startsWith('DAILY_RHYTHM_')));
  }

  // ============================================================
  // 6. Missing/cleared preferences -- both an explicit UNCONFIGURED
  // value AND an entirely OMITTED dependency behave identically, and
  // both correctly restore the engine's own baseline choice (the
  // astrologically-better afternoon slot) -- proving check 1's
  // different outcome really is caused by Daily Rhythm, not chance.
  // ============================================================
  {
    const afternoon = timingCandidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'GOOD');
    const morning = timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE');
    const intent = requestedIntent({ id: 'run4', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });

    const explicitlyUnconfigured = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [afternoon, morning] }), loadDailyRhythmPreferences: async () => UNCONFIGURED }));
    const { loadDailyRhythmPreferences, ...depsWithoutField } = noopDeps({ searchTiming: () => ({ candidates: [afternoon, morning] }) });
    const omittedEntirely = await orchestrateConstructDay(baseRequest({ intents: [intent] }), depsWithoutField as DayConstructorOrchestratorDeps);

    const placedA = explicitlyUnconfigured.status === 'READY' ? explicitlyUnconfigured.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run4') : undefined;
    const placedB = omittedEntirely.status === 'READY' ? omittedEntirely.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run4') : undefined;
    check('6. cleared (both-null) preferences -> the existing engine\'s own top choice wins (the astrologically-better GOOD afternoon one, since nothing deprioritizes it)', placedA?.start.toISOString() === afternoon.start);
    check('6b. OMITTING loadDailyRhythmPreferences entirely from deps behaves identically to explicit unconfigured (existing callers like Remaining-Day Recomposition are unaffected)', placedB?.start.toISOString() === placedA?.start.toISOString());
  }

  // ============================================================
  // 7. Existing fixed commitments -- a FIXED intent is never touched by
  // Daily Rhythm filtering (it never calls searchTiming at all) and
  // never gets a Daily Rhythm explanation.
  // ============================================================
  {
    const fixedStart = iso(`${MONDAY}T11:11:00.000Z`); // 4:41pm IST -- deliberately "during work hours"
    const intent = requestedIntent({ id: 'fixed1', title: 'Doctor appointment', activityId: 'workout', flexibility: 'FIXED', fixedStart, durationMinutes: 30 });
    const deps = noopDeps({ loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'fixed1') : undefined;
    check('7. a user-selected FIXED time is placed exactly as requested, even during work hours for a PERSONAL activity', result.status === 'READY' && placed?.start.getTime() === fixedStart.getTime());
    check('7b. a FIXED placement never receives a Daily Rhythm explanation (never second-guesses a manual choice)', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'fixed1' && w.code.startsWith('DAILY_RHYTHM_')));
  }

  // ============================================================
  // 8. Existing UserAvailabilityPeriod combined with Daily Rhythm --
  // both independent preferences remain active together without
  // interfering with one another.
  // ============================================================
  {
    const morning = timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE');
    const intent = requestedIntent({ id: 'run5', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({
      searchTiming: () => ({ candidates: [morning] }),
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 1, startTime: '06:00', endTime: '20:00' }] }),
      loadDailyRhythmPreferences: async () => CONFIGURED,
    });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent], constructionWindowSource: 'REMAINING_TODAY' }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run5') : undefined;
    check('8. UserAvailabilityPeriod (configured) and Daily Rhythm (configured) both apply together without error or interference', result.status === 'READY' && placed?.start.toISOString() === morning.start);
  }

  // ============================================================
  // 9. Deterministic ordering -- the exact same request run twice
  // produces an identical result.
  // ============================================================
  {
    const afternoon = timingCandidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'GOOD');
    const morning = timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE');
    const intent = requestedIntent({ id: 'run6', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [afternoon, morning] }), loadDailyRhythmPreferences: async () => CONFIGURED });
    const resultA = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const resultB = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placedA = resultA.status === 'READY' ? resultA.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run6')?.start.toISOString() : undefined;
    const placedB = resultB.status === 'READY' ? resultB.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run6')?.start.toISOString() : undefined;
    check('9. identical requests run twice produce an identical placement (deterministic, no flaky ties)', placedA !== undefined && placedA === placedB);
  }

  // ============================================================
  // 10. Existing scheduling behavior unchanged for users without Daily
  // Rhythm preferences -- byte-identical result with and without the
  // DR2 integration point touched, for an unconfigured user.
  // ============================================================
  {
    const afternoon = timingCandidate(`${MONDAY}T11:11:00.000Z`, `${MONDAY}T11:41:00.000Z`, 'GOOD');
    const intent = requestedIntent({ id: 'run7', title: 'Go for a run', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [afternoon] }) }));
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run7') : undefined;
    check('10. an unconfigured user\'s only candidate is placed exactly as the engine ranked it -- zero regression', result.status === 'READY' && placed?.start.toISOString() === afternoon.start);
  }

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Orchestrator Integration checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM ORCHESTRATOR INTEGRATION CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
