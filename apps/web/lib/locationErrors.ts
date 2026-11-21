/**
 * AURA-MOBILE-01-M2-D -- one set of user-facing location error messages for
 * the native (Capacitor) and web (navigator.geolocation) "Use my current
 * location" paths, plus a classifier for native plugin errors.
 *
 * Messages are concise, actionable, and never include plugin internals,
 * coordinates or diagnostics. Coordinate acquisition failures and reverse
 * geocoding (city lookup) failures are deliberately separate kinds.
 */

export type LocationErrorKind =
  | 'permission_denied'
  | 'permission_permanently_denied'
  | 'services_disabled'
  | 'unavailable'
  | 'timeout'
  | 'geocode_unavailable'
  | 'unexpected';

export const LOCATION_ERROR_MESSAGES: Record<LocationErrorKind, string> = {
  permission_denied: 'Location permission was denied. You can search or enter your location manually below.',
  permission_permanently_denied:
    'Location access is turned off for AuraSchedule. Open Settings to allow it, or search or enter your location manually below.',
  services_disabled:
    'Location is turned off on this device. Turn it on in your device settings, or search or enter your location manually below.',
  unavailable: "Your device couldn't determine your location. Try again, or search or enter your location manually below.",
  timeout: 'Finding your location took too long. Try again, or search or enter your location manually below.',
  geocode_unavailable: 'City lookup is temporarily unavailable. Please search or enter your location manually below.',
  unexpected: 'Something went wrong while finding your location. You can search or enter your location manually below.',
};

/**
 * AURA-MOBILE-01-IOS-02 -- iOS-specific wording. iOS has no in-app
 * "Open Settings" action (the AppSettings plugin is Android-only, see
 * lib/appSettings.ts), so the iOS copy names where the switch lives instead
 * of implying a button. Kinds not listed here use LOCATION_ERROR_MESSAGES.
 */
export const IOS_LOCATION_ERROR_MESSAGES: Partial<Record<LocationErrorKind, string>> = {
  permission_permanently_denied:
    'Location access is off for AuraSchedule. Turn it on in the iOS Settings app, or search or enter your location manually below.',
};

/** User-facing message for `kind` on `platform` (Capacitor.getPlatform()). */
export function locationErrorMessage(kind: LocationErrorKind, platform: string): string {
  return (platform === 'ios' && IOS_LOCATION_ERROR_MESSAGES[kind]) || LOCATION_ERROR_MESSAGES[kind];
}

/** Error kinds that a trip to the device Settings app can resolve -- the
 * picker re-checks these when the app resumes. */
export const SETTINGS_RECOVERABLE_KINDS: ReadonlySet<LocationErrorKind> = new Set<LocationErrorKind>([
  'permission_denied',
  'permission_permanently_denied',
  'services_disabled',
]);

/** Thrown by the application-level timeout. It means "the UI stopped
 * waiting", NOT that the native request was cancelled -- the Capacitor
 * plugin offers no cancellation for getCurrentPosition. */
export class LocationTimeoutError extends Error {
  constructor() {
    super('location request timed out (application level)');
    this.name = 'LocationTimeoutError';
  }
}

/**
 * Maps an error from @capacitor/geolocation 6.x (Android/iOS) to a kind.
 * Known Android plugin messages (GeolocationPlugin.java / Geolocation.java):
 *   "Location services are not enabled" (checkPermissions/requestPermissions)
 *   "location disabled"                  (getCurrentPosition, services off)
 *   "location unavailable"               (fused provider returned null)
 *   "Location permission was denied"     (permission callback)
 *   "Google Play Services not available"
 * iOS (GeolocationPlugin.swift) rejects CLLocationManager failures with
 * error.localizedDescription, e.g. "The operation couldn't be completed.
 * (kCLErrorDomain error 0.)". The surrounding words are localized by the
 * device language but the "kCLErrorDomain" token and the code are not, so
 * only those are matched (IOS-02):
 *   code 0 kCLErrorLocationUnknown -> 'unavailable'
 *   code 1 kCLErrorDenied          -> 'permission_permanently_denied'
 *          (iOS never re-prompts after a denial; only Settings can fix it)
 *   code 2 kCLErrorNetwork         -> 'unavailable'
 * Anything unrecognised becomes 'unexpected'; the raw message is never shown.
 */
export function classifyNativeLocationError(err: unknown): LocationErrorKind {
  if (err instanceof LocationTimeoutError) return 'timeout';
  const message = typeof (err as { message?: unknown })?.message === 'string' ? ((err as { message: string }).message) : '';
  const m = message.toLowerCase();
  const clError = /kclerrordomain\D{0,24}?(\d+)/.exec(m);
  if (clError) {
    const code = Number(clError[1]);
    if (code === 0 || code === 2) return 'unavailable';
    if (code === 1) return 'permission_permanently_denied';
    return 'unexpected';
  }
  if (m.includes('location services are not enabled') || m.includes('location disabled')) return 'services_disabled';
  if (m.includes('location unavailable') || m.includes('google play services not available')) return 'unavailable';
  if (m.includes('permission') && m.includes('denied')) return 'permission_denied';
  return 'unexpected';
}
