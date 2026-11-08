import { resolveHistoricalActiveWindow } from './historicalActivityWindow';
import { getMinuteOfDayInTimezone } from './timezone';
import type { SolarWindowType } from '../../../packages/panchang/src/windows';
import { SolarNoEventError } from '../../../packages/astronomy/src/errors';

/**
 * Plan Completion Historical Integrity V1 -- the pure derivation step that
 * turns ONE completion instant + the owner's current Timing Location into
 * the three "actual observation" fields a Plan-completion HabitLog needs:
 * logTimestamp, activeWindow, logMinuteOfDay.
 *
 * This function owns no clock (it never calls `new Date()`) and no
 * Panchang/timezone math of its own -- it only composes the existing
 * canonical helpers (resolveHistoricalActiveWindow, getMinuteOfDayInTimezone)
 * that apps/web/app/api/habit-logs/route.ts already uses for exactly this
 * purpose. Pulled out as a standalone pure function so
 * apps/web/lib/db.ts's logPlannedActivity() can be tested deterministically
 * (a fixed completionInstant in, fixed fields out) without exposing a
 * client-controlled completion timestamp anywhere in the public API --
 * logPlannedActivity's own signature stays exactly
 * (userId: string, planId: string), and only it decides `new Date()`.
 *
 * Deliberately takes latitude/longitude/timezone as plain parameters, never
 * a User object -- this keeps the function from silently reaching for
 * birthLatitude/birthLongitude/birthTimezone or Event Location fields; the
 * caller must supply the owner's CURRENT Timing Location explicitly.
 */
export interface PlanCompletionHistory {
  logTimestamp: Date;
  activeWindow: SolarWindowType;
  logMinuteOfDay: number;
}

export function derivePlanCompletionHistory(params: {
  completionInstant: Date;
  latitude: number;
  longitude: number;
  timezone: string;
}): PlanCompletionHistory {
  const { completionInstant, latitude, longitude, timezone } = params;
  // PA-3C-C1B-01: a legitimate solar no-event condition must not prevent
  // this otherwise-valid plan completion from being recorded. Only
  // SolarNoEventError is caught -- SolarInputValidationError/
  // SolarComputationError are real bugs/bad data and must keep propagating.
  let activeWindow: SolarWindowType;
  try {
    activeWindow = resolveHistoricalActiveWindow(completionInstant, latitude, longitude, timezone);
  } catch (err) {
    if (err instanceof SolarNoEventError) {
      activeWindow = 'UNAVAILABLE';
    } else {
      throw err;
    }
  }
  return {
    logTimestamp: completionInstant,
    activeWindow,
    logMinuteOfDay: getMinuteOfDayInTimezone(timezone, completionInstant),
  };
}
