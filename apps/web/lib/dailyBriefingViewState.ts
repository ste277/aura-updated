/**
 * AURA DB2 -- lightweight per-user, per-local-date "has the Daily Briefing
 * already been shown expanded today" state.
 *
 * Same try/catch-guarded localStorage pattern already established by
 * apps/web/lib/windowNotifications.ts's own loadNotificationPrefs/
 * saveNotificationPrefs (unavailable/throwing storage -- private
 * browsing, quota, SSR -- never crashes the caller, it just behaves as
 * "nothing recorded yet").
 *
 * Keyed by userId (not a single shared key) specifically so switching
 * users on the same browser can never read or clobber another user's
 * state (DB2 brief section 4: "User switching on the same browser must
 * not share the read state").
 *
 * Stores a plain "YYYY-MM-DD" local-date string, never a timestamp --
 * comparing it against the CURRENT local date (itself always freshly
 * resolved from the briefing the server just returned, which already
 * used the user's current configured timezone) is what makes "resets on
 * the next local day" and "changing the user's timezone is handled
 * correctly" both fall out for free: there is no separate timezone-aware
 * logic to get wrong here, just string equality against an
 * already-correct date.
 */

const STORAGE_PREFIX = 'aura_daily_briefing_last_expanded_date_';

export function loadLastExpandedLocalDate(userId: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_PREFIX + userId);
  } catch {
    return null;
  }
}

/**
 * Records that the briefing was shown expanded for `localDate`. Callers
 * MUST only call this after valid, successfully-rendered personalized
 * content is on screen (DB2 brief section 4: "Do not mark a briefing as
 * viewed merely because Home mounted or an API request started... A
 * failed request must not consume the first-visit experience") -- never
 * on mount, never on fetch-start, never for an UNAVAILABLE/error result.
 */
export function saveLastExpandedLocalDate(userId: string, localDate: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_PREFIX + userId, localDate);
  } catch {
    // Storage unavailable (private mode, quota, disabled) -- the briefing
    // still rendered correctly this visit; it will simply start expanded
    // again next visit too, which is a safe, non-crashing degradation.
  }
}
