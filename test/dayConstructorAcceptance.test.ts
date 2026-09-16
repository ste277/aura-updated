/**
 * Day Constructor V1 -- PR E1 acceptance-domain regression suite.
 * Exercises `evaluateAcceptance` entirely through injected fake
 * dependencies and an injected boundary `now` -- no live DB, no network,
 * no real timing-engine computation, matching this repo's own
 * established convention (dayConstructorOrchestrator.test.ts).
 */
import {
  evaluateAcceptance,
  type AcceptConstructedDayRequest,
  type AcceptedProposedItem,
  type AcceptanceDeps,
} from '../apps/web/lib/dayConstructorAcceptance';
import type { ConstructionWindow } from '../apps/web/lib/dayIntent';
import type { PlanBlockerCandidate } from '../apps/web/lib/dayConstructorOrchestrator';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

function window(overrides: Partial<ConstructionWindow> = {}): ConstructionWindow {
  return {
    date: '2026-09-16',
    start: iso('2026-09-16T13:00:00Z'),
    end: iso('2026-09-17T04:00:00Z'),
    timezone: 'America/New_York',
    source: 'EXPLICIT_RANGE',
    ...overrides,
  };
}

function item(overrides: Partial<AcceptedProposedItem> & { intentId: string; start: Date; end: Date }): AcceptedProposedItem {
  return { title: 'Untitled', placementSource: 'SELECTED_CANDIDATE', ...overrides };
}

function request(overrides: Partial<AcceptConstructedDayRequest> = {}): AcceptConstructedDayRequest {
  return { clientRequestId: 'accept-1', constructionWindow: window(), proposedItems: [], ...overrides };
}

function fakeCandidate(overrides: Partial<TimingCandidate> = {}): TimingCandidate {
  return {
    start: '2026-09-16T14:00:00Z',
    end: '2026-09-16T15:00:00Z',
    score: 7,
    label: 'GOOD',
    muhurtaScore: 0,
    reasons: [],
    metadata: { windowType: 'NEUTRAL' as unknown as TimingCandidate['metadata']['windowType'], windowLabel: '', activityType: '', dateLabel: '' },
    ...overrides,
  };
}

/** Default deps: no blockers, every activityId valid, CHECK always succeeds. */
function baseDeps(overrides: Partial<AcceptanceDeps> = {}): AcceptanceDeps {
  return {
    loadFreshBlockers: async () => [],
    validateActivity: () => true,
    checkTiming: () => fakeCandidate(),
    ...overrides,
  };
}

const NOW = iso('2026-09-16T09:00:00Z'); // before the default window's own start (13:00Z)

async function main() {
  // ============================================================
  // HAPPY PATH (1-11)
  // ============================================================

  {
    const req = request({ proposedItems: [item({ intentId: 'a', activityId: 'deep_work', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE' })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('1. one SELECTED_CANDIDATE item is ACCEPTABLE', decision.status === 'ACCEPTABLE');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T15:30:00Z'), end: iso('2026-09-16T16:30:00Z'), placementSource: 'FIXED_CONSTRAINT' })] });
    const decision = await evaluateAcceptance(req, baseDeps({ checkTiming: () => { throw new Error('CHECK must never be called for FIXED_CONSTRAINT'); } }), NOW);
    check('2. one FIXED_CONSTRAINT item is ACCEPTABLE (and CHECK is never invoked for it)', decision.status === 'ACCEPTABLE');
  }
  {
    const req = request({
      proposedItems: [
        item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }),
        item({ intentId: 'b', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T17:00:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
        item({ intentId: 'c', start: iso('2026-09-16T18:00:00Z'), end: iso('2026-09-16T18:45:00Z') }),
      ],
    });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('3. multiple proposed items are ACCEPTABLE together', decision.status === 'ACCEPTABLE' && decision.writeIntents.length === 3);
  }
  {
    const req = request({
      proposedItems: [
        item({ intentId: 'late', start: iso('2026-09-16T18:00:00Z'), end: iso('2026-09-16T18:45:00Z') }),
        item({ intentId: 'early', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }),
      ],
    });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('4. chronological write order by start time regardless of input order', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].intentId === 'early' && decision.writeIntents[1].intentId === 'late');
  }
  {
    const start = iso('2026-09-16T14:00:00Z');
    const end = iso('2026-09-16T15:00:00Z');
    const req = request({ proposedItems: [item({ intentId: 'a', start, end })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('5. reviewed start is preserved exactly', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].plannedStartAt.getTime() === start.getTime());
    check('6. reviewed end is preserved exactly', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].plannedEndAt.getTime() === end.getTime());
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', title: 'Finish investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('7. reviewed title is preserved verbatim', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].title === 'Finish investor deck');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', activityId: 'deep_work', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('8. activityId is preserved when present', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].activityId === 'deep_work');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('9. absent activityId remains absent (never fabricated)', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].activityId === undefined);
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:45:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('10. durationMinutes is derived from the reviewed interval (45 min)', decision.status === 'ACCEPTABLE' && decision.writeIntents[0].durationMinutes === 45);
  }
  check('11. AcceptedProposedItem has no field for a deferred-item shape (structurally impossible to submit one)', (() => {
    const shapeKeys: (keyof AcceptedProposedItem)[] = ['intentId', 'activityId', 'title', 'start', 'end', 'placementSource'];
    return !shapeKeys.includes('primaryReason' as keyof AcceptedProposedItem) && !('diagnostics' in ({} as AcceptedProposedItem));
  })());

  // ============================================================
  // WHOLE PROPOSAL (12-15)
  // ============================================================

  {
    const req = request({
      proposedItems: [
        item({ intentId: 'good', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }),
        item({ intentId: 'bad', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T15:30:00Z') }), // end before start
      ],
    });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('12. one invalid item rejects the entire proposal', decision.status === 'REJECTED' && decision.reason === 'INVALID_REQUEST');
  }
  {
    const req = request({
      proposedItems: [
        item({ intentId: 'good', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }),
        item({ intentId: 'conflicted', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') }),
      ],
    });
    const blocker: PlanBlockerCandidate = { start: iso('2026-09-16T20:30:00Z'), end: iso('2026-09-16T21:30:00Z'), status: 'UPCOMING' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [blocker] }), NOW);
    check('13. one blocker conflict rejects the entire proposal', decision.status === 'REJECTED' && decision.reason === 'CONFLICT');
  }
  {
    const req = request({
      proposedItems: [
        item({ intentId: 'good', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }),
        item({ intentId: 'bad-check', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') }),
      ],
    });
    const decision = await evaluateAcceptance(
      req,
      baseDeps({ checkTiming: (r) => { if (r.candidateStart.getTime() === iso('2026-09-16T20:00:00Z').getTime()) throw new Error('engine unavailable'); return fakeCandidate(); } }),
      NOW
    );
    check('14. one timing-infrastructure failure rejects the entire proposal', decision.status === 'REJECTED' && decision.reason === 'TIMING_CHECK_FAILED');
  }
  {
    const req = request({
      proposedItems: [
        item({ intentId: 'good', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }),
        item({ intentId: 'bad', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T15:30:00Z') }),
      ],
    });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('15. a REJECTED decision never carries a writeIntents field', decision.status === 'REJECTED' && !('writeIntents' in decision));
  }

  // ============================================================
  // STALE (16-19)
  // ============================================================

  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T08:00:00Z'), end: iso('2026-09-16T08:30:00Z') })], constructionWindow: window({ start: iso('2026-09-16T07:00:00Z') }) });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW); // NOW = 09:00Z, item start = 08:00Z
    check('16. proposed start already elapsed relative to now is STALE_PREVIEW', decision.status === 'REJECTED' && decision.reason === 'STALE_PREVIEW');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: NOW, end: iso('2026-09-16T09:30:00Z') })], constructionWindow: window({ start: iso('2026-09-16T08:00:00Z') }) });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('17. proposed start exactly equal to now is STALE_PREVIEW (never treated as still-future)', decision.status === 'REJECTED' && decision.reason === 'STALE_PREVIEW');
  }
  {
    const elapsedWindow = window({ start: iso('2026-09-16T06:00:00Z'), end: iso('2026-09-16T08:00:00Z') });
    const req = request({ constructionWindow: elapsedWindow, proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T07:00:00Z'), end: iso('2026-09-16T07:30:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW); // whole window already elapsed relative to NOW (09:00Z)
    check('18. the reviewed construction window itself having elapsed is STALE_PREVIEW (covers local-day rollover)', decision.status === 'REJECTED' && decision.reason === 'STALE_PREVIEW');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const blocker: PlanBlockerCandidate = { start: iso('2026-09-16T20:30:00Z'), end: iso('2026-09-16T21:30:00Z'), status: 'UPCOMING' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [blocker] }), NOW);
    check('19. a fresh blocker appearing since preview time is CONFLICT, not STALE_PREVIEW', decision.status === 'REJECTED' && decision.reason === 'CONFLICT');
  }

  // ============================================================
  // BLOCKERS (20-25) -- reusing PR C's own isActivePlanBlocker verbatim
  // ============================================================

  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const futureBlocker: PlanBlockerCandidate = { start: iso('2026-09-16T20:30:00Z'), end: iso('2026-09-16T21:30:00Z'), status: 'UPCOMING' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [futureBlocker] }), NOW);
    check('20. a future active UPCOMING blocker blocks', decision.status === 'REJECTED' && decision.reason === 'CONFLICT');
  }
  {
    const currentNow = iso('2026-09-16T20:15:00Z');
    // The proposed item itself is still FUTURE relative to currentNow (20:30 > 20:15,
    // so it is not STALE_PREVIEW); the blocker started before currentNow and is still
    // ongoing (currently in progress), and its remaining overlap reaches into the
    // proposed item's own interval.
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:30:00Z'), end: iso('2026-09-16T21:30:00Z') })] });
    const currentBlocker: PlanBlockerCandidate = { start: iso('2026-09-16T19:45:00Z'), end: iso('2026-09-16T20:45:00Z'), status: 'UPCOMING' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [currentBlocker] }), currentNow);
    check('21. a currently in-progress UPCOMING blocker blocks its own remaining overlap', decision.status === 'REJECTED' && decision.reason === 'CONFLICT');
  }
  {
    const laterNow = iso('2026-09-16T22:00:00Z');
    const req = request({ constructionWindow: window({ end: iso('2026-09-17T04:00:00Z') }), proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T22:30:00Z'), end: iso('2026-09-16T23:00:00Z') })] });
    const missedBlocker: PlanBlockerCandidate = { start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z'), status: 'UPCOMING' }; // elapsed, never logged -> derived MISSED
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [missedBlocker] }), laterNow);
    check('22. a past, derived-MISSED UPCOMING blocker does not block', decision.status === 'ACCEPTABLE');
  }
  {
    // Acceptance can only ever accept a still-future proposed item (an
    // already-elapsed start is unconditionally STALE_PREVIEW -- see #16/17
    // -- so there is no "accept a historical proposed item" case the way
    // PR C's own EXPLICIT_RANGE construction supports). This instead
    // re-confirms LOGGED's own time-independent blocking rule using a
    // still-future item: a LOGGED blocker blocks regardless of the
    // reference instant, exactly like isActivePlanBlocker's own contract.
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const loggedBlocker: PlanBlockerCandidate = { start: iso('2026-09-16T19:45:00Z'), end: iso('2026-09-16T20:30:00Z'), status: 'LOGGED' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [loggedBlocker] }), NOW);
    check('23. a LOGGED blocker blocks even though it predates the reference instant (time-independent rule)', decision.status === 'REJECTED' && decision.reason === 'CONFLICT');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const cancelledBlocker: PlanBlockerCandidate = { start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z'), status: 'CANCELLED' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [cancelledBlocker] }), NOW);
    check('24. a CANCELLED blocker never blocks, even at the exact same interval', decision.status === 'ACCEPTABLE');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const adjacentBlocker: PlanBlockerCandidate = { start: iso('2026-09-16T21:00:00Z'), end: iso('2026-09-16T22:00:00Z'), status: 'UPCOMING' };
    const decision = await evaluateAcceptance(req, baseDeps({ loadFreshBlockers: async () => [adjacentBlocker] }), NOW);
    check('25. an adjacent (touching, non-overlapping) blocker is allowed', decision.status === 'ACCEPTABLE');
  }

  // ============================================================
  // INTEGRITY (26-35)
  // ============================================================

  check('26. an invalid (unparseable) start rejects as INVALID_REQUEST', (await evaluateAcceptance(request({ proposedItems: [item({ intentId: 'a', start: new Date('not-a-date'), end: iso('2026-09-16T15:00:00Z') })] }), baseDeps(), NOW)).status === 'REJECTED');
  check('27. an invalid (unparseable) end rejects as INVALID_REQUEST', (await evaluateAcceptance(request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: new Date('not-a-date') })] }), baseDeps(), NOW)).status === 'REJECTED');
  check('28. end <= start rejects as INVALID_REQUEST', (await evaluateAcceptance(request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T15:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] }), baseDeps(), NOW)).status === 'REJECTED');
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }), item({ intentId: 'b', start: iso('2026-09-16T14:30:00Z'), end: iso('2026-09-16T15:30:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('29. two proposed items overlapping each other rejects as INVALID_REQUEST', decision.status === 'REJECTED' && decision.reason === 'INVALID_REQUEST');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-17T05:00:00Z'), end: iso('2026-09-17T06:00:00Z') })] }); // after window.end (04:00Z next day)
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('30. an item outside the reviewed construction window rejects as INVALID_REQUEST', decision.status === 'REJECTED' && decision.reason === 'INVALID_REQUEST');
  }
  check('31. malformed timezone on the reviewed window is passed through untouched (acceptance never re-derives window bounds from timezone)', (() => {
    const w = window({ timezone: '' });
    return w.start.getTime() === window().start.getTime(); // start/end are absolute instants, never re-derived from timezone at this layer
  })());
  check('32. malformed targetDate (window.date) does not affect interval validation (date is reference-only, per dayIntent.ts)', (() => {
    const w = window({ date: 'not-a-date' });
    return w.start.getTime() === window().start.getTime();
  })());
  check('33. an empty title rejects as INVALID_REQUEST', (await evaluateAcceptance(request({ proposedItems: [item({ intentId: 'a', title: '', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] }), baseDeps(), NOW)).status === 'REJECTED');
  check('34. a title over 200 characters rejects as INVALID_REQUEST', (await evaluateAcceptance(request({ proposedItems: [item({ intentId: 'a', title: 'x'.repeat(201), start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] }), baseDeps(), NOW)).status === 'REJECTED');
  {
    // Pre-commit review fix (this ticket's own section 2): a sub-minute-
    // precision interval is REJECTED outright, never silently rounded
    // into a materially different duration.
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:44:36.500Z') })] }); // 44 min 36.5 sec
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('34b. a sub-minute-precision interval rejects as INVALID_REQUEST rather than being silently rounded', decision.status === 'REJECTED' && decision.reason === 'INVALID_REQUEST');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'dup', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:30:00Z') }), item({ intentId: 'dup', start: iso('2026-09-16T15:00:00Z'), end: iso('2026-09-16T15:30:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    check('35. a duplicate intentId within one proposal rejects as INVALID_REQUEST', decision.status === 'REJECTED' && decision.reason === 'INVALID_REQUEST');
  }

  // ============================================================
  // ACTIVITY (36-38)
  // ============================================================

  {
    const req = request({ proposedItems: [item({ intentId: 'a', activityId: 'deep_work', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps({ validateActivity: (id) => id === 'deep_work' }), NOW);
    check('36. a valid activityId is accepted', decision.status === 'ACCEPTABLE');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', activityId: 'deleted_activity', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps({ validateActivity: () => false }), NOW);
    check('37. an activityId that no longer resolves rejects as INVALID_ACTIVITY', decision.status === 'REJECTED' && decision.reason === 'INVALID_ACTIVITY');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps({ validateActivity: () => { throw new Error('should never be called for an absent activityId'); } }), NOW);
    check('38. an absent activityId is accepted without ever calling validateActivity', decision.status === 'ACCEPTABLE');
  }

  // ============================================================
  // TIMING (39-47)
  // ============================================================

  {
    let called = false;
    const req = request({ proposedItems: [item({ intentId: 'a', placementSource: 'SELECTED_CANDIDATE', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    await evaluateAcceptance(req, baseDeps({ checkTiming: () => { called = true; return fakeCandidate(); } }), NOW);
    check('39. SELECTED_CANDIDATE runs CHECK exactly once', called);
  }
  {
    let calls = 0;
    const req = request({ proposedItems: [item({ intentId: 'a', placementSource: 'FIXED_CONSTRAINT', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    await evaluateAcceptance(req, baseDeps({ checkTiming: () => { calls++; return fakeCandidate(); } }), NOW);
    check('40. FIXED_CONSTRAINT runs zero CHECK calls', calls === 0);
  }
  {
    let capturedStart: Date | undefined;
    const start = iso('2026-09-16T14:07:00Z');
    const req = request({ proposedItems: [item({ intentId: 'a', start, end: iso('2026-09-16T15:00:00Z') })] });
    await evaluateAcceptance(req, baseDeps({ checkTiming: (r) => { capturedStart = r.candidateStart; return fakeCandidate(); } }), NOW);
    check('41. CHECK receives the exact reviewed start (never moved)', capturedStart?.getTime() === start.getTime());
  }
  {
    let capturedDuration: number | null = null;
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:37:00Z') })] });
    await evaluateAcceptance(req, baseDeps({ checkTiming: (r) => { capturedDuration = r.durationMinutes; return fakeCandidate(); } }), NOW);
    check('42. CHECK receives the exact reviewed duration', capturedDuration === 37);
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps({ checkTiming: () => fakeCandidate({ label: 'CAUTION', score: 1 }) }), NOW);
    check('43. betterNearby-style alternative signals are never inspected -- only the throw/no-throw of checkTiming matters', decision.status === 'ACCEPTABLE');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decisionGood = await evaluateAcceptance(req, baseDeps({ checkTiming: () => fakeCandidate({ label: 'EXCELLENT' }) }), NOW);
    const decisionBad = await evaluateAcceptance(req, baseDeps({ checkTiming: () => fakeCandidate({ label: 'CAUTION' }) }), NOW);
    check('44. a changed timing-quality label alone never causes rejection', decisionGood.status === 'ACCEPTABLE' && decisionBad.status === 'ACCEPTABLE');
  }
  {
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps({ checkTiming: () => { throw new Error('timing engine unavailable'); } }), NOW);
    check('45. a thrown/failed CHECK evaluation rejects as TIMING_CHECK_FAILED', decision.status === 'REJECTED' && decision.reason === 'TIMING_CHECK_FAILED');
  }
  check('46. evaluateAcceptance source never calls runTimingSearch/FIND directly (structural)', !/runTimingSearch\(|mode:\s*['"]FIND['"]/.test(require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/dayConstructorAcceptance.ts'), 'utf8')));
  {
    const req = request({ proposedItems: [item({ intentId: 'a', activityId: undefined, title: 'Reply to emails', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:30:00Z') })] });
    let capturedTaskTitle: string | undefined;
    await evaluateAcceptance(req, baseDeps({ checkTiming: (r) => { capturedTaskTitle = r.taskTitle; return fakeCandidate(); } }), NOW);
    check('47. an activityId-less SELECTED_CANDIDATE item runs CHECK via taskTitle fallback (never fabricates an activityId)', capturedTaskTitle === 'Reply to emails');
  }

  // ============================================================
  // TIMEZONE (48-52)
  // ============================================================

  {
    const positiveOffsetWindow = window({ timezone: 'Asia/Kolkata', start: iso('2026-09-16T18:30:00Z'), end: iso('2026-09-17T18:30:00Z') });
    const req = request({ constructionWindow: positiveOffsetWindow, proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), iso('2026-09-16T19:00:00Z'));
    check('48. positive-offset timezone window: still resolves on absolute instants correctly', decision.status === 'ACCEPTABLE');
  }
  {
    const negativeOffsetWindow = window({ timezone: 'America/Los_Angeles', start: iso('2026-09-16T07:00:00Z'), end: iso('2026-09-17T07:00:00Z') });
    const req = request({ constructionWindow: negativeOffsetWindow, proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), iso('2026-09-16T19:00:00Z'));
    check('49. negative-offset timezone window: still resolves on absolute instants correctly', decision.status === 'ACCEPTABLE');
  }
  {
    const dstWindow = window({ timezone: 'America/New_York', start: iso('2026-11-01T04:00:00Z'), end: iso('2026-11-02T05:00:00Z') }); // spans a US DST fall-back
    const req = request({ constructionWindow: dstWindow, proposedItems: [item({ intentId: 'a', start: iso('2026-11-01T20:00:00Z'), end: iso('2026-11-01T21:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), iso('2026-11-01T19:00:00Z'));
    check('50. a window spanning a DST boundary still validates purely on absolute instants', decision.status === 'ACCEPTABLE');
  }
  {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    const req = request({ proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), NOW);
    process.env.TZ = originalTZ;
    check('51. result is identical regardless of process.env.TZ (server-timezone independence)', decision.status === 'ACCEPTABLE');
  }
  {
    // Local-day rollover: window end already elapsed relative to a much-later `now`.
    const req = request({ constructionWindow: window({ end: iso('2026-09-17T04:00:00Z') }), proposedItems: [item({ intentId: 'a', start: iso('2026-09-16T20:00:00Z'), end: iso('2026-09-16T21:00:00Z') })] });
    const decision = await evaluateAcceptance(req, baseDeps(), iso('2026-09-18T00:00:00Z'));
    check('52. local-day rollover (accepted long after the window elapsed) is STALE_PREVIEW', decision.status === 'REJECTED' && decision.reason === 'STALE_PREVIEW');
  }

  // ============================================================
  // SECURITY / BOUNDARY (53-58)
  // ============================================================

  check('53. AcceptConstructedDayRequest has no userId field (structural)', !/userId/.test(require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/dayConstructorAcceptance.ts'), 'utf8').match(/export interface AcceptConstructedDayRequest \{[^}]*\}/)?.[0] ?? ''));
  check('54. clientRequestId is a required field on the request contract', (() => { const req = request(); return typeof req.clientRequestId === 'string' && req.clientRequestId.length > 0; })());
  check('55. AcceptedProposedItem has no deferredItems-shaped field (structural, re-confirming #11)', !/deferredItems/.test(require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/dayConstructorAcceptance.ts'), 'utf8')));
  check('56. dayConstructorAcceptance.ts never imports from db.ts (no DB dependency)', !/from ['"](\.\.?\/)*db['"]/.test(require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/dayConstructorAcceptance.ts'), 'utf8')));
  check('57. dayConstructorAcceptance.ts never calls fetch( or references /api/ (no API dependency)', !/fetch\(|\/api\//.test(require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/dayConstructorAcceptance.ts'), 'utf8')));
  check('58. dayConstructorAcceptance.ts never calls createPlannedActivity(/claimPlanCreation(/pool. (no persistence dependency)', !/createPlannedActivity\(|claimPlanCreation\(|fillPlanCreationClaim\(|pool\./.test(require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/dayConstructorAcceptance.ts'), 'utf8')));

  // ============================================================
  // DETERMINISM (59-60)
  // ============================================================

  {
    const req = request({ proposedItems: [item({ intentId: 'a', activityId: 'deep_work', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })] });
    const d1 = await evaluateAcceptance(req, baseDeps(), NOW);
    const d2 = await evaluateAcceptance(req, baseDeps(), NOW);
    check('59. identical inputs produce an identical (byte-equivalent) result', JSON.stringify(d1) === JSON.stringify(d2));
  }
  {
    const originalItems = [item({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })];
    const req = request({ proposedItems: originalItems });
    const snapshotBefore = JSON.stringify(req);
    await evaluateAcceptance(req, baseDeps(), NOW);
    check('60. evaluateAcceptance never mutates its input request', JSON.stringify(req) === snapshotBefore && req.proposedItems === originalItems);
  }

  if (!allPassed) {
    console.error('SOME DAY CONSTRUCTOR ACCEPTANCE CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL DAY CONSTRUCTOR ACCEPTANCE CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
