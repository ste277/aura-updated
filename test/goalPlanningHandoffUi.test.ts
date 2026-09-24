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
  // ============================================================
  check('A/4. the checkbox is gated on derivedState === \'SUGGESTED\'', /isSelectable = activity\.derivedState === 'SUGGESTED'/.test(source));
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
  // SUGGESTED set on every render, never trusting a stale selectedIds
  // value directly.
  // ============================================================
  check(
    'effectiveSelectedIds is derived by intersecting selectedIds with the CURRENT suggestedIds set (never used raw)',
    /effectiveSelectedIds = Array\.from\(selectedIds\)\.filter\(\(id\) => suggestedIds\.has\(id\)\)/.test(source)
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
  // ============================================================
  check('47. "What would you like Aura to help you plan?" appears, gated on suggestedIds.size > 0', /suggestedIds\.size > 0 && <p[\s\S]{0,120}What would you like Aura to help you plan\?/.test(source));

  if (!allPassed) {
    console.error('SOME GOAL PLANNING HANDOFF UI CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL PLANNING HANDOFF UI CHECKS PASSED');
}

main();
