/**
 * Lunar Intelligence V1 — L2: action-phase representation.
 *
 * REPRESENTATIONAL PLUMBING ONLY. This file declares what an "action phase"
 * IS -- the answer to "what part of this occurrence/activity are we
 * evaluating?" -- and nothing else. It contains no inference, no default,
 * no scoring, and no helper of any kind: a bare type, deliberately.
 *
 * ActionPhase is NOT:
 *   - an activity type (that's MuhurtaFamily/MuhurtaIntent, activityOntology.ts)
 *   - an execution/scheduling status (that's PlannedActivity.status / DailyAgendaItemStatus)
 *   - a timing-precision property of an activity KIND (that's TimingSensitivity)
 *   - a lifecycle or completion concept
 *
 * See the Lunar Intelligence V1 L2 audit for why this is deliberately an
 * ephemeral, optional EVALUATION INPUT rather than a field on
 * MuhurtaClassification, ActivityDefinition, or PlannedActivity: the same
 * activity definition can genuinely be START one day and FINISH another
 * (e.g. "Deep Work" on a report), so phase cannot correctly live on the
 * activity's own static identity -- only on a specific evaluation.
 *
 * Nothing in this file is inferred, defaulted, or read by any production
 * caller yet: it exists purely so evaluateActivityFit()/
 * evaluateMuhurtaWithRulePack() have a real, typed parameter to accept
 * (and currently ignore) instead of a future PR inventing one under time
 * pressure -- the same "declare it early, unused" precedent this codebase
 * already used for ActivityDurationMode's SESSION value
 * (packages/recommendation/src/activityDefinitions.ts).
 */

export type ActionPhase = 'START' | 'CONTINUE' | 'FINISH' | 'PREPARE' | 'REVIEW';
