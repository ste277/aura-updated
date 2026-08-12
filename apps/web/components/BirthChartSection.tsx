'use client';

import { useEffect, useState, useMemo } from 'react';
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
  birthDate?: string;
  birthTime?: string;
  birthCityName?: string;
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
  const [birthCity, setBirthCity] = useState(CITY_OPTIONS[0]?.cityName || 'Chennai');

  useEffect(() => {
    fetch('/api/cities/custom')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CityOption[]) => setCustomCities(data))
      .catch(() => {});
  }, []);

  const combinedCities: CityOption[] = [
    ...CITY_OPTIONS.map((c: any) => ({
      cityName: c.cityName || c.name || 'Chennai',
      latitude: c.latitude,
      longitude: c.longitude,
      timezone: c.timezone,
    })),
    ...customCities.filter((cc) => !CITY_OPTIONS.some((co: any) => (co.cityName || co.name) === cc.cityName)),
  ];

  async function loadChartAndTransits() {
    const resChart = await fetch('/api/panchang/natal-chart');
    if (resChart.ok) {
      const data: NatalChartData = await resChart.json();
      setChartData(data);
      setHasProfile(true);

      if (data.birthDate) setBirthDate(data.birthDate);
      if (data.birthTime) setBirthTime(data.birthTime);
      if (data.birthCityName) setBirthCity(data.birthCityName);

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

  const handleToggleForm = () => {
    if (!showForm && chartData) {
      if (chartData.birthDate) setBirthDate(chartData.birthDate);
      if (chartData.birthTime) setBirthTime(chartData.birthTime);
      if (chartData.birthCityName) setBirthCity(chartData.birthCityName);
    }
    setShowForm((v) => !v);
  };

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

  const moonRashiIdx = chartData ? RASHI_NAME_TO_INDEX[chartData.janmaRashi] ?? 1 : 1;
  const selectedHouseFromMoon =
    selectedRashiIndex !== null ? ((selectedRashiIndex - moonRashiIdx + 12) % 12) + 1 : null;

  const displayedTransits =
    selectedHouseFromMoon !== null
      ? transits.filter((t) => t.houseFromMoon === selectedHouseFromMoon)
      : transits;

  // Dynamic Transit Energy Summarizer with Distinct Planetary Mappings
  const transitSummary = useMemo(() => {
    if (!transits || transits.length === 0) return null;

    const capitalizeOn: string[] = [];
    const guardrails: string[] = [];

    transits.forEach((t) => {
      if (t.isBenefic) {
        if (t.graha === 'Sun') {
          capitalizeOn.push(`Sun (House ${t.houseFromMoon}): Executive drive & administrative focus.`);
        } else if (t.graha === 'Moon') {
          capitalizeOn.push(`Moon (House ${t.houseFromMoon}): High vitality & smooth mental momentum.`);
        } else if (t.graha === 'Mercury') {
          capitalizeOn.push(`Mercury (House ${t.houseFromMoon}): Sharp analytical speed & communication.`);
        } else if (t.graha === 'Venus') {
          capitalizeOn.push(`Venus (House ${t.houseFromMoon}): Enhanced creative harmony & workflow.`);
        } else if (t.graha === 'Saturn') {
          capitalizeOn.push(`Saturn (House ${t.houseFromMoon}): Long-term stability & disciplined growth.`);
        } else {
          capitalizeOn.push(`${t.graha} (House ${t.houseFromMoon}): Auspicious support.`);
        }
      } else {
        if (t.graha === 'Mars') {
          guardrails.push(`Mars (House ${t.houseFromMoon}): Guard against hasty or impulsive friction.`);
        } else if (t.graha === 'Jupiter') {
          guardrails.push(`Jupiter (House ${t.houseFromMoon}): Exercise prudent financial planning.`);
        } else if (t.graha === 'Rahu') {
          guardrails.push(`Rahu (House ${t.houseFromMoon}): Avoid overcommitment or speculative risks.`);
        } else if (t.graha === 'Ketu') {
          guardrails.push(`Ketu (House ${t.houseFromMoon}): Watch out for emotional detachment.`);
        } else {
          guardrails.push(`${t.graha} (House ${t.houseFromMoon}): Potential friction point; exercise care.`);
        }
      }
    });

    return {
      capitalizeOn: capitalizeOn.slice(0, 3),
      guardrails: guardrails.slice(0, 3),
    };
  }, [transits]);

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
              onClick={handleToggleForm}
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
            gap: 8,
            background: 'var(--as-surface-raised)',
            padding: 12,
            borderRadius: 8,
            border: '1px solid var(--as-border)',
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase' }}>
            Enter Birth Details
          </div>
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
            style={{ ...formInputStyle, cursor: 'pointer', background: 'var(--as-abhijit-dim, #1f4d34)', color: 'var(--as-abhijit, #4ade80)', fontWeight: 600 }}
          >
            {saving ? 'Saving...' : 'Save Birth Profile'}
          </button>
          {error && <div style={{ color: 'var(--as-rahu)', fontSize: 11 }}>{error}</div>}
        </form>
      )}

      {chartData && !showForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* VISIBLE ENTERED DETAILS SUMMARY BANNER */}
          {(chartData.birthDate || birthDate) && (
            <div
              style={{
                background: 'rgba(30, 41, 59, 0.4)',
                border: '1px solid var(--as-border)',
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11,
                fontFamily: 'monospace',
                color: 'var(--as-text-muted)',
              }}
            >
              <span>
                📅 {chartData.birthDate || birthDate} · ⏰ {chartData.birthTime || birthTime}
              </span>
              <span style={{ color: 'var(--as-abhijit, #4ade80)', fontWeight: 600 }}>
                📍 {chartData.birthCityName || birthCity}
              </span>
            </div>
          )}

          {/* Birth Info & Interactive South Indian Chart Card */}
          <div style={{ background: 'var(--as-surface-raised)', border: '1px solid var(--as-border)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--as-text)', marginBottom: 12, textAlign: 'center' }}>
              Janma Rashi: <strong>{chartData.janmaRashi}</strong> · Janma Nakshatra: <strong>{chartData.janmaNakshatra}</strong>
            </div>

            {/* Visual South Indian D1 Chart Grid */}
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

              {/* DYNAMIC GOCHARA ENERGY SUMMARY CARD */}
              {transitSummary && selectedRashiIndex === null && (
                <div
                  style={{
                    background: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid var(--as-border)',
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>
                    Dynamic Gochara Summary
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {/* Green Light Box */}
                    <div style={{ background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.2)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-abhijit, #4ade80)', marginBottom: 6 }}>
                        🟢 Capitalize On
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, color: '#e2e8f0', lineHeight: 1.4 }}>
                        {transitSummary.capitalizeOn.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Guardrails Box */}
                    <div style={{ background: 'rgba(251, 107, 107, 0.08)', border: '1px solid rgba(251, 107, 107, 0.2)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-rahu, #fb6b6b)', marginBottom: 6 }}>
                        ⚠️ Guardrails
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 14, fontSize: 11, color: '#e2e8f0', lineHeight: 1.4 }}>
                        {transitSummary.guardrails.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

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