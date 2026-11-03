/**
 * Daily Rhythm -- Home Timeline Navigation Fix.
 *
 * Home's "View full day timeline ->" button used to navigate to the
 * unrelated Panchang-window Timeline tab (`setActiveTab('timeline')`)
 * instead of scrolling to/focusing the already-rendered Home timeline on
 * the same screen. The fix reuses the EXISTING cross-tab-handoff focus
 * mechanism (`homeTimelineFocusKey` state in page.tsx + the matching
 * `focusTimelineKey` effect in HomeDashboard.tsx, which scrolls/focuses
 * `[data-home-timeline-region]`) rather than introducing a second,
 * standalone scroll/focus implementation.
 *
 * No component-test harness exists in this repo for a plain .tsx file like
 * this one under the standard ts-node runner (see this repo's own
 * established convention, e.g. test/homeTimelineOpportunityCta.test.ts's
 * header comment) -- so this follows the same source-text/regex
 * structural-assertion pattern rather than introducing one.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
const homeTimelineSource = fs.readFileSync('apps/web/components/HomeTimeline.tsx', 'utf8');

// ============================================================
// 1/2. "View full day timeline" triggers homeTimelineFocusKey, never
// setActiveTab('timeline') -- the exact bug this ticket fixes.
// ============================================================

const onNextShiftClickMatch = pageSource.match(/onNextShiftClick=\{([^}]*)\}/);
check('1/2. page.tsx located a single onNextShiftClick prop assignment', onNextShiftClickMatch !== null);
const onNextShiftClickBody = onNextShiftClickMatch?.[1] ?? '';
check('1. onNextShiftClick triggers the existing homeTimelineFocusKey mechanism (setHomeTimelineFocusKey), the SAME update call the cross-tab handoff already uses', /setHomeTimelineFocusKey\(Date\.now\(\)\)/.test(onNextShiftClickBody));
check("2. onNextShiftClick no longer calls setActiveTab('timeline') -- it stays on Home", !/setActiveTab\('timeline'\)/.test(onNextShiftClickBody));

// ============================================================
// Confirm the OTHER, unrelated Panchang-tab navigation call sites are
// untouched -- this fix must be scoped to onNextShiftClick alone.
// ============================================================

const setActiveTabTimelineCount = (pageSource.match(/setActiveTab\('timeline'\)/g) ?? []).length;
check("3/6. exactly 2 OTHER call sites still legitimately navigate to the Panchang timeline tab (onViewTimeline, onViewTodayRhythm) -- unrelated navigation is unchanged", setActiveTabTimelineCount === 2);

// ============================================================
// 3. The existing focus effect remains authoritative: no second
// scroll/focus mechanism was introduced anywhere in HomeDashboard.tsx.
// ============================================================

const scrollIntoViewMatches = homeDashboardSource.match(/\.scrollIntoView\(/g) ?? [];
check('3. HomeDashboard.tsx has exactly ONE scrollIntoView call site (the existing focusTimelineKey effect) -- no duplicate/standalone scroll mechanism was introduced', scrollIntoViewMatches.length === 1);

const focusTimelineKeyEffectMatch = homeDashboardSource.match(/useEffect\(\(\) => \{\s*if \(!focusTimelineKey\) return;[\s\S]*?\n {2}\}, \[focusTimelineKey\]\);/);
check('3. the existing focusTimelineKey effect (scroll + focus against [data-home-timeline-region]) is present, unmodified in shape', focusTimelineKeyEffectMatch !== null);
const focusEffectBody = focusTimelineKeyEffectMatch?.[0] ?? '';
check('3. that effect still scrolls the timeline region into view', /timelineRegion\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/.test(focusEffectBody));
check('3. that effect still focuses the timeline region (preventScroll, so the smooth scroll is not interrupted)', /timelineRegion\?\.focus\(\{ preventScroll: true \}\)/.test(focusEffectBody));

// ============================================================
// 4. Both the populated AND empty timeline branches expose the SAME
// data-home-timeline-region marker the focus effect queries for.
// ============================================================

const regionMarkerMatches = homeTimelineSource.match(/data-home-timeline-region/g) ?? [];
check('4. HomeTimeline.tsx now declares the data-home-timeline-region marker exactly twice (once per branch: empty-state and populated)', regionMarkerMatches.length === 2);

const emptyBranchMatch = homeTimelineSource.match(/if \(items\.length === 0 && pendingActivities\.length === 0\) \{\s*return \(\s*<section([^>]*)>/);
check('4. the empty-state branch\'s opening <section> tag was located', emptyBranchMatch !== null);
const emptyBranchSectionAttrs = emptyBranchMatch?.[1] ?? '';
check('4. the empty-state timeline region carries the focus-region marker', /data-home-timeline-region/.test(emptyBranchSectionAttrs));
check('4. the empty-state timeline region is focusable (tabIndex={-1}), matching the populated branch', /tabIndex=\{-1\}/.test(emptyBranchSectionAttrs));

// Locate the populated branch's <section> tag by its unique content anchor
// (`background: colors.surfaceSubtle` exists ONLY in the populated branch's
// wrapper div) rather than by occurrence order in the source: an earlier
// version of this check used `/return \(\s*<section([^>]*)>\s*<SectionHeader
// label="Your Day"/` with no `g` flag, which matches the FIRST such
// occurrence in source order -- the EMPTY-state branch, since both branches
// open with the identical `<section ...><SectionHeader label="Your Day" />`
// sequence. That bug silently re-verified the empty branch twice instead of
// independently verifying the populated one. Anchoring on content that is
// structurally guaranteed to appear only inside the populated branch (not on
// source-order position, which is incidental) fixes this without relying on
// the empty-branch check (lines above) or the exactly-two-markers count
// check (line 70) to cover it by elimination.
const populatedAnchorIndex = homeTimelineSource.indexOf('background: colors.surfaceSubtle');
check('4. located the populated branch\'s unique content anchor (background: colors.surfaceSubtle, only present in that branch)', populatedAnchorIndex !== -1);
const sectionOpenMatches = [...homeTimelineSource.matchAll(/<section([^>]*)>/g)];
const populatedBranchMatch = sectionOpenMatches.filter((m) => m.index! < populatedAnchorIndex).pop();
check('4. the populated branch\'s opening <section> tag (the nearest one preceding its unique content anchor) was located, independently of the empty-state branch\'s match above', populatedBranchMatch !== undefined);
const populatedBranchSectionAttrs = populatedBranchMatch?.[1] ?? '';
check('4. the populated timeline region still carries the focus-region marker (unchanged)', /data-home-timeline-region/.test(populatedBranchSectionAttrs));
check('4. the populated timeline region is focusable (tabIndex={-1}), matching the empty-state branch', /tabIndex=\{-1\}/.test(populatedBranchSectionAttrs));

// ============================================================
// 5. Repeated focus requests remain supported: the update function uses
// a fresh, always-distinct value (Date.now()), not a boolean/no-op style
// setter that could fail to re-trigger the effect on a second click.
// ============================================================

check("5. the update call passes a fresh value each invocation (Date.now()), so repeated clicks keep producing distinct, non-zero focusTimelineKey values -- the effect's `if (!focusTimelineKey) return;` guard is never defeated by a repeat click", /setHomeTimelineFocusKey\(Date\.now\(\)\)/.test(onNextShiftClickBody));

if (!allPassed) {
  console.error('\nSome Full-Day Timeline Navigation checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL FULL-DAY TIMELINE NAVIGATION CHECKS PASSED');
}
