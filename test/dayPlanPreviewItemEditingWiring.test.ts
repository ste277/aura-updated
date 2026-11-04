/**
 * Plan My Day -- single-item time editing WIRING regression suite.
 *
 * The pure logic (`dayConstructorPreviewItemClient.ts`/
 * `dayPlanPreviewItemEditing.ts`) is covered by its own suites
 * (dayConstructorPreviewItemClient.test.ts, dayPlanPreviewItemEditing.test.ts).
 * What those can't catch is INTEGRATION: does the modal actually reuse
 * the existing `ModalShell`/`useModalA11y` primitives instead of a new
 * one-off implementation, does the controller actually gate editing on
 * SAVING/SAVED, does it ever reach the acceptance endpoint for an edit,
 * does `PlanDayClient.tsx` actually wire the new prop through. This suite
 * reads each file's source as plain text and checks those structural
 * facts directly -- same convention as `homeMove.test.ts`'s own
 * structural checks against `HomeDashboard.tsx`/`HomeTimeline.tsx` --
 * rather than importing/rendering real React components (which would
 * need `TS_NODE_COMPILER_OPTIONS: '{"jsx":"react"}'` plus a DOM, for
 * checks that don't actually need a render to answer).
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function main() {
  const modal = strip(read('../apps/web/components/EditProposedItemTimeModal.tsx'));
  const controller = strip(read('../apps/web/components/DayPlanPreviewController.tsx'));
  const preview = strip(read('../apps/web/components/DayPlanPreview.tsx'));
  const planDayClient = strip(read('../apps/web/app/plan-day/PlanDayClient.tsx'));

  // ============================================================
  // EditProposedItemTimeModal.tsx (1-8)
  // ============================================================
  check('1. the modal reuses the existing ModalShell primitive, never a new overlay implementation', /\bModalShell\b/.test(modal) && !/position:\s*['"]fixed['"]/.test(modal));
  check('2. the modal reuses the existing useModalA11y primitive, never a new Escape/focus-trap implementation', /\buseModalA11y\b/.test(modal));
  check('3. the modal calls the ONE preview-item network function, updatePreviewItemTime', /\bupdatePreviewItemTime\s*\(/.test(modal));
  check('4. the modal never imports or calls the acceptance network function (acceptConstructedDay)', !/\bacceptConstructedDay\b/.test(modal));
  check('5. the modal never references the acceptance endpoint path', !modal.includes('/api/day-constructor/accept'));
  check('6. the modal never references a database/persistence module', !/\bfrom\s+['"][^'"]*\/db['"]/.test(modal) && !/\bprisma\b/i.test(modal));
  check('7. the modal has a double-submit guard before its one network call (checks `saving` before calling updatePreviewItemTime)', /if\s*\([^)]*saving[^)]*\)\s*return/.test(modal));
  check('8. the modal reuses the existing local-wall-time -> UTC converter (localDateTimeToUTC), not a hand-rolled one', /\blocalDateTimeToUTC\s*\(/.test(modal));

  // ============================================================
  // DayPlanPreviewController.tsx (9-16)
  // ============================================================
  check('9. the controller renders the edit modal', /<EditProposedItemTimeModal\b/.test(controller));
  check('10. editing is gated OFF while a save is in flight (SAVING)', /actionState\.kind\s*!==\s*['"]SAVING['"]/.test(controller));
  check('11. editing is gated OFF once the day is already saved (SAVED)', /actionState\.kind\s*!==\s*['"]SAVED['"]/.test(controller));
  check('12. the edit affordance is also gated on the parent actually supplying onPreviewReplaced', /onPreviewReplaced\s*&&/.test(controller) || /editingAllowed\s*=\s*onPreviewReplaced/.test(controller));
  check('13. a successful edit applies the update via the one pure preview-state function, applyUpdatedProposedItem', /applyUpdatedProposedItem\s*\(/.test(controller));
  check('14. the controller never computes a replacement preview itself (no manual proposedItems.map/splice near the modal wiring)', !/proposedItems\.splice/.test(controller));
  // P0 fix (PR #281 async race) -- `editingItem` became `editing` (now a
  // {item, generation} pair, see check 23 below), so the modal-close call
  // is `setEditing(null)`, not the old `setEditingItem(null)`. Same
  // invariant: a successful edit always closes the modal.
  check('15. a successful edit closes the modal (editing reset to null)', /setEditing\(null\)/.test(controller));
  check('16. the controller still owns exactly one DayPlanPreview render (the edit UI is a sibling, not a second preview surface)', (controller.match(/<DayPlanPreview\b/g) ?? []).length === 1);

  // ============================================================
  // DayPlanPreview.tsx (17-20)
  // ============================================================
  check('17. ProposedItemRow accepts an optional onEditItem prop (additive, not required)', /onEditItem\?:/.test(preview));
  check('18. the clickable time only renders when onEditItem is actually supplied (an if/ternary on onEditItem around the button)', /onEditItem\s*\?\s*\(/.test(preview));
  check('19. omitting onEditItem still renders a plain, non-interactive time (no behavior change for any caller that does not pass it)', /\)\s*:\s*\(\s*<div[^>]*>\{formatItemClockTime/.test(preview));
  check('20. the clickable time has an accessible label describing the action', /aria-label=\{`Change the time for/.test(preview));

  // ============================================================
  // PlanDayClient.tsx wiring (21-22)
  // ============================================================
  // P0 fix (PR #281 async race) -- `setPreview` is no longer passed
  // directly; `replacePreview` (which bumps `previewGenerationRef` before
  // calling the real `setPreview`, see check 23/24 below) is the ONLY
  // sanctioned way `preview` is ever replaced, so every replacement stays
  // paired with the generation bump that invalidates stale async
  // responses against it.
  check('21. PlanDayClient passes onPreviewReplaced to the controller', /<DayPlanPreviewController[\s\S]*?onPreviewReplaced=\{replacePreview\}/.test(planDayClient));
  check('22. PlanDayClient still owns `preview` via its own useState (single source of truth unchanged by this ticket)', /const\s*\[preview,\s*setPreview\]\s*=\s*useState/.test(planDayClient));

  // ============================================================
  // P0 fix (PR #281 -- Preview Lifecycle and Async Race) (23-28)
  // ============================================================
  check('23. PlanDayClient never calls the raw setPreview setter directly -- every replacement goes through replacePreview so the generation bump can never be skipped', (planDayClient.match(/\bsetPreview\(/g) ?? []).length === 1 && /function replacePreview\(/.test(planDayClient));
  check('24. replacePreview bumps previewGenerationRef before calling setPreview', /function replacePreview\([^)]*\)\s*\{[\s\S]{0,400}?previewGenerationRef\.current\s*\+=\s*1;[\s\S]{0,400}?setPreview\(/.test(planDayClient));
  check('25. PlanDayClient passes previewGenerationRef to the controller', /<DayPlanPreviewController[\s\S]*?previewGenerationRef=\{previewGenerationRef\}/.test(planDayClient));
  check('26. the controller captures the LIVE generation (not a stale snapshot) at apply-time before replacing the preview', /previewGenerationRef\.current\s*!==\s*editing\.generation/.test(controller));
  check('27. the Escape-key handler respects the same `saving` guard as every other dismissal path (localized fix, not inside the shared useModalA11y/ModalShell primitives)', /useModalA11y\(\{\s*isOpen:\s*true,\s*onClose:\s*saving\s*\?\s*NOOP\s*:\s*onClose/.test(modal));
  check('28. replacePreview is guarded by a mount-tracking ref (a stale response after real unmount can never call setPreview)', /function replacePreview\([^)]*\)\s*\{[\s\S]{0,200}?mountedRef\.current/.test(planDayClient));

  if (!allPassed) {
    console.error('\nSome Day Plan Preview Item Editing WIRING checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY PLAN PREVIEW ITEM EDITING WIRING CHECKS PASSED');
  }
}

main();
