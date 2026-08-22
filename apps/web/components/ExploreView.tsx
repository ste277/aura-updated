'use client';

import React from 'react';
import * as theme from './theme';

/**
 * Product Structure V2 -- Explore owns Panchang + Muhurtham (brief section
 * 23). A small landing screen, not a rewrite of either existing view:
 * PanchangCalendarView and MuhurthamFinderView are unchanged, just reached
 * from here instead of buried under You. Deliberately does NOT mix in
 * "Your Moments" (brief section 23: "Do not mix Your Moments into this
 * screen" -- that lives in Plan).
 */
interface ExploreViewProps {
  onOpenPanchang: () => void;
  onOpenMuhurtham: () => void;
}

export function ExploreView({ onOpenPanchang, onOpenMuhurtham }: ExploreViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div>
        <h1 style={{ fontSize: 22, margin: 0, lineHeight: 1.15 }}>Explore</h1>
        <p style={{ fontSize: 12, color: '#b6c2d1', margin: '5px 0 0' }}>
          What does this time hold, and when is a favorable moment for something important?
        </p>
      </div>

      <button type="button" onClick={onOpenPanchang} style={cardButtonStyle}>
        <span style={{ fontSize: 28 }}>🗓️</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 800 }}>Panchang Calendar</span>
          <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 3 }}>What does this date hold?</span>
        </span>
        <span style={{ color: '#94a3b8', fontSize: 18 }}>›</span>
      </button>

      <button type="button" onClick={onOpenMuhurtham} style={cardButtonStyle}>
        <span style={{ fontSize: 28 }}>✨</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 16, fontWeight: 800 }}>Muhurtham Finder</span>
          <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 3 }}>When is a favorable time for this important occasion?</span>
        </span>
        <span style={{ color: '#94a3b8', fontSize: 18 }}>›</span>
      </button>
    </div>
  );
}

const cardButtonStyle: React.CSSProperties = {
  ...theme.panelStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  width: '100%',
  minHeight: 76,
  color: theme.colors.textPrimary,
  padding: '14px 16px',
  textAlign: 'left',
  cursor: 'pointer',
};
