/**
 * Goals V2 Candidate B3.1 -- pure tests for the Goal-create idempotency
 * helpers (apps/web/lib/goalCreateIdempotency.ts). No DB -- see
 * test/goalsCreateIdempotencyDb.test.ts for the live-database proof of
 * replay/concurrency/conflict behavior through the real route.
 */
import { deriveIdempotentGoalId, goalCreateRequestMatchesExisting } from '../apps/web/lib/goalCreateIdempotency';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// deriveIdempotentGoalId
// ============================================================
check('deterministic: the same (userId, clientRequestId) always derives the identical id', deriveIdempotentGoalId('user-1', 'req-1') === deriveIdempotentGoalId('user-1', 'req-1'));
check('user-salted: two different users supplying the IDENTICAL clientRequestId never collide', deriveIdempotentGoalId('user-1', 'req-1') !== deriveIdempotentGoalId('user-2', 'req-1'));
check('request-distinct: two different clientRequestIds for the SAME user never collide', deriveIdempotentGoalId('user-1', 'req-1') !== deriveIdempotentGoalId('user-1', 'req-2'));
check('non-empty, string result', typeof deriveIdempotentGoalId('user-1', 'req-1') === 'string' && deriveIdempotentGoalId('user-1', 'req-1').length > 0);

// ============================================================
// goalCreateRequestMatchesExisting -- matching cases
// ============================================================
{
  const base = { title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: 'workout' }] };
  const existing = { title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: 'workout', completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } }] };
  check('match: identical title/targetDate/activities (omitted completion/rhythm normalize to DONE/NONE, matching the persisted defaults)', goalCreateRequestMatchesExisting(base, existing));
}
{
  const base = { title: 'Get fitter', targetDate: '2026-12-01', activities: [] };
  const existing = { title: 'Get fitter', targetDate: '2026-12-01', activities: [] };
  check('match: identical with targetDate set and zero activities', goalCreateRequestMatchesExisting(base, existing));
}
{
  const base = {
    title: 'Meditate regularly',
    targetDate: null,
    activities: [{ title: 'Meditate 10 minutes', activityId: 'meditation', completionRequirement: { kind: 'DURATION' as const, targetValue: 10 }, rhythm: { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 } }],
  };
  const existing = {
    title: 'Meditate regularly',
    targetDate: null,
    activities: [{ title: 'Meditate 10 minutes', activityId: 'meditation', completionRequirement: { kind: 'DURATION' as const, targetValue: 10 }, rhythm: { kind: 'N_PER_WEEK' as const, targetPerWeek: 3 } }],
  };
  check('match: explicit DURATION completion + N_PER_WEEK rhythm compared correctly', goalCreateRequestMatchesExisting(base, existing));
}

// ============================================================
// goalCreateRequestMatchesExisting -- mismatch cases (fail closed)
// ============================================================
{
  const existing = { title: 'Get fitter', targetDate: null, activities: [] };
  check('mismatch: different title', !goalCreateRequestMatchesExisting({ title: 'Learn Spanish', targetDate: null, activities: [] }, existing));
}
{
  const existing = { title: 'Get fitter', targetDate: null, activities: [] };
  check('mismatch: different targetDate', !goalCreateRequestMatchesExisting({ title: 'Get fitter', targetDate: '2026-12-01', activities: [] }, existing));
}
{
  const existing = { title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: 'workout', completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } }] };
  check('mismatch: different activity count', !goalCreateRequestMatchesExisting({ title: 'Get fitter', targetDate: null, activities: [] }, existing));
}
{
  const existing = { title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: 'workout', completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } }] };
  check('mismatch: renamed activity title', !goalCreateRequestMatchesExisting({ title: 'Get fitter', targetDate: null, activities: [{ title: 'Morning cardio', activityId: 'workout' }] }, existing));
}
{
  const existing = { title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: 'workout', completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } }] };
  check('mismatch: different activityId', !goalCreateRequestMatchesExisting({ title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: 'task-7' }] }, existing));
}
{
  const existing = { title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: 'meditation', completionRequirement: { kind: 'DURATION' as const, targetValue: 10 }, rhythm: { kind: 'NONE' as const } }] };
  check(
    'mismatch: different completion target value',
    !goalCreateRequestMatchesExisting({ title: 'Meditate regularly', targetDate: null, activities: [{ title: 'Meditate 10 minutes', activityId: 'meditation', completionRequirement: { kind: 'DURATION', targetValue: 20 } }] }, existing)
  );
}
{
  const existing = { title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: null, completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } }] };
  check(
    'mismatch: different Rhythm (NONE vs N_PER_WEEK)',
    !goalCreateRequestMatchesExisting({ title: 'Get fitter', targetDate: null, activities: [{ title: 'Go for a run', activityId: null, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }] }, existing)
  );
}
{
  const existing = {
    title: 'Get fitter',
    targetDate: null,
    activities: [
      { title: 'A', activityId: null, completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } },
      { title: 'B', activityId: null, completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } },
    ],
  };
  check(
    'mismatch: reordered otherwise-identical activities (order-sensitive, fail closed)',
    !goalCreateRequestMatchesExisting({ title: 'Get fitter', targetDate: null, activities: [{ title: 'B', activityId: null }, { title: 'A', activityId: null }] }, existing)
  );
}
{
  // Release review B3.1 section 16 -- a completion UNIT mismatch, isolated
  // from targetValue (the existing pure tests only exercised a
  // targetValue mismatch; this is the comparator's own remaining
  // material field, directly covered now).
  const existing = { title: 'Drink water', targetDate: null, activities: [{ title: 'Drink water', activityId: null, completionRequirement: { kind: 'MEASURED_TARGET' as const, targetValue: 2, unit: 'litres' }, rhythm: { kind: 'NONE' as const } }] };
  check(
    'mismatch: same completion kind/targetValue, different unit',
    !goalCreateRequestMatchesExisting({ title: 'Drink water', targetDate: null, activities: [{ title: 'Drink water', activityId: null, completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 2, unit: 'glasses' } }] }, existing)
  );
}
{
  // Release review B3.1 section 19/32 -- duplicate-row multiplicity must
  // be preserved, never collapsed by a Set-based comparison (the
  // implementation uses a plain index-by-index array loop -- no Set
  // anywhere -- confirmed directly by both halves of this check).
  const dupRow = { title: 'A', activityId: null, completionRequirement: { kind: 'DONE' as const }, rhythm: { kind: 'NONE' as const } };
  const existingDup = { title: 'Dup goal', targetDate: null, activities: [dupRow, dupRow] }; // [A, A]
  const existingSingle = { title: 'Dup goal', targetDate: null, activities: [dupRow] }; // [A]
  check('duplicate multiplicity: [A, A] does NOT match [A] (fewer rows than submitted)', !goalCreateRequestMatchesExisting({ title: 'Dup goal', targetDate: null, activities: [{ title: 'A', activityId: null }] }, existingDup));
  check('duplicate multiplicity: [A] does NOT match [A, A] (more existing rows than submitted)', !goalCreateRequestMatchesExisting({ title: 'Dup goal', targetDate: null, activities: [{ title: 'A', activityId: null }, { title: 'A', activityId: null }] }, existingSingle));
  check('duplicate multiplicity: [A, A] genuinely MATCHES [A, A] (duplicates preserved as equal, not destroyed)', goalCreateRequestMatchesExisting({ title: 'Dup goal', targetDate: null, activities: [{ title: 'A', activityId: null }, { title: 'A', activityId: null }] }, existingDup));
}

if (!allPassed) {
  console.error('SOME GOAL CREATE IDEMPOTENCY CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL CREATE IDEMPOTENCY CHECKS PASSED');
