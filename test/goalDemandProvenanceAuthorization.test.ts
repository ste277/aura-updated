/**
 * Goals V2 Candidate A3.4 -- pure tests for `authorizeGoalActivityLinks`
 * (goalDemandProvenanceAuthorization.ts), exercised entirely with
 * in-memory fake "verified items" and a plain Map -- no DB, no real
 * signing/verification. This file proves the AUTHORIZATION LOGIC itself
 * (classification routing, matching/missing/conflicting client links,
 * atomicity); it does not re-prove that `verifyAcceptanceItems` actually
 * runs first in production -- that end-to-end trust-order proof, through
 * the real route/persistence with real signed tokens, lives in
 * goalDemandProvenanceAuthorizationDb.test.ts.
 */
import { authorizeGoalActivityLinks } from '../apps/web/lib/goalDemandProvenanceAuthorization';
import { encodeGoalDemandIntentId } from '../apps/web/lib/goalDemandIntentId';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const DATE = '2026-10-06';
const OTHER_DATE = '2026-10-07';
const autoId = (gaId: string, date = DATE) => encodeGoalDemandIntentId(date, gaId);

function items(...intentIds: string[]) {
  return intentIds.map((intentId) => ({ intentId }));
}

// ============================================================
// 19/27: verified automatic intent + matching client link -> succeeds.
// An entry in `rawGoalActivityLinks` whose key is NOT among the verified
// items (i.e. "unverified") is never even visited -- zero authority,
// confirmed by its total absence from the result.
// ============================================================
{
  const id = autoId('ga-1');
  const result = authorizeGoalActivityLinks(items(id), DATE, new Map([[id, 'ga-1']]));
  check('19. verified automatic intent + matching client link -> succeeds', result.status === 'OK' && result.goalActivityLinks.get(id) === 'ga-1');
}
{
  // 27/28: an unsigned goal-demand-looking id/link for an intentId that
  // was never in `verifiedItems` at all has zero authority -- it is
  // simply never consulted (this is what "only verified items are even
  // iterated" means in practice).
  const verifiedId = autoId('ga-1');
  const neverVerifiedId = autoId('ga-2');
  const result = authorizeGoalActivityLinks(
    items(verifiedId),
    DATE,
    new Map([
      [verifiedId, 'ga-1'],
      [neverVerifiedId, 'ga-2'], // dangling -- intentId never among verifiedItems
    ])
  );
  check('27/28. a link for an intentId never among the verified items carries zero authority and never reaches the result', result.status === 'OK' && result.goalActivityLinks.size === 1 && !result.goalActivityLinks.has(neverVerifiedId));
}

// ============================================================
// 20: missing client link -> server derives the link from the verified
// intentId (transport-only omission, this ticket's own section 9).
// ============================================================
{
  const id = autoId('ga-1');
  const result = authorizeGoalActivityLinks(items(id), DATE, new Map());
  check('20. verified automatic intent + missing client link -> server derives the correct link from the verified intentId', result.status === 'OK' && result.goalActivityLinks.get(id) === 'ga-1');
}

// ============================================================
// 21/22: conflicting client link -> rejected, zero authorized output.
// ============================================================
{
  const id = autoId('ga-1');
  const result = authorizeGoalActivityLinks(items(id), DATE, new Map([[id, 'ga-DIFFERENT']]));
  check('21. verified automatic intent + conflicting client link -> rejected', result.status === 'REJECTED');
  check('22. conflict produces zero authorized links (never a partial/guessed result)', result.status === 'REJECTED' && result.diagnostics.length === 1 && result.diagnostics[0].intentId === id && result.diagnostics[0].detail === 'AUTOMATIC_GOAL_PROVENANCE_MISMATCH');
}

// ============================================================
// 23/24: malformed reserved identity -> rejected, zero authorized output.
// ============================================================
{
  const malformed = 'goal-demand:2026-10-06:'; // missing GoalActivity id
  const result = authorizeGoalActivityLinks(items(malformed), DATE, new Map());
  check('23. verified item carrying a malformed reserved identity -> rejected', result.status === 'REJECTED');
  check('24. malformed identity produces zero authorized links', result.status === 'REJECTED' && result.diagnostics[0].detail === 'MALFORMED_AUTOMATIC_GOAL_INTENT_ID');
}

// ============================================================
// 25/26: planning-date mismatch -> rejected, zero authorized output.
// ============================================================
{
  const id = autoId('ga-1', DATE);
  const result = authorizeGoalActivityLinks(items(id), OTHER_DATE, new Map());
  check('25. verified automatic intent whose decoded date differs from the verified planning date -> rejected', result.status === 'REJECTED');
  check('26. date mismatch produces zero authorized links', result.status === 'REJECTED' && result.diagnostics[0].detail === 'AUTOMATIC_GOAL_PLANNING_DATE_MISMATCH');
}

// ============================================================
// Non-Goal / manual Goal pass-through (this ticket's own section 12/13) --
// completely unaffected by this file's own logic.
// ============================================================
{
  const typedId = 'plan-day-row-1';
  const result = authorizeGoalActivityLinks(items(typedId), DATE, new Map());
  check('29. a typed/ordinary intent with no link -> succeeds, no link in the result (unchanged behavior)', result.status === 'OK' && !result.goalActivityLinks.has(typedId));
}
{
  const manualId = 'plan-day-goal-ga-5';
  const result = authorizeGoalActivityLinks(items(manualId), DATE, new Map([[manualId, 'ga-5']]));
  check('32. a manual Goal intent + matching client link -> passes through verbatim, unchanged', result.status === 'OK' && result.goalActivityLinks.get(manualId) === 'ga-5');
}
{
  // Manual Goal's own existing behavior: this file never cross-checks a
  // manual link against anything -- whatever the client said is passed
  // through verbatim (ownership is still validated later, transactionally,
  // completely unchanged by this file).
  const manualId = 'plan-day-goal-ga-5';
  const result = authorizeGoalActivityLinks(items(manualId), DATE, new Map([[manualId, 'ga-ANYTHING-AT-ALL']]));
  check('manual Goal links are never cross-checked by this file (that stays the existing transactional ownership check\'s job)', result.status === 'OK' && result.goalActivityLinks.get(manualId) === 'ga-ANYTHING-AT-ALL');
}

// ============================================================
// Mixed batch: non-Goal, manual Goal, and automatic Goal items together.
// ============================================================
{
  const autoGood = autoId('ga-1');
  const manualId = 'plan-day-goal-ga-2';
  const typedId = 'plan-day-row-9';
  const result = authorizeGoalActivityLinks(
    items(autoGood, manualId, typedId),
    DATE,
    new Map([
      [autoGood, 'ga-1'],
      [manualId, 'ga-2'],
    ])
  );
  check(
    '39. multiple item kinds in one batch all authorize correctly together',
    result.status === 'OK' && result.goalActivityLinks.get(autoGood) === 'ga-1' && result.goalActivityLinks.get(manualId) === 'ga-2' && !result.goalActivityLinks.has(typedId)
  );
}
{
  // 40: one invalid automatic provenance among otherwise-valid siblings ->
  // the WHOLE batch rejects, never a partial authorized map.
  const autoGood = autoId('ga-1');
  const autoBad = autoId('ga-2');
  const result = authorizeGoalActivityLinks(items(autoGood, autoBad), DATE, new Map([[autoGood, 'ga-1'], [autoBad, 'ga-CONFLICT']]));
  check('40. one invalid automatic provenance among valid siblings -> the whole batch is rejected, zero authorized links for ANY item', result.status === 'REJECTED');
}

if (!allPassed) {
  console.error('SOME GOAL DEMAND PROVENANCE AUTHORIZATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL DEMAND PROVENANCE AUTHORIZATION CHECKS PASSED');
