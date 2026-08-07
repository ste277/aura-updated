'use client';

import { useEffect, useState } from 'react';
import { CITY_OPTIONS } from '../lib/cities';
import { SouthIndianChart } from './SouthIndianChart';

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

interface TransitInsight {
  graha: string;
  transitRashi: number;
  houseFromMoon: number;
  isBenefic: boolean;
  insight: string;
}

interface NatalChartData {
  janmaRashi: string;
  janmaNakshatra: string;
  chart: GrahaPlacement[];
  taraBala: { taraNumber: number; name: string; favorable: boolean; todayNakshatraName: string };
}

const RASHI_NAME_TO_INDEX: Record<string, number> = {
  Mesha: 0,
  Vrishabha: 1,
  Mithuna: 2,
  Karka: 3,
  Simha: 4,
  Kanya: 5,
  Tula: 6,
  Vrishchika: 7,
  Dhanu: 8,
  Makara: 9,
  Kumbha: 10,
  Meena: 11,
};

export function BirthChartSection() {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [chartData, setChartData] = useState<NatalChartData | null>(null);
  const [transits, setTransits] = useState<TransitInsight[]>([]);
  const [selectedRashiIndex, setSelectedRashiIndex] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customCities, setCustomCities] = useState<CityOption[]>([]);
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [birthCity, setBirthCity] = useState(CITY_OPTIONS[0].cityName);

  useEffect(() => {
    fetch('/api/cities/custom')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CityOption[]) => setCustomCities(data))
      .catch(() => {});
  }, []);

  const combinedCities: CityOption[] = [
    ...CITY_OPTIONS,
    ...customCities.filter((cc) => !CITY_OPTIONS.some((co) => co.cityName === cc.cityName)),
  ];

  async function loadChartAndTransits() {
    const resChart = await fetch('/api/panchang/natal-chart');
    if (resChart.ok) {
      setChartData(await resChart.json());
      setHasProfile(true);

      const resTransits = await fetch('/api/panchang/transits');
      if (resTransits.ok) {
        setTransits(await resTransits.json());
      }
    } else {
      setHasProfile(false);
    }
  }

  useEffect(() => {
    loadChartAndTransits();
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
      await loadChartAndTransits();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Could not save birth profile.');
    }
  }

  // Calculate filtered house index when a grid cell is selected
  const moonRashiIdx = chartData ? RASHI_NAME_TO_INDEX[chartData.janmaRashi] ?? 1 : 1;
  const selectedHouseFromMoon =
    selectedRashiIndex !== null ? ((selectedRashiIndex - moonRashiIdx + 12) % 12) + 1 : null;

  const displayedTransits =
    selectedHouseFromMoon !== null
      ? transits.filter((t) => t.houseFromMoon === selectedHouseFromMoon)
      : transits;

  if (hasProfile === null) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontFamily: 'var(--as-font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--as-text-muted)' }}>
          Birth Chart & Transits
        </span>
        {hasProfile && (
          <div style={{ display: 'flex', gap: 12 }}>
            <a
              href="/api/calendar/feed"
              download
              style={{ fontSize: 11, color: 'var(--as-abhijit, #4ade80)', textDecoration: 'none' }}
            >
              📅 Export iCal
            </a>
            <button
              onClick={() => setShowForm((v) => !v)}
              style={{ fontSize: 11, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {showForm ? 'Cancel' : 'Edit'}
            </button>
          </div>
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

      {chartData && !showForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Birth Info & Interactive South Indian Chart Card */}
          <div style={{ background: 'var(--as-surface-raised)', border: '1px solid var(--as-border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--as-text)', marginBottom: 12, textAlign: 'center' }}>
              Janma Rashi: <strong>{chartData.janmaRashi}</strong> · Janma Nakshatra: <strong>{chartData.janmaNakshatra}</strong>
            </div>

            {/* Visual South Indian D1 Chart Grid with Active Click State */}
            <SouthIndianChart
              chart={chartData.chart}
              janmaRashi={chartData.janmaRashi}
              selectedRashiIndex={selectedRashiIndex}
              onSelectRashi={setSelectedRashiIndex}
            />

            <div
              style={{
                fontSize: 12,
                padding: '8px 10px',
                borderRadius: 8,
                marginBottom: 12,
                background: chartData.taraBala.favorable ? 'var(--as-abhijit-dim, #1f4d34)' : 'var(--as-rahu-dim, #4d2323)',
                color: chartData.taraBala.favorable ? 'var(--as-abhijit, #4ade80)' : 'var(--as-rahu, #fb6b6b)',
              }}
            >
              Today's Tara Bala: <strong>{chartData.taraBala.name}</strong> ({chartData.taraBala.favorable ? 'favorable' : 'use caution'})
            </div>

            {/* 2-Column Graha Degree Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
              {chartData.chart.map((g) => (
                <div key={g.graha} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--as-text-muted)' }}>
                  <span>{g.graha}</span>
                  <span style={{ color: 'var(--as-text)', fontWeight: 500 }}>
                    {g.rashiName} {g.degreeInRashi.toFixed(1)}°
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Daily Gochara / Transits Grid */}
          {transits.length > 0 && (
            <div style={{ background: 'var(--as-surface-raised)', border: '1px solid var(--as-border)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-text)' }}>
                  Live Planetary Transits (Gochara from Chandra)
                  {selectedHouseFromMoon !== null && (
                    <span style={{ color: 'var(--as-abhijit, #4ade80)', marginLeft: 6, fontWeight: 500 }}>
                      (House {selectedHouseFromMoon})
                    </span>
                  )}
                </div>
                {selectedRashiIndex !== null && (
                  <button
                    onClick={() => setSelectedRashiIndex(null)}
                    style={{ fontSize: 11, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Show All Transits
                  </button>
                )}
              </div>

              {displayedTransits.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--as-text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No major planets transiting House {selectedHouseFromMoon} today.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {displayedTransits.map((t) => (
                    <div
                      key={t.graha}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--as-surface)',
                        borderLeft: `4px solid ${t.isBenefic ? 'var(--as-abhijit, #4ade80)' : 'var(--as-rahu, #fb6b6b)'}`,
                        borderTop: '1px solid var(--as-border)',
                        borderRight: '1px solid var(--as-border)',
                        borderBottom: '1px solid var(--as-border)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-text)' }}>{t.graha}</span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.03em',
                            textTransform: 'uppercase',
                            padding: '2px 8px',
                            borderRadius: 12,
                            background: t.isBenefic ? 'rgba(74, 222, 128, 0.15)' : 'rgba(251, 107, 107, 0.15)',
                            color: t.isBenefic ? 'var(--as-abhijit, #4ade80)' : 'var(--as-rahu, #fb6b6b)',
                          }}
                        >
                          House {t.houseFromMoon} · {t.isBenefic ? 'Auspicious' : 'Friction'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--as-text-muted)', lineHeight: 1.4 }}>{t.insight}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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