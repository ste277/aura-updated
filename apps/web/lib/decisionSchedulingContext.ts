/**
 * Constructor Decision Intelligence -- O5 P2d: the DECISION SCHEDULING CONTEXT (pure data + pure derivations).
 *
 * THE PROBLEM THIS CLOSES. DecisionEvidence is deeply immutable once built -- but it was built from facts assembled by
 * INDEPENDENT database reads (the Rhythm recurrence read, the duration sources, the availability configuration and the
 * persisted plans that block the opportunity horizon). Independent reads can observe different committed states, so
 * immutable evidence could faithfully freeze a view that never existed in the database: for example "three occurrences
 * remain" (read before a plan was committed) next to "the day is fully blocked" (read after it).
 *
 * THE FIX. Every database-derived input that can change the evidence is read ONCE, inside ONE short PostgreSQL
 * REPEATABLE READ transaction (decisionSchedulingContextLoader.ts), into this detached, deep-frozen context. The
 * transaction then ends. Everything after that is CPU over the context: the recurrence facts, the duration resolution, the
 * availability / blocker adaptation and the opportunity projection read the context only and never the database.
 *
 *   resolve request / static inputs -> [ REPEATABLE READ: read -> DecisionSchedulingContext ] -> transaction ends
 *     -> CPU projection and classification -> DecisionFacts -> immutable DecisionEvidence -> (DecisionPressure -> shadow)
 *
 * AUTHORITY CLASSIFICATION of every input to the evidence:
 *
 *   DATABASE_SNAPSHOT_AUTHORITY (in this context, one snapshot)
 *     - recurrence demand: the candidate Rhythm activities and their linked-occurrence rows (plan start and status)
 *     - duration sources: stored activity-duration preferences and the recent habit logs behavioral duration derives from
 *     - availability: the persisted "configured" flag and the weekly availability periods
 *     - blockers: the persisted plans overlapping the opportunity horizon
 *   REQUEST_AUTHORITY (one authenticated request, read once, not snapshot state)
 *     - the planning date, the user's timezone, the reference instant `now`, a requested duration, intent ids
 *   IMMUTABLE_STATIC_AUTHORITY (in-process data, deterministic for a code version; never in the transaction)
 *     - the activity catalog: default / suggested durations, activity identity, the Rhythm and lifecycle rules
 *   CPU_DERIVED (computed from the above, outside the transaction)
 *     - Rhythm counts, the opportunity projection (O1), DecisionFacts, DecisionEvidence, DecisionPressure
 *
 * NOT IN THIS CONTEXT, on purpose: the Constructor's OWN placement inputs (the target-day blockers and, for a
 * remaining-today window, the availability it constructs in) -- they decide placement, never the evidence. The context
 * holds no pressure, no classification, no shadow output, no promotion and no contention.
 *
 * GENERIC AND SOURCE-NEUTRAL: nothing here branches on where a candidate came from (manual / automatic / Goal). The rows are
 * the Rhythm read model's own inputs, carried as detached scalars; a context is loaded once per planning evaluation, never
 * per candidate. OWNERSHIP: instants are ISO strings, every nested value is a copy, and the whole value is deep-frozen; each
 * derivation below builds fresh objects (new Date instances, new arrays) so no layer shares mutable state.
 */

import type { CandidateGoalActivityForRhythmDemandRow, GoalActivityOccurrenceRow } from './db';
import type { AvailabilityConfiguration } from './availabilityContext';
import type { OpportunityRangeDeps } from './opportunityRangeAdapter';
import type { PlanBlockerCandidate, PlanBlockerStatus } from './planBlockerLifecycle';
import { buildDurationContext, type DurationContext } from './durationContext';
import { userActivityPreferencesFromRows } from './activityPreferences';

export interface SchedulingContextOccurrenceRow {
  readonly goalActivityId: string;
  readonly plannedStartAt: string;
  readonly status: string;
  /** Insights V1 PR2 -- carried through unchanged from GoalActivityOccurrenceRow (see db.ts). */
  readonly scheduledWeekStart: string | null;
  readonly scheduledWeekTimezone: string | null;
}

export interface SchedulingContextRecurrence {
  readonly candidateRows: readonly CandidateGoalActivityForRhythmDemandRow[];
  readonly occurrenceRows: readonly SchedulingContextOccurrenceRow[];
}

export interface SchedulingContextDurationSources {
  readonly preferenceRows: readonly { readonly activityId: string; readonly preferredDurationMinutes: number }[];
  readonly habitLogs: readonly { readonly activityId: string | null; readonly logTimestamp: string; readonly durationMinutes: number }[];
}

/** Present only when at least one recurrence candidate exists (otherwise no opportunity evidence can be produced). */
export interface SchedulingContextOpportunity {
  readonly configured: boolean;
  readonly periods: readonly { readonly weekday: number; readonly startTime: string; readonly endTime: string }[];
  /** The UTC range the persisted plans were read for: exactly the opportunity horizon the projection will request. */
  readonly planRangeFrom: string;
  readonly planRangeTo: string;
  readonly plans: readonly { readonly start: string; readonly end: string; readonly status: string }[];
}

export interface DecisionSchedulingContext {
  readonly recurrence: SchedulingContextRecurrence;
  readonly durationSources: SchedulingContextDurationSources;
  readonly opportunity: SchedulingContextOpportunity | undefined;
}

/** What the loader read inside the snapshot, before it is copied and frozen (outside the transaction). */
export interface DecisionSchedulingContextParts {
  recurrence: { candidateRows: readonly CandidateGoalActivityForRhythmDemandRow[]; occurrenceRows: readonly GoalActivityOccurrenceRow[] };
  durationSources: { preferenceRows: readonly { activityId: string; preferredDurationMinutes: number }[]; habitLogs: readonly { activityId?: string | null; logTimestamp: Date | string; durationMinutes: number }[] };
  opportunity?: { configured: boolean; periods: readonly { weekday: number; startTime: string; endTime: string }[]; planRangeFrom: Date; planRangeTo: Date; plans: readonly { plannedStartAt: Date | string; plannedEndAt: Date | string; status: string }[] };
}

const iso = (value: Date | string): string => new Date(value).toISOString();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Copies the rows read inside the snapshot into a detached, deep-frozen context. Pure; runs AFTER the transaction has ended. */
export function createDecisionSchedulingContext(parts: DecisionSchedulingContextParts): DecisionSchedulingContext {
  return deepFreeze({
    recurrence: {
      candidateRows: parts.recurrence.candidateRows.map((row) => ({ goalActivityId: row.goalActivityId, goalId: row.goalId, goalTitle: row.goalTitle, title: row.title, activityId: row.activityId, rhythmKind: row.rhythmKind, rhythmTargetPerWeek: row.rhythmTargetPerWeek })),
      occurrenceRows: parts.recurrence.occurrenceRows.map((row) => ({ goalActivityId: row.goalActivityId, plannedStartAt: iso(row.plannedStartAt), status: row.status, scheduledWeekStart: row.scheduledWeekStart, scheduledWeekTimezone: row.scheduledWeekTimezone })),
    },
    durationSources: {
      preferenceRows: parts.durationSources.preferenceRows.map((row) => ({ activityId: row.activityId, preferredDurationMinutes: row.preferredDurationMinutes })),
      habitLogs: parts.durationSources.habitLogs.map((log) => ({ activityId: log.activityId ?? null, logTimestamp: iso(log.logTimestamp), durationMinutes: log.durationMinutes })),
    },
    opportunity: parts.opportunity
      ? {
          configured: parts.opportunity.configured,
          periods: parts.opportunity.periods.map((period) => ({ weekday: period.weekday, startTime: period.startTime, endTime: period.endTime })),
          planRangeFrom: iso(parts.opportunity.planRangeFrom),
          planRangeTo: iso(parts.opportunity.planRangeTo),
          plans: parts.opportunity.plans.map((plan) => ({ start: iso(plan.plannedStartAt), end: iso(plan.plannedEndAt), status: plan.status })),
        }
      : undefined,
  });
}

/**
 * The availability / blocker dependencies the opportunity adapter (O2) consumes, answered from the context -- never from
 * the database. A request for a plan range the snapshot did not cover, or for availability the context did not read, FAILS
 * (the preparer is fail-open, so the result is no opportunity evidence): it never falls back to a live read and never
 * guesses. Each call returns fresh objects.
 */
export function schedulingContextOpportunityRangeDeps(context: DecisionSchedulingContext): OpportunityRangeDeps {
  return {
    loadAvailabilityConfiguration: async () => {
      const opportunity = context.opportunity;
      if (!opportunity) throw new Error('decision scheduling context holds no availability');
      return { configured: opportunity.configured, periods: opportunity.periods.map((period) => ({ weekday: period.weekday as AvailabilityConfiguration['periods'][number]['weekday'], startTime: period.startTime, endTime: period.endTime })) };
    },
    loadPlansOverlappingRange: async (bounds) => {
      const opportunity = context.opportunity;
      if (!opportunity) throw new Error('decision scheduling context holds no plans');
      if (bounds.from.getTime() < Date.parse(opportunity.planRangeFrom) || bounds.to.getTime() > Date.parse(opportunity.planRangeTo)) throw new Error('requested plan range lies outside the snapshot range');
      return opportunity.plans
        .map((plan): PlanBlockerCandidate => ({ start: new Date(plan.start), end: new Date(plan.end), status: plan.status as PlanBlockerStatus }))
        .filter((plan) => plan.start.getTime() < bounds.to.getTime() && plan.end.getTime() > bounds.from.getTime());
    },
  };
}

/** The duration-personalization maps for this evaluation, derived (CPU) from the snapshot's preference rows and habit logs by the one shared assembly. */
export function schedulingContextDurationContext(context: DecisionSchedulingContext, timezone: string, now: Date): DurationContext {
  return buildDurationContext(
    userActivityPreferencesFromRows(context.durationSources.preferenceRows),
    context.durationSources.habitLogs.map((log) => ({ activityId: log.activityId, logTimestamp: new Date(log.logTimestamp), durationMinutes: log.durationMinutes })),
    timezone,
    now
  );
}
