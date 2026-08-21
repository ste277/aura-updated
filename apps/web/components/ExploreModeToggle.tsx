'use client';

import React from 'react';

/**
 * The [Calendar][Muhurtham] toggle (brief section 12) shared by
 * PanchangCalendarView and MuhurthamFinderView, so both entry points render
 * an identical control rather than two near-duplicate ones.
 */
export function ExploreModeToggle({ active, onSelectCalendar, onSelectMuhurtham }: { active: 'calendar' | 'muhurtham'; onSelectCalendar?: () => void; onSelectMuhurtham?: () => void }) {
  return (
    <div style={toggleRowStyle} role="tablist" aria-label="Panchang Explore view">
      <ToggleButton label="Calendar" icon="📅" active={active === 'calendar'} onClick={onSelectCalendar} />
      <ToggleButton label="Muhurtham" icon="🔎" active={active === 'muhurtham'} onClick={onSelectMuhurtham} />
    </div>
  );
}

function ToggleButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={active ? undefined : onClick}
      disabled={active && !onClick}
      style={{
        ...toggleButtonStyle,
        background: active ? '#4ade80' : 'transparent',
        color: active ? '#020617' : '#f8fafc',
        cursor: active ? 'default' : 'pointer',
      }}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
}

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  background: 'rgba(15, 23, 42, 0.6)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 14,
  padding: 4,
};

const toggleButtonStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 34,
  border: 'none',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 800,
  fontFamily: 'sans-serif',
};
