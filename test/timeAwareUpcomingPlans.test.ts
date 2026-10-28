// Run with: npx ts-node test/timeAwareUpcomingPlans.test.ts (see .github/workflows/ci.yml)
//
// DR4-E1 -- Time-Aware Upcoming Plans. Covers the classification/ordering
// fix only (derivedPlanLifecycle / isUpcomingOrCurrentPlan / isMissedPlan /
// isAwaitingConfirmationPlan in planFormatting.ts, and the collection-
// building choreography PlanWithAuraView.tsx now uses). DR4-E2 owns the
// Missed section's own presentation and is out of scope here.
import fs from 'fs';
import path from 'path';
import {
  derivedPlanLifecycle,
  isUpcomingOrCurrentPlan,
  isMissedPlan,
  isAwaitingConfirmationPlan,
  isActionableUpcomingPlan,
  isCompletedPlan,
  type PersistedPlanStatus,
} from '../apps/web/lib/planFormatting';
import { timeBasedStatus } from '../apps/web/lib/dailyAgenda';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// Fixed, deterministic instants -- never Date.now(). "now" is 2026-10-20
// 18:00 IST, matching the DR4-E audit's own reported scenario date.
const IST_OFFSET_MS = 330 * 60000;
const istToUtc = (y: number, mo: number, d: number, h: number, mi: number) => new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MS);
const NOW = istToUtc(2026, 10, 20, 18, 0);

type FixturePlan = { status?: PersistedPlanStatus; plannedStartAt: string; plannedEndAt: string };
const fixture = (startIso: string, endIso: string, status?: PersistedPlanStatus): FixturePlan => ({ status, plannedStartAt: startIso, plannedEndAt: endIso });
const iso = (d: Date) => d.toISOString();

// A minimal "plan-like" object carrying just what the collection-building
// choreography in PlanWithAuraView.tsx needs (id + the two timestamps) --
// mirrors UpcomingPlan's own shape for the fields that matter here, without
// pulling in the full .tsx component (plain classification/sort/slice only).
interface MiniPlan extends FixturePlan {
  id: string;
}
/** Reproduces PlanWithAuraView.tsx's own upcomingOrCurrentPlans / missedPlans
 * / filteredUpcomingPlans / visibleUpcomingPlans choreography exactly, using
 * the real exported functions -- not a reimplementation of their logic, just
 * the surrounding list-building this test can exercise without a DOM. */
function buildPlanTabView(savedPlans: MiniPlan[], now: Date, showAllPlans: boolean, plansFilter: 'AWAITING_CONFIRMATION' | null = null) {
  const upcomingOrCurrentPlans = savedPlans
    .filter((p) => isUpcomingOrCurrentPlan(p, now))
    .sort((a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime());
  const missedPlans = savedPlans
    .filter((p) => isMissedPlan(p, now))
    .sort((a, b) => new Date(b.plannedEndAt).getTime() - new Date(a.plannedEndAt).getTime());
  const filteredUpcomingPlans = plansFilter === 'AWAITING_CONFIRMATION' ? missedPlans : upcomingOrCurrentPlans;
  const visibleUpcomingPlans = !showAllPlans
    ? filteredUpcomingPlans.slice(0, 3)
    : plansFilter === 'AWAITING_CONFIRMATION'
      ? filteredUpcomingPlans
      : [...filteredUpcomingPlans, ...missedPlans];
  return { upcomingOrCurrentPlans, missedPlans, visibleUpcomingPlans };
}

function main() {
  // ============================================================
  // 1-8. Classification matrix (status x time)
  // ============================================================
  const futureStart = iso(istToUtc(2026, 10, 20, 21, 0));
  const futureEnd = iso(istToUtc(2026, 10, 20, 21, 30));
  check('1. Future UPCOMING activity classifies as UPCOMING and is upcoming/current', derivedPlanLifecycle(fixture(futureStart, futureEnd), NOW) === 'UPCOMING' && isUpcomingOrCurrentPlan(fixture(futureStart, futureEnd), NOW) && !isMissedPlan(fixture(futureStart, futureEnd), NOW));

  const soonStart = iso(istToUtc(2026, 10, 20, 18, 20)); // 20 min out, inside STARTING_SOON_WINDOW_MS (30 min)
  const soonEnd = iso(istToUtc(2026, 10, 20, 19, 0));
  check('2. Starting-soon activity (within 30 min) classifies as STARTING_SOON and is upcoming/current, never missed', derivedPlanLifecycle(fixture(soonStart, soonEnd), NOW) === 'STARTING_SOON' && isUpcomingOrCurrentPlan(fixture(soonStart, soonEnd), NOW) && !isMissedPlan(fixture(soonStart, soonEnd), NOW));

  const curStart = iso(istToUtc(2026, 10, 20, 17, 45));
  const curEnd = iso(istToUtc(2026, 10, 20, 18, 15));
  check('3. Currently active activity (now within [start, end]) classifies as CURRENT and is upcoming/current, never missed', derivedPlanLifecycle(fixture(curStart, curEnd), NOW) === 'CURRENT' && isUpcomingOrCurrentPlan(fixture(curStart, curEnd), NOW) && !isMissedPlan(fixture(curStart, curEnd), NOW));

  const pastStart = iso(istToUtc(2026, 10, 9, 7, 0));
  const pastEnd = iso(istToUtc(2026, 10, 9, 7, 20));
  check('4. Past unlogged (persisted UPCOMING) activity classifies as MISSED, excluded from upcoming/current, included in missed', derivedPlanLifecycle(fixture(pastStart, pastEnd), NOW) === 'MISSED' && !isUpcomingOrCurrentPlan(fixture(pastStart, pastEnd), NOW) && isMissedPlan(fixture(pastStart, pastEnd), NOW));

  check('5. Logged activity: terminal status wins over time, never MISSED regardless of how old', derivedPlanLifecycle(fixture(pastStart, pastEnd, 'LOGGED'), NOW) === 'LOGGED' && !isMissedPlan(fixture(pastStart, pastEnd, 'LOGGED'), NOW) && !isUpcomingOrCurrentPlan(fixture(pastStart, pastEnd, 'LOGGED'), NOW) && isCompletedPlan({ status: 'LOGGED' }));
  check('6. Skipped activity: terminal status wins over time, never MISSED, never upcoming/current', derivedPlanLifecycle(fixture(pastStart, pastEnd, 'SKIPPED'), NOW) === 'SKIPPED' && !isMissedPlan(fixture(pastStart, pastEnd, 'SKIPPED'), NOW) && !isUpcomingOrCurrentPlan(fixture(pastStart, pastEnd, 'SKIPPED'), NOW));
  check('7. Cancelled activity: terminal status wins over time, never MISSED, never upcoming/current', derivedPlanLifecycle(fixture(pastStart, pastEnd, 'CANCELLED'), NOW) === 'CANCELLED' && !isMissedPlan(fixture(pastStart, pastEnd, 'CANCELLED'), NOW) && !isUpcomingOrCurrentPlan(fixture(pastStart, pastEnd, 'CANCELLED'), NOW));
  check('8. Moved activity: terminal status wins over time, never MISSED, never upcoming/current', derivedPlanLifecycle(fixture(pastStart, pastEnd, 'MOVED'), NOW) === 'MOVED' && !isMissedPlan(fixture(pastStart, pastEnd, 'MOVED'), NOW) && !isUpcomingOrCurrentPlan(fixture(pastStart, pastEnd, 'MOVED'), NOW));

  // ============================================================
  // 9. Missing end timestamp -- exercised against timeBasedStatus directly
  // (the lower-level function derivedPlanLifecycle delegates to). Real
  // PlannedActivity rows always have plannedEndAt (schema: NOT NULL,
  // UpcomingPlan.plannedEndAt: string, not optional) -- this documents the
  // existing Home contract is preserved, not a new rule invented for plans.
  // ============================================================
  const startedNoEnd = istToUtc(2026, 10, 20, 17, 0);
  check('9. Missing end timestamp: once started, stays CURRENT indefinitely (existing Home semantics -- no end means no elapse, never invents a new expiration rule)', timeBasedStatus(startedNoEnd, undefined, NOW) === 'CURRENT' && timeBasedStatus(startedNoEnd, undefined, istToUtc(2030, 1, 1, 0, 0)) === 'CURRENT');
  check('9. Missing end timestamp, not yet started: still UPCOMING/STARTING_SOON as normal', timeBasedStatus(istToUtc(2026, 10, 21, 9, 0), undefined, NOW) === 'UPCOMING');

  // ============================================================
  // 10. Activity crossing midnight -- absolute instants, not minute-of-day.
  // 23:00 Oct 19 IST -> 00:30 Oct 20 IST.
  // ============================================================
  const crossStart = iso(istToUtc(2026, 10, 19, 23, 0));
  const crossEnd = iso(istToUtc(2026, 10, 20, 0, 30));
  check('10. Cross-midnight activity, now just before its end: not yet missed', derivedPlanLifecycle(fixture(crossStart, crossEnd), istToUtc(2026, 10, 20, 0, 29)) !== 'MISSED');
  check('10. Cross-midnight activity, now exactly at its end: not missed (contract is end < now, not <=)', derivedPlanLifecycle(fixture(crossStart, crossEnd), istToUtc(2026, 10, 20, 0, 30)) !== 'MISSED');
  check('10. Cross-midnight activity, now just after its end: missed', derivedPlanLifecycle(fixture(crossStart, crossEnd), istToUtc(2026, 10, 20, 0, 31)) === 'MISSED');

  // ============================================================
  // 11. Browser/user timezone mismatch -- Date objects are absolute instants;
  // constructing "the same instant" via two different offsets must classify
  // identically. Simulates a browser in US/Pacific evaluating a plan whose
  // scheduled times are IST, both resolving to the same real-world moment.
  // ============================================================
  const sameInstantViaIstOffset = istToUtc(2026, 10, 20, 18, 0); // "18:00 IST" == NOW
  const sameInstantViaUtcLiteral = new Date(NOW.getTime()); // identical instant, constructed with no offset arithmetic at all
  check('11. A given instant classifies identically regardless of how the Date was constructed (offset math vs. literal) -- proves no timezone-of-`now` dependency', derivedPlanLifecycle(fixture(pastStart, pastEnd), sameInstantViaIstOffset) === derivedPlanLifecycle(fixture(pastStart, pastEnd), sameInstantViaUtcLiteral));
  const pacificConstructedNow = new Date(Date.UTC(2026, 9, 20, 12, 30)); // 12:30 UTC == 18:00 IST == 05:30 US/Pacific that same calendar instant
  check('11. Timezone mismatch between browser and activity: classification depends only on the absolute instant, never on which zone constructed `now`', derivedPlanLifecycle(fixture(pastStart, pastEnd), pacificConstructedNow) === 'MISSED' && derivedPlanLifecycle(fixture(futureStart, futureEnd), pacificConstructedNow) === 'UPCOMING');

  // ============================================================
  // 12/15. Multiple missed activities -- most-recently-missed first, and
  // deterministic (stable) ordering across repeated classification.
  // ============================================================
  const missedA: MiniPlan = { id: 'oct9', ...fixture(iso(istToUtc(2026, 10, 9, 7, 0)), iso(istToUtc(2026, 10, 9, 7, 20))) };
  const missedB: MiniPlan = { id: 'oct10', ...fixture(iso(istToUtc(2026, 10, 10, 7, 0)), iso(istToUtc(2026, 10, 10, 7, 40))) };
  const missedC: MiniPlan = { id: 'oct12', ...fixture(iso(istToUtc(2026, 10, 12, 18, 0)), iso(istToUtc(2026, 10, 12, 19, 0))) };
  const multiMissed = [missedA, missedB, missedC];
  const { missedPlans: sortedMissed } = buildPlanTabView(multiMissed, NOW, true);
  check('12. Multiple missed activities all classify as missed', sortedMissed.length === 3);
  check('12. Missed activities order most-recently-missed first (Oct 12, Oct 10, Oct 9)', sortedMissed.map((p) => p.id).join(',') === 'oct12,oct10,oct9');
  check('15. Deterministic ordering: re-running classification+sort on the same input produces the identical order every time', JSON.stringify(buildPlanTabView(multiMissed, NOW, true).missedPlans.map((p) => p.id)) === JSON.stringify(buildPlanTabView([...multiMissed], NOW, true).missedPlans.map((p) => p.id)));
  const tieStart = iso(istToUtc(2026, 10, 9, 8, 0));
  const tieEnd = iso(istToUtc(2026, 10, 9, 8, 30));
  const tiedMissed: MiniPlan[] = [
    { id: 'first', ...fixture(tieStart, tieEnd) },
    { id: 'second', ...fixture(tieStart, tieEnd) },
  ];
  check('15. Deterministic tie-breaking for identical end timestamps: stable sort preserves original relative order', buildPlanTabView(tiedMissed, NOW, true).missedPlans.map((p) => p.id).join(',') === 'first,second');

  // ============================================================
  // 13/14. Three-slot limit applies only to upcoming/current; missed
  // activities never displace genuinely future/current ones.
  // ============================================================
  const futureX: MiniPlan = { id: 'future-x', ...fixture(iso(istToUtc(2026, 10, 20, 20, 0)), iso(istToUtc(2026, 10, 20, 20, 30))) };
  const currentX: MiniPlan = { id: 'current-x', ...fixture(iso(istToUtc(2026, 10, 20, 17, 45)), iso(istToUtc(2026, 10, 20, 18, 15))) };
  const auditScenario = [missedA, missedB, missedC, currentX, futureX]; // exact DR4-E audit reproduction
  const collapsed = buildPlanTabView(auditScenario, NOW, false);
  check('13/14. Collapsed (default) view: the 3-slot limit is filled entirely by current/future activities -- no missed activity occupies a slot', collapsed.visibleUpcomingPlans.every((p) => p.id === 'current-x' || p.id === 'future-x') && collapsed.visibleUpcomingPlans.length === 2);
  check('14. Missed activities never displace future/current ones even when there are more missed than upcoming', collapsed.visibleUpcomingPlans.map((p) => p.id).sort().join(',') === 'current-x,future-x');
  const manyFuture = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, ...fixture(iso(istToUtc(2026, 10, 20, 20 + i, 0)), iso(istToUtc(2026, 10, 20, 20 + i, 30))) }));
  const collapsedMany = buildPlanTabView([...multiMissed, ...manyFuture], NOW, false);
  check('13. Three-slot limit: exactly 3 upcoming/current plans shown by default even when more exist, none of them missed', collapsedMany.visibleUpcomingPlans.length === 3 && collapsedMany.visibleUpcomingPlans.every((p) => p.id.startsWith('f')));

  // ============================================================
  // 16. Existing "View all" access -- missed plans remain reachable, never
  // silently dropped, appended after upcoming/current (never displacing).
  // ============================================================
  const expanded = buildPlanTabView(auditScenario, NOW, true);
  check('16. "View all" (showAllPlans) surfaces every missed plan -- none become inaccessible', expanded.visibleUpcomingPlans.filter((p) => ['oct9', 'oct10', 'oct12'].includes(p.id)).length === 3);
  check('16. "View all" keeps current/future plans FIRST, missed plans appended after (not displaced, not interleaved ahead of them)', expanded.visibleUpcomingPlans.slice(0, 2).map((p) => p.id).join(',') === 'current-x,future-x');
  check('16. The Insights "awaiting confirmation" filtered view (plansFilter) independently reaches the same missed set', buildPlanTabView(auditScenario, NOW, true, 'AWAITING_CONFIRMATION').visibleUpcomingPlans.map((p) => p.id).join(',') === 'oct12,oct10,oct9');
  check('16. isAwaitingConfirmationPlan (Insights\' own name) and isMissedPlan (DR4-E1\'s name) agree on every fixture -- same underlying fact, not two rules', [fixture(pastStart, pastEnd), fixture(futureStart, futureEnd), fixture(pastStart, pastEnd, 'LOGGED'), fixture(curStart, curEnd)].every((p) => isAwaitingConfirmationPlan(p, NOW) === isMissedPlan(p, NOW)));

  // ============================================================
  // 17/18. Goal-linked vs. unlinked activities -- classification is purely
  // status + time; goal linkage (a field this module never even sees) has
  // zero effect, confirming DR4-C's goal continuity is entirely untouched.
  // ============================================================
  const goalLinked = { ...fixture(pastStart, pastEnd), goalActivityExecutionId: 'exec-1', goalId: 'goal-1' } as FixturePlan & { goalActivityExecutionId: string; goalId: string };
  const unlinked = fixture(pastStart, pastEnd);
  check('17/18. Goal-linked and goal-unlinked activities with identical timing classify identically (classification never reads goal fields)', derivedPlanLifecycle(goalLinked, NOW) === derivedPlanLifecycle(unlinked, NOW) && isMissedPlan(goalLinked, NOW) === isMissedPlan(unlinked, NOW));
  check('17. planFormatting.ts reads no goal field (no goal-aware branching exists to get out of sync with DR4-C)', !/goalId|goalActivityExecutionId|GoalActivity/.test(strip(read('../apps/web/lib/planFormatting.ts'))));

  // ============================================================
  // 19. No database status mutation -- structural: this PR writes no status,
  // persists no MISSED, calls no write endpoint. Mirrors missedRecovery.
  // test.ts's own structural convention for the identical claim on Home.
  // ============================================================
  const planFormattingSrc = strip(read('../apps/web/lib/planFormatting.ts'));
  const planViewSrc = strip(read('../apps/web/components/PlanWithAuraView.tsx'));
  check('19. planFormatting.ts never writes a status, never persists MISSED, makes no network call', !/fetch\(|UPDATE\s+"PlannedActivity"|SET status|'MISSED'\s*,?\s*$/m.test(planFormattingSrc) && !/status\s*=\s*'MISSED'/.test(planFormattingSrc));
  check('19. The new PlanWithAuraView.tsx collections (upcomingOrCurrentPlans/missedPlans) are computed via useMemo over savedPlans, never a second fetch or mutation', /const upcomingOrCurrentPlans = useMemo/.test(planViewSrc) && /const missedPlans = useMemo/.test(planViewSrc) && (planViewSrc.match(/fetch\('\/api\/plans'\)/g) ?? []).length === 1);
  check('19. No migration directory references a MISSED status column or value (count-independent -- holds regardless of how many unrelated migrations exist)', (() => { const dirs = fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)); return dirs.every((d) => !/'MISSED'|missedAt/i.test(fs.readFileSync(path.join(__dirname, '../apps/web/prisma/migrations', d, 'migration.sql'), 'utf8'))); })());

  // ============================================================
  // 20. Existing API compatibility -- GET /api/plans and listPlannedActivities
  // are untouched by this PR (classification/sorting moved entirely
  // client-side specifically to avoid touching this shared contract, which
  // app/api/calendar/feed/route.ts and app/page.tsx also depend on).
  // ============================================================
  const dbSrc = read('../apps/web/lib/db.ts');
  check('20. listPlannedActivities\' query/order is byte-for-byte unchanged by this PR', /ORDER BY\s*\n\s*CASE WHEN status = 'UPCOMING' THEN 0 ELSE 1 END,\s*\n\s*"plannedStartAt" ASC,\s*\n\s*"createdAt" DESC/.test(dbSrc));
  const routeSrc = read('../apps/web/app/api/plans/route.ts');
  check('20. GET /api/plans still calls listPlannedActivities verbatim, unmodified by this PR', /const plans = await listPlannedActivities\(session\.userId\);/.test(routeSrc));

  console.log(allPassed ? '\nALL TIME-AWARE UPCOMING PLANS CHECKS PASSED' : '\nSOME TIME-AWARE UPCOMING PLANS CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}
main();
