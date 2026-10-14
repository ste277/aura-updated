/**
 * Location PR9 -- the ONE place that calls PATCH /api/users/location and
 * interprets its response, shared by OnboardingJourney.tsx's own
 * confirmSuggestedCity and LocationPicker.tsx's own confirmCurrentLocation.
 * Before this, both independently duplicated the same fetch/parse logic
 * (Location PR8 introduced LocationPicker's copy after onboarding's had
 * already existed). Callers still decide their own request body -- which
 * differs by design (onboarding's curated-cityName-vs-custom branch via
 * findCity, Settings' always-custom branch) -- so this file only unifies
 * how the request is sent and the response is read, not what is sent.
 */
export type LocationConfirmationResult =
  | { ok: true; locationConfirmedAt: string | null }
  | { ok: false; error: string };

export async function submitLocationConfirmation(body: Record<string, unknown>): Promise<LocationConfirmationResult> {
  try {
    const res = await fetch('/api/users/location', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, locationConfirmedAt: typeof data.locationConfirmedAt === 'string' ? data.locationConfirmedAt : null };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: typeof data.error === 'string' && data.error ? data.error : 'Could not confirm location.' };
  } catch {
    return { ok: false, error: "Couldn't confirm location. Please try again." };
  }
}
