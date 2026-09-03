import { isValidIanaTimezone } from './timezone';

/**
 * Pure request-validation helpers for POST /api/plans, kept out of
 * app/api/plans/route.ts for the same reason muhurthamSearchRequest.ts is
 * kept out of the Muhurtham search route (Next's route modules may only
 * export HTTP handlers) -- and, concretely, so this can be unit-tested
 * without a live server/DB.
 */

/**
 * Event Location Plan Persistence V1: validates the optional
 * `eventLocation` snapshot on a plan-save request -- `{cityName,
 * timezone}`, the exact shape saveUpcomingPlanFromCandidate() derives from
 * PR #55's own resultEventLocation (the client-side snapshot of the
 * location that actually produced the saved result, never live picker
 * state, never the User's current Timing Location). Absent/null -> both
 * persisted fields are null (this plan used the Timing Location -- the
 * common, backward-compatible case). Present -> both cityName and timezone
 * are required together, never one without the other (a durable plan
 * should never silently know its timezone but lose the location's
 * identity, or vice versa). No coordinates accepted -- see
 * createPlannedActivity's own call site for why (data minimization;
 * nothing recomputes Panchang from a saved plan). Reuses
 * isValidIanaTimezone(), the same canonical validator PR #55's own
 * eventLocation search validation uses -- no second timezone-validation
 * system.
 */
export function parseEventLocationSnapshot(raw: unknown): { ok: true; eventTimezone: string | null; eventLocationName: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, eventTimezone: null, eventLocationName: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'eventLocation must be an object with cityName and timezone.' };
  }
  const obj = raw as Record<string, unknown>;
  const cityName = typeof obj.cityName === 'string' ? obj.cityName.trim() : '';
  const timezone = typeof obj.timezone === 'string' ? obj.timezone.trim() : '';
  if (!cityName || !timezone) {
    return { ok: false, error: 'eventLocation.cityName and eventLocation.timezone are both required when eventLocation is supplied.' };
  }
  if (!isValidIanaTimezone(timezone)) {
    return { ok: false, error: 'eventLocation.timezone must be a valid IANA timezone.' };
  }
  return { ok: true, eventTimezone: timezone, eventLocationName: cityName };
}
