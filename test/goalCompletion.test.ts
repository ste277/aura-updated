/**
 * Goals V2 G2.1 -- pure domain regression suite for
 * apps/web/lib/goalCompletion.ts (CompletionRequirement validation,
 * normalization, persisted<->canonical round-trip). No DB access -- see
 * goalsDb.test.ts for live-Postgres coverage of the persistence paths that
 * consume this module.
 */
import {
  isCompletionKind,
  COMPLETION_KINDS,
  DONE_COMPLETION_REQUIREMENT,
  validateCompletionRequirement,
  toPersistedCompletionRequirement,
  normalizeGoalActivityCompletionRequirement,
} from '../apps/web/lib/goalCompletion';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Taxonomy -- exactly DONE/DURATION/MEASURED_TARGET, nothing else
// ============================================================
check('exactly three completion kinds', COMPLETION_KINDS.length === 3);
check('COMPLETION_KINDS is exactly DONE/DURATION/MEASURED_TARGET', JSON.stringify([...COMPLETION_KINDS].sort()) === JSON.stringify(['DONE', 'DURATION', 'MEASURED_TARGET']));
check('isCompletionKind accepts DONE', isCompletionKind('DONE'));
check('isCompletionKind accepts DURATION', isCompletionKind('DURATION'));
check('isCompletionKind accepts MEASURED_TARGET', isCompletionKind('MEASURED_TARGET'));
check('isCompletionKind rejects CHECKLIST (deferred, never a kind in G2.1)', !isCompletionKind('CHECKLIST'));
check('isCompletionKind rejects COUNT (collapsed into MEASURED_TARGET, not its own kind)', !isCompletionKind('COUNT'));
check('isCompletionKind rejects QUANTITY (collapsed into MEASURED_TARGET, not its own kind)', !isCompletionKind('QUANTITY'));
check('isCompletionKind rejects STEPS', !isCompletionKind('STEPS'));
check('isCompletionKind rejects BOOLEAN', !isCompletionKind('BOOLEAN'));
check('isCompletionKind rejects PERCENTAGE', !isCompletionKind('PERCENTAGE'));
check('isCompletionKind rejects non-string input', !isCompletionKind(42));
check('isCompletionKind rejects null', !isCompletionKind(null));

// ============================================================
// Section 15 -- valid states
// ============================================================
check('valid: DONE', validateCompletionRequirement({ kind: 'DONE' }).ok === true);
check('valid: DURATION 30', (() => { const r = validateCompletionRequirement({ kind: 'DURATION', targetValue: 30 }); return r.ok && r.requirement.targetValue === 30 && r.requirement.unit === undefined; })());
check('valid: DURATION 10', (() => { const r = validateCompletionRequirement({ kind: 'DURATION', targetValue: 10 }); return r.ok && r.requirement.targetValue === 10; })());
check('valid: MEASURED_TARGET 8 glasses', (() => { const r = validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 8, unit: 'glasses' }); return r.ok && r.requirement.targetValue === 8 && r.requirement.unit === 'glasses'; })());
check('valid: MEASURED_TARGET 20 pages', (() => { const r = validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }); return r.ok && r.requirement.targetValue === 20 && r.requirement.unit === 'pages'; })());
check('valid: MEASURED_TARGET 6000 steps', (() => { const r = validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 6000, unit: 'steps' }); return r.ok && r.requirement.targetValue === 6000 && r.requirement.unit === 'steps'; })());
check('valid: MEASURED_TARGET 5 km', (() => { const r = validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 5, unit: 'km' }); return r.ok && r.requirement.targetValue === 5 && r.requirement.unit === 'km'; })());
check('valid: MEASURED_TARGET 2.5 km -- fractional target preserved EXACTLY, not floored/rounded', (() => { const r = validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 2.5, unit: 'km' }); return r.ok && r.requirement.targetValue === 2.5; })());
check('valid: DURATION 12.5 -- fractional minutes also preserved exactly', (() => { const r = validateCompletionRequirement({ kind: 'DURATION', targetValue: 12.5 }); return r.ok && r.requirement.targetValue === 12.5; })());

// ============================================================
// Section 14 -- invalid states
// ============================================================
check('invalid: DONE + target', validateCompletionRequirement({ kind: 'DONE', targetValue: 5 }).ok === false);
check('invalid: DONE + unit', validateCompletionRequirement({ kind: 'DONE', unit: 'glasses' }).ok === false);
check('invalid: DURATION without target', validateCompletionRequirement({ kind: 'DURATION' }).ok === false);
check('invalid: DURATION target = 0', validateCompletionRequirement({ kind: 'DURATION', targetValue: 0 }).ok === false);
check('invalid: DURATION target < 0', validateCompletionRequirement({ kind: 'DURATION', targetValue: -5 }).ok === false);
check('invalid: DURATION target NaN', validateCompletionRequirement({ kind: 'DURATION', targetValue: NaN }).ok === false);
check('invalid: DURATION + unit', validateCompletionRequirement({ kind: 'DURATION', targetValue: 30, unit: 'minutes' }).ok === false);
check('invalid: MEASURED_TARGET without target', validateCompletionRequirement({ kind: 'MEASURED_TARGET', unit: 'glasses' }).ok === false);
check('invalid: MEASURED_TARGET target = 0', validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 0, unit: 'glasses' }).ok === false);
check('invalid: MEASURED_TARGET target < 0', validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: -8, unit: 'glasses' }).ok === false);
check('invalid: MEASURED_TARGET without unit', validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 8 }).ok === false);
check('invalid: MEASURED_TARGET blank unit (empty string)', validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 8, unit: '' }).ok === false);
check('invalid: MEASURED_TARGET whitespace-only unit', validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 8, unit: '   ' }).ok === false);
check('invalid: unknown kind', validateCompletionRequirement({ kind: 'CHECKLIST' }).ok === false);
check('invalid: missing kind', validateCompletionRequirement({ kind: undefined }).ok === false);

// ============================================================
// DONE_COMPLETION_REQUIREMENT / persisted round-trip
// ============================================================
check('DONE_COMPLETION_REQUIREMENT is the canonical singleton shape', DONE_COMPLETION_REQUIREMENT.kind === 'DONE' && DONE_COMPLETION_REQUIREMENT.targetValue === undefined && DONE_COMPLETION_REQUIREMENT.unit === undefined);

check('toPersistedCompletionRequirement(DONE) -> all-null (indistinguishable from legacy/unset)', (() => {
  const p = toPersistedCompletionRequirement({ kind: 'DONE' });
  return p.completionKind === null && p.completionTargetValue === null && p.completionUnit === null;
})());
check('toPersistedCompletionRequirement(DURATION) persists kind+target, null unit', (() => {
  const p = toPersistedCompletionRequirement({ kind: 'DURATION', targetValue: 30 });
  return p.completionKind === 'DURATION' && p.completionTargetValue === 30 && p.completionUnit === null;
})());
check('toPersistedCompletionRequirement(MEASURED_TARGET) persists all three', (() => {
  const p = toPersistedCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 8, unit: 'glasses' });
  return p.completionKind === 'MEASURED_TARGET' && p.completionTargetValue === 8 && p.completionUnit === 'glasses';
})());

// ============================================================
// Section 16 -- critical acceptance criterion: legacy normalization
// ============================================================
check(
  '16. legacy GoalActivity with no completion fields (completionKind null) -> canonical DONE',
  (() => {
    const r = normalizeGoalActivityCompletionRequirement({ completionKind: null, completionTargetValue: null, completionUnit: null });
    return r.kind === 'DONE' && r.targetValue === undefined && r.unit === undefined;
  })()
);
check(
  'legacy row with stray non-null target/unit but null kind still normalizes to DONE (kind is authoritative)',
  normalizeGoalActivityCompletionRequirement({ completionKind: null, completionTargetValue: 99, completionUnit: 'stray' }).kind === 'DONE'
);
check(
  'a persisted row that would fail validation (e.g. DURATION with a unit, defensive/should-never-happen) falls back to DONE rather than throwing',
  normalizeGoalActivityCompletionRequirement({ completionKind: 'DURATION', completionTargetValue: 30, completionUnit: 'minutes' }).kind === 'DONE'
);
check(
  'a persisted row with an unrecognized kind string falls back to DONE',
  normalizeGoalActivityCompletionRequirement({ completionKind: 'NOT_A_REAL_KIND', completionTargetValue: null, completionUnit: null }).kind === 'DONE'
);
check(
  'normalize round-trips a genuinely valid persisted DURATION row',
  (() => {
    const r = normalizeGoalActivityCompletionRequirement({ completionKind: 'DURATION', completionTargetValue: 30, completionUnit: null });
    return r.kind === 'DURATION' && r.targetValue === 30;
  })()
);
check(
  'normalize round-trips a genuinely valid persisted MEASURED_TARGET row, fractional value preserved',
  (() => {
    const r = normalizeGoalActivityCompletionRequirement({ completionKind: 'MEASURED_TARGET', completionTargetValue: 2.5, completionUnit: 'km' });
    return r.kind === 'MEASURED_TARGET' && r.targetValue === 2.5 && r.unit === 'km';
  })()
);

if (!allPassed) {
  console.error('SOME GOAL COMPLETION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL COMPLETION CHECKS PASSED');
