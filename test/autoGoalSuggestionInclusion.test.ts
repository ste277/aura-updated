/**
 * Goals V2 Candidate A3.3 -- pure tests: the automatic Goal-suggestion ->
 * row factory, the canonical intent-id encoder (its own zero-dependency
 * module, re-verified via the exact import path PlanDayClient.tsx uses),
 * and the "available suggestions" derivation
 * (`deriveAvailableAutoGoalSuggestions`, planDayEntry.ts). No DB, no
 * component rendering -- matching this repository's own established
 * convention (see captureHandoff.test.ts/goalPlanningHandoff.test.ts).
 */
import { createIntentRowFromAutoGoalSuggestion, deriveAvailableAutoGoalSuggestions, createIntentRowFromGoalActivity, type PlanDayIntentRow } from '../apps/web/lib/planDayEntry';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';
import type { GoalDemandCandidate } from '../apps/web/lib/goalDemandCandidates';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function suggestion(overrides: Partial<GoalDemandCandidate> & { goalActivityId: string }): GoalDemandCandidate {
  return { goalId: 'goal-1', goalTitle: 'Reduce stress', title: 'Meditate 10 minutes', activityId: 'meditation', remainingThisWeek: 2, ...overrides };
}

// ============================================================
// Intent-ID encoding (this ticket's own section 6/9) -- re-verified via
// the exact zero-dependency module PlanDayClient.tsx itself imports, not
// merely A2's own re-export.
// ============================================================
check('encodeGoalDemandIntentId: same GoalActivity + same date -> same id', encodeGoalDemandIntentId('2026-10-06', 'ga-1') === encodeGoalDemandIntentId('2026-10-06', 'ga-1'));
check('encodeGoalDemandIntentId: different date -> different id', encodeGoalDemandIntentId('2026-10-06', 'ga-1') !== encodeGoalDemandIntentId('2026-10-07', 'ga-1'));
check('encodeGoalDemandIntentId: different GoalActivity -> different id', encodeGoalDemandIntentId('2026-10-06', 'ga-1') !== encodeGoalDemandIntentId('2026-10-06', 'ga-2'));
check('encodeGoalDemandIntentId: canonical format', encodeGoalDemandIntentId('2026-10-06', 'ga-1') === 'goal-demand:2026-10-06:ga-1');
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/goalDemandIntentId.ts'), 'utf8');
  // Goals V2 Candidate A3.4 -- this ticket's own section 4/5/23 added a
  // strict decoder, which needs real calendar-date validity (never
  // regex-shape-only) -- the ONE allowed import is
  // isValidCalendarDateString (packages/panchang/src/localDate.ts),
  // itself confirmed zero-import/framework-agnostic (re-verified
  // directly in goalDemandIntentId.test.ts's own check 18c). The real
  // invariant that still matters -- client-bundle-safety (no pg/db.ts/
  // React/next) -- is narrowed accordingly, never dropped.
  check('goalDemandIntentId.ts imports exactly one module, the pure zero-import date-validity helper (client-bundle-safe, this ticket\'s own A3.4 addition)', (src.match(/^import .*from '([^']+)';/gm) ?? []).length === 1 && /from '\.\.\/\.\.\/\.\.\/packages\/panchang\/src\/localDate'/.test(src));
  const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('goalDemandIntentId.ts never imports pg/db.ts/React/next in real code', !/from '\.\/db'|from 'pg'|from 'react'|from 'next/i.test(srcNoComments));
  check('goalDemandIntentId.ts never calls Date.now()/new Date() in real code (no randomness/time dependency)', !/Date\.now\(\)|new Date\(\)/.test(srcNoComments));
}

// ============================================================
// Row construction (this ticket's own section 8) -- same field mapping
// as the manual createIntentRowFromGoalActivity, but a CALLER-SUPPLIED
// canonical automatic intent id, never the manual plan-day-goal-<id>
// scheme.
// ============================================================
{
  const intentId = encodeGoalDemandIntentId('2026-10-06', 'ga-1');
  const row = createIntentRowFromAutoGoalSuggestion({ title: 'Meditate 10 minutes', activityId: 'meditation', goalActivityId: 'ga-1' }, intentId);
  check('10. included row uses the canonical goal-demand intent id as its own id', row.id === 'goal-demand:2026-10-06:ga-1');
  check('11. the id uses exactly the planningLocalDate it was given', row.id.includes('2026-10-06'));
  check('13. included row carries goalActivityId', row.goalActivityId === 'ga-1');
  check('14. included row carries activityId when present', row.activityId === 'meditation');
  check('15. no duration is invented', row.durationMinutes === null);
  check('16. flexibility uses the existing Goal/manual default (FLEXIBLE)', row.timeMode === 'FLEXIBLE');
  check('row id never uses the manual plan-day-goal- scheme', !row.id.startsWith('plan-day-goal-'));
  // 8: no Rhythm metadata, no goalId as scheduling identity -- the row
  // object has exactly the same field set a manual Goal row has, proven
  // by comparing key sets directly.
  const manualRow = createIntentRowFromGoalActivity({ id: 'ga-1', title: 'x', activityId: null });
  check('row carries no additional Rhythm/goalId/remainingThisWeek fields beyond the existing Goal row shape', Object.keys(row).sort().join(',') === Object.keys(manualRow).sort().join(','));
}
{
  // 12: title changes never alter identity -- the id is a pure function
  // of (planningLocalDate, goalActivityId) only.
  const idA = createIntentRowFromAutoGoalSuggestion({ title: 'Meditate 10 minutes', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-06', 'ga-1')).id;
  const idB = createIntentRowFromAutoGoalSuggestion({ title: 'Totally renamed', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-06', 'ga-1')).id;
  check('44. title change does not alter identity', idA === idB);
}
{
  // 45: repeated include/remove/include yields the same intent id -- a
  // pure function of (date, goalActivityId), so this holds trivially by
  // construction; verified explicitly anyway.
  const id1 = createIntentRowFromAutoGoalSuggestion({ title: 'x', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-06', 'ga-1')).id;
  const id2 = createIntentRowFromAutoGoalSuggestion({ title: 'x', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-06', 'ga-1')).id;
  const id3 = createIntentRowFromAutoGoalSuggestion({ title: 'x', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-06', 'ga-1')).id;
  check('45. repeated include/remove/include yields the same intent id', id1 === id2 && id2 === id3);
}
{
  // 43: same GoalActivity, Today vs Tomorrow -> distinct ids.
  const today = createIntentRowFromAutoGoalSuggestion({ title: 'x', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-06', 'ga-1')).id;
  const tomorrow = createIntentRowFromAutoGoalSuggestion({ title: 'x', activityId: null, goalActivityId: 'ga-1' }, encodeGoalDemandIntentId('2026-10-07', 'ga-1')).id;
  check('43. same GoalActivity, Today vs Tomorrow -> different intent ids', today !== tomorrow);
}

// ============================================================
// Available-suggestions derivation (this ticket's own section 10/13/17)
// ============================================================
{
  const suggestions = [suggestion({ goalActivityId: 'ga-1' }), suggestion({ goalActivityId: 'ga-2' })];
  check('2. one suggestion with zero rows -> fully available', deriveAvailableAutoGoalSuggestions([suggestion({ goalActivityId: 'ga-1' })], []).length === 1);
  check('1/19. zero suggestions -> empty available list', deriveAvailableAutoGoalSuggestions([], []).length === 0);
  check('3. multiple suggestions preserve input order (no re-sort)', deriveAvailableAutoGoalSuggestions(suggestions, []).map((s) => s.goalActivityId).join(',') === 'ga-1,ga-2');
}
{
  // 7/17: a suggestion that already has a row (any origin) is excluded from "available".
  const rows: PlanDayIntentRow[] = [{ ...createIntentRowFromGoalActivity({ id: 'x', title: 'x', activityId: null }), id: 'row-1', goalActivityId: 'ga-1' }];
  const available = deriveAvailableAutoGoalSuggestions([suggestion({ goalActivityId: 'ga-1' }), suggestion({ goalActivityId: 'ga-2' })], rows);
  check('7/17. a GoalActivity with an existing row (included) disappears from available suggestions', available.length === 1 && available[0].goalActivityId === 'ga-2');
}
{
  // 19 (return behavior): removing the row (simulated by omitting it from
  // the `rows` array passed in) makes the suggestion available again --
  // this is what makes PlanDayClient's own `removeRow` "just work" with
  // zero additional code.
  const withRow = deriveAvailableAutoGoalSuggestions([suggestion({ goalActivityId: 'ga-1' })], [{ ...createIntentRowFromGoalActivity({ id: 'x', title: 'x', activityId: null }), id: 'row-1', goalActivityId: 'ga-1' }]);
  const withoutRow = deriveAvailableAutoGoalSuggestions([suggestion({ goalActivityId: 'ga-1' })], []);
  check('19. removing the row (simulated) returns the suggestion to the available list', withRow.length === 0 && withoutRow.length === 1);
}
{
  // 24/25: a manually-seeded row (plan-day-goal- scheme) also excludes
  // its GoalActivity from available automatic suggestions -- defensive,
  // never the primary dedup (that is A3.2's own server-side job), and
  // the manual row's OWN identity is untouched by this derivation.
  const manualRow = createIntentRowFromGoalActivity({ id: 'ga-1', title: 'Manually planned', activityId: null });
  check('25. manual Goal row identity is unchanged (still plan-day-goal-<id>)', manualRow.id === 'plan-day-goal-ga-1');
  const available = deriveAvailableAutoGoalSuggestions([suggestion({ goalActivityId: 'ga-1' }), suggestion({ goalActivityId: 'ga-2' })], [manualRow]);
  check('24. a manually-seeded GoalActivity remains excluded from available automatic suggestions (defensive, in addition to A3.2\'s own server-side dedup)', available.length === 1 && available[0].goalActivityId === 'ga-2');
}
{
  // 29: suggestions from multiple Goals all survive derivation together, no grouping/ranking.
  const suggestions = [suggestion({ goalActivityId: 'ga-1', goalId: 'goal-1' }), suggestion({ goalActivityId: 'ga-2', goalId: 'goal-2' }), suggestion({ goalActivityId: 'ga-3', goalId: 'goal-2' })];
  const available = deriveAvailableAutoGoalSuggestions(suggestions, []);
  check('29. suggestions from multiple Goals all remain available together', available.length === 3);
}

// ============================================================
// 4/5. Presentation fields -- activity title and Goal title are both
// present, factual fields on GoalDemandCandidate (no new shape needed).
// 6: remainingThisWeek exists on the type but this file never reads it
// for any row/presentation decision -- proven by grep.
// ============================================================
{
  const s = suggestion({ goalActivityId: 'ga-1', title: 'Meditate 10 minutes', goalTitle: 'Reduce stress' });
  check('4. suggestion carries the activity title', s.title === 'Meditate 10 minutes');
  check('5. suggestion carries the Goal title', s.goalTitle === 'Reduce stress');
}
{
  const planDayEntrySrc: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/planDayEntry.ts'), 'utf8');
  check('6. remainingThisWeek is never read anywhere in planDayEntry.ts (not rendered, not used as a scheduling field)', !/remainingThisWeek/.test(planDayEntrySrc));
}

if (!allPassed) {
  console.error('SOME AUTO GOAL SUGGESTION INCLUSION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL AUTO GOAL SUGGESTION INCLUSION CHECKS PASSED');
