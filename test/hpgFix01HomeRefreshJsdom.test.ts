/**
 * AURA-HPG-FIX-01 (V1-09 + V1-05 rendering) -- real React 18 + jsdom.
 *
 * V1-09 staging repro: after "Plan remaining 2" -> accept 1 -> Done, Home's
 * rhythm card still read "2 sessions remaining... Plan remaining 2" until a
 * full reload. Root cause: app/page.tsx fetched goal-rhythm suggestions only
 * on sign-in (useEffect on user?.id); no plan-changing path refreshed them,
 * and the weekly review's close had no callback at all.
 *
 * Run with:
 *   npx ts-node --project tsconfig.jsdom-tests.json test/hpgFix01HomeRefreshJsdom.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { React, mount, click, flush } from './jsdomReactHarness';
import type { HomeGoalRhythmSuggestion } from '../apps/web/lib/homeGoalRhythmSuggestions';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GoalRhythmSuggestionsCard } = require('../apps/web/components/GoalRhythmSuggestionsCard');

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function suggestion(overrides: Partial<HomeGoalRhythmSuggestion> & { goalActivityId: string }): HomeGoalRhythmSuggestion {
  return {
    goalId: 'goal-1',
    goalTitle: 'Run 3x weekly',
    title: 'Evening run',
    activityId: null,
    remainingThisWeek: 2,
    targetPerWeek: 3,
    progressLabel: '2 sessions remaining this week (of 3)',
    planHandoff: { fromGoal: 'goal-1', activities: overrides.goalActivityId },
    ...overrides,
  };
}

function buttonsText(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());
}
function findButton(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text) as HTMLButtonElement | undefined;
}

async function main() {
  // The weekly review modal fetches its proposal on open; fail it so the
  // modal settles on its NETWORK_ERROR state (which has a Close button).
  // useModalA11y (the weekly review dialog) reads these DOM globals, which
  // the shared harness does not install; scoped to this test only.
  for (const name of ['HTMLElement', 'Node', 'FocusEvent']) {
    if ((global as any)[name] === undefined) (global as any)[name] = (window as any)[name];
  }
  (global as any).fetch = async () => {
    throw new Error('offline in test');
  };

  // ---------- 1. Rendering: unscheduled vs scheduled today ----------
  {
    const h = await mount(React.createElement(GoalRhythmSuggestionsCard, { suggestions: [suggestion({ goalActivityId: 'ga-free' })], dismissedIds: new Set(), onDismiss: () => {}, timezone: 'Asia/Kolkata' }));
    const texts = buttonsText(h.container);
    check('1. not scheduled today: "Just today" offered (unchanged)', texts.includes('Just today'));
    check('1. not scheduled today: "Plan remaining 2" offered (unchanged)', texts.includes('Plan remaining 2'));
    check('1. not scheduled today: no "already planned" note', !(h.container.textContent ?? '').includes("Today's session is already planned."));
    await h.unmount();
  }
  {
    const h = await mount(React.createElement(GoalRhythmSuggestionsCard, { suggestions: [suggestion({ goalActivityId: 'ga-today', scheduledToday: true })], dismissedIds: new Set(), onDismiss: () => {}, timezone: 'Asia/Kolkata' }));
    const texts = buttonsText(h.container);
    check('1. scheduled today: "Just today" NOT offered', !texts.includes('Just today'));
    check('1. scheduled today: "Plan it" (a today handoff) NOT offered', !texts.includes('Plan it'));
    check('1. scheduled today: weekly review still offered', texts.includes('Plan remaining 2'));
    check('1. scheduled today: explanatory note rendered', (h.container.textContent ?? '').includes("Today's session is already planned."));
    await h.unmount();
  }
  {
    const h = await mount(React.createElement(GoalRhythmSuggestionsCard, { suggestions: [suggestion({ goalActivityId: 'ga-one', remainingThisWeek: 1, progressLabel: '1 session remaining this week (of 3)', scheduledToday: true })], dismissedIds: new Set(), onDismiss: () => {}, timezone: 'Asia/Kolkata' }));
    const texts = buttonsText(h.container);
    check('1. scheduled today, 1 remaining: "Plan another day" instead of "Plan it"', texts.includes('Plan another day') && !texts.includes('Plan it'));
    await h.unmount();
  }

  // ---------- 2. V1-09: closing the weekly review notifies Home ----------
  {
    let closedCount = 0;
    const h = await mount(React.createElement(GoalRhythmSuggestionsCard, {
      suggestions: [suggestion({ goalActivityId: 'ga-review' })],
      dismissedIds: new Set(),
      onDismiss: () => {},
      timezone: 'Asia/Kolkata',
      onWeeklyReviewClosed: () => {
        closedCount += 1;
      },
    }));
    await click(findButton(h.container, 'Plan remaining 2')!);
    await flush();
    await flush();
    const closeButton = findButton(document.body, 'Close');
    check('2. weekly review opened and settled (Close available)', !!closeButton);
    check('2. nothing refreshed merely by opening the review', closedCount === 0);
    if (closeButton) await click(closeButton);
    await flush();
    check('2. closing the review calls onWeeklyReviewClosed exactly once', closedCount === 1);
    check('2. review dialog is gone after close', !findButton(document.body, 'Close'));
    await h.unmount();
  }

  // ---------- 3. Wiring guards (page + Home) ----------
  const page = fs.readFileSync(path.join(__dirname, '../apps/web/app/page.tsx'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '../apps/web/components/HomeDashboard.tsx'), 'utf8');
  const bodyOf = (name: string) => {
    const start = page.indexOf(`const ${name} = useCallback(`);
    return start < 0 ? '' : page.slice(start, page.indexOf('\n  );', start) > 0 ? Math.min(page.indexOf('\n  );', start), start + 2500) : start + 2500);
  };
  check('3. Plan-tab saves/logs/moves/skips (handlePlanLogged) refresh rhythm', /const handlePlanLogged = useCallback\(async \(\) => \{[\s\S]{0,600}refreshGoalRhythmSuggestions\(\)/.test(page));
  check('3. Home complete/skip/move/skip-all (handleHomePlanCompleted) refresh rhythm', bodyOf('handleHomePlanCompleted').includes('refreshGoalRhythmSuggestions()'));
  check('3. My Day / Day Builder changes (handleMyDayOrGuidanceChanged) refresh rhythm', /const handleMyDayOrGuidanceChanged = useCallback\(\(\) => \{[\s\S]{0,200}refreshGoalRhythmSuggestions\(\)/.test(page));
  check('3. weekly-review close is wired page -> Home -> card', page.includes('onGoalRhythmChanged={handleMyDayOrGuidanceChanged}') && home.includes('onWeeklyReviewClosed={onGoalRhythmChanged}'));
  check('3. post-change refresh keeps last-known-good on failure (no blanking)', page.includes('loadGoalRhythmSuggestions({ preserveOnFailure: true })'));
  check('3. no full-page reload introduced for the refresh', !/refreshGoalRhythmSuggestions[\s\S]{0,200}location\.reload/.test(page));

  if (!allPassed) {
    console.error('\nhpgFix01HomeRefreshJsdom: FAILED');
    process.exit(1);
  }
  console.log('\nhpgFix01HomeRefreshJsdom: all checks passed');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
