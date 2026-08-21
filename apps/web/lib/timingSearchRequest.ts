import { runTimingSearch, TimingSearchMode, TimingSearchRequest, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { DailyAssistantContext, PlanningHorizon } from '../../../packages/recommendation/src/dailyAssistant';

/**
 * Pure request validation for POST /api/timing-search, kept out of
 * app/api/timing-search/route.ts because Next's App Router route modules may
 * only export HTTP method handlers and a small set of config options --
 * exporting an arbitrary helper from a route.ts fails Next's own route
 * type-check (`OmitWithTag<...> does not satisfy the constraint`). Living
 * here also makes it testable without mocking NextRequest/session/DB -- see
 * test/timingSearchApi.test.ts.
 */

const MAX_TASK_TITLE_LENGTH = 200;
const MAX_ACTIVITY_ID_LENGTH = 100;
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;
const MAX_DATE_RANGE_DAYS = 90;
const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const MIN_COMPARE_CANDIDATES = 2;
const MAX_COMPARE_CANDIDATES = 6;
const MIN_CHECK_NEARBY_WINDOW_MINUTES = 0;
const MAX_CHECK_NEARBY_WINDOW_MINUTES = 720;

const VALID_MODES = new Set<TimingSearchMode>(['FIND', 'CHECK', 'COMPARE']);
const VALID_HORIZONS = new Set<PlanningHorizon>(['NOW', 'TODAY', 'TOMORROW', 'WEEKEND', 'SEVEN_DAYS', 'CUSTOM']);
const VALID_TIME_PREFERENCES = new Set<TimingTimePreference>(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);

export function isDateOnlyString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isIsoInstantString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
}

function daySpan(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
}

export type TimingSearchValidationResult =
  | { ok: true; request: TimingSearchRequest }
  | { ok: false; error: string; status: number };

/**
 * Validates a parsed JSON body into a TimingSearchRequest. Takes the
 * already-resolved DailyAssistantContext (built from the session user by the
 * route) rather than resolving it itself, keeping this function free of I/O
 * so it can be unit-tested with a fake context.
 */
export function buildTimingSearchRequest(body: Record<string, unknown>, context: DailyAssistantContext): TimingSearchValidationResult {
  const mode = String(body?.mode || '') as TimingSearchMode;
  if (!VALID_MODES.has(mode)) {
    return { ok: false, error: 'mode must be one of FIND, CHECK, COMPARE.', status: 400 };
  }

  const activityId = typeof body.activityId === 'string' && body.activityId.trim() ? body.activityId.trim() : undefined;
  const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle.trim() : '';
  if (activityId && activityId.length > MAX_ACTIVITY_ID_LENGTH) {
    return { ok: false, error: `activityId must be ${MAX_ACTIVITY_ID_LENGTH} characters or fewer.`, status: 400 };
  }
  if (!activityId && (!taskTitle || taskTitle.length > MAX_TASK_TITLE_LENGTH)) {
    return { ok: false, error: `Either activityId or a taskTitle of up to ${MAX_TASK_TITLE_LENGTH} characters is required.`, status: 400 };
  }

  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    return { ok: false, error: `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`, status: 400 };
  }

  const rawTimePreference = body.timePreference === undefined ? 'ANY' : String(body.timePreference);
  if (!VALID_TIME_PREFERENCES.has(rawTimePreference as TimingTimePreference)) {
    return { ok: false, error: 'Invalid time preference.', status: 400 };
  }
  const timePreference = rawTimePreference as TimingTimePreference;

  const request: TimingSearchRequest = {
    mode,
    activityId,
    taskTitle: activityId ? undefined : taskTitle,
    durationMinutes,
    timePreference,
    context,
  };

  if (mode === 'FIND') {
    const rawLimit = body.limit === undefined ? undefined : Number(body.limit);
    if (rawLimit !== undefined && (!Number.isFinite(rawLimit) || rawLimit < MIN_LIMIT || rawLimit > MAX_LIMIT)) {
      return { ok: false, error: `limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}.`, status: 400 };
    }
    request.limit = rawLimit;

    if (body.dateRange !== undefined) {
      const dateRange = body.dateRange as Record<string, unknown>;
      if (!dateRange || typeof dateRange !== 'object' || !isDateOnlyString(dateRange.start) || !isDateOnlyString(dateRange.end)) {
        return { ok: false, error: 'dateRange must be { start, end } as YYYY-MM-DD dates.', status: 400 };
      }
      const span = daySpan(dateRange.start, dateRange.end);
      if (span < 0 || span > MAX_DATE_RANGE_DAYS) {
        return { ok: false, error: `dateRange must be between 0 and ${MAX_DATE_RANGE_DAYS} days.`, status: 400 };
      }
      request.dateRange = { start: dateRange.start, end: dateRange.end };
    } else {
      const horizon = String(body.horizon || 'TODAY') as PlanningHorizon;
      if (!VALID_HORIZONS.has(horizon)) {
        return { ok: false, error: 'Invalid planning horizon.', status: 400 };
      }
      request.horizon = horizon;
      if (horizon === 'CUSTOM') {
        if (!isDateOnlyString(body.customStartDate) || !isDateOnlyString(body.customEndDate)) {
          return { ok: false, error: 'A valid custom start and end date are required.', status: 400 };
        }
        const span = daySpan(body.customStartDate, body.customEndDate);
        if (span < 0 || span > MAX_DATE_RANGE_DAYS) {
          return { ok: false, error: `Custom range must be ${MAX_DATE_RANGE_DAYS} days or fewer.`, status: 400 };
        }
        request.customStartDate = body.customStartDate;
        request.customEndDate = body.customEndDate;
      }
    }
  } else if (mode === 'CHECK') {
    if (!isIsoInstantString(body.candidateStart)) {
      return { ok: false, error: 'A valid candidateStart date/time is required.', status: 400 };
    }
    request.candidateStart = body.candidateStart as string;

    if (body.checkNearbyWindowMinutes !== undefined) {
      const nearby = Number(body.checkNearbyWindowMinutes);
      if (!Number.isFinite(nearby) || nearby < MIN_CHECK_NEARBY_WINDOW_MINUTES || nearby > MAX_CHECK_NEARBY_WINDOW_MINUTES) {
        return { ok: false, error: `checkNearbyWindowMinutes must be between ${MIN_CHECK_NEARBY_WINDOW_MINUTES} and ${MAX_CHECK_NEARBY_WINDOW_MINUTES}.`, status: 400 };
      }
      request.checkNearbyWindowMinutes = nearby;
    }
  } else {
    const candidateStarts = Array.isArray(body.candidateStarts) ? body.candidateStarts : [];
    if (candidateStarts.length < MIN_COMPARE_CANDIDATES || candidateStarts.length > MAX_COMPARE_CANDIDATES) {
      return { ok: false, error: `candidateStarts must contain between ${MIN_COMPARE_CANDIDATES} and ${MAX_COMPARE_CANDIDATES} entries.`, status: 400 };
    }
    if (!candidateStarts.every(isIsoInstantString)) {
      return { ok: false, error: 'Every candidateStarts entry must be a valid date/time.', status: 400 };
    }
    request.candidateStarts = candidateStarts;
  }

  return { ok: true, request };
}

/** Convenience wrapper: validate then run, for the route handler. */
export function handleTimingSearchBody(body: Record<string, unknown>, context: DailyAssistantContext) {
  const validated = buildTimingSearchRequest(body, context);
  if (!validated.ok) return { ok: false as const, error: validated.error, status: validated.status };
  return { ok: true as const, result: runTimingSearch(validated.request) };
}
