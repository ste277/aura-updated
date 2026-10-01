/**
 * Goals V2 G3.4 -- live-database proof that GOAL_TEMPLATES's own
 * per-activity completionRequirement actually reaches persistence through
 * the EXISTING G2.1 write path (createGoalWithActivities), stays
 * prospective-only (an existing GoalActivity is never retroactively
 * changed), and flows unmodified through the EXISTING G3.1/G3.2/G3.3 read
 * models (loadGoalContextsForPlanIds / listGoalActivitiesWithLinkedPlanStatus)
 * into the EXISTING canonical formatter -- all without touching any Goal
 * Detail, Right Now, or Constructor production code. Requires a real,
 * reachable DATABASE_URL, same convention as every other Goals V2 DB test.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalTemplateCompletionDb.test.ts
 */
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  createPlannedActivity,
  logPlannedActivity,
  deleteGoal,
  beginTransaction,
  loadGoalContextsForPlanIds,
  listGoalActivitiesWithLinkedPlanStatus,
} from '../apps/web/lib/db';
import { resolveGoalTemplateActivities } from '../apps/web/lib/goals';
import { normalizeGoalActivityCompletionRequirement } from '../apps/web/lib/goalCompletion';
import { formatGoalActivityCompletion } from '../apps/web/lib/goalActivityExecution';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
let planCounter = 0;
function nextPlanWindow(): { start: Date; end: Date } {
  planCounter += 1;
  const start = new Date(`2027-01-${String(1 + planCounter).padStart(2, '0')}T09:00:00Z`);
  return { start, end: new Date(start.getTime() + 30 * 60000) };
}

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-template-completion@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
    }
  };

  try {
    // ============================================================
    // 26/12. TEST — DONE persists via the exact canonical G2.1 storage
    // convention (all three columns null) for an INSUFFICIENT_INFORMATION
    // template activity.
    // ============================================================
    {
      const activities = resolveGoalTemplateActivities('GET_FITTER');
      const { goal, activities: created } = await createGoalWithActivities({ userId: user.id, title: 'G3.4 GET_FITTER goal', targetDate: null, activities });
      createdGoalIds.push(goal.id);
      const runActivity = created.find((a) => a.title === 'Go for a run')!;
      check('26. GET_FITTER "Go for a run" persists DONE via the canonical all-null convention (completionKind/TargetValue/Unit all null)', runActivity.completionKind === null && runActivity.completionTargetValue === null && runActivity.completionUnit === null);
    }

    // ============================================================
    // 12/27. TEST — DURATION persists correctly (kind=DURATION, target=10,
    // no unit), then the EXISTING G3.2 canonical formatter (completely
    // unmodified by G3.4) produces "10 min" from the persisted+normalized
    // shape -- proving the payoff happens through existing data flow, with
    // zero Goal Detail production code change.
    // ============================================================
    let meditateGoalId = '';
    let meditateActivityId = '';
    {
      const activities = resolveGoalTemplateActivities('MEDITATE_REGULARLY');
      const { goal, activities: created } = await createGoalWithActivities({ userId: user.id, title: 'G3.4 MEDITATE_REGULARLY goal', targetDate: null, activities });
      createdGoalIds.push(goal.id);
      meditateGoalId = goal.id;
      const meditateActivity = created[0];
      meditateActivityId = meditateActivity.id;
      check('12/27. MEDITATE_REGULARLY persists DURATION targetValue=10', meditateActivity.completionKind === 'DURATION' && meditateActivity.completionTargetValue === 10);
      check('12. DURATION persists with NO unit (implicit minutes)', meditateActivity.completionUnit === null);

      // 34. remains SUGGESTED -- no automatic planning.
      check('34. newly-created templated activity is SUGGESTED (no plannedActivityId)', meditateActivity.status === 'SUGGESTED' && meditateActivity.plannedActivityId === null);

      // 36. Goal Detail integration -- via the EXISTING read model
      // (listGoalActivitiesWithLinkedPlanStatus), normalized through the
      // EXISTING canonical helper, exactly as the real API route does
      // (apps/web/app/api/goals/[goalId]/route.ts) -- no special template
      // knowledge anywhere in this chain.
      const rows = await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id);
      const row = rows.find((r) => r.id === meditateActivity.id)!;
      const requirement = normalizeGoalActivityCompletionRequirement(row);
      check('36. Goal Detail read model normalizes the persisted row to DURATION targetValue=10 (same helper the real route.ts uses)', requirement.kind === 'DURATION' && requirement.targetValue === 10);
      check('36. Goal Detail\'s own canonical formatter (unmodified by G3.4) renders "10 min" for a not-yet-completed templated activity', formatGoalActivityCompletion(requirement, (row as any).currentValue ?? null) === '10 min');
    }

    // ============================================================
    // 37. TEST — RIGHT NOW INTEGRATION. Plan the templated activity, log a
    // partial actual value, then verify loadGoalContextsForPlanIds (the
    // EXACT read model Home/Right Now consumes, unmodified by G3.4) sees
    // the SAME requirement, and the SAME canonical formatter produces the
    // expected "x / 10 min" string -- proving template semantics flow
    // through the existing architecture end-to-end, with zero Home
    // production code touched.
    // ============================================================
    {
      const { start, end } = nextPlanWindow();
      const plan = await createPlannedActivity({ userId: user.id, title: 'Meditate 10 minutes', plannedStartAt: start, plannedEndAt: end, durationMinutes: 10, windowType: 'NEUTRAL' });
      const client = await beginTransaction();
      try {
        await client.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plan.id, meditateActivityId]);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      await logPlannedActivity(user.id, plan.id, { actualValue: 6 });

      const contexts = await loadGoalContextsForPlanIds(user.id, [plan.id]);
      const ctx = contexts.get(plan.id)!;
      check('37. Right Now read model (loadGoalContextsForPlanIds) sees the SAME DURATION targetValue=10 requirement the template resolved', ctx.goalActivity.completionRequirement.kind === 'DURATION' && ctx.goalActivity.completionRequirement.targetValue === 10);
      check('37. Right Now read model sees the logged actual value (6)', ctx.currentValue === 6);
      check('37. Right Now\'s own canonical formatter (G3.3, unmodified by G3.4) renders "6 / 10 min"', formatGoalActivityCompletion(ctx.goalActivity.completionRequirement, ctx.currentValue) === '6 / 10 min');
      check('37. Right Now context carries the correct Goal title', ctx.goal.id === meditateGoalId && ctx.goal.title === 'G3.4 MEDITATE_REGULARLY goal');
    }

    // ============================================================
    // 29. TEST — START FROM SCRATCH. A manually-added GoalActivity (no
    // template, no completionRequirement supplied) still defaults to DONE,
    // completely unaffected by G3.4's template enrichment.
    // ============================================================
    {
      const { goal } = await createGoalWithActivities({ userId: user.id, title: 'G3.4 start-from-scratch goal', targetDate: null, activities: [] });
      createdGoalIds.push(goal.id);
      const manual = await addGoalActivity(user.id, goal.id, { title: 'A manually typed activity, no template', activityId: null });
      check('29. Start-from-scratch manual activity (no template, no explicit requirement) persists DONE via the unchanged default -- all three columns null', manual!.completionKind === null && manual!.completionTargetValue === null && manual!.completionUnit === null);
    }

    // ============================================================
    // 38. TEST — MANUAL EXPLICIT REQUIREMENT. An existing programmatic
    // caller that explicitly supplies its OWN CompletionRequirement (fully
    // independent of any template) remains authoritative -- G3.4's
    // template-default logic never overwrites an explicitly-supplied value.
    // ============================================================
    {
      const { goal } = await createGoalWithActivities({ userId: user.id, title: 'G3.4 explicit-requirement goal', targetDate: null, activities: [] });
      createdGoalIds.push(goal.id);
      const explicit = await addGoalActivity(user.id, goal.id, { title: 'Read 20 pages', activityId: null, completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } });
      check('38. an explicitly-supplied, non-template MEASURED_TARGET requirement persists verbatim, untouched by any template default', explicit!.completionKind === 'MEASURED_TARGET' && explicit!.completionTargetValue === 20 && explicit!.completionUnit === 'pages');
    }

    // ============================================================
    // 15/30/22/23. TEST — PROSPECTIVE ONLY. A GoalActivity persisted with
    // the OLD, pre-G3.4-equivalent semantics (constructed here as the
    // fixture: an explicit DONE requirement, simulating "created before
    // this template activity carried a DURATION target") must NOT be
    // retroactively changed merely because resolveGoalTemplateActivities
    // NOW resolves that same category to a richer requirement. No
    // UPDATE/backfill exists anywhere in this write path (already proven
    // structurally in goalTemplateCompletion.test.ts) -- this proves the
    // BEHAVIORAL consequence against a real persisted row.
    // ============================================================
    {
      const { goal, activities: created } = await createGoalWithActivities({
        userId: user.id,
        title: 'G3.4 prospective-only fixture goal',
        targetDate: null,
        activities: [{ title: 'Meditate 10 minutes', activityId: null, completionRequirement: { kind: 'DONE' } }],
      });
      createdGoalIds.push(goal.id);
      const oldStyleActivity = created[0];
      check('15/30. fixture persisted as DONE (simulating a pre-G3.4-equivalent row)', oldStyleActivity.completionKind === null);

      // Re-resolve the CURRENT template definition (which DOES carry
      // DURATION for this exact title) -- this must have zero effect on
      // the already-persisted row above.
      const currentResolution = resolveGoalTemplateActivities('MEDITATE_REGULARLY');
      check('15/30. re-resolving the current template still yields DURATION targetValue=10 (the template itself did change)', currentResolution[0].completionRequirement?.kind === 'DURATION');

      const rows = await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id);
      const rereadRow = rows.find((r) => r.id === oldStyleActivity.id)!;
      check('22/23/30. the EXISTING row, read back from the DB, is STILL DONE -- template re-resolution never mutated it (no backfill, no retroactive reinterpretation)', rereadRow.completionKind === null && rereadRow.completionTargetValue === null);
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL TEMPLATE COMPLETION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL TEMPLATE COMPLETION DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
