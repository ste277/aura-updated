'use client';

import { useEffect, useState } from 'react';
import { CITY_OPTIONS } from '../lib/cities';

interface CityOption {
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface GrahaPlacement {
  graha: string;
  rashiName: string;
  degreeInRashi: number;
}

interface NatalChartData {
  janmaRashi: string;
  janmaNakshatra: string;
  chart: GrahaPlacement[];
  taraBala: { taraNumber: number; name: string; favorable: boolean; todayNakshatraName: string };
}

export function BirthChartSection() {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null); // null = checking
  const [chartData, setChartData] = useState<NatalChartData | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [birthCity, setBirthCity] = useState(CITY_OPTIONS[0].cityName);

  // Fetch saved custom cities from DB
  useEffect(() => {
    fetch('/api/cities/custom')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CityOption[]) => setCustomCities(data))
      .catch(() => {});
  }, []);

  // Combine static options with custom saved cities (deduped by city name)
  const combinedCities: CityOption[] = [
    ...CITY_OPTIONS,
    ...customCities.filter((cc) => !CITY_OPTIONS.some((co) => co.cityName === cc.cityName)),
  ];

  async function loadChart() {
    const res = await fetch('/api/panchang/natal-chart');
    if (res.ok) {
      setChartData(await res.json());
      setHasProfile(true);
    } else {
      setHasProfile(false);
    }
  }

  useEffect(() => {
    loadChart();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const city = combinedCities.find((c) => c.cityName === birthCity) || combinedCities[0];

    const res = await fetch('/api/users/birth-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        birthDate,
        birthTime,
        birthCityName: city.cityName,
        birthLatitude: city.latitude,
        birthLongitude: city.longitude,
        birthTimezone: city.timezone,
      }),
    });
    setSaving(false);

    if (res.ok) {
      setShowForm(false);
      await loadChart();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not save birth profile.');
    }
  }

  if (hasProfile === null) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span
          style={{
            fontFamily: 'var(--as-font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--as-text-muted)',
          }}
        >
          Birth chart
        </span>
        {hasProfile && (
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{ fontSize: 11, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Edit
          </button>
        )}
      </div>

      {!hasProfile && !showForm && (
        <div style={{ fontSize: 13, color: 'var(--as-text-muted)' }}>
          No birth profile yet.{' '}
          <button
            onClick={() => setShowForm(true)}
            style={{ color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13 }}
          >
            Add your birth details
          </button>{' '}
          to see your birth chart and personalized daily favorability.
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--as-surface-raised)',
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--as-border)',
            marginBottom: 12,
          }}
        >
          <input required type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} style={formInputStyle} />
          <input required type="time" value={birthTime} onChange={(e) => setBirthTime(e.target.value)} style={formInputStyle} />
          <select value={birthCity} onChange={(e) => setBirthCity(e.target.value)} style={formInputStyle}>
            {combinedCities.map((c) => (
              <option key={c.cityName} value={c.cityName}>
                {c.cityName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving}
            style={{ ...formInputStyle, cursor: 'pointer', background: 'var(--as-abhijit-dim, #1f4d34)', color: 'var(--as-abhijit, #4ade80)' }}
          >
            {saving ? 'Saving...' : 'Save birth profile'}
          </button>
          {error && <div style={{ color: 'var(--as-rahu)', fontSize: 11 }}>{error}</div>}
        </form>
      )}

      {chartData && (
        <div style={{ background: 'var(--as-surface-raised)', border: '1px solid var(--as-border)', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, color: 'var(--as-text)', marginBottom: 8 }}>
            Janma Rashi: <strong>{chartData.janmaRashi}</strong> · Janma Nakshatra: <strong>{chartData.janmaNakshatra}</strong>
          </div>

          <div
            style={{
              fontSize: 12,
              padding: '8px 10px',
              borderRadius: 8,
              marginBottom: 10,
              background: chartData.taraBala.favorable ? 'var(--as-abhijit-dim, #1f4d34)' : 'var(--as-rahu-dim, #4d2323)',
              color: chartData.taraBala.favorable ? 'var(--as-abhijit, #4ade80)' : 'var(--as-rahu, #fb6b6b)',
            }}
          >
            Today's Tara Bala: <strong>{chartData.taraBala.name}</strong> ({chartData.taraBala.favorable ? 'favorable' : 'use caution'})
          </div>

          <div style={{ display: 'grid', gap: 4 }}>
            {chartData.chart.map((g) => (
              <div key={g.graha} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--as-text-muted)' }}>
                <span>{g.graha}</span>
                <span style={{ color: 'var(--as-text)' }}>
                  {g.rashiName} {g.degreeInRashi.toFixed(1)}°
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const formInputStyle: React.CSSProperties = {
  fontFamily: 'var(--as-font-body)',
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--as-border)',
  background: 'var(--as-surface)',
  color: 'var(--as-text)',
};