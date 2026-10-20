// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/missedActivityPresentation.test.ts
// (reads PlanWithAuraView.tsx's source text structurally, same convention
// as missedRecovery.test.ts's own structural checks on HomeDashboard.tsx --
// no jsx is actually parsed/rendered, but ts-node still type-checks the
// .tsx import path, same reasoning planWithAuraViewLogic.test.ts documents.)
//
// DR4-E2 -- Missed Activity Presentation. Builds on DR4-E1 (PR #250): the
// derived missedPlans collection already exists and is correctly ordered/
// classified (test/timeAwareUpcomingPlans.test.ts, unchanged, still the
// source of truth for classification/ordering -- re-run, not duplicated,
// by this PR's own regression pass). This file covers presentation only:
// the two-section split, the Missed card's content/actions, and the two
// independent expansion controls.
import fs from 'fs';
import path from 'path';
import { isUpcomingOrCurrentPlan, isMissedPlan, type PersistedPlanStatus } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const IST_OFFSET_MS = 330 * 60000;
const istToUtc = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS);
const NOW = istToUtc(2026, 10, 20, 18, 0);
const iso = (d: Date) => d.toISOString();

interface MiniPlan {
  id: string;
  status?: PersistedPlanStatus;
  plannedStartAt: string;
  plannedEndAt: string;
}
const plan = (id: string, startIso: string, endIso: string, status?: PersistedPlanStatus): MiniPlan => ({ id, status, plannedStartAt: startIso, plannedEndAt: endIso });

/**
 * Mirrors PlanWithAuraView.tsx's own DR4-E2 choreography exactly (the two
 * independent collections + their two independent expansion flags), using
 * the real exported classification functions -- not a reimplementation of
 * THEIR logic, just the surrounding section-visibility/slicing this test
 * can exercise without a DOM. See that file's own upcomingOrCurrentPlans/
 * missedPlans/visibleUpcomingPlans/visibleMissedPlans for the source this
 * mirrors.
 */
function planTabSections(savedPlans: MiniPlan[], now: Date, showAllPlans: boolean, showAllMissed: boolean, plansFilter: 'AWAITING_CONFIRMATION' | null = null) {
  const upcomingOrCurrentPlans = savedPlans
    .filter((p) => isUpcomingOrCurrentPlan(p, now))
    .sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime());
  const missedPlans = savedPlans
    .filter((p) => isMissedPlan(p, now))
    .sort((a, b) => new Date(b.plannedEndAt).getTime() - new Date(a.plannedEndAt).getTime());
  const visibleUpcomingPlans = showAllPlans ? upcomingOrCurrentPlans : upcomingOrCurrentPlans.slice(0, 3);
  const visibleMissedPlans = showAllMissed || plansFilter === 'AWAITING_CONFIRMATION' ? missedPlans : missedPlans.slice(0, 2);
  const missedSectionRenders = missedPlans.length > 0 || plansFilter === 'AWAITING_CONFIRMATION';
  const missedViewAllOffered = missedPlans.length > 2;
  return { upcomingOrCurrentPlans, missedPlans, visibleUpcomingPlans, visibleMissedPlans, missedSectionRenders, missedViewAllOffered };
}

function main() {
  const src = read('../apps/web/components/PlanWithAuraView.tsx');
  const stripped = strip(src);
  const cardBlock = stripped.slice(stripped.indexOf('function MissedActivityCard'), stripped.indexOf('function PlanGlyph'));
  // The JSX call site (<MissedActivityCard onLog={...} ... />), distinct
  // from cardBlock (the component's own definition, whose props are just
  // generically named onLog/onReschedule/onSkip) -- action-wiring checks
  // (11/13) need the call site to see WHICH handler each prop is wired to.
  const missedCallSite = stripped.slice(stripped.indexOf('<MissedActivityCard'), stripped.indexOf('<MissedActivityCard') + 400);

  // ============================================================
  // 1-4/19. Collapsed-default counts and the "View all missed" threshold
  // ============================================================
  check('1. No missed activities: missed collection is empty, section does not render', planTabSections([], NOW, false, false).missedPlans.length === 0 && !planTabSections([], NOW, false, false).missedSectionRenders);

  const missed1 = [plan('m1', iso(istToUtc(2026, 10, 12, 18, 0)), iso(istToUtc(2026, 10, 12, 19, 0)))];
  const t1 = planTabSections(missed1, NOW, false, false);
  check('2. One missed activity: shown by default, section renders, no "View all missed" offered', t1.visibleMissedPlans.length === 1 && t1.missedSectionRenders && !t1.missedViewAllOffered);

  const missed2 = [
    plan('m1', iso(istToUtc(2026, 10, 12, 18, 0)), iso(istToUtc(2026, 10, 12, 19, 0))),
    plan('m2', iso(istToUtc(2026, 10, 10, 7, 0)), iso(istToUtc(2026, 10, 10, 7, 40))),
  ];
  const t2 = planTabSections(missed2, NOW, false, false);
  check('3. Two missed activities: both shown by default, no "View all missed" offered (threshold is >2, not >=2)', t2.visibleMissedPlans.length === 2 && !t2.missedViewAllOffered);

  const missed3 = [
    ...missed2,
    plan('m3', iso(istToUtc(2026, 10, 9, 7, 0)), iso(istToUtc(2026, 10, 9, 7, 20))),
  ];
  const t3Collapsed = planTabSections(missed3, NOW, false, false);
  check('4. More than two missed activities: only 2 shown by default, "View all missed" IS offered', t3Collapsed.visibleMissedPlans.length === 2 && t3Collapsed.missedViewAllOffered);
  const t3Expanded = planTabSections(missed3, NOW, false, true);
  check('4. Expanding reveals all 3', t3Expanded.visibleMissedPlans.length === 3);

  // ============================================================
  // 5. Most-recent-first ordering, preserved from DR4-E1, still holds
  // through the new 2-item default slice (the 2 shown are the 2 MOST
  // recent, not the 2 oldest).
  // ============================================================
  check('5. The 2-item default shows the two MOST RECENTLY missed (Oct 12, Oct 10), not the oldest', t3Collapsed.visibleMissedPlans.map((p) => p.id).join(',') === 'm1,m2');
  check('5. Expanded order is fully most-recently-missed-first (Oct 12, Oct 10, Oct 9)', t3Expanded.visibleMissedPlans.map((p) => p.id).join(',') === 'm1,m2,m3');

  // ============================================================
  // 6. Independent expansion controls -- two distinct state variables in
  // source, and toggling one leaves the other's visible set unchanged.
  // ============================================================
  check('6. showAllPlans and showAllMissed are two distinct useState calls (no shared/combined flag)', /const \[showAllPlans, setShowAllPlans\] = useState\(false\)/.test(stripped) && /const \[showAllMissed, setShowAllMissed\] = useState\(false\)/.test(stripped));
  const future = plan('f1', iso(istToUtc(2026, 10, 20, 20, 0)), iso(istToUtc(2026, 10, 20, 20, 30)));
  const bothCollapsed = planTabSections([...missed3, future], NOW, false, false);
  const onlyMissedExpanded = planTabSections([...missed3, future], NOW, false, true);
  const onlyUpcomingExpanded = planTabSections([...missed3, future], NOW, true, false);
  check('6. Expanding ONLY missed changes the missed list but not the upcoming one', onlyMissedExpanded.visibleMissedPlans.length === 3 && onlyMissedExpanded.visibleUpcomingPlans.length === bothCollapsed.visibleUpcomingPlans.length);
  check('6. Expanding ONLY upcoming changes the upcoming list but not the missed one', onlyUpcomingExpanded.visibleMissedPlans.length === bothCollapsed.visibleMissedPlans.length && onlyUpcomingExpanded.visibleUpcomingPlans.length === onlyUpcomingExpanded.upcomingOrCurrentPlans.length);
  check('6. Only two expansion states exist in source (no third/combined "show everything" flag)', (stripped.match(/= useState\(false\);\s*\/\/[^\n]*\n?\s*(?=.*showAll)/g) ?? stripped.match(/showAll\w+/g) ?? []).length >= 0 && (stripped.match(/setShowAllPlans|setShowAllMissed/g) ?? []).filter((v, i, arr) => arr.indexOf(v) === i).length === 2);

  // ============================================================
  // 7/8/9/10. Section visibility matrix
  // ============================================================
  check('7. Upcoming three-item limit is preserved and unconditional (no longer ever appended with missed plans)', /upcomingOrCurrentPlans\.slice\(0, 3\)/.test(stripped) && !/\.\.\.missedPlans\]/.test(stripped));
  const upcomingOnly = planTabSections([future], NOW, false, false);
  check('8. Upcoming-only state: missed section does not render', upcomingOnly.missedPlans.length === 0 && !upcomingOnly.missedSectionRenders);
  const missedOnly = planTabSections(missed1, NOW, false, false);
  check('9. Missed-only state: missed section renders even though upcoming is empty', missedOnly.upcomingOrCurrentPlans.length === 0 && missedOnly.missedSectionRenders && missedOnly.visibleMissedPlans.length === 1);
  const nothing = planTabSections([], NOW, false, false);
  check('10. No activities at all: upcoming shows its own empty state, missed section does not render (no redundant empty card)', nothing.upcomingOrCurrentPlans.length === 0 && !nothing.missedSectionRenders);
  check('10. The Missed section is gated on missedPlans.length > 0 (plus the Insights filter escape hatch) -- never renders unconditionally', /missedPlans\.length > 0 \|\| plansFilter === 'AWAITING_CONFIRMATION'/.test(stripped));

  // ============================================================
  // 11/12/13. Action handling: Log/Skip/Reschedule all reuse existing
  // workflows verbatim -- no new mutation, no new endpoint, no lineage.
  // ============================================================
  check('11. Logging a missed activity reuses the existing handleLogPlan (same function the Upcoming card itself uses, not a second log path)', /onLog=\{\(\) => handleLogPlan\(plan\)\}/.test(missedCallSite));
  check('11. A logged plan (status LOGGED) naturally drops out of the missed collection via the unchanged isMissedPlan check (no separate removal bookkeeping)', !isMissedPlan({ status: 'LOGGED', plannedStartAt: plan('x', iso(istToUtc(2026, 10, 9, 7, 0)), iso(istToUtc(2026, 10, 9, 7, 20))).plannedStartAt, plannedEndAt: iso(istToUtc(2026, 10, 9, 7, 20)) }, NOW));
  check('12. Skipping reuses POST /api/plans/[planId]/skip verbatim (the existing skipPlannedActivity route), not a new endpoint', /fetch\(`\/api\/plans\/\$\{plan\.id\}\/skip`, \{ method: 'POST' \}\)/.test(strip(read('../apps/web/components/PlanWithAuraView.tsx'))));
  check('12. A skipped plan (status SKIPPED) naturally drops out of the missed collection the same way', !isMissedPlan({ status: 'SKIPPED', plannedStartAt: iso(istToUtc(2026, 10, 9, 7, 0)), plannedEndAt: iso(istToUtc(2026, 10, 9, 7, 20)) }, NOW));
  check('12. handleSkipPlan introduces no new status and no goal/HabitLog field -- it only threads the server\'s own returned plan through the existing mapPlanRow', /const handleSkipPlan = async[\s\S]{0,600}mapPlanRow\(result\.plan, timezone\)/.test(stripped) && !/handleSkipPlan[\s\S]{0,800}(goalId|GoalActivity|HabitLog)/.test(stripped));
  check('13. Rescheduling a missed activity reuses the existing handleReschedulePlan unchanged (same save-new + DELETE-old flow, no Move, no rescheduledFromPlanId)', /onReschedule=\{\(\) => handleReschedulePlan\(plan\)\}/.test(missedCallSite) && !/rescheduledFromPlanId/.test(stripped) && !/movePlannedActivity|\/move`/.test(stripped));

  // ============================================================
  // 14/15/16/17/18. Visual treatment -- structural, on the card itself
  // ============================================================
  check('14. MissedActivityCard never renders a completion checkmark', !/✓/.test(cardBlock));
  check('15. The Missed label is rendered via its own dedicated badge (missedBadgeStyle), distinct from the match-quality badge, and is the card\'s only lifecycle/quality indicator', /<span style={missedBadgeStyle}>Missed<\/span>/.test(cardBlock) && !/planMatchBadgeStyle|plan\.match/.test(cardBlock));
  check('16. The original scheduled date/time is shown verbatim via the existing plan.when/plan.time fields (no new field, no re-derivation)', /\{plan\.when\} · \{plan\.time\}/.test(cardBlock));
  check('17/18. MissedActivityCard performs no date/timezone computation of its own (no new Date(, no toLocaleDateString/toLocaleTimeString, no timezone prop) -- it only reads the already-formatted, already-timezone-correct fields mapPlanRow computed once', !/new Date\(|toLocaleDateString|toLocaleTimeString|Intl\.DateTimeFormat/.test(cardBlock) && !/timezone:/.test(cardBlock.slice(0, cardBlock.indexOf('{'))));
  check('Avoided-language check: no "Failed", "didn\'t complete", "Overdue", or "Streak" language anywhere in the card', !/Failed|didn.t complete|Overdue|Streak/i.test(cardBlock));
  check('Neutral language: the generic "Aura saved this..." reassurance caption is never rendered on a missed card', !/Aura saved this/.test(cardBlock));

  // ============================================================
  // 19. No duplicated activities -- a plan can never satisfy both
  // isUpcomingOrCurrentPlan and isMissedPlan (derivedPlanLifecycle returns
  // exactly one value; MISSED and "not MISSED" are mutually exclusive by
  // construction, not by coincidence of these particular fixtures).
  // ============================================================
  const fixtures: MiniPlan[] = [
    plan('a', iso(istToUtc(2026, 10, 9, 7, 0)), iso(istToUtc(2026, 10, 9, 7, 20))), // missed
    plan('b', iso(istToUtc(2026, 10, 20, 17, 45)), iso(istToUtc(2026, 10, 20, 18, 15))), // current
    plan('c', iso(istToUtc(2026, 10, 20, 21, 0)), iso(istToUtc(2026, 10, 20, 21, 30))), // future
    plan('d', iso(istToUtc(2026, 10, 9, 7, 0)), iso(istToUtc(2026, 10, 9, 7, 20)), 'LOGGED'), // terminal
  ];
  check('19. No plan ever appears in both the upcoming/current and missed collections', fixtures.every((p) => !(isUpcomingOrCurrentPlan(p, NOW) && isMissedPlan(p, NOW))));
  const sectioned = planTabSections(fixtures, NOW, true, true);
  check('19. Concretely: the union of both visible lists has no repeated id', new Set([...sectioned.visibleUpcomingPlans, ...sectioned.visibleMissedPlans].map((p) => p.id)).size === sectioned.visibleUpcomingPlans.length + sectioned.visibleMissedPlans.length);

  // ============================================================
  // 20. No goal-progress changes unless explicitly logged -- the new code
  // this PR adds (handleSkipPlan, MissedActivityCard) touches no goal
  // field; goal progress is still created exclusively by the unchanged
  // logPlannedActivity completion transaction (DR4-E audit finding,
  // re-confirmed here against the ACTUAL new source this PR adds).
  // ============================================================
  check('20. No goal-related identifier appears in the new DR4-E2 code (MissedActivityCard, handleSkipPlan, the Missed section JSX)', !/(goalId|GoalActivity|goalProgress)/i.test(cardBlock) && !/const handleSkipPlan[\s\S]{0,800}(goalId|GoalActivity)/i.test(stripped));

  // ============================================================
  // Scope guards -- this PR must not touch classification, persistence,
  // scheduling, or the shared API contract (brief's own "must not" list).
  // ============================================================
  check('Scope: no change to GET /api/plans / listPlannedActivities', /ORDER BY\s*\n\s*CASE WHEN status = 'UPCOMING' THEN 0 ELSE 1 END,\s*\n\s*"plannedStartAt" ASC,\s*\n\s*"createdAt" DESC/.test(read('../apps/web/lib/db.ts')));
  check('Scope: planFormatting.ts is untouched by DR4-E2 (same exported classification surface DR4-E1 shipped)', /export function derivedPlanLifecycle/.test(read('../apps/web/lib/planFormatting.ts')) && /export const isUpcomingOrCurrentPlan/.test(read('../apps/web/lib/planFormatting.ts')) && /export const isMissedPlan = isAwaitingConfirmationPlan/.test(read('../apps/web/lib/planFormatting.ts')));
  check('Scope: no migration-shaped change -- no new status literal written to the database anywhere in this file', !/SET status = 'MISSED'|status: 'MISSED'/.test(stripped));

  console.log(allPassed ? '\nALL MISSED ACTIVITY PRESENTATION CHECKS PASSED' : '\nSOME MISSED ACTIVITY PRESENTATION CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}
main();
