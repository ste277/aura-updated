'use client';

import { useEffect, useState } from 'react';

interface PanchangElement {
  name: string;
  paksha?: string;
  endsAt: string | null;
}

interface PanchangToday {
  tithi: PanchangElement;
  nakshatra: PanchangElement;
  yoga: PanchangElement;
  karana: PanchangElement;
}

function formatEndsAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `until ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function TodayOverview() {
  const [data, setData] = useState<PanchangToday | null>(null);

  useEffect(() => {
    fetch('/api/panchang/today')
      .then((res) => (res.ok ? res.json() : null))
      .then(setData);
  }, []);

  if (!data) return null;

  const rows: { label: string; el: PanchangElement }[] = [
    { label: 'Tithi', el: data.tithi },
    { label: 'Nakshatra', el: data.nakshatra },
    { label: 'Yoga', el: data.yoga },
    { label: 'Karana', el: data.karana },
  ];

  return (
    <div
      style={{
        marginTop: 28,
        background: 'var(--as-surface-raised)',
        border: '1px solid var(--as-border)',
        borderRadius: 12,
        padding: '14px 16px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--as-font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--as-text-muted)',
          marginBottom: 10,
        }}
      >
        Today overview
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(({ label, el }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--as-text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--as-text)', textAlign: 'right' }}>
              {el.paksha ? `${el.paksha} ${el.name}` : el.name}
              {el.endsAt && (
                <span style={{ color: 'var(--as-text-muted)', fontSize: 11, marginLeft: 6 }}>
                  ({formatEndsAt(el.endsAt)})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
