'use client';

import { useEffect, useState } from 'react';
import { CITY_OPTIONS } from '../lib/cities';

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

export function LocationPicker({ currentCity, onChanged }: LocationPickerProps) {
  const [saving, setSaving] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [custom, setCustom] = useState({ cityName: '', latitude: '', longitude: '', timezone: '' });

  // Load custom cities saved in the DB
  useEffect(() => {
    fetch('/api/cities/custom')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CityOption[]) => setCustomCities(data))
      .catch(() => {});
  }, []);

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

  async function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      cityName: custom.cityName,
      latitude: parseFloat(custom.latitude),
      longitude: parseFloat(custom.longitude),
      timezone: custom.timezone,
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
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not save that location.');
    }
  }

  if (showCustomForm) {
    return (
      <form
        onSubmit={handleCustomSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'var(--as-surface-raised)',
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--as-border)',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--as-text-muted)', marginBottom: 2 }}>
          Custom location — timezone must be an IANA name, e.g. "America/Chicago"
        </div>
        <input
          required
          placeholder="City name"
          value={custom.cityName}
          onChange={(e) => setCustom({ ...custom, cityName: e.target.value })}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            required
            placeholder="Latitude"
            value={custom.latitude}
            onChange={(e) => setCustom({ ...custom, latitude: e.target.value })}
            style={inputStyle}
          />
          <input
            required
            placeholder="Longitude"
            value={custom.longitude}
            onChange={(e) => setCustom({ ...custom, longitude: e.target.value })}
            style={inputStyle}
          />
        </div>
        <input
          required
          placeholder="Timezone (e.g. America/Chicago)"
          value={custom.timezone}
          onChange={(e) => setCustom({ ...custom, timezone: e.target.value })}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              ...inputStyle,
              cursor: 'pointer',
              background: 'var(--as-abhijit-dim, #1f4d34)',
              color: 'var(--as-abhijit, #4ade80)',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={() => setShowCustomForm(false)} style={{ ...inputStyle, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
        {error && <div style={{ color: 'var(--as-rahu)', fontSize: 11 }}>{error}</div>}
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
      {error && <div style={{ color: 'var(--as-rahu)', fontSize: 11, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--as-font-body)',
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--as-border)',
  background: 'var(--as-surface)',
  color: 'var(--as-text)',
  flex: 1,
};