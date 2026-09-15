/**
 * AURA HOME IA V2 FOLLOW-UP FIXES -- Finding A regression coverage.
 *
 * Live validation found HomeTimeline.tsx's own TimelineRow rendering the
 * "Plan" CTA for an OPPORTUNITY row TWICE once the row's "Why?" panel was
 * expanded: once unconditionally right below the duration/status/Why? line
 * (always visible), and a second time inside the `isExpanded && hasExplanation`
 * block. Both buttons shared the same `onPlan`/`isPlanning` state, so this
 * was pure visual duplication, not a correctness bug -- but it directly
 * contradicts the ticket's own duplication audit and the "exactly ONE
 * primary Plan CTA" requirement.
 *
 * No component-test harness exists in this repo for a plain .tsx file like
 * this one under the standard ts-node runner (see this repo's own
 * established convention, e.g. test/planLogMyDayRefresh.test.ts's header
 * comment) -- so this follows the same source-text/regex structural-
 * assertion pattern rather than introducing one.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const source = fs.readFileSync('apps/web/components/HomeTimeline.tsx', 'utf8');

// ============================================================
// Exactly one Plan CTA render site in TimelineRow, regardless of
// collapsed/expanded state.
// ============================================================

const planButtonMatches = source.match(/<PrimaryButton onClick=\{\(\) => onPlan\?\.\(item\)\}/g) ?? [];
check('HomeTimeline.tsx renders the Opportunity "Plan" PrimaryButton exactly once (not once per collapsed+expanded state)', planButtonMatches.length === 1);

// ============================================================
// That single render site must NOT live inside the `isExpanded &&
// hasExplanation` Why panel -- otherwise the CTA would disappear entirely
// while collapsed (a different, worse bug) rather than being a stable,
// always-visible action.
// ============================================================

const whyPanelMatch = source.match(/\{isExpanded && hasExplanation && \(([\s\S]*?)\n {6}\)\}/);
check('The Why panel block (isExpanded && hasExplanation) was located', whyPanelMatch !== null);
const whyPanelBody = whyPanelMatch?.[1] ?? '';
check('The Why panel itself no longer renders a "Plan" PrimaryButton (that was the duplicate)', !/PrimaryButton/.test(whyPanelBody));
check('The Why panel still renders the plain-language explanation lines (explanationLines.map)', /explanationLines\.map/.test(whyPanelBody));

// ============================================================
// The remaining (sole) Plan CTA still lives in the unconditional
// `isOpportunity && (...)` block, still wired to the same onPlan/isPlanning
// state -- confirms the fix removed the duplicate, not the feature.
// ============================================================

const primaryOpportunityBlockMatch = source.match(/\{isOpportunity && \(([\s\S]*?)\n {6}\)\}/);
check('The primary isOpportunity block (outside the Why panel) was located', primaryOpportunityBlockMatch !== null);
const primaryOpportunityBlockBody = primaryOpportunityBlockMatch?.[1] ?? '';
check('That block still renders the "Plan" PrimaryButton', /<PrimaryButton onClick=\{\(\) => onPlan\?\.\(item\)\}/.test(primaryOpportunityBlockBody));
check('That block still uses the caller-owned isPlanning state ("Planning…" vs "Plan"), never a locally-invented loading state', /\{isPlanning \? 'Planning…' : 'Plan'\}/.test(primaryOpportunityBlockBody));
check('That block still passes disabled={isPlanning} through to the button (no new disabled logic)', /disabled=\{isPlanning\}/.test(primaryOpportunityBlockBody));

if (!allPassed) {
  console.error('\nSome Home Timeline Opportunity CTA checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME TIMELINE OPPORTUNITY CTA CHECKS PASSED');
}
