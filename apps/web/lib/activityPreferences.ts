/**
 * Explicit Duration Preferences Foundation V1 -- the service module that
 * owns EXPLICIT, user-declared per-activity duration preferences. This is a
 * deliberately separate axis from apps/web/lib/behavioralAffinity.ts's
 * `typicalDurationMinutes` (a DESCRIPTIVE, inferred aggregate of recent
 * observed durations -- see that module's own SEMANTICS doc comment): a
 * preference here exists ONLY when the user explicitly set it, is never
 * inferred, never generated from behavior, and is the source of truth for
 * itself (no recency window, no evidence-count gate, no consistency check --
 * the persisted value simply IS the preference). Explicit preference and
 * behavioral inference must never be conflated or cross-derived; this
 * module has no import of and no dependency on behavioralAffinity.ts.
 *
 * FOUNDATION ONLY (architecture audit "Explicit Duration Preferences
 * Foundation V1"): this module has no product consumer yet -- no API
 * route, no UI, no Day Builder/Daily Guidance/Forward Planner/Ask Aura
 * integration. It exists to establish a correct, tested persistence
 * contract ahead of those follow-up PRs. The current shipping request path
 * query impact of this file is exactly zero.
 */
import {
  listUserActivityPreferenceRows,
  upsertUserActivityPreference,
  deleteUserActivityPreference,
} from './db';
import { getActivityProfileById } from '../../../packages/recommendation/src/personalizedTasks';

// Persisted-preference bounds -- deliberately a LOCAL copy, not imported
// from apps/web/lib/timingSearchRequest.ts. The 15/360 range is already
// duplicated across timingSearchRequest.ts, timingSearch.ts,
// forwardPlannerOrchestrator.ts, and askAuraOrchestrator.ts with no shared
// constant; a fifth independent local copy here matches that existing
// convention rather than introducing a new cross-module dependency to
// avoid it (architecture audit items 82/83/86/87 -- out of scope to
// centralize as part of this feature).
const MIN_PREFERRED_DURATION_MINUTES = 15;
const MAX_PREFERRED_DURATION_MINUTES = 360;

/** Minimal app-facing contract -- deliberately excludes engineVersion,
 * policyVersion, confidence, evidence, timestamps, and any other Prisma-row
 * field. This is persisted user configuration, not a derived engine output
 * (architecture audit items 75/77/78: no contract versioning needed). */
export interface UserActivityPreference {
  activityId: string;
  preferredDurationMinutes: number;
}

/**
 * Pure validation, exported (mirrors apps/web/lib/timingSearchRequest.ts's
 * own convention of a pure, directly-testable validation entry point
 * separate from any DB-touching operation) -- returns `activityId`
 * unchanged on success, throws a deterministic Error on an unknown id.
 * Exact-match only against the canonical catalog: no alias/title
 * resolution, no fuzzy matching.
 */
export function validateActivityId(activityId: string): string {
  if (!getActivityProfileById(activityId)) {
    throw new Error(`Unknown activityId: "${activityId}".`);
  }
  return activityId;
}

/**
 * Pure validation, exported for the same reason as `validateActivityId`.
 * Returns `preferredDurationMinutes` unchanged on success, throws a
 * deterministic Error on any invalid value (non-integer, NaN, Infinity, or
 * out of the persisted-value bounds). REJECTS, never clamps.
 */
export function validatePreferredDurationMinutes(preferredDurationMinutes: number): number {
  if (
    !Number.isInteger(preferredDurationMinutes) ||
    preferredDurationMinutes < MIN_PREFERRED_DURATION_MINUTES ||
    preferredDurationMinutes > MAX_PREFERRED_DURATION_MINUTES
  ) {
    throw new Error(
      `preferredDurationMinutes must be an integer between ${MIN_PREFERRED_DURATION_MINUTES} and ${MAX_PREFERRED_DURATION_MINUTES}.`
    );
  }
  return preferredDurationMinutes;
}

/**
 * All of this user's explicit preferences -- one DB query, no pagination
 * (the activity catalog is small/bounded, so per-user row count is tiny).
 * Never reads across users.
 *
 * RETIRED-ACTIVITY FAIL-CLOSED (merge-critical): a stored row whose
 * activityId no longer resolves via `getActivityProfileById` (the activity
 * was removed from the catalog after the preference was set) is silently
 * OMITTED from the result -- never thrown, never crashes the caller. The
 * underlying row is NOT deleted by this read -- filtering happens only in
 * this projection, the DB row itself is left untouched for any future
 * catalog restoration or manual inspection.
 *
 * Sorted by activityId ascending for deterministic output (test/debugging
 * only -- carries no product significance).
 */
export async function listUserActivityPreferences(userId: string): Promise<UserActivityPreference[]> {
  const rows = await listUserActivityPreferenceRows(userId);
  return rows
    .filter((row) => getActivityProfileById(row.activityId) !== undefined)
    .map((row) => ({ activityId: row.activityId, preferredDurationMinutes: row.preferredDurationMinutes }));
}

/**
 * Sets (creates or updates) this user's explicit preferred duration for one
 * activity. Validates activityId against the canonical catalog and
 * preferredDurationMinutes against the persisted-value bounds BEFORE
 * writing -- invalid input is REJECTED, never clamped (this is persisted
 * configuration entering the database, not Timing Search's ephemeral
 * downstream safety clamp on a request value).
 *
 * Idempotent: setting the same (userId, activityId) twice updates the one
 * row (upsert on the `@@unique([userId, activityId])` constraint) rather
 * than erroring or creating a duplicate.
 */
export async function setPreferredActivityDuration(input: {
  userId: string;
  activityId: string;
  preferredDurationMinutes: number;
}): Promise<void> {
  validateActivityId(input.activityId);
  validatePreferredDurationMinutes(input.preferredDurationMinutes);
  await upsertUserActivityPreference(input.userId, input.activityId, input.preferredDurationMinutes);
}

/**
 * Clears (deletes) this user's explicit preferred duration for one
 * activity, returning the family to "use Aura's suggestion" -- i.e. whatever
 * the future consumption precedence (behavioral > catalog > suggested > 45)
 * resolves to once no explicit preference row exists. Clearing NEVER writes
 * a sentinel value equal to any default; it only ever removes the row.
 *
 * Idempotent: clearing a preference that was never set (or was already
 * cleared) succeeds silently -- never throws.
 *
 * activityId is still validated against the canonical catalog (even though
 * a delete of an unknown id would simply affect zero rows either way) so
 * this helper's input contract stays consistent with
 * setPreferredActivityDuration's -- both only ever accept a real catalog id.
 */
export async function clearPreferredActivityDuration(input: { userId: string; activityId: string }): Promise<void> {
  validateActivityId(input.activityId);
  await deleteUserActivityPreference(input.userId, input.activityId);
}

/**
 * Pure projection: activityId -> preferredDurationMinutes, for future
 * consumption (e.g. a `durationMinutesFor` precedence extension) that wants
 * a plain lookup rather than the row-shaped array. Mirrors
 * behavioralAffinity.ts's own `activityDurationByActivityId` projection
 * exactly, including its duplicate-input semantics: LAST ENTRY WINS. In
 * real data this can never actually happen (the DB's own
 * `@@unique([userId, activityId])` constraint guarantees at most one row
 * per activityId), so this only matters for hand-constructed test input --
 * see test/activityPreferences.test.ts for an explicit test of this
 * behavior. Never mutates its input.
 */
export function preferredDurationByActivityId(
  preferences: readonly UserActivityPreference[]
): Readonly<Record<string, number>> {
  const byActivityId: Record<string, number> = {};
  for (const preference of preferences) {
    byActivityId[preference.activityId] = preference.preferredDurationMinutes;
  }
  return byActivityId;
}
