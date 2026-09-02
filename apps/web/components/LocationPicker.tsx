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

interface LocationPickerProps {
  currentCity: string;
  onChanged: (city: CityOption) => void;
}

const OTHER_VALUE = '__other__';

/**
 * Planning Custom Location UX Fix. This is the Planning/Timing Location
 * (Panchang, sunrise/sunset, Rahu Kalam/Yama/Gulika/Abhijit, Good Right Now,
 * Timing Search, Day Builder) -- never the Birth Location used for the natal
 * chart. Saving here only ever touches cityName/latitude/longitude/timezone
 * (via /api/users/location -> updateUserLocation()); it never reads or
 * writes birthCityName/birthLatitude/birthLongitude/birthTimezone.
 */
export function LocationPicker({ currentCity, onChanged }: LocationPickerProps) {
  const [saving, setSaving] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
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

    const res = await fetch('/api/users/location', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: isStatic
        ? JSON.stringify({ cityName: value })
        : JSON.stringify({ custom: selectedCity }),
    });

    setSaving(false);

    if (res.ok) {
      onChanged(selectedCity);
    } else {
      setError('Could not update location.');
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

    const res = await fetch('/api/users/location', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom: payload }),
    });

    setSaving(false);

    if (res.ok) {
      const data = await res.json();
      const newCity = {
        cityName: data.cityName,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
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
