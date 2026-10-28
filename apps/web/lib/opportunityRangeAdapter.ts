/**
 * Opportunity Scarcity V1 -- O2: the generic, read-only range adapter.
 *
 * For an explicit inclusive civil-date range, a timezone and an explicit
 * `now`, produces the two inputs the pure projection engine
 * (opportunityProjection.ts) consumes: per-date availability and a flat
 * list of generic blockers. It decides nothing else: not why the range
 * exists, how many occurrences are needed, or what any result means.
 *
 * SOURCE-NEUTRAL: no knowledge of where a range comes from. The caller
 * supplies the dates.
 *
 * AVAILABILITY. Reuses the canonical `resolveAvailability`
 * (availabilityContext.ts) -- no weekday/template logic is reproduced.
 *   - An unconfigured user is UNKNOWN for every date. The constructor's
 *     "remaining today" fallback is deliberately NOT used: an application
 *     default is not known availability.
 *   - A configured date whose weekday has no windows is KNOWN with zero
 *     windows (known empty).
 *   - The canonical resolver clips a date's windows only when that date
 *     is the local date of the reference instant it is given. Clipping
 *     belongs to the projection engine, so templates are resolved
 *     relative to an instant before the range, which never clips; the
 *     windows supplied are the full-day canonical windows.
 *   - Local wall times become instants through the canonical timezone
 *     helpers only. A window boundary that falls inside a DST transition
 *     hour (a wall time that does not exist, or that happens twice) cannot
 *     be converted exactly, so that date is UNKNOWN rather than guessed.
 *   - The weekly template has no date-specific exceptions (holidays,
 *     travel, one-off hours), so a configured future date reflects the
 *     recurring template only.
 *
 * BLOCKERS. Persisted Plans overlapping the range, filtered by the
 * canonical lifecycle (`isActivePlanBlocker`, planBlockerLifecycle.ts),
 * returned as absolute-instant intervals. They are not split by day: each
 * interval applies to every day it overlaps, so a Plan spanning midnight
 * or the range edge is seen by every affected day. Only persisted Plans
 * are known; unsaved candidate intents and external calendar events are
 * not represented.
 *
 * COST. One availability-configuration load and one plan query for the
 * whole range, independent of its length; everything else is in memory.
 *
 * READ-ONLY and DETERMINISTIC: no writes, no clock (`now` is supplied).
 */

import { getWeekdayForDateStr, resolveAvailability, type AvailabilityConfiguration } from './availabilityContext';
import type { BlockedInterval } from './dayCapacity';
import { MAX_PROJECTION_HORIZON_DAYS, type DayAvailabilityInput } from './opportunityProjection';
import { isActivePlanBlocker, type PlanBlockerCandidate } from './planBlockerLifecycle';
import { addDaysToDateStr, getDatePartsInTimezone, localDateTimeToUTC, resolveLocalDateTime } from './timezone';
import { isValidCalendarDateString } from '../../../packages/panchang/src/localDate';

export interface OpportunityRangeRequest {
  /** First local civil date (YYYY-MM-DD), inclusive. */
  startDate: string;
  /** Last local civil date (YYYY-MM-DD), inclusive. */
  endDate: string;
  /** Timezone the civil dates and weekly template are read in. */
  timezone: string;
  /** Explicit reference instant, used only for the Plan lifecycle. */
  now: Date;
}

/** Everything the adapter needs to read, injected so it is directly
 * testable. Both are scoped to the authenticated user by their wiring. */
export interface OpportunityRangeDeps {
  /** Loaded exactly once per call. */
  loadAvailabilityConfiguration: () => Promise<AvailabilityConfiguration>;
  /** Called exactly once per call, with the whole range's UTC bounds.
   * Must return Plans overlapping `[from, to)`. */
  loadPlansOverlappingRange: (bounds: { from: Date; to: Date }) => Promise<readonly PlanBlockerCandidate[]>;
}

export interface OpportunityRangeInputs {
  /** One entry for every date in the range. */
  availabilityByDate: ReadonlyMap<string, DayAvailabilityInput>;
  blockers: readonly BlockedInterval[];
}

export type OpportunityRangeErrorCode = 'INVALID_DATE' | 'INVALID_RANGE' | 'RANGE_TOO_LONG' | 'INVALID_TIMEZONE' | 'INVALID_NOW';

export type OpportunityRangeResult = { status: 'OK'; inputs: OpportunityRangeInputs } | { status: 'INVALID_INPUT'; code: OpportunityRangeErrorCode };

/**
 * O5 P2d -- the UTC bounds `loadOpportunityRangeInputs` asks its plan loader for, for an inclusive civil-date range: local
 * start of the first date through local start of the day after the last date. Exported so a snapshot read can fetch EXACTLY
 * the range the projection will later request, from one definition.
 */
export function computeOpportunityRangeBounds(startDate: string, endDate: string, timezone: string): { from: Date; to: Date } {
  return { from: localDateTimeToUTC(startDate, '00:00', timezone), to: localDateTimeToUTC(addDaysToDateStr(endDate, 1), '00:00', timezone) };
}

type ValidatedRange = { ok: true; dates: string[]; bounds: { from: Date; to: Date } } | { ok: false; code: OpportunityRangeErrorCode };

function validateRange(request: OpportunityRangeRequest): ValidatedRange {
  const { startDate, endDate, timezone, now } = request;
  if (typeof startDate !== 'string' || typeof endDate !== 'string' || !isValidCalendarDateString(startDate) || !isValidCalendarDateString(endDate)) return { ok: false, code: 'INVALID_DATE' };
  if (endDate < startDate) return { ok: false, code: 'INVALID_RANGE' };
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return { ok: false, code: 'INVALID_NOW' };
  try {
    getDatePartsInTimezone(timezone, now);
  } catch {
    return { ok: false, code: 'INVALID_TIMEZONE' };
  }
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDaysToDateStr(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_PROJECTION_HORIZON_DAYS) return { ok: false, code: 'RANGE_TOO_LONG' };
  }
  // The range's UTC bounds from the canonical conversion, not 24-hour
  // arithmetic: local start of the first date through local start of the
  // day after the last date (the same formula the planning day bounds use).
  return {
    ok: true,
    dates,
    bounds: computeOpportunityRangeBounds(startDate, endDate, timezone),
  };
}

/** True when every configured window boundary on `date` resolves to
 * exactly one instant. */
function boundariesAreExact(date: string, timezone: string, configuration: AvailabilityConfiguration): boolean {
  const weekday = getWeekdayForDateStr(date);
  return configuration.periods
    .filter((period) => period.weekday === weekday)
    .every((period) => resolveLocalDateTime(date, period.startTime, timezone).status === 'OK' && resolveLocalDateTime(date, period.endTime, timezone).status === 'OK');
}

/**
 * Pure adaptation of already-loaded data. Exposed so the range logic is
 * testable without any loader.
 */
export function adaptOpportunityRangeInputs(request: OpportunityRangeRequest, configuration: AvailabilityConfiguration, plans: readonly PlanBlockerCandidate[]): OpportunityRangeResult {
  const range = validateRange(request);
  if (!range.ok) return { status: 'INVALID_INPUT', code: range.code };
  const { dates, bounds } = range;
  const { timezone, now } = request;

  // An instant before the range, so the canonical resolver never clips a
  // date at it: clipping is the projection engine's responsibility.
  const unclippedReference = new Date(bounds.from.getTime() - 24 * 60 * 60 * 1000);

  const availabilityByDate = new Map<string, DayAvailabilityInput>();
  for (const date of dates) {
    const resolution = resolveAvailability({ targetDate: date, timezone, now: unclippedReference, configuration });
    if (resolution.status === 'UNCONFIGURED' || !boundariesAreExact(date, timezone, configuration)) {
      availabilityByDate.set(date, { kind: 'UNKNOWN' });
    } else {
      availabilityByDate.set(date, { kind: 'KNOWN', windows: resolution.usableWindows.map((window) => ({ start: window.start, end: window.end })) });
    }
  }

  const blockers: BlockedInterval[] = plans
    .filter((plan) => plan.start.getTime() < bounds.to.getTime() && plan.end.getTime() > bounds.from.getTime())
    .filter((plan) => isActivePlanBlocker(plan, now))
    .map((plan) => ({ start: plan.start, end: plan.end, source: 'FIXED_PLAN' as const }));

  return { status: 'OK', inputs: { availabilityByDate, blockers } };
}

/**
 * Loads (once) and adapts. Invalid input fails before any load.
 */
export async function loadOpportunityRangeInputs(request: OpportunityRangeRequest, deps: OpportunityRangeDeps): Promise<OpportunityRangeResult> {
  const range = validateRange(request);
  if (!range.ok) return { status: 'INVALID_INPUT', code: range.code };
  const [configuration, plans] = await Promise.all([deps.loadAvailabilityConfiguration(), deps.loadPlansOverlappingRange(range.bounds)]);
  return adaptOpportunityRangeInputs(request, configuration, plans);
}
