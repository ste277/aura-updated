import { TimingSearchRequest, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { DailyAssistantContext, PlanningHorizon } from '../../../packages/recommendation/src/dailyAssistant';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';

/**
 * Recipient Conversion V1 (brief section 20/21) -- validation for the new
 * PUBLIC, UNAUTHENTICATED guest search endpoint. Deliberately much narrower
 * than lib/timingSearchRequest.ts's own bounds (which stay unchanged for the
 * authenticated /api/timing-search this reuses runTimingSearch() alongside,
 * never through):
 *
 *   - mode is always FIND (no CHECK/COMPARE surface for anonymous callers)
 *   - activityId is required and must resolve to a real, EVERYDAY-planning-
 *     mode catalog activity -- no free-text taskTitle (brief section 23:
 *     never accept/log arbitrary guest text), and no CEREMONIAL/IMPORTANT
 *     (Muhurtham-tier) activity, since guest V1 is scoped to everyday
 *     timing only (brief section 14's explicit "limit guest conversion V1
 *     to everyday timing and document it" allowance)
 *   - horizon is restricted to the guest-facing subset (brief section 4)
 *   - limit is fixed at 3, max horizon is 7 days (brief section 21)
 *
 * The context itself (built by the route, not here) never carries
 * personalContext -- GENERAL-only by construction, not by a flag.
 */

const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 180;
const GUEST_RESULT_LIMIT = 3;

const GUEST_VALID_HORIZONS = new Set<PlanningHorizon>(['TODAY', 'TOMORROW', 'WEEKEND', 'SEVEN_DAYS']);
const GUEST_VALID_TIME_PREFERENCES = new Set<TimingTimePreference>(['ANY', 'MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']);

export type GuestTimingSearchValidationResult =
  | { ok: true; request: TimingSearchRequest }
  | { ok: false; error: string; status: number };

export function buildGuestTimingSearchRequest(body: Record<string, unknown>, context: DailyAssistantContext): GuestTimingSearchValidationResult {
  const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
  if (!activityId) {
    return { ok: false, error: 'activityId is required.', status: 400 };
  }
  const activity = FULL_ACTIVITY_CATALOG.find((candidate) => candidate.id === activityId);
  if (!activity) {
    return { ok: false, error: 'Unknown activityId.', status: 400 };
  }
  const definition = getActivityDefinition(activity);
  if (!definition || definition.experience.planningMode !== 'EVERYDAY') {
    return { ok: false, error: 'This activity is not available in the guest search yet.', status: 400 };
  }

  const durationMinutes = Number(body.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    return { ok: false, error: `durationMinutes must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`, status: 400 };
  }

  const horizon = String(body.horizon || 'TODAY') as PlanningHorizon;
  if (!GUEST_VALID_HORIZONS.has(horizon)) {
    return { ok: false, error: 'Invalid horizon.', status: 400 };
  }

  const rawTimePreference = body.timePreference === undefined ? 'ANY' : String(body.timePreference);
  if (!GUEST_VALID_TIME_PREFERENCES.has(rawTimePreference as TimingTimePreference)) {
    return { ok: false, error: 'Invalid time preference.', status: 400 };
  }

  return {
    ok: true,
    request: {
      mode: 'FIND',
      activityId,
      durationMinutes,
      horizon,
      timePreference: rawTimePreference as TimingTimePreference,
      limit: GUEST_RESULT_LIMIT,
      context,
    },
  };
}
