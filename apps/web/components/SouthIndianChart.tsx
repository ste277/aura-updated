'use client';

import React from 'react';

interface GrahaPlacement {
  graha: string;
  rashiName: string;
  degreeInRashi: number;
}

interface SouthIndianChartProps {
  chart: GrahaPlacement[];
  janmaRashi: string;
  selectedRashiIndex: number | null;
  onSelectRashi: (index: number | null) => void;
}

interface RashiMeta {
  name: string;
  sanskrit: string;
  lord: string;
  element: string;
  signNumber: number;
}

const RASHI_METADATA: Record<number, RashiMeta> = {
  0: { name: 'Mesha', sanskrit: 'Aries', lord: 'Mars', element: 'Fire', signNumber: 1 },
  1: { name: 'Vrishabha', sanskrit: 'Taurus', lord: 'Venus', element: 'Earth', signNumber: 2 },
  2: { name: 'Mithuna', sanskrit: 'Gemini', lord: 'Mercury', element: 'Air', signNumber: 3 },
  3: { name: 'Karka', sanskrit: 'Cancer', lord: 'Moon', element: 'Water', signNumber: 4 },
  4: { name: 'Simha', sanskrit: 'Leo', lord: 'Sun', element: 'Fire', signNumber: 5 },
  5: { name: 'Kanya', sanskrit: 'Virgo', lord: 'Mercury', element: 'Earth', signNumber: 6 },
  6: { name: 'Tula', sanskrit: 'Libra', lord: 'Venus', element: 'Air', signNumber: 7 },
  7: { name: 'Vrishchika', sanskrit: 'Scorpio', lord: 'Mars', element: 'Water', signNumber: 8 },
  8: { name: 'Dhanu', sanskrit: 'Sagittarius', lord: 'Jupiter', element: 'Fire', signNumber: 9 },
  9: { name: 'Makara', sanskrit: 'Capricorn', lord: 'Saturn', element: 'Earth', signNumber: 10 },
  10: { name: 'Kumbha', sanskrit: 'Aquarius', lord: 'Saturn', element: 'Air', signNumber: 11 },
  11: { name: 'Meena', sanskrit: 'Pisces', lord: 'Jupiter', element: 'Water', signNumber: 12 },
};

const RASHI_GRID_MAP: Record<number, { row: number; col: number; name: string }> = {
  11: { row: 0, col: 0, name: 'Meena' },
  0:  { row: 0, col: 1, name: 'Mesha' },
  1:  { row: 0, col: 2, name: 'Vrishabha' },
  2:  { row: 0, col: 3, name: 'Mithuna' },
  10: { row: 1, col: 0, name: 'Kumbha' },
  3:  { row: 1, col: 3, name: 'Karka' },
  9:  { row: 2, col: 0, name: 'Makara' },
  4:  { row: 2, col: 3, name: 'Simha' },
  8:  { row: 3, col: 0, name: 'Dhanu' },
  7:  { row: 3, col: 1, name: 'Vrishchika' },
  6:  { row: 3, col: 2, name: 'Tula' },
  5:  { row: 3, col: 3, name: 'Kanya' },
};

const RASHI_NAME_TO_INDEX: Record<string, number> = {
  Mesha: 0, Vrishabha: 1, Mithuna: 2, Karka: 3,
  Simha: 4, Kanya: 5, Tula: 6, Vrishchika: 7,
  Dhanu: 8, Makara: 9, Kumbha: 10, Meena: 11,
};

const BENEFIC_GRAHAS = new Set(['Jupiter', 'Venus', 'Moon', 'Mercury']);

export function SouthIndianChart({
  chart,
  janmaRashi,
  selectedRashiIndex,
  onSelectRashi,
}: SouthIndianChartProps) {
  const moonRashiIdx = RASHI_NAME_TO_INDEX[janmaRashi] ?? 1;

  // Group planets by rashi index
  const planetsByRashi: Record<number, GrahaPlacement[]> = {};
  for (const p of chart) {
    const idx = RASHI_NAME_TO_INDEX[p.rashiName];
    if (idx !== undefined) {
      if (!planetsByRashi[idx]) planetsByRashi[idx] = [];
      planetsByRashi[idx].push(p);
    }
  }

  // Generate 4x4 grid cells
  const gridCells: ({ rashiIndex: number; name: string } | null)[][] = Array(4)
    .fill(null)
    .map(() => Array(4).fill(null));

  Object.entries(RASHI_GRID_MAP).forEach(([idxStr, pos]) => {
    gridCells[pos.row][pos.col] = {
      rashiIndex: Number(idxStr),
      name: pos.name,
    };
  });

  const selectedMeta = selectedRashiIndex !== null ? RASHI_METADATA[selectedRashiIndex] : null;
  const selectedPlanets = selectedRashiIndex !== null ? planetsByRashi[selectedRashiIndex] || [] : [];
  const houseFromMoon = selectedRashiIndex !== null ? ((selectedRashiIndex - moonRashiIdx + 12) % 12) + 1 : null;

  const handleCellClick = (rashiIndex: number) => {
    // Toggle selection off if clicking the already selected cell
    if (selectedRashiIndex === rashiIndex) {
      onSelectRashi(null);
    } else {
      onSelectRashi(rashiIndex);
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: 420, margin: '0 auto 16px auto' }}>
      {/* 4x4 South Indian Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridTemplateRows: 'repeat(4, 1fr)',
          aspectRatio: '1 / 1',
          border: '1.5px solid var(--as-border, #334155)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--as-surface-raised, #0f172a)',
        }}
      >
        {gridCells.map((row, rIdx) =>
          row.map((cell, cIdx) => {
            if (rIdx >= 1 && rIdx <= 2 && cIdx >= 1 && cIdx <= 2) {
              if (rIdx === 1 && cIdx === 1) {
                return (
                  <div
                    key="center-core"
                    style={{
                      gridColumn: '2 / span 2',
                      gridRow: '2 / span 2',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--as-surface, #020617)',
                      border: '1px solid var(--as-border, #334155)',
                      padding: 8,
                      textAlign: 'center',
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-text, #f8fafc)', letterSpacing: '0.05em' }}>
                      RASI (D1)
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--as-text-muted, #94a3b8)', marginTop: 4 }}>
                      Chandra: <strong style={{ color: 'var(--as-abhijit, #4ade80)' }}>{janmaRashi}</strong>
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--as-text-muted, #64748b)', marginTop: 6 }}>
                      Tap a house to filter transits
                    </span>
                  </div>
                );
              }
              return null;
            }

            if (!cell) return null;

            const isMoonSign = cell.name === janmaRashi;
            const isSelected = selectedRashiIndex === cell.rashiIndex;
            const planets = planetsByRashi[cell.rashiIndex] || [];

            return (
              <div
                key={`${rIdx}-${cIdx}`}
                onClick={() => handleCellClick(cell.rashiIndex)}
                style={{
                  position: 'relative',
                  border: isSelected ? '1.5px solid var(--as-abhijit, #4ade80)' : '1px solid var(--as-border, #334155)',
                  padding: '4px 6px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: isSelected
                    ? 'rgba(74, 222, 128, 0.12)'
                    : isMoonSign
                    ? 'rgba(74, 222, 128, 0.06)'
                    : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: 'var(--as-text-muted, #64748b)', textTransform: 'uppercase', fontWeight: 600 }}>
                    {cell.name.slice(0, 3)}
                  </span>
                  {isMoonSign && (
                    <span style={{ fontSize: 8, background: 'var(--as-abhijit-dim, #1f4d34)', color: 'var(--as-abhijit, #4ade80)', padding: '1px 3px', borderRadius: 3 }}>
                      MOON
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {planets.map((p) => {
                    const isBenefic = BENEFIC_GRAHAS.has(p.graha);
                    return (
                      <div
                        key={p.graha}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 10,
                          fontWeight: 600,
                          color: isBenefic ? 'var(--as-abhijit, #4ade80)' : 'var(--as-text, #e2e8f0)',
                        }}
                      >
                        <span>{p.graha}</span>
                        <span style={{ fontSize: 9, opacity: 0.75, fontWeight: 400 }}>
                          {Math.floor(p.degreeInRashi)}°
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Rashi Detail Popup Drawer */}
      {selectedMeta && (
        <div
          style={{
            marginTop: 10,
            background: 'var(--as-surface, #020617)',
            border: '1px solid var(--as-border, #334155)',
            borderRadius: 8,
            padding: '10px 14px',
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--as-text, #f8fafc)' }}>
                {selectedMeta.name} ({selectedMeta.sanskrit})
              </span>
              <span style={{ fontSize: 11, color: 'var(--as-abhijit, #4ade80)', marginLeft: 8 }}>
                House {houseFromMoon} from Moon
              </span>
            </div>
            <button
              type="button"
              onClick={() => onSelectRashi(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--as-text-muted, #94a3b8)',
                cursor: 'pointer',
                fontSize: 12,
                padding: 0,
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--as-text-muted, #94a3b8)', marginBottom: 8 }}>
            <span>Ruler: <strong style={{ color: 'var(--as-text, #e2e8f0)' }}>{selectedMeta.lord}</strong></span>
            <span>Element: <strong style={{ color: 'var(--as-text, #e2e8f0)' }}>{selectedMeta.element}</strong></span>
            <span>Sign #: <strong style={{ color: 'var(--as-text, #e2e8f0)' }}>{selectedMeta.signNumber}</strong></span>
          </div>

          <div style={{ borderTop: '1px solid var(--as-border, #334155)', paddingTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--as-text, #f8fafc)' }}>
              Occupying Grahas ({selectedPlanets.length}):
            </span>
            {selectedPlanets.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--as-text-muted, #64748b)', marginTop: 2 }}>
                No natal planets occupy this sign.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {selectedPlanets.map((p) => (
                  <div key={p.graha} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: 'var(--as-text, #e2e8f0)', fontWeight: 600 }}>{p.graha}</span>
                    <span style={{ color: 'var(--as-text-muted, #94a3b8)' }}>{p.degreeInRashi.toFixed(2)}° in sign</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
