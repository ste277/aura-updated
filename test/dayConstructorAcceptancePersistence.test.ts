/**
 * Day Constructor V1 -- PR E2 persistence-layer PURE-LOGIC regression
 * suite. Exercises the DI-testable pieces (idempotency-key derivation,
 * replay/collision content comparison, the AcceptedPlanWrite -> Plan
 * mapping) with no DB, no network -- matching this repo's own
 * established convention. The actual atomic-transaction orchestration
 * (`persistAcceptedConstructedDay`) requires a real Postgres connection
 * and is instead covered by `test/dayConstructorAcceptancePersistenceDb.test.ts`
 * (same live-DB convention as `forwardPlannerOrchestrator.test.ts`).
 */
import { deriveAcceptanceIdempotencyKey, deriveAcceptancePrefix, keySetsAreEqual, plansMatchAcceptedItem, toCreatePlannedActivityInput } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1',
    userId: 'user-1',
    title: 'Investor deck',
    activityType: 'Investor deck',
    icon: null,
    activityId: 'deep_work',
    status: 'UPCOMING',
    plannedStartAt: iso('2026-09-16T14:00:00Z'),
    plannedEndAt: iso('2026-09-16T15:00:00Z'),
    durationMinutes: 60,
    windowType: 'NEUTRAL',
    windowLabel: null,
    matchLabel: null,
    score: null,
    recommendation: null,
    calendarUrl: null,
    loggedAt: null,
    habitLogId: null,
    eventTimezone: null,
    eventLocationName: null,
    createdAt: iso('2026-09-16T09:00:00Z'),
    updatedAt: iso('2026-09-16T09:00:00Z'),
    ...overrides,
  };
}

function item(overrides: Partial<AcceptedProposedItem> = {}): AcceptedProposedItem {
  return {
    intentId: 'a',
    activityId: 'deep_work',
    title: 'Investor deck',
    start: iso('2026-09-16T14:00:00Z'),
    end: iso('2026-09-16T15:00:00Z'),
    placementSource: 'SELECTED_CANDIDATE',
    ...overrides,
  };
}

// ============================================================
// Key derivation
// ============================================================

check('1. same (clientRequestId, intentId) pair derives the same key', deriveAcceptanceIdempotencyKey('abc', 'a') === deriveAcceptanceIdempotencyKey('abc', 'a'));
check('2. different intentId under the same clientRequestId derives a different key', deriveAcceptanceIdempotencyKey('abc', 'a') !== deriveAcceptanceIdempotencyKey('abc', 'b'));
check('3. different clientRequestId under the same intentId derives a different key', deriveAcceptanceIdempotencyKey('abc', 'a') !== deriveAcceptanceIdempotencyKey('xyz', 'a'));
check(
  '4. length-prefixing prevents a colon-boundary collision between two distinct (clientRequestId, intentId) pairs',
  deriveAcceptanceIdempotencyKey('a:b', 'c') !== deriveAcceptanceIdempotencyKey('a', 'b:c')
);
check('5. key derivation never throws for ordinary alphanumeric ids', (() => {
  deriveAcceptanceIdempotencyKey('req-123', 'intent-456');
  return true;
})());

// ============================================================
// Prefix sharing (pre-commit review fix) -- every per-item key for one
// acceptance starts with that acceptance's own shared prefix, which is
// what `findPlanCreationClaimsByPrefix` uses for complete-set discovery.
// ============================================================

check('5b. every derived key starts with its own clientRequestId\'s prefix', deriveAcceptanceIdempotencyKey('abc', 'a').startsWith(deriveAcceptancePrefix('abc')) && deriveAcceptanceIdempotencyKey('abc', 'b').startsWith(deriveAcceptancePrefix('abc')));
check('5c. a different clientRequestId never shares a prefix, even as a string prefix of another', deriveAcceptancePrefix('abc') !== deriveAcceptancePrefix('abcd') && !deriveAcceptanceIdempotencyKey('abcd', 'x').startsWith(deriveAcceptancePrefix('abc')));

// ============================================================
// Prefix/key safety for clientRequestId values containing characters
// that are significant to SQL LIKE (`%`, `_`) or otherwise unusual --
// section 6's own explicit requirement. `deriveAcceptancePrefix`/
// `deriveAcceptanceIdempotencyKey` never interpret these specially (they
// are plain string concatenation); the DB-side query
// (`findPlanCreationClaimsByPrefix`, db.ts) also never uses LIKE, only
// `left(...) = ...` exact equality, so these characters carry no special
// meaning there either (verified structurally below, and exercised
// end-to-end in the live-DB suite's own "special characters" case).
// ============================================================

check('5k. a clientRequestId containing a literal "%" derives a stable, self-consistent prefix', (() => {
  const id = 'req-%-50off';
  return deriveAcceptanceIdempotencyKey(id, 'a').startsWith(deriveAcceptancePrefix(id)) && deriveAcceptancePrefix(id) === deriveAcceptancePrefix(id);
})());
check('5l. a clientRequestId containing a literal "_" derives a stable, self-consistent prefix', (() => {
  const id = 'req_with_underscores';
  return deriveAcceptanceIdempotencyKey(id, 'a').startsWith(deriveAcceptancePrefix(id));
})());
check('5m. "%"/"_" in clientRequestId never causes two DIFFERENT ids to derive the same prefix (no accidental wildcard-style broadening)', deriveAcceptancePrefix('req-%') !== deriveAcceptancePrefix('req-X') && deriveAcceptancePrefix('req_1') !== deriveAcceptancePrefix('reqX1'));
check('5n. a clientRequestId containing Unicode derives a stable, self-consistent prefix', (() => {
  const id = 'req-日本語-emoji-🎉';
  return deriveAcceptanceIdempotencyKey(id, 'a').startsWith(deriveAcceptancePrefix(id));
})());
check('5o. a long clientRequestId (200 chars, the max) derives without truncation or error', (() => {
  const id = 'x'.repeat(200);
  return deriveAcceptancePrefix(id).includes(id) && deriveAcceptanceIdempotencyKey(id, 'a').endsWith(':a');
})());
check(
  "5p. structural: findPlanCreationClaimsByPrefix (db.ts) uses left(...)=... exact equality, never LIKE/ILIKE",
  (() => {
    const dbSource: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/db.ts'), 'utf8');
    const fnMatch = dbSource.match(/export async function findPlanCreationClaimsByPrefix[\s\S]*?\n}/);
    return !!fnMatch && /left\(/.test(fnMatch[0]) && !/\bLIKE\b|\bILIKE\b/i.test(fnMatch[0]);
  })()
);

// ============================================================
// Key-set equality (pre-commit review fix) -- the core fix for the
// strict-subset replay bug (original [A,B] vs retry [A] must NOT be
// treated as equal sets).
// ============================================================

check('5d. identical sets (same order) are equal', keySetsAreEqual(['a', 'b'], ['a', 'b']));
check('5e. identical sets (different order) are equal', keySetsAreEqual(['a', 'b'], ['b', 'a']));
check('5f. a strict subset is NOT equal to the full set (original [A,B], retry [A] -- case A/B)', !keySetsAreEqual(['a', 'b'], ['a']) && !keySetsAreEqual(['a', 'b'], ['b']));
check('5g. a strict superset is NOT equal to the original set (original [A], retry [A,B] -- case D)', !keySetsAreEqual(['a'], ['a', 'b']));
check('5h. a partial-overlap swap is NOT equal (original [A,B,C], retry [A,C] -- case C)', !keySetsAreEqual(['a', 'b', 'c'], ['a', 'c']));
check('5i. a disjoint set is NOT equal', !keySetsAreEqual(['a', 'b'], ['c', 'd']));
check('5j. empty vs empty is equal', keySetsAreEqual([], []));

// ============================================================
// Replay/collision content comparison
// ============================================================

check('6. identical title/start/end/activityId matches', plansMatchAcceptedItem(plan(), item()));
check('7. a different title does not match', !plansMatchAcceptedItem(plan({ title: 'Something else' }), item()));
check('8. a different start does not match', !plansMatchAcceptedItem(plan({ plannedStartAt: iso('2026-09-16T14:05:00Z') }), item()));
check('9. a different end does not match', !plansMatchAcceptedItem(plan({ plannedEndAt: iso('2026-09-16T15:05:00Z') }), item()));
check('10. a different activityId does not match', !plansMatchAcceptedItem(plan({ activityId: 'other_activity' }), item()));
check('11. both activityId absent (null vs undefined) still matches', plansMatchAcceptedItem(plan({ activityId: null }), item({ activityId: undefined })));
check('12. a persisted activityId when the item has none does not match', !plansMatchAcceptedItem(plan({ activityId: 'deep_work' }), item({ activityId: undefined })));
check('13. placementSource is never part of the comparison (FIXED_CONSTRAINT vs SELECTED_CANDIDATE with identical content still matches)', plansMatchAcceptedItem(plan(), item({ placementSource: 'FIXED_CONSTRAINT' })));

// ============================================================
// AcceptedPlanWrite -> CreatePlannedActivityInput mapping
// ============================================================

{
  const input = toCreatePlannedActivityInput('user-1', { activityId: 'deep_work', title: 'Investor deck', plannedStartAt: iso('2026-09-16T14:00:00Z'), plannedEndAt: iso('2026-09-16T15:00:00Z'), durationMinutes: 60 });
  check('14. mapping preserves userId', input.userId === 'user-1');
  check('15. mapping preserves title exactly', input.title === 'Investor deck');
  check('16. mapping preserves plannedStartAt exactly', input.plannedStartAt.getTime() === iso('2026-09-16T14:00:00Z').getTime());
  check('17. mapping preserves plannedEndAt exactly', input.plannedEndAt.getTime() === iso('2026-09-16T15:00:00Z').getTime());
  check('18. mapping preserves durationMinutes exactly (never recomputed)', input.durationMinutes === 60);
  check('19. mapping preserves activityId when present', input.activityId === 'deep_work');
  check('20. mapping defaults windowType to NEUTRAL (the same honest default POST /api/plans already uses)', input.windowType === 'NEUTRAL');
  check('21. mapping never fabricates score/matchLabel/recommendation/calendarUrl', input.score === undefined && input.matchLabel === undefined && input.recommendation === undefined && input.calendarUrl === undefined);
}
{
  const input = toCreatePlannedActivityInput('user-1', { title: 'Reply to emails', plannedStartAt: iso('2026-09-16T14:00:00Z'), plannedEndAt: iso('2026-09-16T14:30:00Z'), durationMinutes: 30 });
  check('22. mapping persists null activityId when absent (never fabricated)', input.activityId === null);
}

// ============================================================
// Structural checks (this ticket's own section 43/44/46) -- read the
// actual committed source, mirroring dayConstructorOrchestrator.test.ts's
// own tests 55-59 convention.
// ============================================================

const fs = require('fs');
const path = require('path');
const persistenceSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/dayConstructorAcceptancePersistence.ts'), 'utf8');
const routeSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/app/api/day-constructor/accept/route.ts'), 'utf8');

check('23. persistence layer calls evaluateAcceptance (PR E1) rather than re-implementing acceptance rules', /evaluateAcceptance\(/.test(persistenceSource));
check('24. persistence layer never calls constructDay( (no reconstruction)', !/constructDay\(/.test(persistenceSource));
check('25. persistence layer never calls runTimingSearch with mode: FIND', !/mode:\s*['"]FIND['"]/.test(persistenceSource));
check('26. route.ts never contains business logic beyond parse/auth/delegate (no direct SQL, no pool/client reference)', !/\bpool\.|\bclient\.|CREATE TABLE|INSERT INTO|SELECT .* FROM/.test(routeSource));
check('27. route.ts derives the authenticated user exclusively from getSessionFromRequest (no userId read from the request body)', /getSessionFromRequest\(/.test(routeSource) && !/body\.userId|body\?\.userId/.test(routeSource));
check('28. route.ts reads the authoritative clock exactly once (new Date() appears exactly once)', (routeSource.match(/new Date\(\)/g) ?? []).length === 1);

if (!allPassed) {
  console.error('SOME DAY CONSTRUCTOR ACCEPTANCE PERSISTENCE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DAY CONSTRUCTOR ACCEPTANCE PERSISTENCE CHECKS PASSED');
