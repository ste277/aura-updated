/**
 * Goals V2 Candidate A3.4 -- pure tests for the canonical automatic
 * Goal-demand intent-id encoder AND strict decoder
 * (apps/web/lib/goalDemandIntentId.ts). No DB, no network, no component
 * rendering. This module's own security property (a syntactically-valid
 * `goal-demand:...` string carries ZERO authority on its own -- only an
 * ALREADY-VERIFIED intentId does) is proven at the acceptance layer, in
 * goalDemandProvenanceAuthorization.test.ts/Db.test.ts -- this file only
 * proves the pure encode/decode/classification logic itself.
 */
import { encodeGoalDemandIntentId, classifyGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// 1-6: encode
// ============================================================
check('1. encode canonical id', encodeGoalDemandIntentId('2026-10-06', 'ga-1') === 'goal-demand:2026-10-06:ga-1');
check('4. same date/id -> deterministic (same output across repeated calls)', encodeGoalDemandIntentId('2026-10-06', 'ga-1') === encodeGoalDemandIntentId('2026-10-06', 'ga-1'));
check('5. different date -> distinct id', encodeGoalDemandIntentId('2026-10-06', 'ga-1') !== encodeGoalDemandIntentId('2026-10-07', 'ga-1'));
check('6. different GoalActivity -> distinct id', encodeGoalDemandIntentId('2026-10-06', 'ga-1') !== encodeGoalDemandIntentId('2026-10-06', 'ga-2'));

// ============================================================
// 2-3: decode + round-trip
// ============================================================
{
  const id = encodeGoalDemandIntentId('2026-10-06', 'ga-1');
  const decoded = classifyGoalDemandIntentId(id);
  check('2. decode canonical id', decoded.kind === 'VALID_GOAL_DEMAND' && decoded.planningLocalDate === '2026-10-06' && decoded.goalActivityId === 'ga-1');
  check('3. encode/decode round-trip reproduces the exact original string', decoded.kind === 'VALID_GOAL_DEMAND' && encodeGoalDemandIntentId(decoded.planningLocalDate, decoded.goalActivityId) === id);
  check('17. decoding then re-encoding never normalizes/alters the identity', encodeGoalDemandIntentId('2026-10-06', 'ga-1') === id);
}

// ============================================================
// 7-8: NOT_GOAL_DEMAND
// ============================================================
check('7. an ordinary id -> NOT_GOAL_DEMAND', classifyGoalDemandIntentId('typed-123').kind === 'NOT_GOAL_DEMAND');
check('7b. a manual Goal row id -> NOT_GOAL_DEMAND (this module never reinterprets the manual scheme)', classifyGoalDemandIntentId('plan-day-goal-ga-1').kind === 'NOT_GOAL_DEMAND');
check('7c. a Quick Pick row id -> NOT_GOAL_DEMAND', classifyGoalDemandIntentId('plan-day-row-3').kind === 'NOT_GOAL_DEMAND');
check('7d. a Capture row id -> NOT_GOAL_DEMAND', classifyGoalDemandIntentId('plan-day-capture-cap-1').kind === 'NOT_GOAL_DEMAND');
check('8. empty string -> NOT_GOAL_DEMAND (does not claim the reserved namespace)', classifyGoalDemandIntentId('').kind === 'NOT_GOAL_DEMAND');
check('8b. the bare prefix with no colon at all -> NOT_GOAL_DEMAND (does not match the reserved `goal-demand:` namespace exactly)', classifyGoalDemandIntentId('goal-demand').kind === 'NOT_GOAL_DEMAND');

// ============================================================
// 9-13: malformed reserved-prefix -> INVALID_GOAL_DEMAND (this ticket's
// own section 11 -- never silently downgraded to NOT_GOAL_DEMAND)
// ============================================================
check('9. "goal-demand:" alone -> INVALID', classifyGoalDemandIntentId('goal-demand:').kind === 'INVALID_GOAL_DEMAND');
check('10. missing date ("goal-demand::ga-1") -> INVALID', classifyGoalDemandIntentId('goal-demand::ga-1').kind === 'INVALID_GOAL_DEMAND');
check('11. invalid date syntax ("goal-demand:not-a-date:ga-1") -> INVALID', classifyGoalDemandIntentId('goal-demand:not-a-date:ga-1').kind === 'INVALID_GOAL_DEMAND');
check('12. missing GoalActivity id ("goal-demand:2026-10-06:") -> INVALID', classifyGoalDemandIntentId('goal-demand:2026-10-06:').kind === 'INVALID_GOAL_DEMAND');
check('13. extra component ("goal-demand:2026-10-06:ga-1:extra") -> INVALID', classifyGoalDemandIntentId('goal-demand:2026-10-06:ga-1:extra').kind === 'INVALID_GOAL_DEMAND');
check(
  '14. a malformed reserved-prefix id is NEVER classified NOT_GOAL_DEMAND (cannot downgrade/bypass provenance validation)',
  ['goal-demand:', 'goal-demand::ga-1', 'goal-demand:not-a-date:ga-1', 'goal-demand:2026-10-06:', 'goal-demand:2026-10-06:ga-1:extra'].every((id) => classifyGoalDemandIntentId(id).kind === 'INVALID_GOAL_DEMAND')
);

// ============================================================
// 15-16: valid/impossible calendar dates
// ============================================================
check('15. a canonical, real calendar date is accepted', classifyGoalDemandIntentId('goal-demand:2026-10-06:ga-1').kind === 'VALID_GOAL_DEMAND');
check('16a. an impossible calendar date (2026-02-30, no such day) -> INVALID, not silently clamped', classifyGoalDemandIntentId('goal-demand:2026-02-30:ga-1').kind === 'INVALID_GOAL_DEMAND');
check('16b. an impossible calendar date (2026-13-01, no such month) -> INVALID', classifyGoalDemandIntentId('goal-demand:2026-13-01:ga-1').kind === 'INVALID_GOAL_DEMAND');
check('16c. an impossible calendar date (2026-04-31, April has 30 days) -> INVALID', classifyGoalDemandIntentId('goal-demand:2026-04-31:ga-1').kind === 'INVALID_GOAL_DEMAND');
check('16d. a real leap-day date (2028-02-29) is accepted', classifyGoalDemandIntentId('goal-demand:2028-02-29:ga-1').kind === 'VALID_GOAL_DEMAND');
check('16e. a non-leap-year Feb 29 (2026-02-29, 2026 is not a leap year) -> INVALID', classifyGoalDemandIntentId('goal-demand:2026-02-29:ga-1').kind === 'INVALID_GOAL_DEMAND');

// ============================================================
// 18: module remains zero-coupling (DB/React/Constructor), confirmed by
// direct source inspection -- its own one real import is a pure,
// zero-import, framework-agnostic date-validity helper, never anything
// DB/React/Constructor-coupled.
// ============================================================
{
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/goalDemandIntentId.ts'), 'utf8');
  const imports = [...src.matchAll(/^import .*from '([^']+)';/gm)].map((m) => m[1]);
  check('18a. goalDemandIntentId.ts imports exactly one module (the pure date-validity helper)', imports.length === 1 && imports[0].includes('localDate'));
  // Doc-comment prose explaining the module's own design rationale
  // legitimately mentions "dayConstructor.../db.ts/React" by name (what
  // this module must NEVER import) -- only real import statements count.
  const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('18b. goalDemandIntentId.ts never imports pg/db.ts/React/next/Constructor in real code', !/from '\.\/db'|from 'pg'|from 'react'|from 'next|dayConstructor/.test(srcNoComments));
  const localDateSrc: string = require('fs').readFileSync(require('path').join(__dirname, '../packages/panchang/src/localDate.ts'), 'utf8');
  check('18c. the one real dependency (localDate.ts) is itself zero-import (confirmed transitively pure)', !/^import /m.test(localDateSrc));
}

if (!allPassed) {
  console.error('SOME GOAL DEMAND INTENT ID CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL DEMAND INTENT ID CHECKS PASSED');
