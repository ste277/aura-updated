// Product Instrumentation V1 -- pure funnel/percentile computation.
//
// Deliberately has zero database dependency: every function here takes
// already-fetched numbers (or raw rows) and returns a result, so the funnel
// math itself is unit-testable without a Postgres connection. The internal
// metrics API route (app/api/internal/product-metrics/route.ts) is the only
// caller that wires this up to lib/db.ts's query functions.
import type { ProductEventCountRow } from './db';

export type MetricsTimeWindow = '24h' | '7d' | '30d';

const WINDOW_MS: Record<MetricsTimeWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function isMetricsTimeWindow(value: string): value is MetricsTimeWindow {
  return value === '24h' || value === '7d' || value === '30d';
}

export function windowStart(window: MetricsTimeWindow, now: Date = new Date()): Date {
  return new Date(now.getTime() - WINDOW_MS[window]);
}

/** Nearest-rank percentile over a set of duration samples. Returns null for
 * an empty input rather than 0/NaN, so callers can render "no data" instead
 * of a misleading zero. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/** A ratio expressed as null (not 0) when the denominator is 0 -- "no data
 * yet" is a different fact from "0% conversion", and metrics consumers
 * should be able to tell them apart. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function totalCountForEvent(rows: ProductEventCountRow[], eventName: string): number {
  return rows.filter((r) => r.eventName === eventName).reduce((sum, r) => sum + r.count, 0);
}

export function countByGroupForEvent(rows: ProductEventCountRow[], eventName: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.eventName !== eventName || !r.group) continue;
    out[r.group] = (out[r.group] ?? 0) + r.count;
  }
  return out;
}

// ============================================================
// Core funnel metrics (brief section 9, metrics A-J)
// ============================================================

export interface FunnelMetricsInput {
  /** A: distinct users who started vs. completed a Plan search. */
  planStartedUsers: number;
  planSearchCompletedUsers: number;
  /** B/C: total Muhurtham searches completed, broken down by scope. */
  muhurthamSearchCompletedTotal: number;
  muhurthamSearchCompletedByScope: Record<string, number>;
  /** D-J: distinct-MOMENT counts across the Aura Moment lifecycle. */
  momentsCreated: number;
  momentsShareInitiated: number;
  momentsOpened: number;
  momentsAccepted: number;
  momentsAnotherTime: number;
  /** Distinct moments with ANY response (accepted OR another-time) -- a
   * true union, not accepted+anotherTime summed (a moment can fire both
   * over its lifetime). */
  momentsResponded: number;
  momentsAlternativeCreated: number;
  momentsFindYourOwnClicked: number;
}

export interface FunnelMetrics {
  /** A: Plan activation -- of users who started Plan, how many completed a search. */
  planActivationRate: number | null;
  /** B: Personalization rate -- share of Muhurtham searches that were PERSONAL or SHARED, not GENERAL. */
  personalizationRate: number | null;
  /** C: Shared adoption -- share of Muhurtham searches that were SHARED. */
  sharedAdoptionRate: number | null;
  /** D: Moment creation -- of SHARED searches, how many resulted in a created Aura Moment. */
  momentCreationRate: number | null;
  /** E: Share rate -- of created Moments, how many were actually shared (native share or copy link invoked). */
  shareRate: number | null;
  /** F: Open rate -- of shared Moments, how many were opened by the recipient. */
  openRate: number | null;
  /** G: Response rate -- of opened Moments, how many got any response. */
  responseRate: number | null;
  /** H: Accept rate -- of responses, how many were an accept (vs. another-time). */
  acceptRate: number | null;
  /** I: Rescheduling rate -- of another-time responses, how many led the owner to suggest a new Moment. */
  reschedulingRate: number | null;
  /** J: Acquisition intent -- of opened Moments, how many recipients clicked "find your own". */
  acquisitionIntentRate: number | null;
}

export function computeFunnelMetrics(input: FunnelMetricsInput): FunnelMetrics {
  return {
    planActivationRate: rate(input.planSearchCompletedUsers, input.planStartedUsers),
    personalizationRate: rate(
      (input.muhurthamSearchCompletedByScope.PERSONAL ?? 0) + (input.muhurthamSearchCompletedByScope.SHARED ?? 0),
      input.muhurthamSearchCompletedTotal
    ),
    sharedAdoptionRate: rate(input.muhurthamSearchCompletedByScope.SHARED ?? 0, input.muhurthamSearchCompletedTotal),
    momentCreationRate: rate(input.momentsCreated, input.muhurthamSearchCompletedByScope.SHARED ?? 0),
    shareRate: rate(input.momentsShareInitiated, input.momentsCreated),
    openRate: rate(input.momentsOpened, input.momentsShareInitiated),
    responseRate: rate(input.momentsResponded, input.momentsOpened),
    acceptRate: rate(input.momentsAccepted, input.momentsResponded),
    reschedulingRate: rate(input.momentsAlternativeCreated, input.momentsAnotherTime),
    acquisitionIntentRate: rate(input.momentsFindYourOwnClicked, input.momentsOpened),
  };
}
