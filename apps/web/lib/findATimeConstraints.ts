/**
 * AURA-HPG5-V2-I1 -- Find a Time availability and conflict enforcement.
 *
 * Find a Time (`POST /api/timing-search`, mode FIND) used to search every
 * minute of the requested days, ignoring the user's saved availability and
 * their existing plans, so it could recommend 12:00 AM slots or a time that
 * overlaps a plan already on the calendar (HPG5-V1 finding V1-01).
 *
 * The timing engine (packages/recommendation/src/timingSearch.ts) already
 * accepts exactly the two hard constraints needed -- `searchWindow` and
 * `excludedIntervals` -- and applies them BEFORE Panchang/Muhurta evaluation
 * and ranking. Plan My Day already feeds them. This module builds the same
 * two inputs for Find a Time from the SAME existing rules, so no second
 * availability or blocker policy is introduced:
 *
 *   - availability: `resolveAvailability` + `mergeUsableWindows`
 *     (availabilityContext.ts) -- per local date, timezone-aware through
 *     `localDateTimeToUTC`, today clipped at `now`, same-day periods only
 *     (cross-midnight periods are rejected at save time and are NOT
 *     invented here). UNCONFIGURED means "no availability constraint" --
 *     no new overnight restriction is added for such users.
 *   - existing plans: `isActivePlanBlocker` (planBlockerLifecycle.ts) --
 *     CANCELLED/SKIPPED/MOVED never block, LOGGED blocks, UPCOMING blocks
 *     unless already over. Intervals are half-open, so a candidate that
 *     merely touches a plan (end == start) stays eligible -- the engine's
 *     own overlap test is strict on both sides.
 *   - save time: `findBlockingPlanForRange` (planMove.ts) stays the single
 *     overlap decision; `describeFirstBlockingPlanForRange` below only
 *     names the conflict for the UI using the identical predicate.
 *
 * Daily Rhythm (a soft preference) and Panchang ranking are untouched: they
 * run afterwards, over the eligible candidates only.
 */

import { localDateForContext, resolveHorizonDayOffsets, buildDateOffsets } from '../../../packages/recommendation/src/dailyAssistant';
import type { TimingSearchRequest } from '../../../packages/recommendation/src/timingSearch';
import { resolveAvailability, mergeUsableWindows, type AvailabilityConfiguration } from './availabilityContext';
import { isActivePlanBlocker, type PlanBlockerCandidate } from './planBlockerLifecycle';
import { addDaysToDateStr, localDateTimeToUTC } from './timezone';
import { listPlannedActivitiesOverlappingRange, listUserAvailabilityPeriods, type User } from './db';

export interface TimeInterval {
  start: Date;
  end: Date;
}

/** The engine clamps FIND durations to at most 360 minutes; plan loading is
 * padded by the same amount on both sides so a plan that starts the previous
 * day and runs past midnight, or the engine's fixed-offset local-minute
 * mapping drifting across a DST change, can never leave a real blocker
 * unloaded. Extra plans outside the searched space are harmless. */
const LOAD_PADDING_MS = 360 * 60000;

/**
 * The local civil dates (`YYYY-MM-DD`, in the request context's timezone)
 * that `runTimingSearch` will actually iterate for this FIND request.
 * Reproduces the engine's private `resolveSearchDayOffsets` using the SAME
 * exported helpers it calls (`buildDateOffsets`, `resolveHorizonDayOffsets`,
 * `localDateForContext`) -- no new horizon logic.
 */
export function resolveFindATimeSearchDates(request: Pick<TimingSearchRequest, 'context' | 'dateRange' | 'horizon' | 'customStartDate' | 'customEndDate'>): string[] {
  const local = localDateForContext(request.context);
  const offsets = request.dateRange
    ? buildDateOffsets(local, request.dateRange.start, request.dateRange.end)
    : request.horizon
    ? resolveHorizonDayOffsets(request.horizon, request.context, request.customStartDate, request.customEndDate)
    : [0];
  const baseDate = local.toISOString().slice(0, 10);
  return Array.from(new Set(offsets.map((offset) => addDaysToDateStr(baseDate, offset)))).sort();
}

/** Half-open `[from, to)` range of plans to load for the searched dates. */
export function resolveFindATimeLoadBounds(dates: readonly string[], timezone: string): TimeInterval | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const from = localDateTimeToUTC(sorted[0], '00:00', timezone);
  const to = localDateTimeToUTC(addDaysToDateStr(sorted[sorted.length - 1], 1), '00:00', timezone);
  return { start: new Date(from.getTime() - LOAD_PADDING_MS), end: new Date(to.getTime() + LOAD_PADDING_MS) };
}

export interface FindATimeConstraintInput {
  /** Local dates the engine will search (resolveFindATimeSearchDates). */
  dates: readonly string[];
  /** The user's IANA timezone (User.timezone -- the single authority). */
  timezone: string;
  /** The request's own `now` (also the blocker reference instant). */
  now: Date;
  availability: AvailabilityConfiguration;
  /** Raw plan rows overlapping the load bounds; lifecycle filtering happens here. */
  plans: readonly PlanBlockerCandidate[];
}

export interface FindATimeConstraints {
  availabilityStatus: 'CONFIGURED' | 'UNCONFIGURED';
  /** Outer bound of every usable availability window across the searched
   * dates. Absent when availability is UNCONFIGURED. */
  searchWindow?: TimeInterval;
  /** Gaps between usable windows (overnight, unavailable weekdays, breaks
   * inside a day) plus every active blocking plan. */
  excludedIntervals: TimeInterval[];
  blockingPlanCount: number;
  /** False only when availability is CONFIGURED and no usable window exists
   * anywhere in the searched dates (e.g. today's window already elapsed). */
  hasUsableAvailability: boolean;
}

/**
 * Pure. Builds the engine's existing `searchWindow` / `excludedIntervals`
 * inputs. A multi-day search is represented exactly the way the engine's own
 * doc comment prescribes for a single-interval `searchWindow`: the outer
 * span, minus every gap between usable windows.
 */
export function buildFindATimeConstraints(input: FindATimeConstraintInput): FindATimeConstraints {
  const { dates, timezone, now, availability, plans } = input;

  const blockers: TimeInterval[] = plans
    .filter((plan) => isActivePlanBlocker(plan, now))
    .map((plan) => ({ start: plan.start, end: plan.end }))
    .filter((interval) => interval.end.getTime() > interval.start.getTime());

  const resolutions = dates.map((targetDate) => resolveAvailability({ targetDate, timezone, now, configuration: availability }));
  if (!availability.configured || resolutions.every((resolution) => resolution.status === 'UNCONFIGURED')) {
    return { availabilityStatus: 'UNCONFIGURED', excludedIntervals: blockers, blockingPlanCount: blockers.length, hasUsableAvailability: true };
  }

  const usable = mergeUsableWindows(
    resolutions.flatMap((resolution) => (resolution.status === 'CONFIGURED' ? resolution.usableWindows : []))
      .filter((window) => window.end.getTime() > window.start.getTime())
  );

  if (usable.length === 0) {
    // A zero-length window: the engine's `searchWindow` check rejects every
    // candidate before evaluation, so no out-of-availability slot is ever
    // offered as a silent fallback.
    return { availabilityStatus: 'CONFIGURED', searchWindow: { start: now, end: now }, excludedIntervals: blockers, blockingPlanCount: blockers.length, hasUsableAvailability: false };
  }

  const gaps: TimeInterval[] = [];
  for (let i = 0; i < usable.length - 1; i += 1) {
    gaps.push({ start: usable[i].end, end: usable[i + 1].start });
  }

  return {
    availabilityStatus: 'CONFIGURED',
    searchWindow: { start: usable[0].start, end: usable[usable.length - 1].end },
    excludedIntervals: [...gaps, ...blockers],
    blockingPlanCount: blockers.length,
    hasUsableAvailability: true,
  };
}

/** Thin loader: the SAME two repository reads (and the same row mapping)
 * `createRealDayConstructorOrchestratorDeps` uses for Plan My Day. */
export async function loadFindATimeConstraintInputs(user: Pick<User, 'id' | 'availabilityConfigured'>, bounds: TimeInterval): Promise<{ availability: AvailabilityConfiguration; plans: PlanBlockerCandidate[] }> {
  const [periods, plans] = await Promise.all([
    listUserAvailabilityPeriods(user.id),
    listPlannedActivitiesOverlappingRange(user.id, bounds.start, bounds.end),
  ]);
  return {
    availability: {
      configured: user.availabilityConfigured === true,
      periods: periods.map((row) => ({ weekday: row.weekday as AvailabilityConfiguration['periods'][number]['weekday'], startTime: row.startTime, endTime: row.endTime })),
    },
    plans: plans.map((plan) => ({ start: new Date(plan.plannedStartAt), end: new Date(plan.plannedEndAt), status: plan.status })),
  };
}

/** Response metadata added to a FIND response (additive, optional). */
export interface FindATimeConstraintSummary {
  availability: 'CONFIGURED' | 'UNCONFIGURED';
  blockedPlanCount: number;
}

export type FindATimeEmptyReason = 'NO_ELIGIBLE_TIME' | 'NO_AVAILABILITY_IN_RANGE';

export function summarizeFindATimeConstraints(constraints: FindATimeConstraints): FindATimeConstraintSummary {
  return { availability: constraints.availabilityStatus, blockedPlanCount: constraints.blockingPlanCount };
}

/** Why a constrained FIND came back empty, or undefined when it did not. */
export function resolveFindATimeEmptyReason(constraints: FindATimeConstraints, candidateCount: number): FindATimeEmptyReason | undefined {
  if (candidateCount > 0) return undefined;
  if (!constraints.hasUsableAvailability) return 'NO_AVAILABILITY_IN_RANGE';
  return 'NO_ELIGIBLE_TIME';
}

// ============================================================
// Save-time conflict description (POST /api/plans, overlapPolicy
// REJECT_ACTIVE_OVERLAP). The overlap DECISION is always
// `findBlockingPlanForRange`; this only names the conflict.
// ============================================================

export const PLAN_OVERLAP_CODE = 'PLAN_OVERLAP' as const;
export const OVERLAP_POLICIES = ['ALLOW', 'REJECT_ACTIVE_OVERLAP'] as const;
export type OverlapPolicy = (typeof OVERLAP_POLICIES)[number];

/** Absent -> 'ALLOW' (every existing caller unchanged). Unknown -> null (400). */
export function parseOverlapPolicy(value: unknown): OverlapPolicy | null {
  if (value === undefined || value === null) return 'ALLOW';
  return typeof value === 'string' && (OVERLAP_POLICIES as readonly string[]).includes(value) ? (value as OverlapPolicy) : null;
}

/** The minimum the UI needs to name a conflict: the plan's own title and
 * time. No id, no other fields. */
export interface PlanOverlapConflict {
  title: string;
  plannedStartAt: string;
  plannedEndAt: string;
}

/** Same rows, same predicate as `findBlockingPlanForRange` (planMove.ts):
 * half-open overlap, `isActivePlanBlocker` lifecycle. Earliest first. Runs
 * on the caller's transaction client so it sees the same snapshot. */
export async function describeFirstBlockingPlanForRange(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  userId: string,
  start: Date,
  end: Date,
  now: Date
): Promise<PlanOverlapConflict | null> {
  const result = await client.query(
    `SELECT title, "plannedStartAt", "plannedEndAt", status FROM "PlannedActivity"
     WHERE "userId" = $1 AND "plannedStartAt" < $3 AND "plannedEndAt" > $2
     ORDER BY "plannedStartAt" ASC`,
    [userId, start, end]
  );
  for (const row of result.rows) {
    const rowStart = new Date(row.plannedStartAt);
    const rowEnd = new Date(row.plannedEndAt);
    if (!isActivePlanBlocker({ start: rowStart, end: rowEnd, status: row.status }, now)) continue;
    if (!(start.getTime() < rowEnd.getTime() && rowStart.getTime() < end.getTime())) continue;
    return { title: String(row.title), plannedStartAt: rowStart.toISOString(), plannedEndAt: rowEnd.toISOString() };
  }
  return null;
}
