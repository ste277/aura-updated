/**
 * Goals -> Planning Integration V1 PR C -- structural regression suite
 * for the Goal Detail selection UX and "Plan with Aura" handoff CTA
 * (this ticket's own section 3/4/5/6). Same source-reading convention as
 * goalsUiWiring.test.ts -- this repository has no component-rendering
 * harness.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function main() {
  const source = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));

  // ============================================================
  // A/B/C/4 -- a checkbox renders ONLY for SUGGESTED; PLANNED/COMPLETED
  // never get one (isSelectable's own guard).
  //
  // Goals V2 Rhythm R3 (a later, separately-authorized ticket) legitimately
  // widened this gate: a COMPLETED activity is now ALSO selectable, but
  // ONLY when it is independently proven Rhythm-eligible for another
  // occurrence, re-derived server-side every time -- see
  // goalActivityRhythmMaterializationStructuralGuards.test.ts. SUGGESTED
  // remains unconditionally selectable on its own, and no other COMPLETED
  // path (without that explicit Rhythm proof) is granted a checkbox --
  // narrowed to that exact invariant rather than the original "ONLY
  // SUGGESTED, full stop".
  //
  // Rhythm R4 (a still-further, separately-authorized ticket) then replaced
  // R3's own interim rhythmEligibleForAnotherOccurrence flat flag with the
  // canonical `rhythm` view shape (`rhythm.kind === 'N_PER_WEEK' &&
  // rhythm.eligibleForAnotherOccurrence`) -- the exact same fact, read
  // through the one canonical shape instead of a dedicated boolean field.
  // ============================================================
  check(
    // Multi-Occurrence Rhythm PR 2 corrective patch -- PLANNED is now
    // ALSO gated the same way COMPLETED always was (strictly on
    // rhythm.eligibleForAnotherOccurrence for an N_PER_WEEK activity),
    // so the manual Goal Detail flow agrees with the automatic Plan My
    // Day path when a PLANNED activity still has real remaining weekly
    // capacity. A finite (NONE) PLANNED/COMPLETED activity is still
    // never selectable (rhythm.kind === 'N_PER_WEEK' still required).
    'A/4. the checkbox is gated on derivedState === \'SUGGESTED\' (unconditionally), OR COMPLETED/PLANNED gated strictly on rhythm.eligibleForAnotherOccurrence for an N_PER_WEEK activity (R4, extended by Multi-Occurrence Rhythm PR 2)',
    /isSelectable = \(a: GoalActivityView\) => a\.derivedState === 'SUGGESTED' \|\| \(\(a\.derivedState === 'COMPLETED' \|\| a\.derivedState === 'PLANNED'\) && a\.rhythm\.kind === 'N_PER_WEEK' && a\.rhythm\.eligibleForAnotherOccurrence\)/.test(source)
  );
  check('B/C. PLANNED/COMPLETED never render a checkbox -- isSelectable is false for every state except SUGGESTED (single boolean gate, no PLANNED/COMPLETED branch grants it)', !/isSelectable[\s\S]{0,80}'PLANNED'/.test(source) && !/isSelectable[\s\S]{0,80}'COMPLETED'/.test(source));
  check('4. the checkbox itself is conditionally rendered only when isSelectable', /\{isSelectable && \(/.test(source));

  // ============================================================
  // 4 -- selection is pure local state: never a fetch call inside
  // toggleSelected, never a GoalActivity mutation.
  // ============================================================
  const toggleMatch = source.match(/const toggleSelected = \(id: string\) => \{[\s\S]*?\n  \};/);
  check('4. toggleSelected exists and contains no fetch() call (selection never mutates GoalActivity)', toggleMatch !== null && !toggleMatch[0].includes('fetch('));
  check('4. selecting never calls Day Constructor/creates a PlannedActivity (no dayConstructor/acceptConstructedDay reference anywhere in this file)', !/dayConstructor|acceptConstructedDay|createPlannedActivity/i.test(source));

  // ============================================================
  // D -- DISMISSED remains excluded from the primary list entirely
  // (already established by PR B; re-confirmed here since selection
  // logic now also depends on this filtering being correct).
  // ============================================================
  check('D. DISMISSED activities are filtered out before rendering (derivedState !== \'DISMISSED\')', /primaryActivities = activities\.filter\(\(a\) => a\.derivedState !== 'DISMISSED'\)/.test(source));

  // ============================================================
  // E/F/5 -- the CTA renders only when at least one eligible activity is
  // selected, and is absent (not merely disabled) at zero selection.
  // ============================================================
  check('E. the "Plan with Aura" CTA is conditionally rendered only when effectiveSelectedIds.length > 0 (absent, not disabled, at zero selection)', /\{effectiveSelectedIds\.length > 0 && \(/.test(source));
  check('F/5. the CTA copy is "Plan with Aura" (existing product vocabulary)', /Plan with Aura/.test(source));
  check('5. the CTA never says "Schedule automatically" or other pipeline language', !/Schedule automatically|Send GoalActivities|Push to Constructor/i.test(source));

  // ============================================================
  // Stale-selection defense (client-side first line of defense; server-
  // side bootstrap re-resolution is the REAL enforcement, this ticket's
  // own section 8) -- effectiveSelectedIds intersects the current
  // selectable set on every render, never trusting a stale selectedIds
  // value directly.
  //
  // Rhythm R3 renamed the underlying set from suggestedIds to
  // selectableIds (built via the widened isSelectable gate checked above)
  // -- the real invariant this check protects, that effectiveSelectedIds
  // is ALWAYS a fresh intersection against the current eligible set rather
  // than raw selectedIds, is unchanged.
  // ============================================================
  check(
    'effectiveSelectedIds is derived by intersecting selectedIds with the CURRENT selectableIds set (never used raw)',
    /effectiveSelectedIds = Array\.from\(selectedIds\)\.filter\(\(id\) => selectableIds\.has\(id\)\)/.test(source)
  );
  check('the CTA/handler use effectiveSelectedIds, never the raw selectedIds Set directly', !/window\.location\.href = `\/plan-day\?\$\{new URLSearchParams\(\{ fromGoal: goal\.id, activities: Array\.from\(selectedIds\)/.test(source));

  // ============================================================
  // G/6 -- the handoff URL carries ONLY ids (goal.id + selected
  // GoalActivity ids), never a title or activityId.
  // ============================================================
  const handlerMatch = source.match(/const handlePlanWithAura = \(\) => \{[\s\S]*?\n  \};/);
  check('G. handlePlanWithAura exists', handlerMatch !== null);
  check('G. the URL is built via URLSearchParams({ fromGoal: goal.id, activities: ... })', handlerMatch !== null && /new URLSearchParams\(\{ fromGoal: goal\.id, activities: effectiveSelectedIds\.join\(','\) \}\)/.test(handlerMatch[0]));
  check('G. no activity title is ever interpolated into the handoff URL', handlerMatch !== null && !/activity\.title/.test(handlerMatch[0]) && !/\.title/.test(handlerMatch[0]));
  check('G. no activityId is ever interpolated into the handoff URL', handlerMatch !== null && !handlerMatch[0].includes('activityId'));
  check('the handoff navigates to /plan-day (not a Goal-specific route)', handlerMatch !== null && handlerMatch[0].includes("`/plan-day?"));

  // ============================================================
  // 47 -- product copy check: the question framing exists, using the
  // ticket's own preferred phrasing, and does not appear unconditionally
  // (only when there's something to select).
  //
  // Rhythm R3 renamed the gating set from suggestedIds to selectableIds
  // (see above) -- the invariant itself (the prompt only appears when at
  // least one activity is actually selectable) is unchanged.
  // ============================================================
  check('47. "What would you like Aura to help you plan?" appears, gated on selectableIds.size > 0', /selectableIds\.size > 0 && <p[\s\S]{0,120}What would you like Aura to help you plan\?/.test(source));

  if (!allPassed) {
    console.error('SOME GOAL PLANNING HANDOFF UI CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL PLANNING HANDOFF UI CHECKS PASSED');
}

main();
