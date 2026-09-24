/**
 * AURA HOME IA V2 FOLLOW-UP FIXES -- Finding D + Finding E presentation
 * coverage for HomeDashboard.tsx's own Right Now spotlight.
 *
 * selectRightNowState()'s own pure selection logic (the four-state
 * ACTIVE_PLAN/IMMINENT_PLAN/OPPORTUNITY/CONTEXT_OPEN contract) is covered
 * directly in test/rightNowSelection.test.ts. This file covers the
 * REMAINING half: how HomeDashboard.tsx actually renders each state,
 * including the Finding D "Why" dead-control fix. No component-test
 * harness exists in this repo for a plain .tsx file under the standard
 * ts-node runner (see this repo's own established convention, e.g.
 * test/planLogMyDayRefresh.test.ts's header comment) -- so this follows
 * the same source-text/regex structural-assertion pattern.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const source = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');

// ============================================================
// Finding D, checks 1/2/3/5/6 -- Why availability + activation.
// ============================================================

check(
  '1/6. The spotlight\'s Why control is gated on spotlightExplanation existing and being non-empty (fail closed -- never rendered as a bare/unconditional control)',
  /\{spotlightExplanation && spotlightExplanation\.length > 0 && \(\s*\n\s*<TextButton onClick=\{\(\) => handleToggleExpand\(spotlightItem\.id\)\}/.test(source)
);
check(
  '2. Activating Why calls the SAME handleToggleExpand(id) HomeTimeline\'s own row-level Why already uses -- not a locally-invented no-op handler',
  /onClick=\{\(\) => handleToggleExpand\(spotlightItem\.id\)\}/.test(source)
);
check(
  '3/4. A real, visible explanation panel renders inline in the spotlight itself once expanded (never only a distant/off-screen side effect) -- and the SAME toggle state means clicking again collapses it (collapse/reopen)',
  /\{spotlightWhyExpanded && spotlightExplanation && spotlightExplanation\.length > 0 && \(/.test(source) && /Why this time\?/.test(source)
);
check(
  '5. The Why label itself visibly reflects expand/collapse state (never a static label that gives no feedback that a toggle happened)',
  /\{spotlightWhyExpanded \? 'Why\? ↑' : 'Why\? →'\}/.test(source)
);

// ============================================================
// Finding D, checks 7/8 -- no raw jargon/numeric score in the explanation
// path. spotlightExplanation is explanationsById[...], itself built from
// buildWhyAuraExplanation (whyAuraViewModel.ts) -- the SAME already-clean
// plain-language source Finding B's own Home "Why this time?" panel uses.
// No new explanation text is manufactured inside this component.
// ============================================================

check(
  '7/8. The spotlight explanation reuses the existing plain-language buildWhyAuraExplanation output via explanationsById -- no new/local explanation copy is manufactured, and no raw score/jargon field (e.g. a numeric ring) is rendered alongside it',
  /const spotlightExplanation = spotlightItem \? explanationsById\[spotlightItem\.id\] : undefined;/.test(source) &&
    !/spotlightItem\.score/.test(source) &&
    !/MatchScoreRing/.test(source)
);

// ============================================================
// Finding D, check 9 -- the existing Plan CTA (Finding E §4.C, OPPORTUNITY
// only) remains wired to the real, unmodified handlePlanOpportunity
// (CHECK-before-save, canonical save path) -- never a second/fabricated
// planning path introduced alongside the Why fix.
// ============================================================

check(
  '9. The OPPORTUNITY-only Plan CTA in the spotlight calls the existing handlePlanOpportunity (same CHECK-before-save canonical path Opportunity rows already use), gated on rightNowState.kind === \'OPPORTUNITY\'',
  /\{rightNowState\.kind === 'OPPORTUNITY' && \(\s*\n\s*<PrimaryButton\s*\n\s*onClick=\{\(\) => handlePlanOpportunity\(spotlightItem\)\}/.test(source)
);
check(
  '9. That CTA shares the caller-owned planningOpportunityId loading state, never a locally-invented one',
  /disabled=\{planningOpportunityId === spotlightItem\.id\}/.test(source) && /\{planningOpportunityId === spotlightItem\.id \? 'Planning…' : 'Plan'\}/.test(source)
);

// ============================================================
// Finding E -- state-dependent heading + copy, verified structurally.
// PLANNED != RECOMMENDED OPTION: ACTIVE_PLAN/IMMINENT_PLAN copy never
// says "option"; only OPPORTUNITY does.
// ============================================================

check('E: heading is "Happening now" for ACTIVE_PLAN', /rightNowState\.kind === 'ACTIVE_PLAN'\s*\n\s*\? 'Happening now'/.test(source));
check('E: heading is "Coming up" for IMMINENT_PLAN', /\? 'Coming up'/.test(source));
check('E: heading stays "Best option right now" for OPPORTUNITY (unchanged copy)', /\? 'Best option right now'/.test(source));
check('E: ACTIVE_PLAN body copy says "is happening now.", never "is a strong option"', /\$\{spotlightItem\.title\} is happening now\.`/.test(source));
check('E: IMMINENT_PLAN body copy says "starts soon.", never "is a strong option"', /\$\{spotlightItem\.title\} starts soon\.`/.test(source));
check('E: only OPPORTUNITY still uses "is a strong option right now."', /\$\{spotlightItem\.title\} is a strong option right now\.`/.test(source));

// ============================================================
// Finding E -- selection itself is delegated to selectRightNowState, never
// reimplemented/inlined here (single source of truth, matches
// rightNowSelection.test.ts's own coverage).
// ============================================================

check('E: HomeDashboard imports and calls the real selectRightNowState, not a local reimplementation', /import \{ selectRightNowState \} from '\.\.\/lib\/rightNowSelection';/.test(source) && /const rightNowState = useMemo\(\(\) => selectRightNowState\(homeTimeline, new Date\(\)\), \[homeTimeline, currentMinuteOfDay\]\);/.test(source));

// ============================================================
// Composer boundary (ticket §6) -- this fix must never touch
// homeTimelineComposer.ts's own semantics.
// ============================================================

const composerSource = fs.readFileSync('apps/web/lib/homeTimelineComposer.ts', 'utf8');
check('Composer boundary: homeTimelineComposer.ts is not aware of rightNowSelection.ts (no import), proving Right Now selection stays a presentation-layer concern layered ON TOP of the Composer, never inside it', !/rightNowSelection/.test(composerSource));

if (!allPassed) {
  console.error('\nSome Home Dashboard Right Now contract checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME DASHBOARD RIGHT NOW CONTRACT CHECKS PASSED');
}
