'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CITY_OPTIONS, parseCoordinate, formatCoordinateDirectional, MIN_VALID_LATITUDE, MAX_VALID_LATITUDE, MIN_VALID_LONGITUDE, MAX_VALID_LONGITUDE } from '../lib/cities';
import { isValidIanaTimezone, searchTimezones, TimezoneOption } from '../lib/timezone';

interface CityOption {
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

/** Mirrors lib/geocoding.ts's own GeocodeResult shape (never imported
 * directly -- that module is server-only; this is the normalized JSON
 * shape the two /api/location/* routes return). */
interface GeocodeResultDto {
  displayName: string;
  cityName: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  confidence?: number;
}

interface LocationPickerProps {
  currentCity: string;
  /** Onboarding V1 PR 1 -- Location Trust Foundation. Always carries the
   * server's own `locationConfirmedAt` from the PATCH response (never
   * guessed/assumed client-side), so the caller's local state reflects
   * the real confirmation instant immediately, without a refetch. */
  onChanged: (city: CityOption & { locationConfirmedAt: string | null }) => void;
}

const OTHER_VALUE = '__other__';
/** OpenCage confidence is 1-10; below this, the result is disclosed as
 * approximate rather than presented as exact (ticket section B: "Accuracy
 * disclosure where appropriate"). */
const LOW_CONFIDENCE_THRESHOLD = 5;
/** GPS accuracy (meters) above which the result is disclosed as approximate. */
const LOW_GPS_ACCURACY_METERS = 1000;

type PendingSource = 'gps' | 'search';

/**
 * Onboarding V1 PR 3 -- Smart Location Selection. Primary UX, in order:
 * "Use my current location" (GPS + reverse geocode), "Search for a place"
 * (forward geocode), both behind the existing, unchanged confirmation
 * contract -- neither a GPS fix nor a search pick is ever saved until the
 * user explicitly confirms the resolved result, through this file's own
 * confirmPendingResult, which calls the SAME PATCH /api/users/location
 * endpoint (custom branch) handleSelectChange/handleCustomSubmit below
 * already use. The pre-existing curated dropdown + manual coordinate entry
 * are preserved verbatim, now under a collapsed "Advanced options"
 * section -- no existing, tested behavior was removed, only re-homed.
 *
 * This is the ONE shared location-editing component, reused identically
 * by OnboardingJourney.tsx and YouView.tsx (Settings) -- see each file's
 * own `<LocationPicker>` usage. Fixing/extending it here reaches both
 * surfaces by construction; this file must never special-case either
 * caller.
 *
 * Planning/Timing Location only (Panchang, sunrise/sunset, Rahu Kalam/
 * Yama/Gulika/Abhijit, Good Right Now, Timing Search, Day Builder) --
 * never the Birth Location used for the natal chart. Every save path in
 * this file -- curated select, manual custom form, GPS confirm, search
 * confirm -- only ever touches cityName/latitude/longitude/timezone via
 * the same PATCH /api/users/location; none of them reads or writes
 * birthCityName/birthLatitude/birthLongitude/birthTimezone.
 */
export function LocationPicker({ currentCity, onChanged }: LocationPickerProps) {
  const [saving, setSaving] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [custom, setCustom] = useState({ cityName: '', latitude: '', longitude: '', timezone: '' });
  const [touched, setTouched] = useState<Record<'cityName' | 'latitude' | 'longitude' | 'timezone', boolean>>({
    cityName: false,
    latitude: false,
    longitude: false,
    timezone: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [timezoneMenuOpen, setTimezoneMenuOpen] = useState(false);
  const timezoneFieldRef = useRef<HTMLDivElement>(null);

  // ---- Smart Location Selection: GPS ("Use my current location") ----
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // ---- Smart Location Selection: search ----
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<GeocodeResultDto[]>([]);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Smart Location Selection: shared pending-confirmation state ----
  // A GPS fix or a clicked search result lands here -- NEVER auto-saved.
  // The user must explicitly confirm (confirmPendingResult) before
  // anything reaches PATCH /api/users/location. Cleared on confirm,
  // cancel, or component unmount via a fresh pick.
  const [pending, setPending] = useState<{ result: GeocodeResultDto; source: PendingSource; gpsAccuracyMeters?: number } | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Load custom cities saved in the DB
  useEffect(() => {
    fetch('/api/cities/custom')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CityOption[]) => setCustomCities(data))
      .catch(() => {});
  }, []);

  // Close the timezone suggestion menu on an outside click.
  useEffect(() => {
    if (!timezoneMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (timezoneFieldRef.current && !timezoneFieldRef.current.contains(e.target as Node)) {
        setTimezoneMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [timezoneMenuOpen]);

  // Debounced search -- fires ~400ms after the user stops typing, never on
  // every keystroke (keeps the free-tier provider quota and the rate
  // limiter headroom for genuine use). Cleared on unmount/requery.
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/location/search?q=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setSearchResults(Array.isArray(data.results) ? data.results : []);
        } else {
          setSearchResults([]);
          setSearchError(typeof data.error === 'string' ? data.error : 'Search is temporarily unavailable.');
        }
      } catch {
        setSearchResults([]);
        setSearchError("Couldn't search right now. Please try again.");
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  // "Use my current location" -- requested ONLY on explicit tap, never on
  // mount or automatically. Covers: unsupported browser/insecure context,
  // permission denied, timeout, and the reverse-geocode call itself
  // failing -- each with its own message and a path back to search/manual
  // entry, never a dead end.
  function requestCurrentLocation() {
    setGpsError(null);
    setPending(null);

    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setGpsError('Location access needs a secure (https) connection. Try searching instead.');
      return;
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGpsError("Your browser doesn't support location access. Try searching instead.");
      return;
    }

    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        try {
          const res = await fetch(`/api/location/reverse?lat=${latitude}&lng=${longitude}`);
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.result) {
            setPending({ result: data.result, source: 'gps', gpsAccuracyMeters: accuracy });
          } else {
            setGpsError(typeof data.error === 'string' ? data.error : "Couldn't identify your location. Try searching instead.");
          }
        } catch {
          setGpsError("Couldn't identify your location. Try searching instead.");
        } finally {
          setGpsLoading(false);
        }
      },
      (geoError) => {
        setGpsLoading(false);
        if (geoError.code === geoError.PERMISSION_DENIED) {
          setGpsError('Location permission was denied. You can search or enter your location manually below.');
        } else if (geoError.code === geoError.TIMEOUT) {
          setGpsError('Getting your location took too long. Try again or search instead.');
        } else {
          setGpsError('Could not get your location. Try searching instead.');
        }
      },
      { timeout: 10_000, maximumAge: 0 }
    );
  }

  // Shared confirm step for BOTH a GPS fix and a clicked search result --
  // the ONE place either path reaches PATCH /api/users/location. Always
  // the custom branch: a geocoded result is never expected to byte-match
  // a curated CITY_OPTIONS entry, so there is no "is this static" check
  // here the way handleSelectChange below has for the curated dropdown.
  async function confirmPendingResult() {
    if (!pending) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch('/api/users/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custom: {
            cityName: pending.result.cityName,
            latitude: pending.result.latitude,
            longitude: pending.result.longitude,
            timezone: pending.result.timezone,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const confirmed = {
          cityName: pending.result.cityName,
          latitude: pending.result.latitude,
          longitude: pending.result.longitude,
          timezone: pending.result.timezone,
          locationConfirmedAt: typeof data.locationConfirmedAt === 'string' ? data.locationConfirmedAt : null,
        };
        setCustomCities((prev) => [confirmed, ...prev.filter((c) => c.cityName !== confirmed.cityName)]);
        onChanged(confirmed);
        setPending(null);
        setSearchQuery('');
        setSearchResults([]);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' && data.error ? data.error : 'Could not confirm location.');
      }
    } catch {
      setError("Couldn't confirm location. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  // Combine static options with saved custom cities (deduped by city name)
  const combinedCities: CityOption[] = [
    ...CITY_OPTIONS,
    ...customCities.filter((cc) => !CITY_OPTIONS.some((co) => co.cityName === cc.cityName)),
  ];

  async function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === OTHER_VALUE) {
      setShowCustomForm(true);
      return;
    }

    const selectedCity = combinedCities.find((c) => c.cityName === value);
    if (!selectedCity) return;

    setSaving(true);
    setError(null);

    const isStatic = CITY_OPTIONS.some((c) => c.cityName === value);

    // Timing Location Save Failure State Correctness V1 -- setSaving(false)
    // previously ran only after a RESOLVED fetch, so a thrown network/fetch
    // exception (offline, DNS failure, connection reset) skipped it
    // entirely, leaving this control disabled with no error shown until the
    // component happened to unmount/remount. finally is now the single,
    // unconditional cleanup path for both outcomes. onChanged still only
    // ever fires from the res.ok branch below -- never from catch -- so a
    // failed save (HTTP or network) still can never reach page.tsx's
    // handleLocationChanged/loadMyDay/loadAssistantSignals (PR #88).
    try {
      const res = await fetch('/api/users/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: isStatic
          ? JSON.stringify({ cityName: value })
          : JSON.stringify({ custom: selectedCity }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        onChanged({ ...selectedCity, locationConfirmedAt: typeof data.locationConfirmedAt === 'string' ? data.locationConfirmedAt : null });
      } else {
        // Tolerant of a non-JSON/empty error body, same as handleCustomSubmit's
        // existing failure handling below -- prefer the server's own message,
        // fall back to a generic one only when it's missing or unusable.
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' && data.error ? data.error : 'Could not update location.');
      }
    } catch {
      setError("Couldn't save location. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Derived, format-only parsing -- re-evaluated on every render rather than
  // stored, so it never drifts from what's actually typed. Range/timezone
  // validity is a separate check below (a format error and a range error
  // are reported with different messages).
  const parsedLatitude = useMemo(() => parseCoordinate(custom.latitude, 'lat'), [custom.latitude]);
  const parsedLongitude = useMemo(() => parseCoordinate(custom.longitude, 'lng'), [custom.longitude]);
  const timezoneValid = useMemo(() => isValidIanaTimezone(custom.timezone.trim()), [custom.timezone]);
  const timezoneSuggestions: TimezoneOption[] = useMemo(
    () => (timezoneMenuOpen ? searchTimezones(custom.timezone) : []),
    [custom.timezone, timezoneMenuOpen]
  );
  const selectedTimezoneInfo = useMemo(
    () => (timezoneValid ? searchTimezones(custom.timezone.trim(), 1).find((t) => t.id.toLowerCase() === custom.timezone.trim().toLowerCase()) : undefined),
    [custom.timezone, timezoneValid]
  );

  const cityNameError = !custom.cityName.trim() ? 'Enter a location name.' : null;
  const latitudeError =
    !custom.latitude.trim()
      ? 'Enter a latitude.'
      : parsedLatitude === null
      ? 'Use a decimal latitude, e.g. 8.8932 or 8.8932 N.'
      : parsedLatitude < MIN_VALID_LATITUDE || parsedLatitude > MAX_VALID_LATITUDE
      ? `Latitude must be between ${MIN_VALID_LATITUDE} and ${MAX_VALID_LATITUDE}.`
      : null;
  const longitudeError =
    !custom.longitude.trim()
      ? 'Enter a longitude.'
      : parsedLongitude === null
      ? 'Use a decimal longitude, e.g. 76.6141 or 76.6141 E.'
      : parsedLongitude < MIN_VALID_LONGITUDE || parsedLongitude > MAX_VALID_LONGITUDE
      ? `Longitude must be between ${MIN_VALID_LONGITUDE} and ${MAX_VALID_LONGITUDE}.`
      : null;
  const timezoneError = !custom.timezone.trim() ? 'Enter a time zone.' : !timezoneValid ? 'Choose a valid time zone.' : null;

  const formValid = !cityNameError && !latitudeError && !longitudeError && !timezoneError;

  function showError(field: keyof typeof touched, message: string | null): string | null {
    return (touched[field] || submitAttempted) && message ? message : null;
  }

  async function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!formValid || parsedLatitude === null || parsedLongitude === null) return;

    setSaving(true);
    setError(null);

    const payload = {
      cityName: custom.cityName.trim(),
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      timezone: custom.timezone.trim(),
    };

    // Timing Location Save Failure State Correctness V1 -- same fix as
    // handleSelectChange above: setSaving(false) previously ran only after
    // a RESOLVED fetch, so a thrown network/fetch exception left the submit
    // button disabled forever with no error shown. finally is now the
    // single, unconditional cleanup path. The failure branch already
    // preserved showCustomForm/custom (never reset outside the res.ok
    // branch) -- that property is untouched, so a retry after either an
    // HTTP failure or a network failure keeps the user's entered values.
    // onChanged still only ever fires from the res.ok branch -- never from
    // catch -- preserving PR #88's confirmed-save boundary.
    try {
      const res = await fetch('/api/users/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custom: payload }),
      });

      if (res.ok) {
        const data = await res.json();
        const newCity = {
          cityName: data.cityName,
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone,
          locationConfirmedAt: typeof data.locationConfirmedAt === 'string' ? data.locationConfirmedAt : null,
        };

        // Add to local custom cities list so it shows immediately in the dropdown
        setCustomCities((prev) => [newCity, ...prev.filter((c) => c.cityName !== newCity.cityName)]);
        onChanged(newCity);
        setShowCustomForm(false);
        setCustom({ cityName: '', latitude: '', longitude: '', timezone: '' });
        setTouched({ cityName: false, latitude: false, longitude: false, timezone: false });
        setSubmitAttempted(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not save that location.');
      }
    } catch {
      setError("Couldn't save location. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---- Pending confirmation card -- shared by GPS and search, the ONE
  // place either path can reach PATCH /api/users/location. ----
  if (pending) {
    const lowConfidence = pending.source === 'search' ? (pending.result.confidence ?? 10) < LOW_CONFIDENCE_THRESHOLD : (pending.gpsAccuracyMeters ?? 0) > LOW_GPS_ACCURACY_METERS;
    return (
      <div
        style={{
          background: 'var(--as-surface-raised)',
          padding: 14,
          borderRadius: 10,
          border: '1px solid var(--as-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Confirm this location
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-text)' }}>{pending.result.cityName}</div>
          <div style={{ fontSize: 12, color: 'var(--as-text-muted)', marginTop: 2 }}>
            {[pending.result.region, pending.result.country].filter(Boolean).join(', ') || pending.result.displayName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--as-text-muted)', marginTop: 4 }}>Time zone: {pending.result.timezone}</div>
          {lowConfidence && (
            <div style={{ fontSize: 11, color: 'var(--as-caution, #facc15)', marginTop: 6 }}>
              {pending.source === 'gps' ? 'Approximate location -- GPS accuracy was low.' : 'This match is approximate -- double check it looks right.'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={confirmPendingResult}
            disabled={confirming}
            style={{
              flex: 1,
              minHeight: 44,
              padding: '9px 10px',
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: confirming ? 'default' : 'pointer',
              background: 'var(--as-abhijit-dim, #1f4d34)',
              color: 'var(--as-abhijit, #4ade80)',
              opacity: confirming ? 0.7 : 1,
            }}
          >
            {confirming ? 'Confirming...' : `Confirm ${pending.result.cityName}`}
          </button>
          <button
            type="button"
            onClick={() => setPending(null)}
            disabled={confirming}
            style={{
              minHeight: 44,
              padding: '9px 14px',
              borderRadius: 8,
              border: '1px solid var(--as-border)',
              background: 'transparent',
              color: 'var(--as-text-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Back
          </button>
        </div>
        {error && (
          <div role="alert" style={{ color: 'var(--as-danger, var(--as-rahu))', fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  if (showCustomForm) {
    const shownCityNameError = showError('cityName', cityNameError);
    const shownLatitudeError = showError('latitude', latitudeError);
    const shownLongitudeError = showError('longitude', longitudeError);
    const shownTimezoneError = showError('timezone', timezoneError);

    return (
      <form
        onSubmit={handleCustomSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--as-surface-raised)',
          padding: 14,
          borderRadius: 10,
          border: '1px solid var(--as-border)',
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--as-text)' }}>Custom location</div>
          <div style={{ fontSize: 11, color: 'var(--as-text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            This is the location Aura uses for today&apos;s Panchang, sunrise/sunset, and daily timing recommendations.
          </div>
        </div>

        <Field label="Location name" error={shownCityNameError}>
          <input
            required
            placeholder="e.g. Kollam"
            value={custom.cityName}
            onChange={(e) => setCustom({ ...custom, cityName: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, cityName: true }))}
            style={inputStyle(Boolean(shownCityNameError))}
          />
        </Field>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            Coordinates
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Field
                label="Latitude"
                error={shownLatitudeError}
                helper={!shownLatitudeError ? 'Example: 8.8932 or 8.8932 N' : undefined}
                success={
                  !shownLatitudeError && parsedLatitude !== null ? `= ${formatCoordinateDirectional(parsedLatitude, 'lat')}` : undefined
                }
              >
                <input
                  required
                  inputMode="decimal"
                  placeholder="8.8932"
                  value={custom.latitude}
                  onChange={(e) => setCustom({ ...custom, latitude: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, latitude: true }))}
                  style={inputStyle(Boolean(shownLatitudeError))}
                />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field
                label="Longitude"
                error={shownLongitudeError}
                helper={!shownLongitudeError ? 'Example: 76.6141 or 76.6141 E' : undefined}
                success={
                  !shownLongitudeError && parsedLongitude !== null ? `= ${formatCoordinateDirectional(parsedLongitude, 'lng')}` : undefined
                }
              >
                <input
                  required
                  inputMode="decimal"
                  placeholder="76.6141"
                  value={custom.longitude}
                  onChange={(e) => setCustom({ ...custom, longitude: e.target.value })}
                  onBlur={() => setTouched((t) => ({ ...t, longitude: true }))}
                  style={inputStyle(Boolean(shownLongitudeError))}
                />
              </Field>
            </div>
          </div>
        </div>

        <div ref={timezoneFieldRef} style={{ position: 'relative' }}>
          <Field
            label="Time zone"
            error={shownTimezoneError}
            helper={!shownTimezoneError ? 'Search a city, e.g. Kolkata or Dubai — or type an IANA name like Asia/Kolkata' : undefined}
            success={!shownTimezoneError && selectedTimezoneInfo ? `${selectedTimezoneInfo.label} · ${selectedTimezoneInfo.offsetLabel}` : undefined}
          >
            <input
              required
              placeholder="Asia/Kolkata"
              value={custom.timezone}
              onChange={(e) => {
                setCustom({ ...custom, timezone: e.target.value });
                setTimezoneMenuOpen(true);
              }}
              onFocus={() => setTimezoneMenuOpen(true)}
              onBlur={() => setTouched((t) => ({ ...t, timezone: true }))}
              style={inputStyle(Boolean(shownTimezoneError))}
              autoComplete="off"
            />
          </Field>
          {timezoneMenuOpen && timezoneSuggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 20,
                marginTop: 2,
                background: 'var(--as-surface)',
                border: '1px solid var(--as-border)',
                borderRadius: 8,
                overflow: 'hidden',
                boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
              }}
            >
              {timezoneSuggestions.map((tz) => (
                <button
                  key={tz.id}
                  type="button"
                  onClick={() => {
                    setCustom((c) => ({ ...c, timezone: tz.id }));
                    setTouched((t) => ({ ...t, timezone: true }));
                    setTimezoneMenuOpen(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--as-border-subtle, var(--as-border))',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--as-text)' }}>{tz.id}</div>
                  <div style={{ fontSize: 11, color: 'var(--as-text-muted)' }}>
                    {tz.label} · {tz.offsetLabel}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              flex: 1,
              padding: '9px 10px',
              borderRadius: 8,
              border: 'none',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              background: 'var(--as-abhijit-dim, #1f4d34)',
              color: 'var(--as-abhijit, #4ade80)',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving...' : 'Save location'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCustomForm(false);
              setError(null);
            }}
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              border: '1px solid var(--as-border)',
              background: 'transparent',
              color: 'var(--as-text-muted)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
        {error && <div style={{ color: 'var(--as-danger, var(--as-rahu))', fontSize: 12 }}>{error}</div>}
      </form>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        onClick={requestCurrentLocation}
        disabled={gpsLoading}
        aria-label="Use my current location"
        style={{
          minHeight: 44,
          padding: '9px 14px',
          borderRadius: 8,
          border: 'none',
          fontSize: 13,
          fontWeight: 700,
          cursor: gpsLoading ? 'default' : 'pointer',
          background: 'var(--as-abhijit-dim, #1f4d34)',
          color: 'var(--as-abhijit, #4ade80)',
          opacity: gpsLoading ? 0.7 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <span aria-hidden="true">📍</span>
        {gpsLoading ? 'Finding your location...' : 'Use my current location'}
      </button>
      {gpsError && (
        <div role="alert" style={{ color: 'var(--as-danger, var(--as-rahu))', fontSize: 11 }}>
          {gpsError}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <label htmlFor="location-picker-search" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--as-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          Search for a place
        </label>
        <input
          id="location-picker-search"
          type="text"
          placeholder="e.g. Kollam, Kerala"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={inputStyle(false)}
          autoComplete="off"
        />
        {searchLoading && (
          <div style={{ fontSize: 11, color: 'var(--as-text-muted)', marginTop: 4 }}>Searching...</div>
        )}
        {searchError && (
          <div role="alert" style={{ fontSize: 11, color: 'var(--as-danger, var(--as-rahu))', marginTop: 4 }}>
            {searchError}
          </div>
        )}
        {!searchLoading && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--as-text-muted)', marginTop: 4 }}>
            No matches found. Try a different spelling, or enter it manually below.
          </div>
        )}
        {searchResults.length > 0 && (
          <div
            style={{
              marginTop: 6,
              background: 'var(--as-surface)',
              border: '1px solid var(--as-border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {searchResults.map((result, i) => (
              <button
                key={`${result.cityName}-${result.latitude}-${result.longitude}-${i}`}
                type="button"
                onClick={() => setPending({ result, source: 'search' })}
                style={{
                  display: 'block',
                  width: '100%',
                  minHeight: 44,
                  textAlign: 'left',
                  padding: '8px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: i < searchResults.length - 1 ? '1px solid var(--as-border-subtle, var(--as-border))' : 'none',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--as-text)' }}>{result.cityName}</div>
                <div style={{ fontSize: 11, color: 'var(--as-text-muted)' }}>
                  {[result.region, result.country].filter(Boolean).join(', ') || result.displayName}
                </div>
              </button>
            ))}
          </div>
        )}
        {(searchResults.length > 0 || gpsError === null) && pending === null && searchQuery.trim().length >= 2 && (
          // OpenCage's free-tier terms require attribution wherever its
          // results are shown to an end user -- see this PR's own provider
          // decision memo. Kept small/quiet (not a promotional banner),
          // present only once a search has actually produced the UI it
          // attributes.
          <div style={{ fontSize: 10, color: 'var(--as-text-faint, var(--as-text-muted))', marginTop: 6 }}>
            Search powered by{' '}
            <a href="https://opencagedata.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
              OpenCage
            </a>{' '}
            · ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
              OpenStreetMap
            </a>{' '}
            contributors
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
        style={{
          alignSelf: 'flex-start',
          minHeight: 32,
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--as-text-muted)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
      </button>

      {showAdvanced && (
        <div>
          <select
            value={combinedCities.some((c) => c.cityName === currentCity) ? currentCity : OTHER_VALUE}
            onChange={handleSelectChange}
            disabled={saving}
            style={{
              fontFamily: 'var(--as-font-mono)',
              fontSize: 12,
              color: 'var(--as-text-muted)',
              background: 'var(--as-surface)',
              border: '1px solid var(--as-border)',
              borderRadius: 6,
              padding: '3px 8px',
              cursor: 'pointer',
            }}
          >
            {combinedCities.map((c) => (
              <option key={c.cityName} value={c.cityName}>
                {c.cityName}
              </option>
            ))}
            <option value={OTHER_VALUE}>Other (custom location)...</option>
          </select>
          {error && <div style={{ color: 'var(--as-danger, var(--as-rahu))', fontSize: 11, marginTop: 4 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  helper,
  success,
  children,
}: {
  label: string;
  error?: string | null;
  helper?: string;
  success?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-text-secondary, var(--as-text))' }}>{label}</span>
      {children}
      {error ? (
        <span style={{ fontSize: 11, color: 'var(--as-danger, var(--as-rahu))' }}>{error}</span>
      ) : success ? (
        <span style={{ fontSize: 11, color: 'var(--as-positive, var(--as-abhijit))' }}>{success}</span>
      ) : helper ? (
        <span style={{ fontSize: 11, color: 'var(--as-text-muted)' }}>{helper}</span>
      ) : null}
    </label>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--as-font-body)',
    fontSize: 13,
    padding: '8px 10px',
    borderRadius: 6,
    border: `1px solid ${hasError ? 'var(--as-danger, var(--as-rahu))' : 'var(--as-border)'}`,
    background: 'var(--as-surface)',
    color: 'var(--as-text)',
    width: '100%',
    boxSizing: 'border-box',
  };
}
