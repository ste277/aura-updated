/**
 * Goal Continuity on Home V1 (DR4-C) -- this ticket's own dedicated guards.
 *
 * Root cause (confirmed before implementation, per the ticket's own
 * requirement): the goal-association data (`PlanGoalContext`) has always
 * survived end-to-end -- db.ts's loadGoalContextsForPlanIds (status-agnostic)
 * -> dailyAgenda.ts's planToAgendaItem (unconditional passthrough) ->
 * myDayOrchestrator.ts's buildMyDay (queried over ALL of today's plans,
 * including COMPLETED/LOGGED -- listPlannedActivitiesForDay only excludes
 * CANCELLED) -> homeTimelineComposer.ts's projectAgendaItem (unconditional
 * passthrough into HomeTimelineItem.metadata.goalContext, set alongside
 * metadata.isCompleted with zero status gating). The ONLY break was at the
 * final render step: HomeTimeline.tsx's own TimelineRow (the ordinary,
 * always-rendered "Your Day" row for every lifecycle state) never read
 * metadata.goalContext at all -- only the Right Now spotlight
 * (HomeDashboard.tsx) did, and that spotlight structurally excludes
 * completed/missed/skipped/moved items (rightNowSelection.ts's own
 * isResolved()). Category: "association present but not rendered."
 *
 * This file mixes:
 *   (a) real behavioral regression against buildHomeTimeline() (the actual
 *       composer, imported, not reimplemented) proving goalContext survives
 *       projection for EVERY DailyAgendaItemStatus, and
 *   (b) source-structural assertions on HomeTimeline.tsx's own JSX (this
 *       repository has no component-rendering harness for a plain .tsx
 *       file -- same established convention as
 *       test/rightNowGoalContext.test.ts/goalsUiWiring.test.ts).
 */
import * as fs from 'fs';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import type { DailyAgenda, DailyAgendaItem, DailyAgendaItemStatus } from '../apps/web/lib/dailyAgenda';
import type { PlanGoalContext } from '../apps/web/lib/db';
import type { HomeTimelineItem } from '../apps/web/lib/homeTimelineTypes';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function goalContext(overrides: Partial<PlanGoalContext> = {}): PlanGoalContext {
  return {
    goal: { id: 'goal-1', title: 'Get fitter' },
    goalActivity: { id: 'ga-1', completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } },
    currentValue: 12,
    ...overrides,
  };
}

function planItem(overrides: Partial<DailyAgendaItem> = {}): DailyAgendaItem {
  return {
    id: 'plan:a',
    type: 'PLAN',
    title: 'Go for a run',
    startAt: '2026-08-24T05:00:00.000Z',
    endAt: '2026-08-24T05:30:00.000Z',
    status: 'UPCOMING',
    target: { type: 'PLAN', id: 'plan:a' },
    ...overrides,
  };
}

function agendaOf(items: DailyAgendaItem[]): DailyAgenda {
  return { localDate: '2026-08-24', timezone: 'UTC', items, completedCount: 0, plannedCount: items.length };
}

function projectOne(status: DailyAgendaItemStatus, withGoal: boolean): HomeTimelineItem {
  const items = buildHomeTimeline({
    agenda: agendaOf([planItem({ status, goalContext: withGoal ? goalContext() : undefined })]),
    currentMinuteOfDay: 300,
    timezone: 'UTC',
  });
  const item = items.find((i) => i.id === 'plan:a');
  if (!item) throw new Error('expected plan:a to be present in the composed timeline');
  return item;
}

// ============================================================
// 1-3. Goal association survives real composer projection for every
// lifecycle state (before completion, after completion, and every other
// resolved/unresolved state the ticket lists) -- never dropped by status.
// ============================================================
const statusesToCheck: DailyAgendaItemStatus[] = ['UPCOMING', 'STARTING_SOON', 'CURRENT', 'WAITING', 'CONFIRMED', 'COMPLETED', 'MISSED', 'SKIPPED', 'MOVED'];
for (const status of statusesToCheck) {
  const projected = projectOne(status, true);
  check(`1-3. buildHomeTimeline() retains metadata.goalContext for status=${status} (association present-not-rendered is a render-layer bug only, never a projection-layer one)`, projected.metadata?.goalContext?.goal.title === 'Get fitter');
}

// ============================================================
// 4-5. isCompleted mirrors status === 'COMPLETED' only -- goalContext
// presence/absence never affects it, and an ungoaled activity is
// completely unaffected (no goalContext key fabricated).
// ============================================================
{
  const completedWithGoal = projectOne('COMPLETED', true);
  check("4. metadata.isCompleted is true for a COMPLETED, goal-linked item", completedWithGoal.metadata?.isCompleted === true);
  const upcomingWithGoal = projectOne('UPCOMING', false ? true : true);
  check("4. metadata.isCompleted is false for an UPCOMING, goal-linked item", upcomingWithGoal.metadata?.isCompleted === false);
}
{
  const ungoaled = projectOne('COMPLETED', false);
  check('5. an ungoaled COMPLETED item has NO goalContext key at all (never fabricated, never null-valued)', !('goalContext' in (ungoaled.metadata ?? {})));
  const ungoaledUpcoming = projectOne('UPCOMING', false);
  check('5. an ungoaled UPCOMING item has NO goalContext key at all', !('goalContext' in (ungoaledUpcoming.metadata ?? {})));
}

// ============================================================
// 6. Multiple goal-linked items in the same timeline each keep their OWN
// goal's title -- no cross-contamination between items.
// ============================================================
{
  const items = buildHomeTimeline({
    agenda: agendaOf([
      planItem({ id: 'plan:run', title: 'Go for a run', status: 'COMPLETED', target: { type: 'PLAN', id: 'plan:run' }, goalContext: goalContext({ goal: { id: 'goal-1', title: 'Get fitter' } }) }),
      planItem({ id: 'plan:read', title: 'Read', status: 'UPCOMING', startAt: '2026-08-24T06:00:00.000Z', endAt: '2026-08-24T06:30:00.000Z', target: { type: 'PLAN', id: 'plan:read' }, goalContext: goalContext({ goal: { id: 'goal-2', title: 'Read more' } }) }),
    ]),
    currentMinuteOfDay: 300,
    timezone: 'UTC',
  });
  const run = items.find((i) => i.id === 'plan:run');
  const read = items.find((i) => i.id === 'plan:read');
  check("6. two different goal-linked items each retain their OWN goal's title, not the other's", run?.metadata?.goalContext?.goal.title === 'Get fitter' && read?.metadata?.goalContext?.goal.title === 'Read more');
}

// ============================================================
// 7. Existing timeline composition (ordering, status mapping, current/past
// classification) is completely unaffected by goalContext's presence --
// identical candidate set with and without it produces the same order/ids.
// ============================================================
{
  const base = [
    planItem({ id: 'plan:first', title: 'First', status: 'UPCOMING', startAt: '2026-08-24T05:00:00.000Z', endAt: '2026-08-24T05:30:00.000Z', target: { type: 'PLAN', id: 'plan:first' } }),
    planItem({ id: 'plan:second', title: 'Second', status: 'UPCOMING', startAt: '2026-08-24T06:00:00.000Z', endAt: '2026-08-24T06:30:00.000Z', target: { type: 'PLAN', id: 'plan:second' } }),
  ];
  const withoutGoal = buildHomeTimeline({ agenda: agendaOf(base), currentMinuteOfDay: 300, timezone: 'UTC' });
  const withGoalOnSecond = buildHomeTimeline({
    agenda: agendaOf([base[0], { ...base[1], goalContext: goalContext() }]),
    currentMinuteOfDay: 300,
    timezone: 'UTC',
  });
  check('7. item order (ids, in sequence) is identical whether or not an item carries goalContext', JSON.stringify(withoutGoal.map((i) => i.id)) === JSON.stringify(withGoalOnSecond.map((i) => i.id)));
}

// ============================================================
// Source-structural assertions on HomeTimeline.tsx
// ============================================================
const src = fs.readFileSync('apps/web/components/HomeTimeline.tsx', 'utf8');

check('8. HomeTimeline.tsx conditionally renders the goal line on `goalContext` truthiness (absent goalContext -> nothing rendered, never a placeholder)', /\{goalContext && \(/.test(src));
check('8. the rendered text is exactly "Supports {title}" normally and "Completed · Supports {title}" when completed -- no third/other wording', /isCompleted \? `Completed · Supports \$\{goalContext\.goal\.title\}` : `Supports \$\{goalContext\.goal\.title\}`/.test(src));
check("9. the completion prefix is driven by agendaStatus === 'COMPLETED' specifically (SKIPPED/MISSED/MOVED still show plain \"Supports X\", never silently suppressed nor mislabeled 'Completed')", /const isCompleted = item\.metadata\?\.agendaStatus === 'COMPLETED';/.test(src));
check('10. goalContext is read via item.metadata?.goalContext -- pure passthrough, never re-derived/re-queried/re-fetched in this component', /const goalContext = item\.metadata\?\.goalContext;/.test(src));
check('11. the goal line reads ONLY goalContext.goal.title (identity only) -- no currentValue/completionRequirement/execution-internal field ever reaches this component', !/goalContext\.(currentValue|goalActivity|completionRequirement)/.test(src));
check('12. no new fetch/network call was added to HomeTimeline.tsx for Goal progress -- this remains a pure presentation component', !/fetch\(/.test(src));
check('13. no new StatusBadge/card/duplicate-title element was introduced for the goal line -- it is a single plain text-bearing <div>, not a badge/button/card', !/<StatusBadge[^>]*Supports|<PrimaryButton[^>]*Supports|<TextButton[^>]*Supports/.test(src));
check('14. the goal line sits after the duration/status/Why row and before the recovery slot (secondary placement, never ahead of title/status)', (() => {
  const statusRowIdx = src.indexOf("item.status && <StatusBadge");
  const goalLineIdx = src.indexOf('{goalContext && (');
  const recoveryIdx = src.indexOf('{recovery && <div');
  return statusRowIdx !== -1 && goalLineIdx !== -1 && recoveryIdx !== -1 && statusRowIdx < goalLineIdx && goalLineIdx < recoveryIdx;
})());
check('15. no new sort/filter/reorder was added to the items rendering path -- `items` is still only ever `.map`-ed, matching this file\'s own MERGE-CRITICAL ordering contract', !/items\.sort\(|items\.filter\(|items\.reverse\(/.test(src));
check('16. the goal line uses caption-sized, muted typography (typography.caption / colors.textMuted) -- no new font size/weight scale introduced, no large height increase', /\{goalContext && \([\s\S]{0,200}typography\.caption[\s\S]{0,80}colors\.textMuted/.test(src));

// ============================================================
// 17. No migration was added -- this is a pure read-model projection and
// rendering fix over EXISTING data/types, never a new persisted concept.
// ============================================================
const migrationDirs = fs.readdirSync('apps/web/prisma/migrations').filter((d) => /^\d{4}_/.test(d));
check('17. no migration directory was added for DR4-C (count-independent: holds regardless of how many unrelated migrations exist)', !migrationDirs.some((d) => /goalContinuity|homeTimelineGoal/i.test(d)));
check('17. expected migration count is still exactly 50', migrationDirs.length === 50);

// ============================================================
// 18. homeTimelineComposer.ts / dailyAgenda.ts / db.ts were not modified by
// DR4-C -- the fix is confined to the render layer (HomeTimeline.tsx) plus
// its own test guards, never the data pipeline itself.
// ============================================================
check('18. homeTimelineComposer.ts\'s projectAgendaItem still passes goalContext through verbatim (item.goalContext), never re-derives it -- unchanged by DR4-C', /\.\.\.\(item\.goalContext \? \{ goalContext: item\.goalContext \} : \{\}\)/.test(fs.readFileSync('apps/web/lib/homeTimelineComposer.ts', 'utf8')));
check('18. dailyAgenda.ts still spreads goalContext unconditionally (never status-gated) -- unchanged by DR4-C', /\.\.\.\(goalContext \? \{ goalContext \} : \{\}\)/.test(fs.readFileSync('apps/web/lib/dailyAgenda.ts', 'utf8')));

if (!allPassed) {
  console.error('SOME HOME TIMELINE GOAL CONTEXT CHECKS FAILED');
  process.exit(1);
}
console.log('ALL HOME TIMELINE GOAL CONTEXT CHECKS PASSED');
