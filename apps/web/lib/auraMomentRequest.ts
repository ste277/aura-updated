import { isSupportedMuhurthamActivity, SUPPORTED_MUHURTHAM_ACTIVITY_IDS, MuhurthamRating, SharedMuhurthamRating } from '../../../packages/recommendation/src/muhurthamFinder';
import { AuraMomentAlternativePreference, AuraMomentResponseState, AuraMomentScope } from './db';
import { MAX_ALTERNATIVES } from './auraMomentAlternatives';

/**
 * Pure request validation for POST /api/aura-moments, kept out of
 * app/api/aura-moments/route.ts for the same reason muhurthamSearchRequest.ts
 * is kept out of its route (Next's route modules may only export HTTP
 * handlers).
 *
 * Deliberately does NOT accept from the client: activityTitle, activityIcon
 * (resolved server-side from the activity catalog by the route), timezone
 * (the route uses the authenticated owner's own user.timezone), senderDisplayName
 * (derived server-side from the owner's email, never client-supplied --
 * spoofing risk), or explanationSnapshot (always server-templated from scope,
 * see auraMoments.ts's explanationSnapshotForScope -- no free-text public
 * copy from a request body, ever). This mirrors brief section 5: "Do not
 * allow arbitrary birth context in the request" applied broadly -- the
 * client may only select WHICH already-computed result to share, not
 * describe its own content.
 */

const VALID_SCOPES = new Set<AuraMomentScope>(['GENERAL', 'PERSONAL', 'SHARED']);
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;

/** The union of every rating vocabulary Muhurtham Finder's three scopes can
 * produce -- validated as a closed set (not just "any string") so a public
 * moment can never display an arbitrary client-supplied label, even though
 * the actual astrological content of ratingLabel is not itself sensitive. */
const VALID_RATING_LABELS = new Set<MuhurthamRating | SharedMuhurthamRating>([
  'EXCELLENT', 'STRONG', 'FAVORABLE', 'ACCEPTABLE',
  'EXCELLENT_SHARED_FIT', 'STRONG_SHARED_FIT', 'GOOD_SHARED_FIT', 'MIXED_SHARED_FIT',
]);

export interface AuraMomentCreateInput {
  scope: AuraMomentScope;
  activityId: string;
  startAt: Date;
  endAt: Date;
  ratingLabel: string | null;
  /** Required (and only meaningful) when scope === 'SHARED'; the route
   * resolves+ownership-checks this against the authenticated owner. */
  savedPersonId: string | null;
}

export type AuraMomentCreateValidationResult =
  | { ok: true; input: AuraMomentCreateInput }
  | { ok: false; error: string; status: number };

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function buildAuraMomentCreateRequest(body: Record<string, unknown>): AuraMomentCreateValidationResult {
  const rawScope = typeof body.scope === 'string' ? body.scope : '';
  if (!VALID_SCOPES.has(rawScope as AuraMomentScope)) {
    return { ok: false, error: 'scope must be GENERAL, PERSONAL, or SHARED.', status: 400 };
  }
  const scope = rawScope as AuraMomentScope;

  const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
  if (!activityId || !isSupportedMuhurthamActivity(activityId)) {
    return { ok: false, error: `activityId must be one of: ${SUPPORTED_MUHURTHAM_ACTIVITY_IDS.join(', ')}.`, status: 400 };
  }

  if (!isIsoDateString(body.startAt) || !isIsoDateString(body.endAt)) {
    return { ok: false, error: 'startAt and endAt must be valid ISO date-times.', status: 400 };
  }
  const startAt = new Date(body.startAt as string);
  const endAt = new Date(body.endAt as string);
  const durationMinutes = (endAt.getTime() - startAt.getTime()) / 60_000;
  if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
    return { ok: false, error: `endAt must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes after startAt.`, status: 400 };
  }

  let ratingLabel: string | null = null;
  if (body.ratingLabel !== undefined && body.ratingLabel !== null) {
    if (typeof body.ratingLabel !== 'string' || !VALID_RATING_LABELS.has(body.ratingLabel as MuhurthamRating | SharedMuhurthamRating)) {
      return { ok: false, error: 'ratingLabel must be a recognized Muhurtham rating.', status: 400 };
    }
    ratingLabel = body.ratingLabel;
  }

  let savedPersonId: string | null = null;
  if (scope === 'SHARED') {
    savedPersonId = typeof body.savedPersonId === 'string' ? body.savedPersonId.trim() : '';
    if (!savedPersonId) {
      return { ok: false, error: 'savedPersonId is required for SHARED scope.', status: 400 };
    }
  }

  return { ok: true, input: { scope, activityId, startAt, endAt, ratingLabel, savedPersonId } };
}

const VALID_RESPONSE_VALUES = new Set<AuraMomentResponseState>(['ACCEPTED', 'ANOTHER_TIME']);

/** Section 10/11's "only two allowed response values" -- POST
 * /api/aura-moments/[token]/response validates against this before touching
 * the database. Public/unauthenticated input, so this rejects anything that
 * isn't exactly one of the two known values (no free text, no extra states). */
export function isValidMomentResponse(value: unknown): value is AuraMomentResponseState {
  return typeof value === 'string' && VALID_RESPONSE_VALUES.has(value as AuraMomentResponseState);
}

const VALID_ALTERNATIVE_PREFERENCES = new Set<AuraMomentAlternativePreference>(['EARLIER', 'LATER', 'DIFFERENT_DAY', 'NO_PREFERENCE']);

/**
 * Aura Moment Rescheduling brief section 19: "the public API must remain
 * intentionally powerless" -- the ONLY additional thing a recipient may ever
 * submit alongside ANOTHER_TIME is one of these four closed values. No
 * dates, no activity ids, no SavedPerson ids, no free text.
 */
export function isValidAlternativePreference(value: unknown): value is AuraMomentAlternativePreference {
  return typeof value === 'string' && VALID_ALTERNATIVE_PREFERENCES.has(value as AuraMomentAlternativePreference);
}

/**
 * POST /api/aura-moments/[token]/suggest's entire request body: an index
 * into the alternatives just computed (0, 1, or 2 -- see MAX_ALTERNATIVES in
 * auraMomentAlternatives.ts), NEVER a client-supplied date/time/activity/
 * SavedPerson id (brief section 20: "Do not trust IDs supplied by the
 * browser where they can be resolved from AuraMoment"). The route re-runs
 * the exact same deterministic search server-side and picks
 * candidates[index] itself.
 */
export function isValidAlternativeIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_ALTERNATIVES;
}
