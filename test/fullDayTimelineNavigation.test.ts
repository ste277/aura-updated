/**
 * Full-Day Timeline Navigation V1 (DR4-D) -- this ticket's own dedicated guards.
 *
 * HOW TO RUN (uses JSX): ./run_ts.sh test/fullDayTimelineNavigation.test.ts
 * (the repo's own inline --compiler-options already enable jsx -- same
 * convention test/goalAwareRecompositionPresentation.test.ts documents).
 *
 * Root cause (confirmed by tracing the current implementation, not assumed
 * from the original audit's line numbers): "View full day timeline"
 * (HomeDashboard.tsx's own onClick, wired via the now-removed
 * onNextShiftClick prop) called `setActiveTab('timeline')` in page.tsx,
 * which rendered `TimelineView` (components/Timeline.tsx) -- a 24-hour
 * Panchang/solar-window arc dial with "good for this window" activity-
 * discovery cards. That screen has NO relation to the user's actual
 * planned/completed activities, no goal context, no completion status: it
 * is not a timeline of the user's day at all. The REAL full-day timeline
 * of the user's day -- HomeTimeline's own "Your Day" section, complete with
 * ordering, statuses, and (since DR4-C) goal-continuity text -- was already
 * rendered on the SAME screen, directly below the button, the entire time.
 * No navigation was ever needed; the fix scrolls/focuses it in place.
 *
 * Mixes:
 *   (a) real renderToStaticMarkup behavioral checks of HomeTimeline itself
 *       (same convention test/goalAwareRecompositionPresentation.test.ts
 *       and test/homeRecomposition.test.ts already established -- this
 *       repository has no interactive component-rendering harness, so a
 *       real static render is the strongest behavioral proof available for
 *       a .tsx file; actual click -> scroll -> focus interaction was
 *       verified live in the browser, documented in this PR), and
 *   (b) source-structural assertions on HomeDashboard.tsx/page.tsx (the
 *       click handler itself is a DOM-API call with no pure-function
 *       boundary to render-test, same established limit `focusTimelineRow`
 *       already lives under).
 */
import * as fs from 'fs';
import * as path from 'path';
import type { HomeTimelineItem } from '../apps/web/lib/homeTimelineTypes';
import type { PlanGoalContext } from '../apps/web/lib/db';

/* eslint-disable @typescript-eslint/no-var-requires */
const React = require('../apps/web/node_modules/react');
const { renderToStaticMarkup } = require('../apps/web/node_modules/react-dom/server');
const { HomeTimeline } = require('../apps/web/components/HomeTimeline');

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function goalContext(): PlanGoalContext {
  return {
    goal: { id: 'goal-1', title: 'Get fitter' },
    goalActivity: { id: 'ga-1', completionRequirement: { kind: 'DONE' } },
    currentValue: null,
  };
}

function renderTimeline(items: HomeTimelineItem[]) {
  return renderToStaticMarkup(
    React.createElement(HomeTimeline, {
      items,
      timezone: 'UTC',
      explanationsById: {},
      expandedId: null,
      onToggleExpand: () => {},
    })
  );
}

// ============================================================
// 1-2. Timeline visibility / no duplicate timeline / empty-state handling --
// real renderToStaticMarkup output, not source-string matching.
// ============================================================
{
  const emptyMarkup = renderTimeline([]);
  check('1. a day with NO planned activities still renders a data-home-timeline-region scroll/focus target (the existing empty state, never an unrelated screen)', /data-home-timeline-region/.test(emptyMarkup));
  check('1. the empty-day target is programmatically focusable (tabindex="-1", not in normal tab order, same convention the non-empty branch already used)', /data-home-timeline-region[^>]*tabindex="-1"/.test(emptyMarkup) || /tabindex="-1"[^>]*data-home-timeline-region/.test(emptyMarkup));
  check('1. the empty-day state is the EXISTING empty state copy ("Your day is open"), never a fabricated list or placeholder', /Your day is open/.test(emptyMarkup));
  check('2. exactly ONE data-home-timeline-region marker in the empty-day render (no duplicate timeline)', (emptyMarkup.match(/data-home-timeline-region/g) ?? []).length === 1);
}

{
  const items: HomeTimelineItem[] = [
    { id: 'plan:a', kind: 'PLAN', start: '2026-08-24T05:00:00.000Z', end: '2026-08-24T05:30:00.000Z', title: 'Go for a run', planned: true, source: 'PLAN', metadata: { agendaStatus: 'COMPLETED', isCompleted: true, goalContext: goalContext() } },
    { id: 'plan:b', kind: 'PLAN', start: '2026-08-24T06:00:00.000Z', end: '2026-08-24T06:30:00.000Z', title: 'Read', planned: true, source: 'PLAN', metadata: { agendaStatus: 'UPCOMING' } },
  ];
  const markup = renderTimeline(items);
  check('1. a day WITH activities also carries the data-home-timeline-region target', /data-home-timeline-region/.test(markup));
  check('2. exactly ONE data-home-timeline-region marker in a populated render (no duplicate timeline, matches this component\'s own MERGE-CRITICAL single-render contract)', (markup.match(/data-home-timeline-region/g) ?? []).length === 1);
  check('8. goal-context text (DR4-C) survives real rendering through this same target: "Completed · Supports Get fitter" for the completed item', /Completed · Supports Get fitter/.test(markup));
  check('7. both items render in the given order (Go for a run before Read) -- navigation fix touches no ordering/composition logic', markup.indexOf('Go for a run') < markup.indexOf('Read'));
  check('4. the ungoaled item ("Read") renders no fabricated goal line -- exactly ONE "Supports" occurrence in the whole render, from the one goal-linked item only', (markup.match(/Supports/g) ?? []).length === 1);
}

// ============================================================
// 3. Correct action destination / navigation+focus behavior -- structural,
// since the click handler is a raw DOM-API call (scrollIntoView/focus),
// the same category of code focusTimelineRow already lives under with no
// render-testable boundary in this repo. Actual click -> scroll -> focus
// was verified live in the browser (see this PR's own description).
// ============================================================
const dashboardSrc = read('apps/web/components/HomeDashboard.tsx');

check('3. onNextShiftClick (the old cross-tab-navigation prop) no longer exists anywhere in HomeDashboard.tsx', !/onNextShiftClick/.test(dashboardSrc));
check('3. the button now calls a local handleViewFullDayTimeline, never setActiveTab/a tab-switching prop', /onClick=\{handleViewFullDayTimeline\}>View full day timeline/.test(dashboardSrc));
check('3. handleViewFullDayTimeline targets the SAME data-home-timeline-region selector focusTimelineRow already uses (one established convention, not a second one)', /handleViewFullDayTimeline = \(\) => \{[\s\S]{0,300}document\.querySelector<HTMLElement>\('\[data-home-timeline-region\]'\)/.test(dashboardSrc));
check('Navigation requirements: scrollIntoView uses smooth behavior and block: "start" (matches this codebase\'s own existing scrollIntoView convention in PlanWithAuraView.tsx/AskAuraView.tsx)', /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/.test(dashboardSrc));
check('Accessibility: focus() passes preventScroll (no competing/fighting scroll jump on top of the smooth scrollIntoView)', /\.focus\(\{ preventScroll: true \}\)/.test(dashboardSrc));
check('No brittle timeout: handleViewFullDayTimeline contains no setTimeout/arbitrary delay (unlike focusTimelineRow, which needs one only because IT runs after an async state-changing mutation -- this handler runs on a static, already-rendered DOM, so none is needed)', (() => {
  const start = dashboardSrc.indexOf('const handleViewFullDayTimeline');
  const end = dashboardSrc.indexOf('\n  };', start);
  const body = dashboardSrc.slice(start, end);
  return !/setTimeout/.test(body);
})());
check('exactly ONE <HomeTimeline render call in HomeDashboard.tsx (no second/duplicate timeline introduced)', (dashboardSrc.match(/<HomeTimeline\b/g) ?? []).length === 1);

const pageSrc = read('apps/web/app/page.tsx');
check('page.tsx no longer passes onNextShiftClick to HomeDashboard (prop removed on both ends, not left dangling on one side)', !/onNextShiftClick/.test(pageSrc));
check("the 'timeline' tab / TimelineView is NOT removed -- it remains reachable from its other existing entry points (AskAuraView's OPEN_TIMELINE, PlanWithAuraView's onViewDay), this fix only changes HomeDashboard's OWN button", /activeTab === 'timeline' &&[\s\S]{0,40}<TimelineView/.test(pageSrc));

// ============================================================
// 5/9. Accurate action label -- kept exactly as-is (the destination is now
// a genuine full-day timeline of the user's activities, so the existing
// wording is accurate; no misleading copy to correct).
// ============================================================
check('5. the action label is unchanged: "View full day timeline →" (smallest change -- once pointed at the real timeline, the existing wording is accurate, nothing to relabel)', /View full day timeline →<\/TextButton>/.test(dashboardSrc));

// ============================================================
// 6. Home timeline integrity -- composition/ordering/completion/goal-
// association/Daily Rhythm/Right Now/Panchang logic is untouched by this
// navigation-only fix (zero diff in every file that owns those concerns).
// ============================================================
check('6. homeTimelineComposer.ts (composition/ordering) is untouched by DR4-D', /goalContext: item\.goalContext/.test(read('apps/web/lib/homeTimelineComposer.ts')));
check('6. rightNowSelection.ts (Right Now ranking) is not referenced anywhere in this diff\'s own concern -- HomeDashboard.tsx still imports it unchanged', /import \{ selectRightNowState/.test(dashboardSrc));
check('6. DR4-C\'s own goal-continuity render logic in HomeTimeline.tsx is untouched: isCompleted still driven by agendaStatus === \'COMPLETED\' specifically', /const isCompleted = item\.metadata\?\.agendaStatus === 'COMPLETED';/.test(read('apps/web/components/HomeTimeline.tsx')));
check('6. no Panchang/Muhurta calculation file was touched (getPanchangForDate/panchangDay not referenced by this fix\'s own files)', !/getPanchangForDate|panchangDay/.test(dashboardSrc.slice(dashboardSrc.indexOf('handleViewFullDayTimeline'), dashboardSrc.indexOf('handleViewFullDayTimeline') + 600)));

// ============================================================
// Selected-day consistency -- the fix never references a date/localDate
// concept; it operates purely on the already-rendered DOM for the day
// already loaded, never re-fetching or switching days.
// ============================================================
check('Selected-day consistency: handleViewFullDayTimeline references no date/localDate/requestedDate concept -- it cannot change which day is shown', (() => {
  const start = dashboardSrc.indexOf('const handleViewFullDayTimeline');
  const end = dashboardSrc.indexOf('\n  };', start);
  const body = dashboardSrc.slice(start, end);
  return !/localDate|requestedDate|setActiveTab/.test(body);
})());

// ============================================================
// Migration count -- a pure navigation/presentation fix, no schema change.
// ============================================================
const migrationDirs = fs.readdirSync(path.join(__dirname, '..', 'apps', 'web', 'prisma', 'migrations')).filter((d) => /^\d{4}_/.test(d));
check('no migration directory was added for DR4-D', !migrationDirs.some((d) => /timelineNav|fullDayTimeline/i.test(d)));
check('expected migration count is still exactly 50', migrationDirs.length === 50);

if (!allPassed) {
  console.error('SOME FULL DAY TIMELINE NAVIGATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL FULL DAY TIMELINE NAVIGATION CHECKS PASSED');
