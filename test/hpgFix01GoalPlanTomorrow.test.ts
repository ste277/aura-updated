// AURA-HPG-FIX-01 (V1-02) -- Goal -> Plan My Day -> switch to Tomorrow.
//
// Reproduction with synthetic fixtures (no DB, no staging data):
//   1. Arrive via a Goal handoff on Sat 2026-11-21: the canonical goal row
//      is minted as `goal-demand:2026-11-21:<goalActivityId>`.
//   2. Switch to Tomorrow: PlanDayClient keeps `rows` across the soft
//      navigation (by design) -- the row id still says 2026-11-21.
//   3. Accept for 2026-11-22: authorizeGoalActivityLinks rejects the whole
//      request with AUTOMATIC_GOAL_PLANNING_DATE_MISMATCH (shown to the user
//      as "Your day changed since this plan was created"), and "Review
//      again" resubmits the same ids -- an endless fail-closed loop.
// Fix: rekeyGoalDemandRowsForPlanningDate re-keys preserved goal-demand rows
// to the new planning date; server authorization is unchanged.
import * as fs from 'fs';
import * as path from 'path';
import { rekeyGoalDemandRowsForPlanningDate, createIntentRowFromGoalHandoffItem, createIntentRowFromQuickPick, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId, rekeyGoalDemandIntentIdForPlanningDate } from '../apps/web/lib/goalDemandIntentId';
import { authorizeGoalActivityLinks } from '../apps/web/lib/goalDemandProvenanceAuthorization';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TODAY = '2026-11-21';
const TOMORROW = '2026-11-22';
const GA = 'c73b29f0-6cf8-45a5-a97c-9984630a6cdf';

const goalRow = createIntentRowFromGoalHandoffItem({ id: GA, title: 'HPG5 evening run', activityId: null, canonicalDemand: true }, encodeGoalDemandIntentId(TODAY, GA));
check('0. fixture: handoff row is a canonical goal-demand row for today', goalRow.id === `goal-demand:${TODAY}:${GA}` && goalRow.goalActivityId === GA);

// ---------- Reproduction (pre-fix behaviour) ----------
{
  const result = authorizeGoalActivityLinks([{ intentId: goalRow.id }], TOMORROW, new Map([[goalRow.id, GA]]));
  check('1. REPRO: today-keyed goal row accepted for tomorrow is rejected', result.status === 'REJECTED');
  check('1. REPRO: rejection detail is AUTOMATIC_GOAL_PLANNING_DATE_MISMATCH', result.status === 'REJECTED' && result.diagnostics.some((d) => d.detail === 'AUTOMATIC_GOAL_PLANNING_DATE_MISMATCH'));
}

// ---------- Fix ----------
{
  const typed: PlanDayIntentRow = { ...createIntentRowFromQuickPick({ label: 'Workout', activityId: 'workout' }), id: 'plan-day-row-typed' };
  const rows = [goalRow, typed];
  const rekeyed = rekeyGoalDemandRowsForPlanningDate(rows, (id) => rekeyGoalDemandIntentIdForPlanningDate(id, TOMORROW));
  const rekeyedGoal = rekeyed.find((r) => r.goalActivityId === GA)!;
  check('2. goal row re-keyed to tomorrow', rekeyedGoal.id === `goal-demand:${TOMORROW}:${GA}`);
  check('2. goal row keeps title / goalActivityId / every other field', rekeyedGoal.title === goalRow.title && rekeyedGoal.goalActivityId === GA && JSON.stringify({ ...rekeyedGoal, id: '' }) === JSON.stringify({ ...goalRow, id: '' }));
  check('2. non goal-demand rows untouched (same object)', rekeyed.find((r) => r.id === 'plan-day-row-typed') === typed);

  const result = authorizeGoalActivityLinks([{ intentId: rekeyedGoal.id }], TOMORROW, new Map([[rekeyedGoal.id, GA]]));
  check('2. FIXED: re-keyed row passes authorization for tomorrow', result.status === 'OK' && result.goalActivityLinks.get(rekeyedGoal.id) === GA);

  const back = rekeyGoalDemandRowsForPlanningDate(rekeyed, (id) => rekeyGoalDemandIntentIdForPlanningDate(id, TODAY));
  check('2. switching back to Today re-keys back (still authorizable for today)', back.find((r) => r.goalActivityId === GA)!.id === `goal-demand:${TODAY}:${GA}`);

  check('2. no change -> the same array instance (no needless re-render)', rekeyGoalDemandRowsForPlanningDate(rekeyed, (id) => rekeyGoalDemandIntentIdForPlanningDate(id, TOMORROW)) === rekeyed);

  // A provenance mismatch is still rejected after the fix (server rule intact).
  const tampered = authorizeGoalActivityLinks([{ intentId: rekeyedGoal.id }], TOMORROW, new Map([[rekeyedGoal.id, 'some-other-goal-activity']]));
  check('2. server provenance check still rejects a mismatched link', tampered.status === 'REJECTED');
}

// ---------- Duplicate collision ----------
{
  const todayRow = createIntentRowFromGoalHandoffItem({ id: GA, title: 'Run', activityId: null, canonicalDemand: true }, encodeGoalDemandIntentId(TODAY, GA));
  const tomorrowRow = createIntentRowFromGoalHandoffItem({ id: GA, title: 'Run', activityId: null, canonicalDemand: true }, encodeGoalDemandIntentId(TOMORROW, GA));
  const out = rekeyGoalDemandRowsForPlanningDate([tomorrowRow, todayRow], (id) => rekeyGoalDemandIntentIdForPlanningDate(id, TOMORROW));
  check('3. same activity for both days collapses to one intent id (never two identical ids)', out.length === 1 && out[0].id === `goal-demand:${TOMORROW}:${GA}`);
}

// ---------- Wiring ----------
{
  const client = fs.readFileSync(path.join(__dirname, '../apps/web/app/plan-day/PlanDayClient.tsx'), 'utf8');
  check('4. PlanDayClient re-keys rows whenever planningDate changes', /setRows\(\(current\) => rekeyGoalDemandRowsForPlanningDate\(current, \(rowId\) => rekeyGoalDemandIntentIdForPlanningDate\(rowId, planningDate\)\)\);\s*\}, \[planningDate\]\);/.test(client));
  check('4. id helper: non goal-demand ids and same-date ids are unchanged', rekeyGoalDemandIntentIdForPlanningDate('plan-day-goal-x', TOMORROW) === 'plan-day-goal-x' && rekeyGoalDemandIntentIdForPlanningDate(`goal-demand:${TOMORROW}:${GA}`, TOMORROW) === `goal-demand:${TOMORROW}:${GA}`);
  check('4. id helper: malformed goal-demand ids are never rewritten (server rejects them)', rekeyGoalDemandIntentIdForPlanningDate('goal-demand:not-a-date', TOMORROW) === 'goal-demand:not-a-date');
}

if (!allPassed) {
  console.error('\nhpgFix01GoalPlanTomorrow: FAILED');
  process.exit(1);
}
console.log('\nhpgFix01GoalPlanTomorrow: all checks passed');
