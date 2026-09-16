/**
 * Day Constructor V1 -- PR E3 acceptance-client regression suite.
 * Exercises `buildAcceptRequestBody`/`parseAcceptResponseBody` (pure,
 * DI-testable) directly -- the actual `fetch` call inside
 * `acceptConstructedDay` itself is thin, untested glue, matching this
 * repo's own established convention (no route.ts file anywhere has its
 * own test, confirmed during PR E2's own audit) of keeping the untested
 * surface as small as possible around a fully-tested pure core.
 */
import { buildAcceptRequestBody, parseAcceptResponseBody } from '../apps/web/lib/acceptConstructedDay';
import type { ConstructDayPreview, ResolvedIntentSummary } from '../apps/web/lib/dayConstructorOrchestrator';
import type { ProposedItem, DeferredItem, ConstructedDay } from '../apps/web/lib/dayConstructor';
import type { CapacityState, CapacitySnapshot } from '../apps/web/lib/dayCapacity';
import type { DayIntent } from '../apps/web/lib/dayIntent';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

// ============================================================
// Fixture builders -- same convention as dayPlanPreviewPresentation.test.ts.
// ============================================================

function snapshot(capacityState: CapacityState): CapacitySnapshot {
  return { constructionWindowMinutes: 480, blockedMinutes: 0, usableMinutes: 480, requestedMinutes: 120, remainingMinutes: 360, utilization: 0.25, capacityState };
}

function dayIntent(overrides: Partial<DayIntent> & { id: string; title: string }): DayIntent {
  return { targetDate: '2026-09-16', importance: 'MEDIUM', flexibility: 'FLEXIBLE', source: 'USER_TYPED', originalOrder: 0, ...overrides };
}

function resolvedIntent(id: string, title: string): ResolvedIntentSummary {
  return { requestedIntentId: id, dayIntent: dayIntent({ id, title }) };
}

function proposedItem(overrides: Partial<ProposedItem> & { intentId: string; title: string; start: Date; end: Date }): ProposedItem {
  return { placementSource: 'SELECTED_CANDIDATE', requiresConfirmation: true, ...overrides };
}

function constructedDay(overrides: Partial<ConstructedDay> = {}): ConstructedDay {
  return { date: '2026-09-16', proposedItems: [], deferredItems: [], conflicts: [], requestedCapacity: snapshot('OPEN'), proposedCapacity: snapshot('OPEN'), ...overrides };
}

function preview(overrides: Partial<ConstructDayPreview> = {}): ConstructDayPreview {
  return {
    targetDate: '2026-09-16',
    timezone: 'America/New_York',
    constructionWindow: { date: '2026-09-16', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-17T04:00:00Z'), timezone: 'America/New_York', source: 'EXPLICIT_RANGE' },
    resolvedIntents: [],
    constructedDay: constructedDay(),
    warnings: [],
    ...overrides,
  };
}

// ============================================================
// Request payload (this ticket's own section 5/6/33) -- exactly the E2
// contract, nothing else.
// ============================================================

const item1 = proposedItem({ intentId: 'a', activityId: 'deep_work', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', timingFit: 'BEST', candidateOrder: 0 });
const item2 = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T17:00:00Z'), placementSource: 'FIXED_CONSTRAINT' });
const testPreview = preview({
  resolvedIntents: [resolvedIntent('a', 'Investor deck'), resolvedIntent('b', 'Workout')],
  constructedDay: constructedDay({ proposedItems: [item1, item2], deferredItems: [{ intentId: 'z', primaryReason: 'NO_CANDIDATES', diagnostics: [] } as DeferredItem] }),
});

const body = buildAcceptRequestBody(testPreview, 'client-req-1');

check('1. request carries the supplied clientRequestId verbatim', body.clientRequestId === 'client-req-1');
check('2. request carries the exact reviewed constructionWindow (same object reference, never reconstructed)', body.constructionWindow === testPreview.constructionWindow);
check('3. request carries exactly the reviewed proposedItems, none more none fewer', body.proposedItems.length === 2);
check('4. proposed item fields are preserved exactly: intentId', body.proposedItems[0].intentId === 'a');
check('5. proposed item fields are preserved exactly: activityId', body.proposedItems[0].activityId === 'deep_work');
check('6. proposed item fields are preserved exactly: title', body.proposedItems[0].title === 'Investor deck');
check('7. proposed item fields are preserved exactly: start', body.proposedItems[0].start.getTime() === item1.start.getTime());
check('8. proposed item fields are preserved exactly: end', body.proposedItems[0].end.getTime() === item1.end.getTime());
check('9. proposed item fields are preserved exactly: placementSource', body.proposedItems[0].placementSource === 'SELECTED_CANDIDATE');
check('10. absent activityId is never fabricated', body.proposedItems[1].activityId === undefined);
check('11. presentation-only fields (timingFit/candidateOrder/requiresConfirmation) are never sent', !('timingFit' in body.proposedItems[0]) && !('candidateOrder' in body.proposedItems[0]) && !('requiresConfirmation' in body.proposedItems[0]));
check('12. deferred items never appear in the request payload', JSON.stringify(body).includes('NO_CANDIDATES') === false && !('deferredItems' in body));
check('13. warnings never appear in the request payload', !('warnings' in body));
check('14. capacity state never appears in the request payload', !JSON.stringify(body).includes('OPEN') && !('requestedCapacity' in body) && !('proposedCapacity' in body));
check('15. no userId field exists anywhere in the request shape', !('userId' in body));
check('16. no now/authoritative-clock field exists anywhere in the request shape', !('now' in body));
check('17. request has exactly the three top-level E2 fields', Object.keys(body).sort().join(',') === 'clientRequestId,constructionWindow,proposedItems');
check('18. request payload is JSON-serializable and round-trips the same shape', (() => {
  const json = JSON.parse(JSON.stringify(body));
  return json.clientRequestId === 'client-req-1' && json.proposedItems.length === 2 && new Date(json.proposedItems[0].start).getTime() === item1.start.getTime();
})());

// ============================================================
// Response parsing (this ticket's own section 10/35)
// ============================================================

check('19. SAVED parses with its plans array', (() => {
  const r = parseAcceptResponseBody({ status: 'SAVED', plans: [{ id: 'p1', title: 'x', plannedStartAt: 'a', plannedEndAt: 'b' }] });
  return r.status === 'SAVED' && r.plans.length === 1 && r.plans[0].id === 'p1';
})());
check('20. ALREADY_ACCEPTED parses with its plans array', (() => {
  const r = parseAcceptResponseBody({ status: 'ALREADY_ACCEPTED', plans: [] });
  return r.status === 'ALREADY_ACCEPTED' && r.plans.length === 0;
})());
check('21. REJECTED parses with a known reason and diagnostics', (() => {
  const r = parseAcceptResponseBody({ status: 'REJECTED', reason: 'STALE_PREVIEW', diagnostics: [{ intentId: 'a', reason: 'STALE_PREVIEW', detail: 'x' }] });
  return r.status === 'REJECTED' && r.reason === 'STALE_PREVIEW' && r.diagnostics.length === 1;
})());
check('22. REJECTED with an unrecognized reason falls back to UNKNOWN_RESPONSE rather than fabricating a reason', parseAcceptResponseBody({ status: 'REJECTED', reason: 'SOMETHING_NEW' }).status === 'UNKNOWN_RESPONSE');
check('23. IDEMPOTENCY_CONFLICT parses with no extra data required', parseAcceptResponseBody({ status: 'IDEMPOTENCY_CONFLICT' }).status === 'IDEMPOTENCY_CONFLICT');
check('24. SAVE_FAILED parses cleanly', parseAcceptResponseBody({ status: 'SAVE_FAILED' }).status === 'SAVE_FAILED');
check('25. an unrecognized status string is UNKNOWN_RESPONSE', parseAcceptResponseBody({ status: 'SOMETHING_ELSE' }).status === 'UNKNOWN_RESPONSE');
check('26. a non-object body is UNKNOWN_RESPONSE', parseAcceptResponseBody('not an object').status === 'UNKNOWN_RESPONSE');
check('27. null body is UNKNOWN_RESPONSE', parseAcceptResponseBody(null).status === 'UNKNOWN_RESPONSE');
check('28. a body missing status entirely is UNKNOWN_RESPONSE', parseAcceptResponseBody({ plans: [] }).status === 'UNKNOWN_RESPONSE');
check('29. SAVED with a malformed (non-array) plans field defaults to an empty array rather than throwing', parseAcceptResponseBody({ status: 'SAVED', plans: 'oops' }).status === 'SAVED');

// ============================================================
// Structural checks (this ticket's own section 28/36) -- no direct
// persistence path from this client helper.
// ============================================================

const fs = require('fs');
const path = require('path');
const clientSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/acceptConstructedDay.ts'), 'utf8');

check("30. the client helper posts to POST /api/day-constructor/accept, never /api/plans", /\/api\/day-constructor\/accept/.test(clientSource) && !/\/api\/plans/.test(clientSource));
check('31. the client helper never imports createPlannedActivity/db.ts (no direct persistence path)', !/createPlannedActivity|from ['"]\.\.?\/db['"]/.test(clientSource));
check('32. the client helper never calls runTimingSearch/constructDay (no reconstruction)', !/runTimingSearch\(|constructDay\(/.test(clientSource));
check("33. the fetch call uses method: 'POST' explicitly", /method:\s*'POST'/.test(clientSource));

if (!allPassed) {
  console.error('SOME ACCEPT CONSTRUCTED DAY CLIENT CHECKS FAILED');
  process.exit(1);
}
console.log('ALL ACCEPT CONSTRUCTED DAY CLIENT CHECKS PASSED');
