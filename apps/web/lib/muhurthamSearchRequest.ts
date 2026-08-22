import { findMuhurthams, isSupportedMuhurthamActivity, MuhurthamSearchRequest, MuhurthamSearchResult, SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../../../packages/recommendation/src/muhurthamFinder';
import { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import { TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { isDateOnlyString } from './timingSearchRequest';

/**
 * Pure request validation for POST /api/muhurtham-search, kept out of
 * app/api/muhurtham-search/route.ts for the same reason
 * timingSearchRequest.ts is kept out of the timing-search route.ts (Next's
 * route modules may only export HTTP handlers). Mirrors that file's shape.
 *
 * The 180-day search-range cap lives here, not in findMuhurthams() itself --
 * see muhurthamFinder.ts's own module doc comment for why that's a request
 * concern (an HTTP 400) rather than a domain one.
 */

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;
const MAX_DATE_RANGE_DAYS = 180;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

const VALID_TIME_PREFERENCES = new Set<TimingTimePreference>(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);

function daySpan(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
}

export type MuhurthamSearchValidationResult =
  | { ok: true; request: MuhurthamSearchRequest }
  | { ok: false; error: string; status: number };

/**
 * Validates a parsed JSON body into a MuhurthamSearchRequest. Takes the
 * already-resolved DailyAssistantContext (built from the session user by the
 * route) rather than resolving it itself, keeping this function free of I/O
 * so it can be unit-tested with a fake context -- same pattern as
 * buildTimingSearchRequest().
 */
export function buildMuhurthamSearchRequest(body: Record<string, unknown>, context: DailyAssistantContext): MuhurthamSearchValidationResult {
  const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
  if (!activityId) {
    return { ok: false, error: 'activityId is required.', status: 400 };
  }
  if (!isSupportedMuhurthamActivity(activityId)) {
    return { ok: false, error: `activityId must be one of: ${SUPPORTED_MUHURTHAM_ACTIVITY_IDS.join(', ')}.`, status: 400 };
  }

  const dateRange = body.dateRange as Record<string, unknown>;
  if (!dateRange || typeof dateRange !== 'object' || !isDateOnlyString(dateRange.start) || !isDateOnlyString(dateRange.end)) {
    return { ok: false, error: 'dateRange must be { start, end } as YYYY-MM-DD dates.', status: 400 };
  }
  const span = daySpan(dateRange.start, dateRange.end);
  if (span < 0) {
    return { ok: false, error: 'dateRange.end must be on or after dateRange.start.', status: 400 };
  }
  if (span > MAX_DATE_RANGE_DAYS) {
    return { ok: false, error: `dateRange must be ${MAX_DATE_RANGE_DAYS} days or fewer. For longer-range searches, use Life Timing instead.`, status: 400 };
  }

  const durationMinutes = body.durationMinutes === undefined ? undefined : Number(body.durationMinutes);
  if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES)) {
    return { ok: false, error: `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`, status: 400 };
  }

  const rawTimePreference = body.timePreference === undefined ? 'ANY' : String(body.timePreference);
  if (!VALID_TIME_PREFERENCES.has(rawTimePreference as TimingTimePreference)) {
    return { ok: false, error: 'Invalid time preference.', status: 400 };
  }

  const limit = body.limit === undefined ? undefined : Number(body.limit);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT)) {
    return { ok: false, error: `limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}.`, status: 400 };
  }

  const request: MuhurthamSearchRequest = {
    activityId,
    dateRange: { start: dateRange.start, end: dateRange.end },
    durationMinutes,
    timePreference: rawTimePreference as TimingTimePreference,
    limit,
    context,
  };

  return { ok: true, request };
}

/** Convenience wrapper: validate then run, for the route handler. */
export function handleMuhurthamSearchBody(body: Record<string, unknown>, context: DailyAssistantContext): { ok: true; result: MuhurthamSearchResult } | { ok: false; error: string; status: number } {
  const validated = buildMuhurthamSearchRequest(body, context);
  if (!validated.ok) return { ok: false, error: validated.error, status: validated.status };
  return { ok: true, result: findMuhurthams(validated.request) };
}
