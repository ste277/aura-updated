/**
 * Daily Rhythm V1 PR DR3 -- Candidate Coverage & Recommendation Clarity.
 * Orchestrator integration suite exercising `orchestrateConstructDay` end
 * to end through injected fake dependencies -- no live DB, no network, no
 * real Panchang/Muhurta computation -- same convention as
 * test/dailyRhythmOrchestratorIntegration.test.ts (DR2). The fake
 * `searchTiming` here deliberately RESPECTS `request.limit` by slicing a
 * pre-built candidate pool (`request.candidates.slice(0, request.limit ??
 * 3)`), the same shape `runFind`'s own final `.slice(0, limit)` produces
 * (packages/recommendation/src/timingSearch.ts) -- this is what lets
 * these tests prove DR3's own "a candidate beyond the original top three"
 * scenarios deterministically, without depending on real astrology.
 *
 *   npx ts-node test/dailyRhythmCandidateCoverageIntegration.test.ts
 */
import {
  orchestrateConstructDay,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
  type RequestedDayIntent,
} from '../apps/web/lib/dayConstructorOrchestrator';
import type { TimingCandidate, TimingCandidateLabel, TimingSearchRequest } from '../packages/recommendation/src/timingSearch';
import { DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT, type DailyRhythmPreferencesInput } from '../apps/web/lib/dailyRhythmScheduling';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

// 2026-09-21 is a Monday; 2026-09-19 is the preceding Saturday.
const MONDAY = '2026-09-21';
const TZ = 'Asia/Kolkata';
const CONFIGURED: DailyRhythmPreferencesInput = { workStart: '10:00', workEnd: '18:00', workDays: [1, 2, 3, 4, 5] };
const UNCONFIGURED: DailyRhythmPreferencesInput = { workStart: null, workEnd: null, workDays: [] };

function timingCandidate(start: string, end: string, label: TimingCandidateLabel): TimingCandidate {
  return { start, end, score: 5, label, muhurtaScore: 0, reasons: [], metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: MONDAY } };
}

/** Simulates the real engine's own `limit`-governed truncation
 * (runFind's final `.slice(0, limit)`), from a caller-supplied full
 * candidate pool -- `pool` stands in for what a real, unbounded day-long
 * scan would have scored and ranked BEFORE diversification/limit ever
 * applies. Also records every request it received, for the "bounded
 * search" assertions below. */
function makeLimitAwareSearchTiming(pool: TimingCandidate[], requestsSeen: Omit<TimingSearchRequest, 'context'>[]) {
  return (request: Omit<TimingSearchRequest, 'context'>): { candidates: TimingCandidate[] } => {
    requestsSeen.push(request);
    const limit = request.limit ?? 3;
    return { candidates: pool.slice(0, limit) };
  };
}

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

async function main() {
  // ============================================================
  // 1/2. A preferred outside-work candidate exists, but only BEYOND the
  // original top three -- the exact DR2-era limitation DR3 exists to
  // fix. Top 3 (by the fake engine's own ranking order) are all inside
  // work hours; the outside-work option is 4th.
  // ============================================================
  {
    const pool = [
      timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'GOOD'), // 10:30am IST, inside work
      timingCandidate(`${MONDAY}T07:00:00.000Z`, `${MONDAY}T07:30:00.000Z`, 'GOOD'), // 12:30pm IST, inside work
      timingCandidate(`${MONDAY}T09:00:00.000Z`, `${MONDAY}T09:30:00.000Z`, 'GOOD'), // 2:30pm IST, inside work
      timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE'), // 7:00am IST, OUTSIDE work -- 4th in the pool
    ];
    const requestsSeen: Omit<TimingSearchRequest, 'context'>[] = [];
    const intent = requestedIntent({ id: 'run', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: makeLimitAwareSearchTiming(pool, requestsSeen), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run') : undefined;
    check('1/2. DR3 widens the search enough to reach the 4th-ranked, outside-work candidate (invisible to DR2\'s own default limit of 3)', result.status === 'READY' && placed?.start.toISOString() === pool[3].start);
    check('1b. the explanation reflects the preferred placement', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'run' && w.code === 'DAILY_RHYTHM_PERSONAL_OUTSIDE_WORK_HOURS'));
    check('14. the search was widened to exactly DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT, never larger (bounded, not unbounded)', requestsSeen.length > 0 && requestsSeen.every((r) => r.limit === DAILY_RHYTHM_EXPANDED_SEARCH_LIMIT));
  }

  // ============================================================
  // 3. No outside-work candidate exists even within the bounded (12)
  // search -- falls back to the BEST original candidate (the engine's
  // own top-ranked one), never an arbitrary one.
  // ============================================================
  {
    const pool = [
      timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'GOOD'), // best, inside work
      timingCandidate(`${MONDAY}T07:00:00.000Z`, `${MONDAY}T07:30:00.000Z`, 'USABLE'), // inside work
      timingCandidate(`${MONDAY}T09:00:00.000Z`, `${MONDAY}T09:30:00.000Z`, 'CAUTION'), // inside work
    ];
    const intent = requestedIntent({ id: 'run-fallback', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: makeLimitAwareSearchTiming(pool, []), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run-fallback') : undefined;
    check('3. no outside-work candidate anywhere in the bounded search -> falls back to the engine\'s own BEST-ranked candidate', result.status === 'READY' && placed?.start.toISOString() === pool[0].start);
    check('3b. the fallback explanation is attached', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'run-fallback' && w.code === 'DAILY_RHYTHM_PERSONAL_DURING_WORK_HOURS_FALLBACK'));
  }

  // ============================================================
  // 4. An outside-work candidate with LOWER astrological quality than an
  // inside-work one is still preferred -- the soft preference genuinely
  // overrides raw astrological ranking, not merely coincides with it.
  // ============================================================
  {
    const pool = [
      timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'EXCELLENT'), // inside work, the astrologically BEST slot of the day
      timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'CAUTION'), // outside work, astrologically the WORST label
    ];
    const intent = requestedIntent({ id: 'run-quality', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: makeLimitAwareSearchTiming(pool, []), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run-quality') : undefined;
    check('4. a lower-quality (CAUTION) outside-work candidate is preferred over a higher-quality (EXCELLENT) inside-work one', result.status === 'READY' && placed?.start.toISOString() === pool[1].start);
  }

  // ============================================================
  // 5. Existing fixed commitments -- a FIXED intent never calls
  // searchTiming at all (unaffected by widening), and a user-selected
  // time inside work hours is placed exactly as requested.
  // ============================================================
  {
    const fixedStart = iso(`${MONDAY}T11:11:00.000Z`); // 4:41pm IST -- deliberately "during work hours"
    const requestsSeen: Omit<TimingSearchRequest, 'context'>[] = [];
    const intent = requestedIntent({ id: 'fixed1', activityId: 'workout', flexibility: 'FIXED', fixedStart, durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: makeLimitAwareSearchTiming([], requestsSeen), loadDailyRhythmPreferences: async () => CONFIGURED });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'fixed1') : undefined;
    check('5. a FIXED commitment is placed exactly as requested, even during work hours', result.status === 'READY' && placed?.start.getTime() === fixedStart.getTime());
    check('5b. a FIXED intent never calls searchTiming -- no search to widen', requestsSeen.length === 0);
    check('5c. a FIXED placement never receives a Daily Rhythm explanation', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'fixed1' && w.code.startsWith('DAILY_RHYTHM_')));
  }

  // ============================================================
  // 6. Existing UserAvailabilityPeriod combined with the widened search
  // -- both independent preferences remain active together.
  // ============================================================
  {
    const pool = [
      timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'GOOD'), // inside work
      timingCandidate(`${MONDAY}T07:00:00.000Z`, `${MONDAY}T07:30:00.000Z`, 'GOOD'), // inside work
      timingCandidate(`${MONDAY}T09:00:00.000Z`, `${MONDAY}T09:30:00.000Z`, 'GOOD'), // inside work
      timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE'), // outside work, 4th
    ];
    const intent = requestedIntent({ id: 'run-avail', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({
      searchTiming: makeLimitAwareSearchTiming(pool, []),
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 1, startTime: '06:00', endTime: '20:00' }] }),
      loadDailyRhythmPreferences: async () => CONFIGURED,
    });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent], constructionWindowSource: 'REMAINING_TODAY' }), deps);
    const placed = result.status === 'READY' ? result.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run-avail') : undefined;
    check('6. UserAvailabilityPeriod and the DR3-widened search both apply together without error or interference', result.status === 'READY' && placed?.start.toISOString() === pool[3].start);
  }

  // ============================================================
  // 13. Deterministic ordering -- identical requests run twice through
  // the widened-search code path produce an identical result.
  // ============================================================
  {
    const pool = [
      timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'GOOD'),
      timingCandidate(`${MONDAY}T07:00:00.000Z`, `${MONDAY}T07:30:00.000Z`, 'GOOD'),
      timingCandidate(`${MONDAY}T09:00:00.000Z`, `${MONDAY}T09:30:00.000Z`, 'GOOD'),
      timingCandidate(`${MONDAY}T01:30:00.000Z`, `${MONDAY}T02:00:00.000Z`, 'USABLE'),
    ];
    const intent = requestedIntent({ id: 'run-det', activityId: 'workout', durationMinutes: 30 });
    const deps = noopDeps({ searchTiming: makeLimitAwareSearchTiming(pool, []), loadDailyRhythmPreferences: async () => CONFIGURED });
    const resultA = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const resultB = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    const placedA = resultA.status === 'READY' ? resultA.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run-det')?.start.toISOString() : undefined;
    const placedB = resultB.status === 'READY' ? resultB.preview.constructedDay.proposedItems.find((p) => p.intentId === 'run-det')?.start.toISOString() : undefined;
    check('13. identical requests run twice through the widened-search path produce an identical placement', placedA !== undefined && placedA === placedB);
  }

  // ============================================================
  // Regression: unconfigured users (and WORK/FLEXIBLE_BREAK activities)
  // never see a widened limit on the wire -- confirmed by inspecting the
  // actual request the (fake) search engine received, not just the
  // final placement.
  // ============================================================
  {
    const pool = [timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'GOOD')];
    const requestsSeen: Omit<TimingSearchRequest, 'context'>[] = [];
    const intent = requestedIntent({ id: 'run-unconf', activityId: 'workout', durationMinutes: 30 });
    await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: makeLimitAwareSearchTiming(pool, requestsSeen), loadDailyRhythmPreferences: async () => UNCONFIGURED }));
    check('11. an unconfigured user\'s search request carries no `limit` override at all (undefined, not merely 3)', requestsSeen.length > 0 && requestsSeen.every((r) => r.limit === undefined));
  }
  {
    const pool = [timingCandidate(`${MONDAY}T05:00:00.000Z`, `${MONDAY}T05:30:00.000Z`, 'GOOD')];
    const requestsSeen: Omit<TimingSearchRequest, 'context'>[] = [];
    const intent = requestedIntent({ id: 'meeting-unwidened', activityId: 'task-1', durationMinutes: 30 });
    await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: makeLimitAwareSearchTiming(pool, requestsSeen), loadDailyRhythmPreferences: async () => CONFIGURED }));
    check('8. a WORK activity\'s search request carries no `limit` override, even with Daily Rhythm configured', requestsSeen.length > 0 && requestsSeen.every((r) => r.limit === undefined));
  }

  if (!allPassed) {
    console.error('\nSome Daily Rhythm Candidate Coverage Integration checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAILY RHYTHM CANDIDATE COVERAGE INTEGRATION CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
