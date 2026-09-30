/**
 * Goals V2 G2.2.1 -- pure domain regression suite for
 * apps/web/lib/goalActivityExecution.ts (execution snapshot validation,
 * persisted<->canonical mapping). No DB access -- see
 * goalActivityExecutionDb.test.ts for live-Postgres persistence coverage.
 */
import {
  validateGoalActivityExecutionSnapshot,
  toPersistedGoalActivityExecutionSnapshot,
  fromPersistedGoalActivityExecutionSnapshot,
} from '../apps/web/lib/goalActivityExecution';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Section 19 -- domain validation
// ============================================================
check('DONE + null currentValue -> valid', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DONE' }, currentValue: null }).ok === true);
check('DONE + omitted currentValue -> valid', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DONE' } }).ok === true);
check('DONE + numeric currentValue -> invalid', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DONE' }, currentValue: 5 }).ok === false);
check('DONE + currentValue 0 -> invalid (DONE carries no numeric progress at all, not even zero)', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DONE' }, currentValue: 0 }).ok === false);

check(
  'DURATION + valid target + null currentValue -> valid',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: null });
    return r.ok === true && r.snapshot.currentValue === null;
  })()
);
check(
  'DURATION + valid target + positive currentValue -> valid',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: 18 });
    return r.ok === true && r.snapshot.currentValue === 18;
  })()
);
check(
  'DURATION + currentValue > target -> valid (actual may exceed target, never clamped)',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: 40 });
    return r.ok === true && r.snapshot.currentValue === 40;
  })()
);
check(
  'DURATION + fractional currentValue -> valid, preserved exactly (12.5 minutes)',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: 12.5 });
    return r.ok === true && r.snapshot.currentValue === 12.5;
  })()
);

check(
  'MEASURED_TARGET + valid target/unit + null currentValue -> valid',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, currentValue: null });
    return r.ok === true && r.snapshot.currentValue === null;
  })()
);
check(
  'MEASURED_TARGET + fractional currentValue -> valid (2.5 km)',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 5, unit: 'km' }, currentValue: 2.5 });
    return r.ok === true && r.snapshot.currentValue === 2.5;
  })()
);
check(
  'MEASURED_TARGET + currentValue > target -> valid (25/20 pages)',
  (() => {
    const r = validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, currentValue: 25 });
    return r.ok === true && r.snapshot.currentValue === 25;
  })()
);

check('currentValue = 0 -> valid for DURATION (0 is real, observed progress)', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: 0 }).ok === true);
check('currentValue = 0 -> valid for MEASURED_TARGET', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, currentValue: 0 }).ok === true);
check('currentValue < 0 -> invalid for DURATION', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: -5 }).ok === false);
check('currentValue < 0 -> invalid for MEASURED_TARGET', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, currentValue: -1 }).ok === false);
check('currentValue = NaN -> invalid', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: NaN }).ok === false);
check('currentValue = Infinity -> invalid', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: Infinity }).ok === false);

check('an invalid underlying CompletionRequirement (DONE + target) is still rejected -- G2.1 rules are not bypassed here', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DONE', targetValue: 5 }, currentValue: null }).ok === false);
check('an invalid underlying CompletionRequirement (MEASURED_TARGET without unit) is still rejected', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20 }, currentValue: null }).ok === false);
check('an unknown kind is rejected', validateGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'CHECKLIST' }, currentValue: null }).ok === false);

// ============================================================
// Persisted <-> canonical round-trip
// ============================================================
check(
  'toPersistedGoalActivityExecutionSnapshot(DONE) -> explicit "DONE" string, never null (unlike GoalActivity itself)',
  (() => {
    const p = toPersistedGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DONE' }, currentValue: null });
    return p.completionKindSnapshot === 'DONE' && p.completionTargetValueSnapshot === null && p.completionUnitSnapshot === null && p.currentValue === null;
  })()
);
check(
  'toPersistedGoalActivityExecutionSnapshot(DURATION) persists kind+target+currentValue, null unit',
  (() => {
    const p = toPersistedGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'DURATION', targetValue: 30 }, currentValue: 18 });
    return p.completionKindSnapshot === 'DURATION' && p.completionTargetValueSnapshot === 30 && p.completionUnitSnapshot === null && p.currentValue === 18;
  })()
);
check(
  'toPersistedGoalActivityExecutionSnapshot(MEASURED_TARGET) persists all fields',
  (() => {
    const p = toPersistedGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, currentValue: 12 });
    return p.completionKindSnapshot === 'MEASURED_TARGET' && p.completionTargetValueSnapshot === 20 && p.completionUnitSnapshot === 'pages' && p.currentValue === 12;
  })()
);

check(
  'fromPersistedGoalActivityExecutionSnapshot round-trips a valid DURATION row, fractional currentValue preserved',
  (() => {
    const s = fromPersistedGoalActivityExecutionSnapshot({ completionKindSnapshot: 'DURATION', completionTargetValueSnapshot: 30, completionUnitSnapshot: null, currentValue: 12.5 });
    return s.completionRequirement.kind === 'DURATION' && s.completionRequirement.targetValue === 30 && s.currentValue === 12.5;
  })()
);
check(
  'fromPersistedGoalActivityExecutionSnapshot round-trips a valid MEASURED_TARGET row',
  (() => {
    const s = fromPersistedGoalActivityExecutionSnapshot({ completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 20 });
    return s.completionRequirement.kind === 'MEASURED_TARGET' && s.completionRequirement.unit === 'pages' && s.currentValue === 20;
  })()
);
check(
  'fromPersistedGoalActivityExecutionSnapshot throws on a genuinely corrupt row (no legacy fallback, unlike GoalActivity normalization)',
  (() => {
    try {
      fromPersistedGoalActivityExecutionSnapshot({ completionKindSnapshot: 'DURATION', completionTargetValueSnapshot: 30, completionUnitSnapshot: 'minutes', currentValue: null });
      return false;
    } catch (e) {
      return e instanceof Error && /Corrupt GoalActivityExecution snapshot/.test(e.message);
    }
  })()
);

// ============================================================
// Section 20 -- historical target invariant (pure domain proof: snapshot
// values are self-contained and independent of a later CompletionRequirement)
// ============================================================
check(
  '20. a snapshot taken while the live requirement was "20 pages" is untouched by a LATER, different live requirement ("30 pages") -- the snapshot object itself never reads anything live',
  (() => {
    const septemberThirtySnapshot = toPersistedGoalActivityExecutionSnapshot({ completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, currentValue: 20 });
    // Simulate the GoalActivity's live definition changing afterward.
    const laterLiveRequirement = { kind: 'MEASURED_TARGET' as const, targetValue: 30, unit: 'pages' };
    // The already-taken snapshot is a plain value, structurally incapable of observing that
    // change -- re-reading it later still reports the ORIGINAL target, not the new one.
    const rehydrated = fromPersistedGoalActivityExecutionSnapshot(septemberThirtySnapshot);
    return rehydrated.completionRequirement.targetValue === 20 && rehydrated.currentValue === 20 && laterLiveRequirement.targetValue === 30;
  })()
);

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY EXECUTION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY EXECUTION CHECKS PASSED');
