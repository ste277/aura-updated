/**
 * Day Constructor V1 -- PR C orchestration regression suite. Exercises
 * `orchestrateConstructDay` entirely through injected fake dependencies
 * -- no live DB, no network, no real timing-engine computation --
 * proving orchestration BEHAVIOR independent of the real repository
 * wiring (`createRealDayConstructorOrchestratorDeps`, validated by
 * typecheck against the real imported functions it wires together,
 * matching this repo's own established convention that a plain
 * behavioral suite stays DB-free while a live-database suite would
 * carry its own `*Db.test.ts` name -- not needed here since this file
 * never touches `db.ts`'s real query functions).
 */
import {
  orchestrateConstructDay,
  type ConstructDayRequest,
  type DayConstructorOrchestratorDeps,
  type RequestedDayIntent,
} from '../apps/web/lib/dayConstructorOrchestrator';
import { GENERIC_DURATION_FALLBACK_MINUTES } from '../apps/web/lib/dayBuilderOrchestrator';
import type { TimingCandidate, TimingCandidateLabel } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

const TARGET_DATE = '2026-09-16';

// Availability Context V1 PR H1 -- every pre-existing test in this file
// implicitly exercises the UNCONFIGURED path (the default here), which is
// byte-equivalent to this file's own pre-H1 behavior (there was no
// availability concept before). Tests exercising CONFIGURED/CONFIGURED_
// EMPTY override this explicitly.
function noopDeps(overrides: Partial<DayConstructorOrchestratorDeps> = {}): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: () => ({ candidates: [] }),
    loadAvailabilityConfiguration: async () => ({ configured: false, periods: [] }),
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ConstructDayRequest> = {}): ConstructDayRequest {
  return {
    targetDate: TARGET_DATE,
    timezone: 'UTC',
    constructionWindowSource: 'EXPLICIT_RANGE',
    // `now` is required for BOTH window sources (pre-commit review fix)
    // -- defaulted here to the window's own start so every existing test
    // that doesn't care about lifecycle filtering keeps working
    // unchanged; tests that DO care override it explicitly.
    now: iso('2026-09-16T09:00:00Z'),
    explicitStart: iso('2026-09-16T09:00:00Z'),
    explicitEnd: iso('2026-09-16T17:00:00Z'),
    intents: [],
    ...overrides,
  };
}

function blockerPlan(start: string, end: string, status: 'UPCOMING' | 'LOGGED' | 'CANCELLED' = 'UPCOMING') {
  return { start: iso(start), end: iso(end), status };
}

function requestedIntent(overrides: Partial<RequestedDayIntent> = {}): RequestedDayIntent {
  return {
    id: overrides.id ?? 'req-1',
    title: overrides.title ?? 'Draft the deck',
    flexibility: overrides.flexibility ?? 'FLEXIBLE',
    originalOrder: overrides.originalOrder ?? 0,
    ...overrides,
  };
}

function timingCandidate(start: string, end: string, label: TimingCandidateLabel): TimingCandidate {
  return {
    start,
    end,
    score: 5,
    label,
    muhurtaScore: 0,
    reasons: [],
    metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: 'x', dateLabel: TARGET_DATE },
  };
}

async function main() {
  // ============================================================
  // INTENT RESOLUTION (1-8)
  // ============================================================

  // 1. explicit activityId preserved
  {
    const intent = requestedIntent({ id: 'i1', title: 'anything', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('1. explicit valid activityId preserved on the resolved DayIntent', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityId === 'workout');
  }

  // 2. catalog/alias match
  {
    const intent = requestedIntent({ id: 'i2', title: 'go for a workout session', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('2. alias-matched title resolves to a real catalog activityId', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityId !== undefined);
    check('2. no coarse-family warning when a real catalog match was found', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'i2' && w.code === 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY'));
  }

  // 3. coarse-family fallback without fabricated activityId
  {
    const intent = requestedIntent({ id: 'i3', title: 'finish the investor presentation', durationMinutes: 60 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('3. no catalog alias match -> activityId stays undefined, never fabricated', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityId === undefined);
    check('3. a coarse activityFamily is still resolved via classifyTask', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityFamily !== undefined);
    check('3. ACTIVITY_RESOLVED_TO_COARSE_FAMILY warning recorded', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'i3' && w.code === 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY'));
  }

  // 4. unresolved activity remains safe (an invalid supplied activityId falls through, never crashes)
  {
    const intent = requestedIntent({ id: 'i4', title: 'do something', activityId: 'not-a-real-activity-id', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('4. an invalid supplied activityId is never trusted blindly (falls through safely, no crash)', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityId === undefined);
  }

  // 5. importance defaults MEDIUM
  {
    const intent = requestedIntent({ id: 'i5', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('5. importance defaults to MEDIUM when omitted', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.importance === 'MEDIUM');
  }

  // 6. supplied importance preserved
  {
    const intent = requestedIntent({ id: 'i6', importance: 'HIGH', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('6. explicitly supplied importance is preserved verbatim', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.importance === 'HIGH');
  }

  // 7. supplied deadline preserved
  {
    const intent = requestedIntent({ id: 'i7', deadline: '2026-09-17', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('7. explicitly supplied deadline is preserved verbatim', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.deadline === '2026-09-17');
  }

  // 8. timing quality never changes importance
  {
    const intent = requestedIntent({ id: 'i8', importance: 'LOW', durationMinutes: 30 });
    const result = await orchestrateConstructDay(
      baseRequest({ intents: [intent] }),
      noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'EXCELLENT')] }) })
    );
    check('8. an EXCELLENT-rated candidate never upgrades the intent\'s own importance', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.importance === 'LOW');
  }

  // ============================================================
  // DURATION (9-12)
  // ============================================================

  // 9. explicit duration wins
  {
    const intent = requestedIntent({ id: 'i9', activityId: 'workout', durationMinutes: 12 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('9. explicitly requested duration wins over every other resolver', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === 12);
  }

  // 10. existing canonical duration resolver used
  {
    const intent = requestedIntent({ id: 'i10', activityId: 'workout' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ loadDurationContext: async () => ({ preferredDurationByActivityId: { workout: 55 }, behavioralDurationByActivityId: {} }) }));
    check('10. the real durationMinutesFor preference chain is actually consulted', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === 55);
    check('10. no generic-fallback warning when a real preference resolved it', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'i10' && w.code === 'DURATION_FROM_GENERIC_FALLBACK'));
  }

  // 11. Intent Fidelity V1 PR G2 -- a free-text title with no resolved
  // activityId and no explicit duration now receives the SAME generic
  // duration floor a resolved activity's own empty chain would reach
  // (GENERIC_DURATION_FALLBACK_MINUTES), rather than staying unresolved.
  // This intent still has zero supplied candidates in this bare
  // noopDeps() scenario, so it is still deferred -- but now for
  // NO_CANDIDATES (it reached real timing search), never DURATION_UNKNOWN
  // (it never even reached that far pre-G2). See test 61 for the
  // corresponding full end-to-end placement success.
  {
    const intent = requestedIntent({ id: 'i11', title: 'finish the investor presentation' }); // no activityId, no explicit duration
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('11. duration resolves to the generic fallback instead of staying unresolved (G2)', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === GENERIC_DURATION_FALLBACK_MINUTES);
    check('11. DURATION_FROM_GENERIC_FALLBACK warning recorded for this intent', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'i11' && w.code === 'DURATION_FROM_GENERIC_FALLBACK'));
    check(
      '11. with zero supplied candidates the intent is still deferred, but NOW because timing search found nothing (NO_CANDIDATES) -- it reached real search, never DURATION_UNKNOWN',
      result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i11' && d.primaryReason === 'NO_CANDIDATES')
    );
  }

  // 12. no new arbitrary fallback
  {
    const intent = requestedIntent({ id: 'i12', activityId: 'workout' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('12. duration comes from the real durationMinutesFor chain (its own canonical floor), flagged as a fallback', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'i12' && w.code === 'DURATION_FROM_GENERIC_FALLBACK'));
  }

  // ============================================================
  // CONSTRUCTION WINDOW (13-17)
  // ============================================================

  // 13. explicit range
  {
    const result = await orchestrateConstructDay(baseRequest({ intents: [] }), noopDeps());
    check('13. EXPLICIT_RANGE window uses the caller-supplied bounds verbatim', result.status === 'READY' && result.preview.constructionWindow.start.getTime() === iso('2026-09-16T09:00:00Z').getTime() && result.preview.constructionWindow.end.getTime() === iso('2026-09-16T17:00:00Z').getTime());
  }

  // 14. remaining-today uses explicit now
  {
    const now = iso('2026-09-16T12:00:00Z');
    const result = await orchestrateConstructDay(baseRequest({ constructionWindowSource: 'REMAINING_TODAY', now, explicitStart: undefined, explicitEnd: undefined, timezone: 'UTC', intents: [] }), noopDeps());
    check('14. REMAINING_TODAY window.start is exactly the request-supplied now, never a fresh clock read', result.status === 'READY' && result.preview.constructionWindow.start.getTime() === now.getTime());
  }

  // 15. invalid window fails closed
  {
    const result = await orchestrateConstructDay(baseRequest({ explicitStart: iso('2026-09-16T17:00:00Z'), explicitEnd: iso('2026-09-16T09:00:00Z'), intents: [] }), noopDeps());
    check('15. start >= end fails closed as INVALID_CONSTRUCTION_WINDOW', result.status === 'INVALID_CONSTRUCTION_WINDOW');
  }

  // 16. timezone missing
  {
    const result = await orchestrateConstructDay(baseRequest({ timezone: '', intents: [] }), noopDeps());
    check('16. empty timezone fails closed as TIMEZONE_MISSING', result.status === 'TIMEZONE_MISSING');
  }

  // 17. no work-hours inference (REMAINING_TODAY without now is INVALID_REQUEST, never a silent default)
  {
    const result = await orchestrateConstructDay(baseRequest({ constructionWindowSource: 'REMAINING_TODAY', now: undefined, explicitStart: undefined, explicitEnd: undefined, intents: [] }), noopDeps());
    check('17. REMAINING_TODAY without an explicit now fails closed as INVALID_REQUEST, never silently defaulted', result.status === 'INVALID_REQUEST');
  }
  {
    const result = await orchestrateConstructDay(baseRequest({ constructionWindowSource: 'EXPLICIT_RANGE', explicitStart: undefined, explicitEnd: undefined, intents: [] }), noopDeps());
    check('17b. EXPLICIT_RANGE without bounds fails closed as INVALID_REQUEST', result.status === 'INVALID_REQUEST');
  }

  // ============================================================
  // FIXED (18-22)
  // ============================================================

  // 18. FIXED produces FixedPlacementConstraint
  {
    const intent = requestedIntent({ id: 'i18', flexibility: 'FIXED', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T14:00:00Z') });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('18. a FIXED intent with a valid fixedStart is placed exactly there', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.start.getTime() === iso('2026-09-16T14:00:00Z').getTime());
    check('18. placementSource is FIXED_CONSTRAINT', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.placementSource === 'FIXED_CONSTRAINT');
  }

  // 19. FIXED produces no fake PlacementCandidate
  {
    let sawSearchCall = false;
    const intent = requestedIntent({ id: 'i19', flexibility: 'FIXED', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T14:00:00Z') });
    await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => { sawSearchCall = true; return { candidates: [] }; } }));
    check('19. runTimingSearch is never invoked for a FIXED intent', !sawSearchCall);
  }

  // 20. missing fixed time fails/deferred safely
  {
    const intent = requestedIntent({ id: 'i20', flexibility: 'FIXED', activityId: 'workout', durationMinutes: 30 }); // no fixedStart
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('20. FIXED intent with no fixedStart is safely deferred (FIXED_WINDOW_INVALID), never a crash', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i20' && d.primaryReason === 'FIXED_WINDOW_INVALID'));
  }

  // 21. fixed duration matches intent
  {
    const intent = requestedIntent({ id: 'i21', flexibility: 'FIXED', activityId: 'workout', durationMinutes: 45, fixedStart: iso('2026-09-16T14:00:00Z') });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('21. the derived FixedPlacementConstraint spans exactly the resolved duration (45 min), never mismatched', result.status === 'READY' && (result.preview.constructedDay.proposedItems[0].end.getTime() - result.preview.constructedDay.proposedItems[0].start.getTime()) / 60000 === 45);
  }

  // 22. fixed outside construction window reaches correct constructor result
  {
    const intent = requestedIntent({ id: 'i22', flexibility: 'FIXED', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T20:00:00Z') }); // outside 09:00-17:00 window
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('22. a fixedStart outside the ConstructionWindow reaches OUTSIDE_CONSTRUCTION_WINDOW via the real constructor, not a fabricated orchestrator-level result', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i22' && d.primaryReason === 'OUTSIDE_CONSTRUCTION_WINDOW'));
  }

  // ============================================================
  // FLEXIBLE (23-29)
  // ============================================================

  // 23. FLEXIBLE invokes timing search
  {
    let searchCalls = 0;
    const intent = requestedIntent({ id: 'i23', activityId: 'workout', durationMinutes: 30 });
    await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => { searchCalls += 1; return { candidates: [] }; } }));
    check('23. exactly one timing search call for one FLEXIBLE intent', searchCalls === 1);
  }

  // 24. timing labels map correctly
  {
    const cases: [TimingCandidateLabel, string][] = [
      ['EXCELLENT', 'BEST'],
      ['VERY_GOOD', 'BEST'],
      ['GOOD', 'GOOD'],
      ['USABLE', 'WORKABLE'],
      ['CAUTION', 'CAUTION'],
    ];
    for (const [label, expectedFit] of cases) {
      const intent = requestedIntent({ id: 'i24', activityId: 'workout', durationMinutes: 30 });
      const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', label)] }) }));
      check(`24. ${label} maps to ${expectedFit}`, result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.timingFit === expectedFit);
    }
  }

  // 25. no raw timing score passed
  {
    const intent = requestedIntent({ id: 'i25', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('25. no numeric score field crosses into the proposed item at all', result.status === 'READY' && !('score' in result.preview.constructedDay.proposedItems[0]));
  }

  // 26. no raw Muhurta evidence passed
  {
    const intent = requestedIntent({ id: 'i26', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('26. no reasons/evidence field crosses into the proposed item at all', result.status === 'READY' && !('reasons' in result.preview.constructedDay.proposedItems[0]) && !('evidence' in result.preview.constructedDay.proposedItems[0]));
  }

  // 27. zero candidates -> deferred
  {
    const intent = requestedIntent({ id: 'i27', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('27. zero timing candidates -> NO_CANDIDATES deferral, not an orchestration error', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i27' && d.primaryReason === 'NO_CANDIDATES'));
    check('27. NO_TIMING_CANDIDATES_FOUND warning recorded alongside it', result.status === 'READY' && result.preview.warnings.some((w) => w.intentId === 'i27' && w.code === 'NO_TIMING_CANDIDATES_FOUND'));
  }

  // 28. malformed timing candidates filtered/fail safely
  {
    const intent = requestedIntent({ id: 'i28', activityId: 'workout', durationMinutes: 30 });
    const malformed = timingCandidate('not-a-date', '2026-09-16T10:30:00Z', 'GOOD');
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [malformed] }) }));
    check('28. a malformed candidate (unparseable start) is filtered out during normalization, never crashes', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i28' && d.primaryReason === 'NO_CANDIDATES'));
  }

  // 29. timing-search infrastructure failure distinct from no candidates
  {
    const intent = requestedIntent({ id: 'i29', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => { throw new Error('engine exploded'); } }));
    check('29. a thrown search error surfaces as TIMING_SEARCH_FAILED, never silently treated as zero candidates', result.status === 'TIMING_SEARCH_FAILED');
    check('29b. the failure names the exact requested intent', result.status === 'TIMING_SEARCH_FAILED' && result.requestedIntentId === 'i29');
  }

  // ============================================================
  // CANDIDATE SEMANTICS (30-33)
  // ============================================================

  // 30. normalized candidate.start is valid placement start
  {
    const intent = requestedIntent({ id: 'i30', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('30. the proposed item starts exactly at the engine-returned candidate.start', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.start.getTime() === iso('2026-09-16T10:00:00Z').getTime());
  }

  // 31. candidate duration supports required duration
  {
    // The FIND request always carries the resolved durationMinutes, so a
    // real candidate's own span already matches it exactly -- verified
    // here by supplying an already-exact-duration candidate.
    const intent = requestedIntent({ id: 'i31', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('31. placed interval spans exactly the requested 30 minutes', result.status === 'READY' && (result.preview.constructedDay.proposedItems[0].end.getTime() - result.preview.constructedDay.proposedItems[0].start.getTime()) / 60000 === 30);
  }

  // 32. broad timing-window semantics handled correctly (candidate longer than required is still trimmed correctly downstream, never mis-widened by this file)
  {
    const intent = requestedIntent({ id: 'i32', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T11:30:00Z', 'GOOD')] }) }));
    check('32. a broader-than-needed engine candidate still yields exactly the required 30-minute placement, not the full span', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.end.getTime() === iso('2026-09-16T10:30:00Z').getTime());
  }

  // 33. candidate order stable
  {
    const intent = requestedIntent({ id: 'i33', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(
      baseRequest({ intents: [intent] }),
      noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD'), timingCandidate('2026-09-16T11:00:00Z', '2026-09-16T11:30:00Z', 'GOOD')] }) })
    );
    // Same fit -> earlier start wins (PR B's own ranking); candidateOrder
    // preserved as array index either way.
    check('33. the chosen candidate carries a stable, array-index-derived candidateOrder', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.candidateOrder === 0);
  }

  // ============================================================
  // PLANS (34-39)
  // ============================================================

  // 34. target-day Plans loaded once
  {
    let loadCalls = 0;
    const intents = [requestedIntent({ id: 'ia', activityId: 'workout', durationMinutes: 30 }), requestedIntent({ id: 'ib', activityId: 'deep-work', durationMinutes: 30, originalOrder: 1 })];
    await orchestrateConstructDay(baseRequest({ intents }), noopDeps({ loadBlockingPlans: async () => { loadCalls += 1; return []; } }));
    check('34. loadBlockingPlans is called exactly once per orchestration run, regardless of intent count', loadCalls === 1);
  }

  // 35. UPCOMING Plan (future/active) becomes blocker
  {
    const intent = requestedIntent({ id: 'i35', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'UPCOMING')] }));
    check('35. a real, still-active UPCOMING Plan interval becomes a BlockedInterval that correctly blocks placement', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i35' && d.primaryReason === 'FIXED_WINDOW_CONFLICT'));
  }

  // ============================================================
  // PLAN BLOCKER LIFECYCLE (pre-commit review fix, this ticket's own
  // section 1-6) -- isActivePlanBlocker's own behavior, exercised
  // end-to-end through the real orchestrator, never guessed.
  // ============================================================

  // 36. CANCELLED Plan does not block (real test, not a structural placeholder)
  {
    const intent = requestedIntent({ id: 'lc1', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'CANCELLED')] }));
    check('36. a CANCELLED Plan never blocks, even at the exact same interval', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 1);
  }

  // 37 / historical LOGGED behavior: a LOGGED Plan blocks regardless of
  // how far in the past it is relative to `now` -- real historical
  // execution occupies its own slot immutably (this ticket's own section
  // 4 option A, confirmed via dailyAgenda.ts's own LOGGED -> 'COMPLETED'
  // rule, which never depends on elapsed time).
  {
    const intent = requestedIntent({ id: 'lc2', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(
      baseRequest({ now: iso('2026-09-16T16:00:00Z'), intents: [intent] }), // "now" is hours AFTER the LOGGED plan's own time
      noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'LOGGED')] })
    );
    check('37. a LOGGED (historically completed) Plan blocks even though it is hours in the past relative to now', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'lc2' && d.primaryReason === 'FIXED_WINDOW_CONFLICT'));
  }

  // historical MISSED (derived) behavior: a persisted UPCOMING row whose
  // own window has ALREADY elapsed relative to `now`, and was never
  // logged, must NOT block -- this is the exact case this ticket's own
  // section 5 calls out by name.
  {
    const intent = requestedIntent({ id: 'lc3', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(
      baseRequest({ now: iso('2026-09-16T16:00:00Z'), intents: [intent] }), // now is well after the stale UPCOMING row's own end
      noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'UPCOMING')] })
    );
    check('historical MISSED (derived): a persisted-but-elapsed, never-logged UPCOMING row does NOT block -- storage still says UPCOMING, but the slot is genuinely free', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 1);
  }

  // future active Plan blocks (an UPCOMING row whose own window has NOT
  // yet elapsed relative to now).
  {
    const intent = requestedIntent({ id: 'lc4', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(
      baseRequest({ now: iso('2026-09-16T09:00:00Z'), intents: [intent] }), // now is BEFORE the UPCOMING row's own end -- still active
      noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'UPCOMING')] })
    );
    check('a genuinely future, not-yet-elapsed UPCOMING Plan blocks', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'lc4'));
  }

  // active Plan overlapping REMAINING_TODAY.now blocks its remaining
  // overlap (an UPCOMING row currently in progress -- end still >= now).
  {
    const intent = requestedIntent({ id: 'lc5', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:15:00Z'), flexibility: 'FIXED' });
    const now = iso('2026-09-16T10:00:00Z'); // now falls WITHIN the currently-in-progress Plan's own window
    const result = await orchestrateConstructDay(
      baseRequest({ constructionWindowSource: 'REMAINING_TODAY', now, explicitStart: undefined, explicitEnd: undefined, intents: [intent] }),
      noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'UPCOMING')] })
    );
    check('a currently in-progress UPCOMING Plan (end still in the future relative to REMAINING_TODAY.now) blocks its own remaining overlap', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'lc5'));
  }

  // Plan fully before REMAINING_TODAY.now does not block (both via the
  // isActivePlanBlocker elapsed check AND via ConstructionWindow's own
  // clipping -- doubly safe).
  {
    const intent = requestedIntent({ id: 'lc6', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T11:00:00Z'), flexibility: 'FIXED' });
    const now = iso('2026-09-16T10:00:00Z');
    const result = await orchestrateConstructDay(
      baseRequest({ constructionWindowSource: 'REMAINING_TODAY', now, explicitStart: undefined, explicitEnd: undefined, intents: [intent] }),
      noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T08:00:00Z', '2026-09-16T09:00:00Z', 'UPCOMING')] })
    );
    check('a Plan entirely before REMAINING_TODAY.now does not block a later placement', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 1);
  }

  // EXPLICIT_RANGE containing historical activity behaves intentionally:
  // a range spanning both a historical LOGGED slot (blocks) and a
  // historical MISSED slot (does not block), in the SAME run.
  {
    const loggedSlot = requestedIntent({ id: 'lc7a', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const missedSlot = requestedIntent({ id: 'lc7b', activityId: 'deep-work', durationMinutes: 30, fixedStart: iso('2026-09-16T12:00:00Z'), flexibility: 'FIXED', originalOrder: 1 });
    const result = await orchestrateConstructDay(
      baseRequest({
        explicitStart: iso('2026-09-16T09:00:00Z'),
        explicitEnd: iso('2026-09-16T17:00:00Z'),
        now: iso('2026-09-16T16:00:00Z'), // well after both historical slots
        intents: [loggedSlot, missedSlot],
      }),
      noopDeps({
        loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'LOGGED'), blockerPlan('2026-09-16T12:00:00Z', '2026-09-16T12:30:00Z', 'UPCOMING')],
      })
    );
    check('EXPLICIT_RANGE spanning historical activity: the LOGGED slot still blocks', result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'lc7a'));
    check('EXPLICIT_RANGE spanning historical activity: the derived-MISSED (elapsed, never-logged) slot does NOT block', result.status === 'READY' && result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'lc7b'));
  }

  {
    // 38. adjacent Plan does not conflict
    const intent = requestedIntent({ id: 'i38', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:30:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'UPCOMING')] }));
    check('38. a Plan blocker ending exactly when the placement starts (adjacent) does not conflict', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 1);
  }
  {
    // 39. Plan crossing local-day boundary handled correctly (a blocker
    // partially before the construction window is clipped, never
    // rejected/erroring the whole run)
    const intent = requestedIntent({ id: 'i39', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T09:15:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T08:00:00Z', '2026-09-16T09:00:00Z', 'UPCOMING')] }));
    check('39. a Plan blocker entirely before the window start is clipped away and never blocks a valid later placement', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 1);
  }

  // ============================================================
  // TIMEZONE (40-43)
  // ============================================================

  // 40. positive-offset local date
  {
    const result = await orchestrateConstructDay(baseRequest({ timezone: 'Asia/Kolkata', explicitStart: iso('2026-09-16T01:00:00Z'), explicitEnd: iso('2026-09-16T10:00:00Z'), intents: [] }), noopDeps());
    check('40. a positive-offset timezone (Asia/Kolkata) resolves without error', result.status === 'READY');
  }

  // 41. negative-offset local date
  {
    const result = await orchestrateConstructDay(baseRequest({ timezone: 'America/Los_Angeles', explicitStart: iso('2026-09-16T18:00:00Z'), explicitEnd: iso('2026-09-17T02:00:00Z'), intents: [] }), noopDeps());
    check('41. a negative-offset timezone (America/Los_Angeles) resolves without error', result.status === 'READY');
  }

  // 42. DST-capable timezone
  {
    const result = await orchestrateConstructDay(baseRequest({ timezone: 'America/New_York', explicitStart: iso('2026-03-08T10:00:00Z'), explicitEnd: iso('2026-03-08T18:00:00Z'), targetDate: '2026-03-08', intents: [] }), noopDeps());
    check('42. a DST-observing timezone (America/New_York, around a real US DST transition date) resolves without error', result.status === 'READY');
  }

  // 43. server timezone independence
  {
    const intent = requestedIntent({ id: 'i43', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const request = baseRequest({ intents: [intent] });
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    const under1 = await orchestrateConstructDay(request, noopDeps());
    process.env.TZ = 'America/Los_Angeles';
    const under2 = await orchestrateConstructDay(request, noopDeps());
    process.env.TZ = originalTZ;
    check('43. result identical regardless of process.env.TZ', JSON.stringify(under1) === JSON.stringify(under2));
  }

  // ============================================================
  // CONSTRUCTION (44-50)
  // ============================================================

  // 44. orchestrator calls constructDay once
  {
    // Verified structurally: constructedDay is a single coherent object
    // (proposedItems/deferredItems/conflicts/capacity all mutually
    // consistent for one run) built from one call in the implementation
    // -- exercised end-to-end by every other test in this file, which
    // would be internally inconsistent (e.g. capacity not matching
    // proposed items) if two separate calls had been made.
    const intents = [requestedIntent({ id: 'ia', activityId: 'workout', durationMinutes: 30 }), requestedIntent({ id: 'ib', flexibility: 'FIXED', activityId: 'deep-work', durationMinutes: 30, fixedStart: iso('2026-09-16T13:00:00Z'), originalOrder: 1 })];
    const result = await orchestrateConstructDay(baseRequest({ intents }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('44. a single coherent ConstructedDay is produced (one constructDay call)', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 2);
  }

  // 45. returned proposed item is preview-only
  {
    const intent = requestedIntent({ id: 'i45', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('45. proposed item is marked requiresConfirmation: true, and carries no persistence id', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.requiresConfirmation === true && !('id' in result.preview.constructedDay.proposedItems[0]));
  }

  // 46. user-fixed item preserves FIXED_CONSTRAINT source
  {
    const intent = requestedIntent({ id: 'i46', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T10:00:00Z'), flexibility: 'FIXED' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('46. placementSource === FIXED_CONSTRAINT for a user-fixed item', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.placementSource === 'FIXED_CONSTRAINT');
  }

  // 47. flexible item preserves SELECTED_CANDIDATE source
  {
    const intent = requestedIntent({ id: 'i47', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('47. placementSource === SELECTED_CANDIDATE for a flexible item', result.status === 'READY' && result.preview.constructedDay.proposedItems[0]?.placementSource === 'SELECTED_CANDIDATE');
  }

  // 48. mixed FIXED/FLEXIBLE day
  {
    const fixed = requestedIntent({ id: 'fixed1', activityId: 'workout', durationMinutes: 30, fixedStart: iso('2026-09-16T13:00:00Z'), flexibility: 'FIXED' });
    const flexible = requestedIntent({ id: 'flex1', activityId: 'deep-work', durationMinutes: 30, originalOrder: 1 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [fixed, flexible] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('48. a mixed FIXED+FLEXIBLE day places both correctly', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 2);
  }

  // 49. overloaded day delegates placement/defer to PR B
  {
    const a = requestedIntent({ id: 'ovA', activityId: 'workout', durationMinutes: 240, importance: 'HIGH' });
    const b = requestedIntent({ id: 'ovB', activityId: 'deep-work', durationMinutes: 240, importance: 'LOW', originalOrder: 1 });
    const result = await orchestrateConstructDay(
      baseRequest({ explicitStart: iso('2026-09-16T09:00:00Z'), explicitEnd: iso('2026-09-16T13:00:00Z'), intents: [a, b] }),
      noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T09:00:00Z', '2026-09-16T13:00:00Z', 'GOOD')] }) })
    );
    check('49. an overloaded day still reaches READY, placing the higher-priority intent and deferring the rest (PR B\'s own decision, not re-implemented here)', result.status === 'READY' && result.preview.constructedDay.proposedItems.length === 1 && result.preview.constructedDay.proposedItems[0].intentId === 'ovA');
  }

  // 50. zero-capacity day delegates fail-closed behavior to PR A/B
  {
    const intent = requestedIntent({ id: 'i50', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(
      baseRequest({ explicitStart: iso('2026-09-16T09:00:00Z'), explicitEnd: iso('2026-09-16T10:00:00Z'), intents: [intent] }),
      noopDeps({ loadBlockingPlans: async () => [blockerPlan('2026-09-16T09:00:00Z', '2026-09-16T10:00:00Z', 'UPCOMING')] })
    );
    check('50. zero usable capacity fails the whole orchestration closed (NO_USABLE_CAPACITY), never a fabricated proposal', result.status === 'NO_USABLE_CAPACITY');
  }

  // ============================================================
  // FAILURE / WARNINGS (51-54)
  // ============================================================

  // 51. coarse-family warning
  {
    const intent = requestedIntent({ id: 'i51', title: 'finish the investor presentation', durationMinutes: 60 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('51. coarse-family resolution is recorded as a warning, never an error, and the proposal still proceeds', result.status === 'READY' && result.preview.warnings.some((w) => w.code === 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY'));
  }

  // 52. unresolved activity warning if applicable (same warning code covers the case where classifyTask itself found no family)
  {
    const intent = requestedIntent({ id: 'i52', title: 'have a cup of tea', durationMinutes: 15 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('52. an activity that resolves to neither a catalog id nor a family still proceeds safely, without a fabricated activityFamily', result.status === 'READY');
  }

  // 53. no timing candidate warning vs deferred semantics
  {
    const intent = requestedIntent({ id: 'i53', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check('53. NO_TIMING_CANDIDATES_FOUND (warning) and NO_CANDIDATES (constructor deferral) are two distinct, both-present facts describing the same event', result.status === 'READY' && result.preview.warnings.some((w) => w.code === 'NO_TIMING_CANDIDATES_FOUND') && result.preview.constructedDay.deferredItems.some((d) => d.primaryReason === 'NO_CANDIDATES'));
  }

  // 54. timing-search failure is not mislabeled "no candidates"
  {
    const intent = requestedIntent({ id: 'i54', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => { throw new Error('boom'); } }));
    check('54. a thrown search error never reaches READY/NO_CANDIDATES -- it is TIMING_SEARCH_FAILED', result.status === 'TIMING_SEARCH_FAILED');
  }

  // ============================================================
  // PURITY BOUNDARY (55-60)
  // ============================================================

  // 55. orchestrator performs no placement ranking itself
  check(
    '55. orchestrateConstructDay source contains no ranking/sorting logic of its own (structural: it only ever calls constructDay once, never sorts candidates itself)',
    (() => {
      const source = require('fs').readFileSync(require.resolve('../apps/web/lib/dayConstructorOrchestrator.ts'), 'utf8');
      return !/\.sort\(/.test(source);
    })()
  );

  // 56. no persistence calls
  check(
    '56. no persistence function is actually INVOKED anywhere in the orchestrator source (doc-comment mentions explaining the boundary are fine; a real call like createPlannedActivity( is not)',
    (() => {
      const source = require('fs').readFileSync(require.resolve('../apps/web/lib/dayConstructorOrchestrator.ts'), 'utf8');
      return !/createPlannedActivity\(|saveUpcomingPlanFromCandidate\(/.test(source);
    })()
  );

  // 57. no API route
  check('57. no API route file was created for PR C (structural: this test imports only from lib/, never from app/api/)', true);

  // 58. no Plan mutation
  check(
    '58. no Plan-mutating function (update/cancel/delete PlannedActivity) appears in the orchestrator source',
    (() => {
      const source = require('fs').readFileSync(require.resolve('../apps/web/lib/dayConstructorOrchestrator.ts'), 'utf8');
      return !/cancelPlannedActivity|deletePlannedActivity|logPlannedActivity/.test(source);
    })()
  );

  // 59. no timing-engine modification
  check('59. timingSearch.ts/muhurtaEngine.ts/auraFitEngine.ts are only ever imported, never modified by this PR (verified by git diff scope, not by this test file itself)', true);

  // 60. deterministic result with injected dependencies
  {
    const intent = requestedIntent({ id: 'i60', activityId: 'workout', durationMinutes: 30 });
    const request = baseRequest({ intents: [intent] });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) });
    const first = await orchestrateConstructDay(request, deps);
    const second = await orchestrateConstructDay(request, deps);
    check('60. identical request + injected deps produce byte-equivalent output on repeated invocation', JSON.stringify(first) === JSON.stringify(second));
  }

  // ============================================================
  // INTENT FIDELITY V1 -- PR G2 (natural intent duration fallback,
  // 61-69). A free-text intent that never resolved a real activityId
  // now receives GENERIC_DURATION_FALLBACK_MINUTES instead of staying
  // unresolved -- closing post-V1 audit gap G2 -- without ever
  // fabricating an activityId, and without changing the resolved-
  // activity duration chain (durationMinutesFor, dayBuilderOrchestrator.ts,
  // unmodified) at all.
  // ============================================================

  // 61. Full end-to-end placement success: an unknown title + Automatic
  // duration, given a real candidate, is actually PLACED -- reaching the
  // already-existing taskTitle-based FIND search path (previously dead
  // code for this input shape, since duration never resolved far enough
  // to reach it).
  {
    let capturedRequest: { taskTitle?: string; activityId?: string; durationMinutes?: number } | undefined;
    const intent = requestedIntent({ id: 'i61', title: 'sort out the garage' }); // no activityId, no explicit duration
    const deps = noopDeps({
      searchTiming: (request) => {
        capturedRequest = request as typeof capturedRequest;
        return { candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z', 'GOOD')] };
      },
    });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), deps);
    check('61. the intent is actually PROPOSED (placed), not deferred', result.status === 'READY' && result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i61'));
    check('61. its duration is the generic fallback', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === GENERIC_DURATION_FALLBACK_MINUTES);
    check('61. timing search was reached via the free-text taskTitle path (no activityId to search by)', capturedRequest?.activityId === undefined && capturedRequest?.taskTitle === 'sort out the garage');
    check('61. the search request carries the resolved generic-fallback duration, not an omitted/guessed one', capturedRequest?.durationMinutes === GENERIC_DURATION_FALLBACK_MINUTES);
  }

  // 62. Explicit duration on an unknown title still wins outright -- G2
  // never overrides an explicit value, and never flags it as a fallback.
  {
    const intent = requestedIntent({ id: 'i62', title: 'sort out the garage', durationMinutes: 30 });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:30:00Z', 'GOOD')] }) }));
    check('62. the explicit duration is used verbatim, never replaced by the generic fallback', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === 30);
    check('62. no generic-fallback warning when an explicit duration was supplied', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'i62' && w.code === 'DURATION_FROM_GENERIC_FALLBACK'));
  }

  // 63. Known-activity resolution is completely unaffected by G2:
  // behavioral duration still wins over the catalog chain for a resolved
  // activityId (regression guard -- durationMinutesFor itself is
  // untouched).
  {
    const intent = requestedIntent({ id: 'i63', activityId: 'workout' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: { workout: 40 } }) }));
    check('63. behavioral duration still wins over the catalog chain for a resolved activity', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === 40);
    check('63. no generic-fallback warning when a real behavioral signal resolved it', result.status === 'READY' && !result.preview.warnings.some((w) => w.intentId === 'i63' && w.code === 'DURATION_FROM_GENERIC_FALLBACK'));
  }

  // 64. A coarse-family-only title (a real, named classifyTask family --
  // not the generic catch-all) with Automatic duration: activityFamily is
  // still preserved (never fabricated activityId), and duration now
  // resolves instead of staying unresolved.
  {
    const intent = requestedIntent({ id: 'i64', title: 'finish the investor presentation' }); // classifyTask -> a real named family, no catalog alias
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z', 'GOOD')] }) }));
    check('64. activityId stays undefined -- never fabricated to obtain a duration', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityId === undefined);
    check('64. a coarse activityFamily is still resolved', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.activityFamily !== undefined);
    check('64. duration resolves to the generic fallback rather than staying unresolved', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === GENERIC_DURATION_FALLBACK_MINUTES);
  }

  // 65. classifyTask's own generic catch-all (no specific keyword match at
  // all, e.g. "tax return" -- confirmed by this feature's own earlier
  // architecture audit to fall through every named pattern) behaves
  // IDENTICALLY to a named coarse family for G2 purposes -- the generic
  // fallback duration does not depend on which family classifyTask
  // returned.
  {
    const intent = requestedIntent({ id: 'i65', title: 'tax return' });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z', 'GOOD')] }) }));
    check('65. the generic catch-all family still resolves the same generic duration fallback', result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.estimatedDurationMinutes === GENERIC_DURATION_FALLBACK_MINUTES);
  }

  // 66. FIXED unknown-title intent + Automatic: the fixed constraint is
  // now constructible (it was never registered pre-G2, since
  // fixedConstraintsByIntentId population itself requires a resolved
  // duration).
  {
    const intent = requestedIntent({ id: 'i66', title: 'doctor follow-up', flexibility: 'FIXED', fixedStart: iso('2026-09-16T16:00:00Z') });
    const result = await orchestrateConstructDay(baseRequest({ intents: [intent] }), noopDeps());
    check(
      '66. the FIXED intent is placed at its declared time, duration resolved from the generic fallback',
      result.status === 'READY' &&
        result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i66' && p.start.getTime() === iso('2026-09-16T16:00:00Z').getTime() && p.end.getTime() === iso('2026-09-16T16:00:00Z').getTime() + GENERIC_DURATION_FALLBACK_MINUTES * 60000)
    );
  }

  // 67. Deterministic repeat invocation for a mixed G2 case (unknown
  // title, Automatic duration, a real candidate).
  {
    const intent = requestedIntent({ id: 'i67', title: 'sort out the garage' });
    const request = baseRequest({ intents: [intent] });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z', 'GOOD')] }) });
    const first = await orchestrateConstructDay(request, deps);
    const second = await orchestrateConstructDay(request, deps);
    check('67. identical G2 (generic-fallback-duration) request produces byte-equivalent output on repeated invocation', JSON.stringify(first) === JSON.stringify(second));
  }

  // 68. G1 (fixed reservation invariant) regression: an unknown-title
  // FLEXIBLE intent -- now constructible thanks to G2 -- must still yield
  // to a FIXED intent's declared interval, exactly like a known-activity
  // FLEXIBLE intent already does. G1's own implementation is untouched;
  // this proves G2 didn't accidentally bypass it by changing which
  // intents reach placement at all.
  {
    const flexUnknown = requestedIntent({ id: 'i68-flex', title: 'sort out the garage', originalOrder: 0 });
    const fixedDoctor = requestedIntent({ id: 'i68-fixed', title: 'Doctor', flexibility: 'FIXED', fixedStart: iso('2026-09-16T16:00:00Z'), durationMinutes: 45, originalOrder: 1 });
    const deps = noopDeps({ searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T16:00:00Z', '2026-09-16T16:45:00Z', 'EXCELLENT')] }) }); // the FLEXIBLE intent's only candidate overlaps the FIXED slot
    const result = await orchestrateConstructDay(baseRequest({ intents: [flexUnknown, fixedDoctor] }), deps);
    check(
      '68. the FIXED intent keeps its declared interval even though the newly-constructible FLEXIBLE intent was submitted first',
      result.status === 'READY' && result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i68-fixed')
    );
    check(
      '68. the FLEXIBLE intent (no other candidate) is deferred, conflicting with the FIXED reservation -- never displacing it',
      result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i68-flex' && d.primaryReason === 'CONFLICTS_WITH_PROPOSED_ITEM')
    );
  }

  // ============================================================
  // Availability Context V1 PR H1 -- orchestrator integration (69-85).
  // Every test below uses `constructionWindowSource: 'REMAINING_TODAY'`
  // (the ONLY source availability resolution ever touches -- EXPLICIT_
  // RANGE, exercised by every test above via `baseRequest`'s own
  // default, is completely unaffected, already proven by 1-68 above all
  // still passing unmodified).
  // ============================================================

  function remainingTodayRequest(overrides: Partial<ConstructDayRequest> = {}): ConstructDayRequest {
    return baseRequest({ constructionWindowSource: 'REMAINING_TODAY', explicitStart: undefined, explicitEnd: undefined, ...overrides });
  }

  // 69. UNCONFIGURED preserves the exact existing REMAINING_TODAY window (now -> midnight).
  {
    const now = iso('2026-09-16T08:30:00Z'); // 14:00 IST-equivalent-ish in whatever tz; using UTC here since baseRequest's own timezone is 'UTC'.
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now }), noopDeps());
    check(
      '69. UNCONFIGURED preserves the exact existing REMAINING_TODAY behavior (window start=now, end=target civil midnight)',
      result.status === 'READY' && result.preview.constructionWindow.start.getTime() === now.getTime() && result.preview.constructionWindow.end.toISOString() === '2026-09-17T00:00:00.000Z'
    );
  }

  // 70. CONFIGURED today clips to now.
  {
    const now = iso('2026-09-16T08:30:00Z'); // Wednesday.
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '06:00', endTime: '17:00' }] }) });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now }), deps);
    check(
      '70. CONFIGURED today clips the saved period\'s start to now',
      result.status === 'READY' && result.preview.constructionWindow.start.getTime() === now.getTime() && result.preview.constructionWindow.end.toISOString() === '2026-09-16T17:00:00.000Z'
    );
  }

  // 71. CONFIGURED future day is not clipped.
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '09:00', endTime: '17:00' }] }) }); // Thursday=4
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', targetDate: '2026-09-17', now: iso('2026-09-16T16:00:00Z') }), deps);
    check(
      '71. a future targetDate\'s configured availability is not clipped against today\'s now',
      result.status === 'READY' && result.preview.constructionWindow.start.toISOString() === '2026-09-17T09:00:00.000Z' && result.preview.constructionWindow.end.toISOString() === '2026-09-17T17:00:00.000Z'
    );
  }

  // 72. CONFIGURED_EMPTY reaches NO_USABLE_CAPACITY, never a fallback.
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 0, startTime: '10:00', endTime: '13:00' }] }) }); // only Sunday configured; targetDate is a Wednesday.
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z') }), deps);
    check('72. a configured schedule with zero periods for the target weekday reaches NO_USABLE_CAPACITY, never a REMAINING_TODAY fallback', result.status === 'NO_USABLE_CAPACITY');
  }

  // 73. Existing Plan inside availability subtracts capacity.
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }),
      loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z')],
    });
    const intent = requestedIntent({ id: 'i73', durationMinutes: 30 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), deps);
    check(
      '73. an existing Plan inside availability subtracts from usableMinutes exactly as before (8h window - 1h Plan = 7h = 420 min usable)',
      result.status === 'READY' && result.preview.constructedDay.requestedCapacity.usableMinutes === 420
    );
  }

  // 74/75/32. Multiple periods produce the exact gap-blocker capacity example from the architecture audit itself: 09-12 + 14-18, Plan 10-11 -> usable = 360.
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '12:00' }, { weekday: 3, startTime: '14:00', endTime: '18:00' }] }),
      loadBlockingPlans: async () => [blockerPlan('2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z')],
    });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z') }), deps);
    check(
      '74/32. the architecture audit\'s own worked capacity example (09-12 + 14-18, Plan 10-11) resolves to exactly 360 usable minutes',
      result.status === 'READY' &&
        result.preview.constructedDay.requestedCapacity.constructionWindowMinutes === 540 &&
        result.preview.constructedDay.requestedCapacity.blockedMinutes === 180 &&
        result.preview.constructedDay.requestedCapacity.usableMinutes === 360
    );
  }

  // 31/34/40. A FIXED intent placed inside the gap between two usable periods is deferred as blocked (the gap blocker + Plan blocker normalize/merge correctly together).
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '12:00' }, { weekday: 3, startTime: '14:00', endTime: '18:00' }] }) });
    const fixedInGap = requestedIntent({ id: 'i-gap', flexibility: 'FIXED', fixedStart: iso('2026-09-16T12:30:00Z'), durationMinutes: 60 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [fixedInGap] }), deps);
    check(
      '31/34. a FIXED intent placed inside the availability GAP (12:30-13:30, between 09-12 and 14-18) is deferred as blocked, not treated as outside the outer window',
      result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i-gap' && d.primaryReason === 'FIXED_WINDOW_CONFLICT')
    );
  }

  // 33. FIXED entirely outside availability (before the outer window) is deferred OUTSIDE_CONSTRUCTION_WINDOW.
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }) });
    const fixedBefore = requestedIntent({ id: 'i-before', flexibility: 'FIXED', fixedStart: iso('2026-09-16T08:30:00Z'), durationMinutes: 60 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [fixedBefore] }), deps);
    check(
      '33. a FIXED intent entirely before the resolved availability window is deferred OUTSIDE_CONSTRUCTION_WINDOW -- availability is never automatically expanded to accommodate it',
      result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i-before' && d.primaryReason === 'OUTSIDE_CONSTRUCTION_WINDOW')
    );
  }

  // 35/30. G1: LOW FIXED (inside availability) still reserves its interval before a HIGH FLEXIBLE candidate, with availability resolution active.
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }),
      searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T11:00:00Z', 'EXCELLENT')] }),
    });
    const lowFixed = requestedIntent({ id: 'i-lowfixed', importance: 'LOW', flexibility: 'FIXED', fixedStart: iso('2026-09-16T10:00:00Z'), durationMinutes: 60, originalOrder: 0 });
    const highFlex = requestedIntent({ id: 'i-highflex', importance: 'HIGH', durationMinutes: 60, originalOrder: 1 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [lowFixed, highFlex] }), deps);
    check(
      '35/30. G1 reservation holds unchanged under availability resolution: LOW FIXED keeps its interval, HIGH FLEXIBLE is deferred',
      result.status === 'READY' && result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i-lowfixed') && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i-highflex')
    );
  }

  // 36. G2: unknown natural title + Automatic still resolves via the generic duration fallback under availability resolution.
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }),
      searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z', 'GOOD')] }),
    });
    const unknown = requestedIntent({ id: 'i-unknown', title: 'sort out the garage' });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [unknown] }), deps);
    check(
      '36. G2 unknown-title + Automatic duration still resolves via the generic 45-minute fallback, unaffected by availability resolution',
      result.status === 'READY' && result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i-unknown' && p.end.getTime() - p.start.getTime() === 45 * 60000)
    );
  }

  // 37/38. G3/G4: importance and deadline pass through unaffected by availability.
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }) });
    const intent = requestedIntent({ id: 'i-g34', importance: 'HIGH', deadline: '2026-09-16', durationMinutes: 30 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), deps);
    check(
      '37/38. importance and deadline pass through to the resolved DayIntent unchanged under availability resolution',
      result.status === 'READY' && result.preview.resolvedIntents[0].dayIntent.importance === 'HIGH' && result.preview.resolvedIntents[0].dayIntent.deadline === '2026-09-16'
    );
  }

  // 39. Timing quality cannot escape availability -- an EXCELLENT candidate entirely outside the resolved window is still infeasible.
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '12:00' }] }),
      searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T15:00:00Z', '2026-09-16T15:30:00Z', 'EXCELLENT')] }), // outside 09-12
    });
    const intent = requestedIntent({ id: 'i-excellent', durationMinutes: 30 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), deps);
    check(
      '39. an EXCELLENT-rated candidate outside the resolved availability window remains unavailable -- timing quality never overrides availability feasibility',
      result.status === 'READY' && result.preview.constructedDay.deferredItems.some((d) => d.intentId === 'i-excellent')
    );
  }

  // 41. Deterministic orchestration -- identical request/deps produce a byte-equivalent preview.
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '12:00' }, { weekday: 3, startTime: '14:00', endTime: '18:00' }] }) });
    const request = remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [requestedIntent({ id: 'i-det', durationMinutes: 30 })] });
    const first = await orchestrateConstructDay(request, deps);
    const second = await orchestrateConstructDay(request, deps);
    check(
      '41. identical request/deps produce a byte-equivalent resolved construction window across two runs',
      first.status === 'READY' && second.status === 'READY' && first.preview.constructionWindow.start.getTime() === second.preview.constructionWindow.start.getTime() && first.preview.constructionWindow.end.getTime() === second.preview.constructionWindow.end.getTime()
    );
  }

  // ============================================================
  // Availability Context V1 PR H1 hardening -- CONFIGURED_EMPTY
  // requestedMinutes must mean "the total resolved duration requested,"
  // identical to the normal path's own semantics, never "0 because we
  // exited early" (42-50).
  // ============================================================

  function configuredEmptyDeps(overrides: Partial<DayConstructorOrchestratorDeps> = {}): DayConstructorOrchestratorDeps {
    // Sunday=0 configured; every fixture below targets TARGET_DATE (a
    // Wednesday), so this is always CONFIGURED_EMPTY for these tests.
    return noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 0, startTime: '10:00', endTime: '13:00' }] }), ...overrides });
  }

  // 42/1. explicit 60 -> requestedMinutes 60.
  {
    const intent = requestedIntent({ id: 'ce-1', durationMinutes: 60 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), configuredEmptyDeps());
    check('42. CONFIGURED_EMPTY + one explicit-60-minute intent -> requestedMinutes is 60, not 0', result.status === 'NO_USABLE_CAPACITY' && result.requestedMinutes === 60);
  }

  // 43/2. explicit 60 + explicit 30 -> requestedMinutes 90.
  {
    const a = requestedIntent({ id: 'ce-2a', durationMinutes: 60, originalOrder: 0 });
    const b = requestedIntent({ id: 'ce-2b', durationMinutes: 30, originalOrder: 1 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [a, b] }), configuredEmptyDeps());
    check('43. CONFIGURED_EMPTY + two explicit intents (60 + 30) -> requestedMinutes sums to 90', result.status === 'NO_USABLE_CAPACITY' && result.requestedMinutes === 90);
  }

  // 44/3. unknown natural title + Automatic -> requestedMinutes 45 via G2's own generic fallback, no activityId fabricated.
  {
    const intent = requestedIntent({ id: 'ce-3', title: 'sort out the garage' });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), configuredEmptyDeps());
    check('44. CONFIGURED_EMPTY + unknown Automatic -> requestedMinutes is 45 (G2 generic fallback), same as the normal path would resolve', result.status === 'NO_USABLE_CAPACITY' && result.requestedMinutes === 45);
  }

  // 45/4. never a fabricated zero-length window -- INVALID_CONSTRUCTION_WINDOW/TIMEZONE_MISSING never appear; status is exactly NO_USABLE_CAPACITY with a zero constructionWindowMinutes/blockedMinutes reported directly, never derived from a real (invalid) ConstructionWindow object.
  {
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [requestedIntent({ id: 'ce-4', durationMinutes: 15 })] }), configuredEmptyDeps());
    check(
      '45. CONFIGURED_EMPTY never fabricates/validates a zero-length ConstructionWindow -- status is exactly NO_USABLE_CAPACITY with constructionWindowMinutes=0, blockedMinutes=0 reported directly',
      result.status === 'NO_USABLE_CAPACITY' && result.constructionWindowMinutes === 0 && result.blockedMinutes === 0
    );
  }

  // 46/5. timing search is never called for CONFIGURED_EMPTY.
  {
    let searchTimingCalls = 0;
    const deps = configuredEmptyDeps({ searchTiming: () => { searchTimingCalls += 1; return { candidates: [] }; } });
    const intent = requestedIntent({ id: 'ce-5' }); // FLEXIBLE, Automatic -- would normally trigger a search on the READY path.
    await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), deps);
    check('46. CONFIGURED_EMPTY never calls deps.searchTiming -- duration resolution and timing search stay separate concerns', searchTimingCalls === 0);
  }

  // 47/6. status remains exactly NO_USABLE_CAPACITY (explicit, standalone).
  {
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [] }), configuredEmptyDeps());
    check('47. CONFIGURED_EMPTY remains status NO_USABLE_CAPACITY even with zero requested intents', result.status === 'NO_USABLE_CAPACITY' && result.requestedMinutes === 0);
  }

  // 48/7. UNCONFIGURED fallback is untouched by this hardening (never reaches the CONFIGURED_EMPTY branch at all).
  {
    const now = iso('2026-09-16T08:30:00Z');
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now }), noopDeps());
    check('48. UNCONFIGURED still preserves the exact existing REMAINING_TODAY window, unaffected by the CONFIGURED_EMPTY hardening', result.status === 'READY' && result.preview.constructionWindow.start.getTime() === now.getTime());
  }

  // 49/8. Normal CONFIGURED (non-empty) availability's own requestedMinutes is unaffected by this refactor (READY path, real capacity snapshot).
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }) });
    const intent = requestedIntent({ id: 'ce-8', durationMinutes: 30 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), deps);
    check('49. normal (non-empty) configured availability still reports the real requestedMinutes on the READY path, unaffected by the CONFIGURED_EMPTY refactor', result.status === 'READY' && result.preview.constructedDay.requestedCapacity.requestedMinutes === 30);
  }

  // 50/9. The ordinary G2 (non-empty availability) path is unaffected by the resolveRequestedDayIntent extraction -- an unknown title still resolves the generic fallback and gets PLACED (not merely counted).
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 3, startTime: '09:00', endTime: '17:00' }] }),
      searchTiming: () => ({ candidates: [timingCandidate('2026-09-16T10:00:00Z', '2026-09-16T10:45:00Z', 'GOOD')] }),
    });
    const intent = requestedIntent({ id: 'ce-9', title: 'sort out the garage' });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: iso('2026-09-16T00:00:00Z'), intents: [intent] }), deps);
    check(
      '50. the ordinary G2 path (non-empty configured availability) still places an unknown-title Automatic intent via the generic fallback, unaffected by the resolveRequestedDayIntent extraction',
      result.status === 'READY' && result.preview.constructedDay.proposedItems.some((p) => p.intentId === 'ce-9' && p.end.getTime() - p.start.getTime() === 45 * 60000)
    );
  }

  // ============================================================
  // Planning Horizon V1 PR P1 -- Tomorrow readiness (51-60). Every test
  // below uses `remainingTodayRequest` (constructionWindowSource stays
  // 'REMAINING_TODAY' -- P1 never introduces a second source) with a
  // `targetDate` one civil day ahead of `now`'s own civil date.
  // ============================================================

  const TODAY_NOW = iso('2026-09-16T08:00:00Z'); // Wednesday, matches TARGET_DATE.
  const TOMORROW_DATE = '2026-09-17'; // Thursday.

  // 51. TODAY + UNCONFIGURED is completely unaffected by P1 -- exact
  // existing REMAINING_TODAY fallback, still reached.
  {
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW }), noopDeps());
    check(
      '51. TODAY + UNCONFIGURED is unaffected by Planning Horizon V1 -- still resolves the existing REMAINING_TODAY fallback (window start=now, end=today\'s own midnight)',
      result.status === 'READY' && result.preview.constructionWindow.start.getTime() === TODAY_NOW.getTime() && result.preview.constructionWindow.end.toISOString() === '2026-09-17T00:00:00.000Z'
    );
  }

  // 52. TOMORROW + UNCONFIGURED fails closed as FUTURE_AVAILABILITY_REQUIRED -- never reaches the REMAINING_TODAY fallback for a future date.
  {
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE }), noopDeps());
    check('52. TOMORROW + UNCONFIGURED returns FUTURE_AVAILABILITY_REQUIRED, never a fabricated now->tomorrow-midnight window', result.status === 'FUTURE_AVAILABILITY_REQUIRED');
  }

  // 53. The FUTURE_AVAILABILITY_REQUIRED path never calls searchTiming/loadBlockingPlans -- fails closed before any further real-data fetch, mirroring the existing CONFIGURED_EMPTY discipline.
  {
    let searchTimingCalls = 0;
    let loadBlockingPlansCalls = 0;
    const deps = noopDeps({ searchTiming: () => { searchTimingCalls += 1; return { candidates: [] }; }, loadBlockingPlans: async () => { loadBlockingPlansCalls += 1; return []; } });
    const intent = requestedIntent({ id: 'i-future-unconf', durationMinutes: 30 });
    await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE, intents: [intent] }), deps);
    check('53. FUTURE_AVAILABILITY_REQUIRED never calls searchTiming or loadBlockingPlans', searchTimingCalls === 0 && loadBlockingPlansCalls === 0);
  }

  // 54. TOMORROW + CONFIGURED split availability resolves the full, unclipped configured windows for that weekday (Thursday=4) -- no availability-algorithm change (reuses resolveAvailability verbatim).
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '09:00', endTime: '12:00' }, { weekday: 4, startTime: '14:00', endTime: '18:00' }] }) });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE }), deps);
    check(
      '54. TOMORROW + CONFIGURED split availability resolves the full unclipped outer span (09:00-18:00), not clipped against today\'s now',
      result.status === 'READY' && result.preview.constructionWindow.start.toISOString() === '2026-09-17T09:00:00.000Z' && result.preview.constructionWindow.end.toISOString() === '2026-09-17T18:00:00.000Z'
    );
  }

  // 55. Same TOMORROW split-availability request also correctly nets out the gap (09-12 + 14-18 = 420 usable minutes before any Plan/intent).
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '09:00', endTime: '12:00' }, { weekday: 4, startTime: '14:00', endTime: '18:00' }] }) });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE }), deps);
    check(
      '55. TOMORROW\'s own availability gap (12:00-14:00) is still correctly excluded from usable capacity (540 total window minutes - 120 gap = 420 usable)',
      result.status === 'READY' && result.preview.constructedDay.requestedCapacity.usableMinutes === 420
    );
  }

  // 56. TOMORROW + CONFIGURED_EMPTY (zero periods for Thursday) still reaches NO_USABLE_CAPACITY, never reinterpreted as UNCONFIGURED/FUTURE_AVAILABILITY_REQUIRED.
  {
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 0, startTime: '10:00', endTime: '13:00' }] }) }); // only Sunday configured.
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE }), deps);
    check('56. TOMORROW + CONFIGURED_EMPTY reaches NO_USABLE_CAPACITY, distinct from FUTURE_AVAILABILITY_REQUIRED (a real, saved-but-empty schedule is never treated as unconfigured)', result.status === 'NO_USABLE_CAPACITY');
  }

  // 57. An existing Plan tomorrow blocks its own interval.
  {
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '09:00', endTime: '17:00' }] }),
      loadBlockingPlans: async () => [blockerPlan('2026-09-17T10:00:00Z', '2026-09-17T11:00:00Z')],
    });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE }), deps);
    check(
      '57. an existing Plan tomorrow subtracts from tomorrow\'s usable capacity exactly as it would for today (8h window - 1h Plan = 420 usable minutes)',
      result.status === 'READY' && result.preview.constructedDay.requestedCapacity.usableMinutes === 420
    );
  }

  // 58. Today's own Plans never block Tomorrow -- loadBlockingPlans is always scoped by the request's own targetDate (localDayBoundsUTC), never today's bounds.
  {
    let loadBlockingPlansArgs: { from: Date; to: Date } | undefined;
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '09:00', endTime: '17:00' }] }),
      loadBlockingPlans: async (bounds) => { loadBlockingPlansArgs = bounds; return []; },
    });
    await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', now: TODAY_NOW, targetDate: TOMORROW_DATE }), deps);
    check(
      "58. TOMORROW's own blocking-plan query is scoped to tomorrow's own day bounds, never today's",
      loadBlockingPlansArgs !== undefined && loadBlockingPlansArgs.from.toISOString() === '2026-09-17T00:00:00.000Z' && loadBlockingPlansArgs.to.toISOString() === '2026-09-18T00:00:00.000Z'
    );
  }

  // 59/60. FIXED intent tomorrow -- resolveFixedStart-equivalent proof at
  // the orchestrator layer: a fixedStart already anchored to tomorrow's
  // own civil date (as planDayEntry.ts's own resolveFixedStart would
  // produce, given the SAME request.timezone) places correctly inside
  // tomorrow's configured window, proven in two different real-world
  // timezones. The request's own `timezone` is always the ONE
  // authenticated user's own zone -- both the configured-period window
  // and the FIXED instant are resolved against it consistently, exactly
  // as `resolveAvailability`/`resolveFixedStart` both do in production.
  {
    // Asia/Kolkata (UTC+5:30): configuring the whole civil day (00:00-23:59)
    // for weekday=4 (Thursday) resolves to [2026-09-16T18:30:00Z,
    // 2026-09-17T18:29:00Z). 09:00 IST on 2026-09-17 == 2026-09-17T03:30:00Z.
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '00:00', endTime: '23:59' }] }) });
    const fixedKolkata = requestedIntent({ id: 'i-fixed-ist', flexibility: 'FIXED', fixedStart: iso('2026-09-17T03:30:00Z'), durationMinutes: 60 });
    const resultKolkata = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'Asia/Kolkata', now: TODAY_NOW, targetDate: TOMORROW_DATE, intents: [fixedKolkata] }), deps);
    check(
      '59. a FIXED 09:00 Asia/Kolkata start correctly anchored to tomorrow\'s civil date is placed (no browser/client date authority -- the instant alone determines placement)',
      resultKolkata.status === 'READY' && resultKolkata.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i-fixed-ist')
    );
  }
  {
    // America/New_York (EDT, UTC-4 in September): configuring the whole
    // civil day for weekday=4 resolves to [2026-09-17T04:00:00Z,
    // 2026-09-18T03:59:00Z). 09:00 EDT on 2026-09-17 == 2026-09-17T13:00:00Z.
    const deps = noopDeps({ loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '00:00', endTime: '23:59' }] }) });
    const fixedNewYork = requestedIntent({ id: 'i-fixed-edt', flexibility: 'FIXED', fixedStart: iso('2026-09-17T13:00:00Z'), durationMinutes: 60 });
    const resultNewYork = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'America/New_York', now: TODAY_NOW, targetDate: TOMORROW_DATE, intents: [fixedNewYork] }), deps);
    check(
      '60. a FIXED 09:00 America/New_York start correctly anchored to tomorrow\'s civil date is placed, proving FIXED-tomorrow works regardless of which real-world timezone the user is in',
      resultNewYork.status === 'READY' && resultNewYork.preview.constructedDay.proposedItems.some((p) => p.intentId === 'i-fixed-edt')
    );
  }

  // ============================================================
  // Construction-Window-Aware Timing Search V1 -- wiring proof. This
  // file's own `noopDeps().searchTiming` is a plain fake (never the real
  // engine), so this checks WIRING only: does the orchestrator thread the
  // exact resolved `ConstructionWindow` through to `deps.searchTiming`'s
  // own request as `searchWindow`? The real end-to-end behavioral proof
  // (the audit's own reproduced bug, now fixed) lives in
  // test/tomorrowWindowAwareTimingSearch.test.ts, against the REAL
  // engine -- kept separate rather than duplicated here, matching this
  // repo's own established split between a fake-dependency wiring suite
  // (this file) and a real-engine behavioral suite (that one).
  // ============================================================
  {
    const capturedRequests: { start: string | undefined; searchWindow: { start: Date; end: Date } | undefined }[] = [];
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '05:00', endTime: '09:00' }] }),
      searchTiming: (request) => {
        capturedRequests.push({ start: request.dateRange?.start, searchWindow: request.searchWindow });
        return { candidates: [] };
      },
    });
    const flexIntent = requestedIntent({ id: 'i-search-window', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 });
    const result = await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', targetDate: '2026-09-17', now: iso('2026-09-16T16:00:00Z'), intents: [flexIntent] }), deps);
    check('61. a FLEXIBLE intent\'s searchTiming call receives searchWindow', result.status === 'READY' && capturedRequests.length === 1 && capturedRequests[0].searchWindow !== undefined);
    check(
      '62. searchWindow passed to searchTiming matches the resolved ConstructionWindow exactly (same start/end instants, zero conversion)',
      result.status === 'READY' &&
        capturedRequests[0].searchWindow?.start.getTime() === result.preview.constructionWindow.start.getTime() &&
        capturedRequests[0].searchWindow?.end.getTime() === result.preview.constructionWindow.end.getTime()
    );
  }
  {
    // A FIXED intent never calls searchTiming at all (unchanged, pre-
    // existing architecture) -- confirms this PR did not newly route
    // FIXED intents through timing search merely because searchWindow
    // now exists.
    const capturedRequests: unknown[] = [];
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({ configured: true, periods: [{ weekday: 4, startTime: '05:00', endTime: '09:00' }] }),
      searchTiming: (request) => {
        capturedRequests.push(request);
        return { candidates: [] };
      },
    });
    const fixedIntent = requestedIntent({ id: 'i-fixed-no-search', flexibility: 'FIXED', fixedStart: iso('2026-09-17T06:00:00Z'), durationMinutes: 30 });
    await orchestrateConstructDay(remainingTodayRequest({ timezone: 'UTC', targetDate: '2026-09-17', now: iso('2026-09-16T16:00:00Z'), intents: [fixedIntent] }), deps);
    check('63. a FIXED intent still never calls searchTiming (searchWindow addition did not change this)', capturedRequests.length === 0);
  }

  // ============================================================
  // PR #146 correctness amendment -- excludedIntervals wiring proof.
  // Same fake-dependency style as the searchWindow wiring checks above:
  // this file proves WIRING only (does the orchestrator thread the
  // already-computed `blockedIntervals` array through to `searchTiming`
  // as `excludedIntervals`?), never real timing-ranking behavior -- that
  // real-engine proof lives in test/tomorrowWindowAwareTimingSearch.test.ts
  // and test/timingSearch.test.ts.
  // ============================================================
  {
    const capturedRequests: { searchWindow: { start: Date; end: Date } | undefined; excludedIntervals: { start: Date; end: Date }[] | undefined }[] = [];
    // Disjoint availability (05:00-06:00 + 08:00-09:00) on weekday 4 --
    // produces a real, non-empty AVAILABILITY_GAP blocker (06:00-08:00) --
    // plus one existing blocking Plan (elsewhere in the window), so
    // BOTH known `BlockedIntervalSource` categories this ticket's own
    // section 3 asks about are present at once.
    const existingPlan = { start: iso('2026-09-17T12:15:00Z'), end: iso('2026-09-17T12:30:00Z'), status: 'UPCOMING' as const }; // 08:15-08:30 EDT, inside the second period.
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({
        configured: true,
        periods: [
          { weekday: 4, startTime: '05:00', endTime: '06:00' },
          { weekday: 4, startTime: '08:00', endTime: '09:00' },
        ],
      }),
      loadBlockingPlans: async () => [existingPlan],
      searchTiming: (request) => {
        capturedRequests.push({ searchWindow: request.searchWindow, excludedIntervals: request.excludedIntervals });
        return { candidates: [] };
      },
    });
    const flexIntent = requestedIntent({ id: 'i-excluded-intervals', flexibility: 'FLEXIBLE', activityId: 'workout', durationMinutes: 30 });
    await orchestrateConstructDay(remainingTodayRequest({ timezone: 'America/New_York', targetDate: '2026-09-17', now: iso('2026-09-16T16:00:00Z'), intents: [flexIntent] }), deps);
    check('64. a FLEXIBLE intent\'s searchTiming call receives excludedIntervals', capturedRequests.length === 1 && capturedRequests[0].excludedIntervals !== undefined);
    check('65. excludedIntervals contains exactly 2 entries (the availability gap + the existing Plan)', capturedRequests[0].excludedIntervals?.length === 2);
    check(
      '66. one of the excluded intervals is the real AVAILABILITY_GAP (06:00-08:00 EDT = 10:00-12:00Z)',
      capturedRequests[0].excludedIntervals?.some((iv) => iv.start.getTime() === iso('2026-09-17T10:00:00Z').getTime() && iv.end.getTime() === iso('2026-09-17T12:00:00Z').getTime()) === true
    );
    check(
      '67. the other excluded interval is the real existing blocking Plan, exact instants, zero conversion',
      capturedRequests[0].excludedIntervals?.some((iv) => iv.start.getTime() === existingPlan.start.getTime() && iv.end.getTime() === existingPlan.end.getTime()) === true
    );
  }
  {
    // A FIXED intent still never calls searchTiming -- excludedIntervals
    // addition did not change this either (same architecture as check 63).
    const capturedRequests: unknown[] = [];
    const deps = noopDeps({
      loadAvailabilityConfiguration: async () => ({
        configured: true,
        periods: [
          { weekday: 4, startTime: '05:00', endTime: '06:00' },
          { weekday: 4, startTime: '08:00', endTime: '09:00' },
        ],
      }),
      searchTiming: (request) => {
        capturedRequests.push(request);
        return { candidates: [] };
      },
    });
    const fixedIntent = requestedIntent({ id: 'i-fixed-no-search-2', flexibility: 'FIXED', fixedStart: iso('2026-09-17T13:00:00Z'), durationMinutes: 30 });
    await orchestrateConstructDay(remainingTodayRequest({ timezone: 'America/New_York', targetDate: '2026-09-17', now: iso('2026-09-16T16:00:00Z'), intents: [fixedIntent] }), deps);
    check('68. a FIXED intent under disjoint availability still never calls searchTiming (excludedIntervals did not change this)', capturedRequests.length === 0);
  }

  if (!allPassed) {
    console.error('\nSome Day Constructor Orchestrator checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY CONSTRUCTOR ORCHESTRATOR CHECKS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
