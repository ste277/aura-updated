import { findMuhurthams, findPersonalMuhurthams, findSharedMuhurthams, isSupportedMuhurthamActivity, MuhurthamPersonalSearchOutcome, MuhurthamSearchRequest, MuhurthamSearchResult, MuhurthamSearchScope, MuhurthamSharedSearchOutcome, SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../../../packages/recommendation/src/muhurthamFinder';
import { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import { TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';
import { isDateOnlyString } from './timingSearchRequest';
import { CityOption, isValidCustomLocation } from './cities';

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

/**
 * Event Location Search V1: validates the optional `eventLocation` field on
 * the Muhurtham search request body. Reuses isValidCustomLocation()
 * (lib/cities.ts) -- the exact same latitude/longitude/timezone bounds
 * Planning Location's own custom-location form already enforces (±66.5°
 * latitude, the Panchang-safe range computeSolarEphemeris needs; ±180°
 * longitude; a real IANA timezone) -- no second coordinate/timezone
 * validation system.
 *
 * Absent `eventLocation` (undefined) resolves to `{ok: true, location:
 * undefined}` -- the caller falls back to the user's Timing Location.
 * A PRESENT but malformed/invalid `eventLocation` resolves to `{ok: false}`
 * -- never silently falls back to Timing Location, since a caller who
 * explicitly supplied a location almost certainly did not mean "ignore this
 * and use my everyday location instead" (brief section 5).
 */
export function validateEventLocation(raw: unknown): { ok: true; location: CityOption | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, location: undefined };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'eventLocation must be an object with cityName, latitude, longitude, and timezone.' };
  }

  const obj = raw as Record<string, unknown>;
  const cityName = typeof obj.cityName === 'string' ? obj.cityName.trim() : '';
  if (!cityName) return { ok: false, error: 'eventLocation.cityName is required.' };

  const latitude = Number(obj.latitude);
  const longitude = Number(obj.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'eventLocation.latitude and eventLocation.longitude must be finite numbers.' };
  }

  const timezone = typeof obj.timezone === 'string' ? obj.timezone.trim() : '';
  if (!timezone) return { ok: false, error: 'eventLocation.timezone is required.' };

  if (!isValidCustomLocation({ latitude, longitude, timezone })) {
    return { ok: false, error: 'eventLocation has an invalid latitude, longitude, or timezone. Latitude must be between -66.5 and 66.5, longitude between -180 and 180, and timezone a valid IANA name.' };
  }

  return { ok: true, location: { cityName, latitude, longitude, timezone } };
}

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;
const MAX_DATE_RANGE_DAYS = 180;
const MIN_LIMIT = 1;
const MAX_LIMIT = 20;

const VALID_TIME_PREFERENCES = new Set<TimingTimePreference>(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);
const VALID_SCOPES = new Set<MuhurthamSearchScope>(['GENERAL', 'PERSONAL', 'SHARED']);

function daySpan(startDate: string, endDate: string): number {
  return (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
}

export type MuhurthamSearchValidationResult =
  | { ok: true; request: MuhurthamSearchRequest; scope: MuhurthamSearchScope; savedPersonId?: string }
  | { ok: false; error: string; status: number };

/**
 * Validates a parsed JSON body into a MuhurthamSearchRequest + scope. Takes
 * the already-resolved DailyAssistantContext (built from the session user by
 * the route) rather than resolving it itself, keeping this function free of
 * I/O so it can be unit-tested with a fake context -- same pattern as
 * buildTimingSearchRequest(). `context.personalContext` is only meaningful
 * (and only expected to be populated by the caller) when scope is
 * 'PERSONAL' or 'SHARED' -- see route.ts, which skips resolving it entirely
 * for 'GENERAL' requests (brief section 10: "GENERAL should not unnecessarily
 * fetch natal data").
 *
 * For 'SHARED', this function ONLY validates that `savedPersonId` is present
 * as a non-empty string and returns it alongside the request -- it cannot
 * resolve ownership or build `request.partner` itself (that needs a database
 * call, and this function is deliberately I/O-free for unit-testability).
 * route.ts does that resolution and calls findSharedMuhurthams() directly
 * rather than going through handleMuhurthamSearchBody() below, which only
 * dispatches the two DB-free scopes.
 */
export function buildMuhurthamSearchRequest(body: Record<string, unknown>, context: DailyAssistantContext): MuhurthamSearchValidationResult {
  const rawScope = body.scope === undefined ? 'GENERAL' : String(body.scope);
  if (!VALID_SCOPES.has(rawScope as MuhurthamSearchScope)) {
    return { ok: false, error: 'scope must be GENERAL, PERSONAL, or SHARED.', status: 400 };
  }
  const scope = rawScope as MuhurthamSearchScope;

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

  let savedPersonId: string | undefined;
  if (scope === 'SHARED') {
    savedPersonId = typeof body.savedPersonId === 'string' ? body.savedPersonId.trim() : '';
    if (!savedPersonId) {
      return { ok: false, error: 'savedPersonId is required for SHARED scope.', status: 400 };
    }
  }

  const request: MuhurthamSearchRequest = {
    activityId,
    dateRange: { start: dateRange.start, end: dateRange.end },
    durationMinutes,
    timePreference: rawTimePreference as TimingTimePreference,
    limit,
    context,
  };

  return { ok: true, request, scope, savedPersonId };
}

/** Convenience wrapper: validate then run, for the route handler. Dispatches
 * to findMuhurthams() (GENERAL, unchanged response shape) or
 * findPersonalMuhurthams() (PERSONAL, its own discriminated-union outcome
 * shape -- OK or PERSONAL_PROFILE_INCOMPLETE, both HTTP 200 since an
 * incomplete profile is an expected, valid outcome, not a request error).
 * Handles only the two DB-free scopes -- SHARED needs an already-resolved,
 * already-ownership-checked SavedPerson (a database call), so it explicitly
 * refuses to silently run as GENERAL here; see handleSharedMuhurthamSearchBody()
 * below, which route.ts calls instead once it has resolved the SavedPerson. */
export function handleMuhurthamSearchBody(body: Record<string, unknown>, context: DailyAssistantContext): { ok: true; result: MuhurthamSearchResult | MuhurthamPersonalSearchOutcome } | { ok: false; error: string; status: number } {
  const validated = buildMuhurthamSearchRequest(body, context);
  if (!validated.ok) return { ok: false, error: validated.error, status: validated.status };
  if (validated.scope === 'SHARED') return { ok: false, error: 'SHARED scope must be handled via handleSharedMuhurthamSearchBody.', status: 500 };
  if (validated.scope === 'PERSONAL') return { ok: true, result: findPersonalMuhurthams(validated.request) };
  return { ok: true, result: findMuhurthams(validated.request) };
}

/**
 * SHARED-scope counterpart to handleMuhurthamSearchBody() above. Takes an
 * already-resolved, already-ownership-checked `partner` (route.ts builds it
 * via getSavedPersonForOwner()/getSavedPersonNatalContext() BEFORE calling
 * this function) rather than resolving it itself, keeping this file free of
 * database access -- same reasoning as `context` being pre-resolved for the
 * other scopes. A missing/undefined `partner` here means the route already
 * determined the requested savedPersonId doesn't exist or isn't owned by
 * this user; that's an ownership-safe 404 the route returns directly (brief
 * section 11) without ever calling findSharedMuhurthams(), so `partner`
 * being undefined at this point should not normally happen -- kept as
 * `| undefined` only so this function's own signature can't silently accept
 * an unresolved partner as if it were valid.
 */
export function handleSharedMuhurthamSearchBody(
  body: Record<string, unknown>,
  context: DailyAssistantContext,
  partner: { savedPersonId: string; name: string; context: PersonalMuhurtaContext }
): { ok: true; result: MuhurthamSharedSearchOutcome } | { ok: false; error: string; status: number } {
  const validated = buildMuhurthamSearchRequest(body, context);
  if (!validated.ok) return { ok: false, error: validated.error, status: validated.status };
  if (validated.scope !== 'SHARED') return { ok: false, error: 'handleSharedMuhurthamSearchBody requires scope SHARED.', status: 400 };
  return { ok: true, result: findSharedMuhurthams({ ...validated.request, partner }) };
}
