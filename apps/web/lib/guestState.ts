import { sign, verify } from './auth';
import type { PlanningHorizon } from '../../../packages/recommendation/src/dailyAssistant';
import type { TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';

/**
 * Recipient Conversion V1 (brief section 10/19/24/25) -- a short-lived,
 * signed, STATELESS token carrying a guest's timing search + chosen result
 * across the magic-link auth round trip. Reuses lib/auth.ts's existing
 * sign()/verify() HMAC primitive (the same one backing magic-link tokens)
 * rather than a new signing mechanism or a DB table -- there is no
 * guest-specific persistence model, just a tamper-evident payload with an
 * expiry, exactly like MagicLinkPayload.
 *
 * Privacy (brief section 19): this payload is allow-listed field by field.
 * It intentionally contains the guest's OWN chosen city (needed to literally
 * recompute the search on restore) but never a sender identity, SavedPerson
 * id, birth/natal data, email, or the raw public Moment token -- the
 * "Find your own moment" links never carry the Moment token to begin with,
 * only a coarse `source` flag (see AuraMomentClient.tsx).
 */

const GUEST_STATE_TTL_MS = 30 * 60 * 1000; // 30 min -- brief section 25

export interface GuestStateTokenPayload {
  activityId: string;
  horizon: PlanningHorizon;
  timePreference: TimingTimePreference;
  durationMinutes: number;
  /** The guest's own chosen city (lib/cities.ts CITY_OPTIONS name) -- not
   * sender/recipient identity, just the location the search itself needs. */
  cityName: string;
  /** The specific candidate the guest chose to save, so restoring after
   * auth doesn't require re-running the search and risking a different
   * result (the clock moved, a slot is no longer available, etc). */
  candidateStart: string;
  candidateEnd: string;
  /** Coarse, product-level attribution only (brief section 11) -- never a
   * Moment id/token or sender identity. */
  source: 'AURA_MOMENT' | 'DIRECT';
  exp: number;
}

export function createGuestStateToken(payload: Omit<GuestStateTokenPayload, 'exp'>): string {
  const full: GuestStateTokenPayload = { ...payload, exp: Date.now() + GUEST_STATE_TTL_MS };
  return sign(full);
}

export function verifyGuestStateToken(token: string): GuestStateTokenPayload | null {
  return verify<GuestStateTokenPayload>(token);
}
