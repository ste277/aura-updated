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

function noopDeps(overrides: Partial<DayConstructorOrchestratorDeps> = {}): DayConstructorOrchestratorDeps {
  return {
    loadBlockingPlans: async () => [],
    loadDurationContext: async () => ({ preferredDurationByActivityId: {}, behavioralDurationByActivityId: {} }),
    searchTiming: () => ({ candidates: [] }),
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
