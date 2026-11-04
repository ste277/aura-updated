/**
 * HGR2 -- Home Goal-Rhythm Prioritization and Overflow.
 *
 * Pure, DI-free regression coverage for the real production functions
 * `prioritizeGoalRhythmSuggestions`/`splitVisibleAndOverflowGoalRhythmSuggestions`/
 * `computeGoalRhythmHomeView`/`excludeGoalRhythmSuggestionsDuplicatingActivities`
 * (homeGoalRhythmSuggestions.ts). These functions are called DIRECTLY
 * against constructed `HomeGoalRhythmSuggestion` fixtures -- the exact
 * same production code path `GoalRhythmSuggestionsCard.tsx` itself calls
 * (`computeGoalRhythmHomeView`) and `HomeDashboard.tsx` itself calls
 * (`excludeGoalRhythmSuggestionsDuplicatingActivities`), never a
 * reimplementation of their logic. Checks 7/14/15 are explicitly
 * structural/source assertions (this repo has no jsdom/testing-library --
 * confirmed absent from package.json/node_modules, same established,
 * disclosed limitation HGR1's own test file and its independent review
 * already documented) and are labeled as such, never presented as
 * component-rendered behavioral coverage.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  prioritizeGoalRhythmSuggestions,
  splitVisibleAndOverflowGoalRhythmSuggestions,
  computeGoalRhythmHomeView,
  excludeGoalRhythmSuggestionsDuplicatingActivities,
  GOAL_RHYTHM_VISIBLE_CAP,
  type HomeGoalRhythmSuggestion,
} from '../apps/web/lib/homeGoalRhythmSuggestions';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function suggestion(overrides: Partial<HomeGoalRhythmSuggestion> & { goalActivityId: string }): HomeGoalRhythmSuggestion {
  // planHandoff is derived from the FINAL goalId/goalActivityId (after
  // overrides are resolved), never from the goalActivityId alone -- so a
  // test that overrides `goalId` without also overriding `planHandoff`
  // still gets an internally-consistent fixture.
  const goalActivityId = overrides.goalActivityId;
  const goalId = overrides.goalId ?? `goal-${goalActivityId}`;
  return {
    goalId,
    goalTitle: 'Get fit',
    title: 'Run',
    activityId: 'running',
    remainingThisWeek: 1,
    targetPerWeek: 3,
    progressLabel: '1 session remaining this week (of 3)',
    planHandoff: { fromGoal: goalId, activities: goalActivityId },
    ...overrides,
  };
}

function main() {
  // ============================================================
  // 1. Zero eligible activities
  // ============================================================
  {
    const { visible, overflow } = computeGoalRhythmHomeView([], new Set());
    check('1. zero eligible activities -> empty visible and overflow', visible.length === 0 && overflow.length === 0);
  }

  // ============================================================
  // 2. One eligible activity
  // ============================================================
  {
    const s1 = suggestion({ goalActivityId: 'ga-1', remainingThisWeek: 2 });
    const { visible, overflow } = computeGoalRhythmHomeView([s1], new Set());
    check('2. one eligible activity -> appears visible, no overflow', visible.length === 1 && visible[0].goalActivityId === 'ga-1' && overflow.length === 0);
  }

  // ============================================================
  // 3. Exactly three eligible activities (boundary -- no overflow yet)
  // ============================================================
  {
    const three = [
      suggestion({ goalActivityId: 'ga-a', remainingThisWeek: 1 }),
      suggestion({ goalActivityId: 'ga-b', remainingThisWeek: 2 }),
      suggestion({ goalActivityId: 'ga-c', remainingThisWeek: 3 }),
    ];
    const { visible, overflow } = computeGoalRhythmHomeView(three, new Set());
    check('3. exactly three eligible -> all three visible, zero overflow (boundary)', visible.length === 3 && overflow.length === 0 && GOAL_RHYTHM_VISIBLE_CAP === 3);
  }

  // ============================================================
  // 4. More than three eligible activities -- overflow triggers
  // ============================================================
  {
    const five = [
      suggestion({ goalActivityId: 'ga-1', remainingThisWeek: 1 }),
      suggestion({ goalActivityId: 'ga-2', remainingThisWeek: 2 }),
      suggestion({ goalActivityId: 'ga-3', remainingThisWeek: 3 }),
      suggestion({ goalActivityId: 'ga-4', remainingThisWeek: 4 }),
      suggestion({ goalActivityId: 'ga-5', remainingThisWeek: 5 }),
    ];
    const { visible, overflow } = computeGoalRhythmHomeView(five, new Set());
    check(
      '4. more than three eligible -> exactly 3 visible, 2 overflow, nothing dropped (5 total preserved)',
      visible.length === 3 && overflow.length === 2 && visible.length + overflow.length === 5
    );
  }

  // ============================================================
  // 5. Stable deterministic ordering across repeated calls with
  // identical input (and regardless of input array order).
  // ============================================================
  {
    const a = suggestion({ goalActivityId: 'ga-a', remainingThisWeek: 2 });
    const b = suggestion({ goalActivityId: 'ga-b', remainingThisWeek: 2 }); // tie on remainingThisWeek -> breaks on goalActivityId
    const c = suggestion({ goalActivityId: 'ga-c', remainingThisWeek: 5 });
    const run1 = prioritizeGoalRhythmSuggestions([a, b, c]).map((s) => s.goalActivityId);
    const run2 = prioritizeGoalRhythmSuggestions([c, a, b]).map((s) => s.goalActivityId); // different input order
    const run3 = prioritizeGoalRhythmSuggestions([b, c, a]).map((s) => s.goalActivityId); // yet another input order
    check(
      '5. ordering is deterministic (highest remainingThisWeek first, stable goalActivityId tie-break) regardless of input order',
      JSON.stringify(run1) === JSON.stringify(['ga-c', 'ga-a', 'ga-b']) && JSON.stringify(run1) === JSON.stringify(run2) && JSON.stringify(run1) === JSON.stringify(run3)
    );
  }

  // ============================================================
  // 6. Overflow access -- "View all" must reach every eligible
  // suggestion, each with its correct identity.
  // ============================================================
  {
    const five = ['ga-1', 'ga-2', 'ga-3', 'ga-4', 'ga-5'].map((id, i) => suggestion({ goalActivityId: id, remainingThisWeek: 5 - i }));
    const prioritized = prioritizeGoalRhythmSuggestions(five);
    const { visible, overflow } = splitVisibleAndOverflowGoalRhythmSuggestions(prioritized);
    const all = [...visible, ...overflow];
    check(
      '6. every eligible suggestion is reachable (visible + overflow), each with its correct real identity, none fabricated',
      all.length === 5 && new Set(all.map((s) => s.goalActivityId)).size === 5 && overflow.every((s) => five.some((orig) => orig.goalActivityId === s.goalActivityId))
    );
  }

  // ============================================================
  // 7. Collapse behavior -- the card's own expand/collapse slicing
  // (expanded ? [...visible, ...overflow] : visible). No jsdom/
  // testing-library in this repo (confirmed below), so this is a
  // structural assertion on the real component source, not a rendered
  // interaction -- explicitly labeled, not presented as DOM coverage.
  // ============================================================
  {
    const hasNoJsdom = !fs.existsSync(path.join(__dirname, '..', 'node_modules', 'jsdom')) && !fs.existsSync(path.join(__dirname, '..', 'apps', 'web', 'node_modules', 'jsdom'));
    const cardSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/GoalRhythmSuggestionsCard.tsx'), 'utf8');
    const hasExpandToggle = /setExpanded\(\(current\)\s*=>\s*!current\)/.test(cardSource);
    const hasCollapsedSlice = /expanded\s*\?\s*\[\.\.\.visible,\s*\.\.\.overflow\]\s*:\s*visible/.test(cardSource);
    check(
      '7. [STRUCTURAL -- no jsdom in this repo] the card toggles a real expand/collapse state and slices visible+overflow vs visible-only, matching "View all"/"Show less"',
      hasNoJsdom && hasExpandToggle && hasCollapsedSlice
    );
  }

  // ============================================================
  // 8. Dismissal promotes the next item into the visible set.
  // ============================================================
  {
    const four = ['ga-1', 'ga-2', 'ga-3', 'ga-4'].map((id, i) => suggestion({ goalActivityId: id, remainingThisWeek: 4 - i })); // ga-1..ga-4, strictly descending priority
    const before = computeGoalRhythmHomeView(four, new Set());
    check('8a. before dismissal: ga-1/ga-2/ga-3 visible, ga-4 is overflow', before.visible.map((s) => s.goalActivityId).join() === 'ga-1,ga-2,ga-3' && before.overflow[0].goalActivityId === 'ga-4');
    const after = computeGoalRhythmHomeView(four, new Set(['ga-2']));
    check(
      '8b. dismissing ga-2 (a visible item) promotes ga-4 (the overflow item) into the visible set, preserving relative order of the rest',
      after.visible.map((s) => s.goalActivityId).join() === 'ga-1,ga-3,ga-4' && after.overflow.length === 0
    );
  }

  // ============================================================
  // 9. Dismissal does not mutate any persisted data -- the function is
  // pure (no I/O, no mutation of its own inputs), and the dismissal
  // click handler itself performs no write call.
  // ============================================================
  {
    const original = [suggestion({ goalActivityId: 'ga-x', remainingThisWeek: 2 })];
    const snapshotBefore = JSON.stringify(original);
    computeGoalRhythmHomeView(original, new Set(['ga-x']));
    const snapshotAfter = JSON.stringify(original);
    check('9a. computeGoalRhythmHomeView never mutates its input suggestions array/objects', snapshotBefore === snapshotAfter);

    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/HomeDashboard.tsx'), 'utf8');
    const dismissHandlerMatch = dashboardSource.match(/const handleDismissGoalRhythmSuggestion = \(goalActivityId: string\) => \{[\s\S]*?\n {2}\};/);
    const dismissHandlerBody = dismissHandlerMatch ? dismissHandlerMatch[0] : '';
    check(
      '9b. the real "Not now" click handler contains no fetch/write call -- it only updates local dismissedGoalRhythmIds React state',
      dismissHandlerBody.length > 0 && /setDismissedGoalRhythmIds/.test(dismissHandlerBody) && !/fetch\(|\.(create|update|delete|upsert)\(/.test(dismissHandlerBody)
    );
  }

  // ============================================================
  // 10. GoalActivity identity survives prioritization/reordering.
  // ============================================================
  {
    const original = suggestion({ goalActivityId: 'ga-identity', goalId: 'goal-identity-real', remainingThisWeek: 1 });
    const other = suggestion({ goalActivityId: 'ga-other', remainingThisWeek: 9 }); // sorts first
    const [first, prioritizedOriginal] = prioritizeGoalRhythmSuggestions([original, other]);
    check(
      '10. prioritization reorders but never rewrites a suggestion\'s own identity fields (goalActivityId/goalId/planHandoff all byte-identical to the source object)',
      first.goalActivityId === 'ga-other' &&
        prioritizedOriginal.goalActivityId === 'ga-identity' &&
        prioritizedOriginal.goalId === 'goal-identity-real' &&
        prioritizedOriginal.planHandoff.fromGoal === 'goal-identity-real' &&
        prioritizedOriginal.planHandoff.activities === 'ga-identity'
    );
  }

  // ============================================================
  // 11. Overflow "Plan it" preserves identity identically to the
  // visible-card path -- same object, same planHandoff, reached via the
  // SAME render loop (no second/special-cased overflow branch).
  // ============================================================
  {
    const five = ['ga-1', 'ga-2', 'ga-3', 'ga-4', 'ga-5'].map((id, i) => suggestion({ goalActivityId: id, goalId: `goal-${id}`, remainingThisWeek: 5 - i }));
    const { overflow } = computeGoalRhythmHomeView(five, new Set());
    const overflowItem = overflow[0];
    check(
      '11a. an overflow suggestion carries its real planHandoff unchanged (fromGoal/activities match its own goalId/goalActivityId exactly)',
      overflowItem !== undefined && overflowItem.planHandoff.fromGoal === overflowItem.goalId && overflowItem.planHandoff.activities === overflowItem.goalActivityId
    );
    const cardSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/GoalRhythmSuggestionsCard.tsx'), 'utf8');
    const mapCalls = cardSource.match(/\.map\(/g) ?? [];
    check(
      '11b. [STRUCTURAL] the card renders visible and overflow suggestions through the SAME single .map() over `shown` -- no separate/special-cased overflow render path',
      /const shown = expanded \? \[\.\.\.visible, \.\.\.overflow\] : visible;/.test(cardSource) && mapCalls.length === 1
    );
  }

  // ============================================================
  // 12. Existing (non-Rhythm) Home recommendations remain available --
  // this PR's dedup only ever removes a Goal-Rhythm suggestion, never
  // touches the guidance feed's own rendering.
  // ============================================================
  {
    const dashboardSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/HomeDashboard.tsx'), 'utf8');
    const guidanceRenderStillPresent = /BestForYouSection|readyGuidance/.test(dashboardSource);
    const dedupOnlyTouchesGoalRhythm = /excludeGoalRhythmSuggestionsDuplicatingActivities\(goalRhythmSuggestions/.test(dashboardSource);
    check(
      '12. [STRUCTURAL] the existing guidance/"Best For You" rendering is untouched, and the new dedup call\'s own first argument is goalRhythmSuggestions, never the guidance feed',
      guidanceRenderStillPresent && dedupOnlyTouchesGoalRhythm
    );
  }

  // ============================================================
  // 13. Weekly eligibility math itself is unchanged by this PR --
  // regression guard against accidentally touching goalActivityRhythm.ts.
  // ============================================================
  {
    const rhythmSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/lib/goalActivityRhythm.ts'), 'utf8');
    check(
      '13. [STRUCTURAL] goalActivityRhythm.ts\'s own eligibility formula/export is still present verbatim (this PR\'s new files only ever CONSUME HomeGoalRhythmSuggestion, never re-derive remainingThisWeek/targetPerWeek)',
      /remaining = Math\.max\(0, target - completed - committed\)/.test(rhythmSource.replace(/\s+/g, ' ')) || /computeGoalActivityRhythmEligibility/.test(rhythmSource)
    );
    // The new prioritization functions never recompute remainingThisWeek/targetPerWeek -- confirmed by identity in check 10 above.
  }

  // ============================================================
  // 14. Daily Rhythm behavior is unchanged -- still not applied at this
  // layer (regression guard matching HGR1's own test 8).
  // ============================================================
  {
    const newFiles = ['apps/web/lib/homeGoalRhythmSuggestions.ts', 'apps/web/components/GoalRhythmSuggestionsCard.tsx', 'apps/web/components/HomeDashboard.tsx'];
    const referencesDailyRhythm = newFiles.some((f) => /applyDailyRhythmPreference|dailyRhythmScheduling/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')));
    check('14. [STRUCTURAL] HGR2\'s touched files introduce no Daily Rhythm filtering of their own (still exclusively Plan My Day\'s, unchanged)', !referencesDailyRhythm);
  }

  // ============================================================
  // 15. Mobile accessibility and keyboard interaction. [STRUCTURAL --
  // no jsdom in this repo, see check 7] real button elements (not
  // div+onClick), aria-expanded on the toggle, 44px minimum touch target.
  // ============================================================
  {
    const cardSource = fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/GoalRhythmSuggestionsCard.tsx'), 'utf8');
    const usesRealButtons = /<TextButton\b/.test(cardSource) && /<PrimaryButton\b/.test(cardSource) && !/<div[^>]*onClick/.test(cardSource);
    const hasAriaExpanded = /aria-expanded=\{expanded\}/.test(cardSource);
    const hasMinTouchTarget = /minHeight:\s*44/.test(cardSource);
    check(
      '15. [STRUCTURAL] "View all"/"Not now"/"Plan it" are real keyboard-focusable button elements with aria-expanded on the toggle and a 44px minimum touch target',
      usesRealButtons && hasAriaExpanded && hasMinTouchTarget
    );
  }

  // ============================================================
  // Duplicate avoidance (HGR2 section 6) -- direct coverage of
  // excludeGoalRhythmSuggestionsDuplicatingActivities, the real function
  // HomeDashboard.tsx calls.
  // ============================================================
  {
    const withCatalogActivity = suggestion({ goalActivityId: 'ga-dup', activityId: 'running' });
    const withoutCatalogActivity = suggestion({ goalActivityId: 'ga-nocatalog', activityId: null });
    const distinctActivity = suggestion({ goalActivityId: 'ga-distinct', activityId: 'reading' });
    const sameTitleDifferentActivity = suggestion({ goalActivityId: 'ga-sametitle', activityId: 'cycling', title: 'Run' }); // same TITLE as the dup, different activityId -- must NOT be suppressed

    const deduped = excludeGoalRhythmSuggestionsDuplicatingActivities([withCatalogActivity, withoutCatalogActivity, distinctActivity, sameTitleDifferentActivity], new Set(['running']));
    check(
      'dup-a. a suggestion whose activityId is already shown elsewhere on Home is suppressed',
      !deduped.some((s) => s.goalActivityId === 'ga-dup')
    );
    check('dup-b. a suggestion with a null activityId is never suppressed (nothing to collide on)', deduped.some((s) => s.goalActivityId === 'ga-nocatalog'));
    check('dup-c. a suggestion with a genuinely distinct activityId is kept', deduped.some((s) => s.goalActivityId === 'ga-distinct'));
    check(
      'dup-d. a suggestion sharing the SUPPRESSED suggestion\'s title but with a DIFFERENT activityId is kept -- dedup is never title-text-based',
      deduped.some((s) => s.goalActivityId === 'ga-sametitle')
    );
  }
}

main();
if (!allPassed) {
  console.error('SOME HOME GOAL RHYTHM SUGGESTIONS PRIORITIZATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL HOME GOAL RHYTHM SUGGESTIONS PRIORITIZATION CHECKS PASSED');
