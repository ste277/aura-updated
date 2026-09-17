/**
 * Home Plan / Add Actions dead-click fix -- structural regression suite.
 * This repository's own test suite never renders React components (see
 * homeDashboardLogic.test.ts's own doc comment, and
 * homeTimelineOpportunityCta.test.ts's own precedent for exactly this
 * class of property: a plain .tsx file has no component-test harness
 * under the standard ts-node runner) -- so this file proves
 * HomeDashboard.tsx's/page.tsx's own ARCHITECTURAL WIRING facts by
 * reading their real, shipped source, matching that established
 * convention exactly.
 *
 * Scope: the two dead-click fixes only --
 *   A. "Plan" (Best Option Right Now) failure feedback now renders
 *      beside the CTA, never only after the entire Your Day timeline.
 *   B. "+ Add something" always produces a visible result: either the
 *      Day Builder block (when available) or Explore navigation
 *      (when it isn't) -- never a toggle whose rendered result is null.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const dashboardSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/HomeDashboard.tsx'), 'utf8');
const pageSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/app/page.tsx'), 'utf8');

function main() {
  // ============================================================
  // 1. Plan renders (regression -- unchanged from before this fix).
  // ============================================================
  check(
    "1. the OPPORTUNITY-kind Right Now state still renders the PrimaryButton Plan CTA",
    /rightNowState\.kind === 'OPPORTUNITY' && \(\s*<PrimaryButton/.test(dashboardSource)
  );

  // ============================================================
  // 2. Plan execution -- handlePlanOpportunity still uses CHECK, the
  // correct identity fields, and the one canonical save function
  // (regression -- this fix must not touch this logic at all).
  // ============================================================
  {
    const handlerMatch = dashboardSource.match(/const handlePlanOpportunity = async \(item: HomeTimelineItem\) => \{[\s\S]*?\n  \};/);
    const handlerBody = handlerMatch?.[0] ?? '';
    check('2. handlePlanOpportunity still exists as a single, real implementation', handlerBody.length > 0);
    check("2b. handlePlanOpportunity still calls onTimingSearch with mode: 'CHECK'", /mode: 'CHECK'/.test(handlerBody));
    check('2c. handlePlanOpportunity still passes the exact item.metadata.activityId', /activityId: item\.metadata\.activityId/.test(handlerBody));
    check('2d. handlePlanOpportunity still passes candidateStart: item.start', /candidateStart: item\.start/.test(handlerBody));
    check('2e. handlePlanOpportunity still calls the one canonical saveUpcomingPlanFromCandidate (no second save implementation)', /await saveUpcomingPlanFromCandidate\(/.test(handlerBody));
  }

  // ============================================================
  // 3. Plan failure feedback -- CRITICAL. Must render inside the Right
  // Now / OPPORTUNITY block, BEFORE <HomeTimeline in source order --
  // never only after the entire Your Day timeline.
  // ============================================================
  {
    const errorRenderMatches = dashboardSource.match(/\{rightNowState\.kind === 'OPPORTUNITY' && opportunityError && \(/g) ?? [];
    check('3. opportunityError is rendered exactly once, gated on the OPPORTUNITY state', errorRenderMatches.length === 1);

    const errorIndex = dashboardSource.indexOf("{rightNowState.kind === 'OPPORTUNITY' && opportunityError && (");
    const homeTimelineIndex = dashboardSource.indexOf('<HomeTimeline');
    const planButtonIndex = dashboardSource.indexOf('onClick={() => handlePlanOpportunity(spotlightItem)}');
    check('3b. the error render sits BEFORE <HomeTimeline in source order (inside the Right Now card, not after Your Day)', errorIndex > 0 && homeTimelineIndex > 0 && errorIndex < homeTimelineIndex);
    check('3c. the error render sits AFTER the Plan button itself (visually adjacent, not somewhere unrelated earlier in the card)', errorIndex > planButtonIndex);

    // The OLD standalone (never state-gated) render must be gone entirely --
    // proves this is a MOVE, not a duplicate.
    const bareOldRenderCount = (dashboardSource.match(/\{opportunityError && <div/g) ?? []).length;
    check('3d. the old standalone opportunityError render (ungated, after HomeTimeline) no longer exists', bareOldRenderCount === 0);
  }

  // ============================================================
  // 4. Plan success -- onMyDayChanged still refreshes Home after a
  // successful save (regression).
  // ============================================================
  {
    const handlerMatch = dashboardSource.match(/const handlePlanOpportunity = async \(item: HomeTimelineItem\) => \{[\s\S]*?\n  \};/);
    const handlerBody = handlerMatch?.[0] ?? '';
    const saveIndex = handlerBody.indexOf('await saveUpcomingPlanFromCandidate(');
    const refreshIndex = handlerBody.indexOf('onMyDayChanged?.()');
    check('4. onMyDayChanged?.() still fires, after the save call, as the existing success feedback (no new toast infrastructure)', saveIndex > 0 && refreshIndex > saveIndex);
  }

  // ============================================================
  // 5/6/7. Add Something -- normal case (Day Builder), fallback case
  // (Explore), and the no-dead-path invariant.
  // ============================================================
  {
    const handlerMatch = dashboardSource.match(/const handleAddSomething = \(\) => \{[\s\S]*?\n  \};/);
    const handlerBody = handlerMatch?.[0] ?? '';
    check('5. handleAddSomething exists as a single real implementation', handlerBody.length > 0);
    check('5b. when dayBuilderBlock is available, handleAddSomething toggles showDayBuilder (existing proactive-suggestion experience preserved)', /if \(dayBuilderBlock\) \{\s*setShowDayBuilder\(\(current\) => !current\);/.test(handlerBody));
    check('6. when dayBuilderBlock is unavailable, handleAddSomething falls through to onExploreClick (never only toggles state that renders to null)', /\} else \{\s*onExploreClick\?\.\(\);/.test(handlerBody));
    check('7. every branch of handleAddSomething produces a real action -- no bare no-op branch', handlerBody.includes('setShowDayBuilder') && handlerBody.includes('onExploreClick?.()') && !/else \{\s*\}/.test(handlerBody));

    // <HomeTimeline itself now receives the branching handler, not the old bare toggle.
    check('7b. <HomeTimeline receives the new branching handleAddSomething, not the old unconditional toggle', dashboardSource.includes('onAddSomething={handleAddSomething}'));
    check('7c. the old unconditional toggle-only onAddSomething wiring no longer exists', !dashboardSource.includes("onAddSomething={() => setShowDayBuilder((current) => !current)}"));
  }

  // ============================================================
  // 8. Day Builder's own NIGHT semantics are untouched -- this fix only
  // changes what HOME does when dayBuilderBlock is null, never what
  // dayBuilderBlock itself computes.
  // ============================================================
  check("8. dayBuilderBlock's own NIGHT-phase computation is byte-unchanged", /const dayBuilderBlock =\s*myDayAgenda && dayPhase !== 'NIGHT' \? \(/.test(dashboardSource));

  // ============================================================
  // 9. Separation -- neither action references /plan-day or performs a
  // cross-route navigation of its own; Plan My Day remains the only one
  // of the three actions entering /plan-day.
  // ============================================================
  {
    const planHandlerMatch = dashboardSource.match(/const handlePlanOpportunity = async \(item: HomeTimelineItem\) => \{[\s\S]*?\n  \};/);
    const addHandlerMatch = dashboardSource.match(/const handleAddSomething = \(\) => \{[\s\S]*?\n  \};/);
    check('9a. handlePlanOpportunity never references /plan-day or window.location', !/\/plan-day|window\.location/.test(planHandlerMatch?.[0] ?? ''));
    check('9b. handleAddSomething never references /plan-day or window.location', !/\/plan-day|window\.location/.test(addHandlerMatch?.[0] ?? ''));
  }

  // ============================================================
  // 10. Plan My Day regression -- still the only real /plan-day entry.
  // ============================================================
  check("10. Plan My Day (onPlanDay) still navigates to /plan-day, unchanged", pageSource.includes("onPlanDay={() => { window.location.href = '/plan-day'; }}"));
  check('10b. onExploreClick is wired to the same existing Explore navigation onPanchangClick already uses', pageSource.includes("onExploreClick={() => setActiveTab('explore')}"));

  // ============================================================
  // 11. Stale-error reset -- a fresh Plan attempt clears any previous
  // error before starting (regression: this was already correct).
  // ============================================================
  {
    const handlerMatch = dashboardSource.match(/const handlePlanOpportunity = async \(item: HomeTimelineItem\) => \{[\s\S]*?\n  \};/);
    const handlerBody = handlerMatch?.[0] ?? '';
    const setPlanningIndex = handlerBody.indexOf('setPlanningOpportunityId(item.id);');
    const clearErrorIndex = handlerBody.indexOf("setOpportunityError('');");
    const tryIndex = handlerBody.indexOf('try {');
    check('11. a new Plan attempt clears any stale previous error BEFORE the CHECK/save attempt begins', setPlanningIndex > 0 && clearErrorIndex > setPlanningIndex && tryIndex > clearErrorIndex);
  }

  if (!allPassed) {
    console.error('\nSome Home Actions Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL HOME ACTIONS WIRING CHECKS PASSED');
  }
}

main();
