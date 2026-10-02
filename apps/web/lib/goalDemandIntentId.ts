/**
 * Goals V2 Candidate A2/A3.3/A3.4 -- the canonical automatic Goal-demand
 * intent-id encoding AND strict decoder, deliberately kept in its own
 * lightweight module.
 *
 * `goalPlanningSourceAdapter.ts` (A2, server-only) originally defined the
 * encoder inline, but that file also imports `dayConstructorPreviewRequest.ts`
 * (for `MAX_INTENTS_PER_REQUEST`), which transitively imports `db.ts` and
 * therefore `pg` -- safe for A2's own server-only callers, but exactly
 * the kind of module a 'use client' component (PlanDayClient.tsx) must
 * never import, since bundling `pg` into client JS breaks the build. This
 * module imports only `isValidCalendarDateString` (packages/panchang/src/localDate.ts,
 * itself a zero-import, framework-agnostic pure function -- confirmed by
 * direct read, not assumed), so both the server-side acceptance layer and
 * the client component can depend on the ONE real implementation without
 * either pulling in `pg`/React/Constructor/DB -- "do not duplicate the
 * string format" (A3.4's own section 4) is satisfied by having exactly
 * one implementation of each direction (encode, decode), not one per file.
 *
 * ENCODE ONLY until A3.4 -- this module now provides ENCODE + DECODE.
 */

import { isValidCalendarDateString } from '../../../packages/panchang/src/localDate';

const GOAL_DEMAND_INTENT_ID_PREFIX = 'goal-demand';
const GOAL_DEMAND_INTENT_ID_NAMESPACE = `${GOAL_DEMAND_INTENT_ID_PREFIX}:`;

export function encodeGoalDemandIntentId(planningLocalDate: string, goalActivityId: string): string {
  return `${GOAL_DEMAND_INTENT_ID_PREFIX}:${planningLocalDate}:${goalActivityId}`;
}

// ============================================================
// Decoder (Candidate A3.4, this ticket's own section 4/5/11) -- a STRICT
// classifier, never a loose startsWith/split. Three outcomes, never a
// silent fallback between them:
//
//   NOT_GOAL_DEMAND     -- does not claim the reserved `goal-demand:`
//                          namespace at all (an ordinary typed/Quick-Pick/
//                          Capture/manual-Goal intentId). Existing
//                          behavior for these is completely unaffected --
//                          this module makes no claim about them.
//   VALID_GOAL_DEMAND   -- claims the namespace AND is exactly the
//                          canonical `goal-demand:<date>:<goalActivityId>`
//                          shape, carrying the decoded components.
//   INVALID_GOAL_DEMAND -- claims the namespace but is malformed (missing
//                          date, missing GoalActivity id, invalid date
//                          syntax, or an extra component). This ticket's
//                          own explicit, non-negotiable rule: a malformed
//                          reserved-namespace id must NEVER silently
//                          downgrade to NOT_GOAL_DEMAND -- doing so would
//                          let a client bypass provenance validation
//                          merely by submitting a near-miss string. The
//                          caller (goalDemandProvenanceAuthorization.ts)
//                          fails the whole acceptance closed on this
//                          outcome, never treats it as an ordinary intent.
//
// Canonical round-trip (this ticket's own section 5's own "preferred
// invariant"): a VALID_GOAL_DEMAND result's own components, re-encoded,
// reproduce the EXACT original string -- defense-in-depth beyond the
// structural split/date checks above it, verified explicitly below
// rather than merely assumed from the parsing logic.
// ============================================================

export type GoalDemandIntentIdClassification =
  | { kind: 'NOT_GOAL_DEMAND' }
  | { kind: 'INVALID_GOAL_DEMAND' }
  | { kind: 'VALID_GOAL_DEMAND'; planningLocalDate: string; goalActivityId: string };

export function classifyGoalDemandIntentId(intentId: string): GoalDemandIntentIdClassification {
  if (!intentId.startsWith(GOAL_DEMAND_INTENT_ID_NAMESPACE)) return { kind: 'NOT_GOAL_DEMAND' };

  const rest = intentId.slice(GOAL_DEMAND_INTENT_ID_NAMESPACE.length);
  const parts = rest.split(':');
  // Exactly two components: the planning date, then the GoalActivity id.
  // Fewer (missing date and/or id) or more (an extra `:`-delimited
  // component, e.g. a GoalActivity id that itself contained a colon,
  // which never happens for a real UUID but must still be rejected, not
  // guessed at) both fail closed here.
  if (parts.length !== 2) return { kind: 'INVALID_GOAL_DEMAND' };

  const [planningLocalDate, goalActivityId] = parts;
  if (!isValidCalendarDateString(planningLocalDate)) return { kind: 'INVALID_GOAL_DEMAND' };
  if (!goalActivityId) return { kind: 'INVALID_GOAL_DEMAND' };

  // Canonical round-trip -- the decoded components, re-encoded, must
  // reproduce the exact original string. Cheap given the checks above
  // already guarantee it structurally; kept as an explicit, independent
  // assertion rather than relying on that implication silently holding.
  if (encodeGoalDemandIntentId(planningLocalDate, goalActivityId) !== intentId) return { kind: 'INVALID_GOAL_DEMAND' };

  return { kind: 'VALID_GOAL_DEMAND', planningLocalDate, goalActivityId };
}
