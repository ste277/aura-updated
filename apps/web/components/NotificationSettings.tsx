'use client';

import React, { useState } from 'react';
import type { SolarWindowType } from '../../../packages/panchang/src/windows';
import type { NotificationPrefs } from '../lib/windowNotifications';
import { colors, spacing, typography, radius } from './theme';

const WINDOW_OPTIONS: { type: SolarWindowType; label: string; hint: string }[] = [
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', hint: 'Peak productivity window' },
  { type: 'BRAHMA', label: 'Brahma Muhurtham', hint: 'Pre-dawn — early alert' },
  { type: 'GULIKA', label: 'Gulika Kalam', hint: 'Steady progress window' },
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', hint: 'Caution window' },
  { type: 'YAMA', label: 'Yama Gandam', hint: 'Caution window' },
];

/**
 * Aura UI Experience V2 (brief section 60) -- collapsed by default. Before
 * this, all 5 toggles rendered permanently, making this the densest block
 * on the whole You screen. Now a single summary row ("Window alerts / N
 * enabled ›") expands into the exact same 5 toggles on tap -- no
 * functionality removed, just not shown until asked for.
 */
export function NotificationSettings({
  prefs,
  onChange,
}: {
  prefs: NotificationPrefs;
  onChange: (next: NotificationPrefs) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const enabledCount = WINDOW_OPTIONS.filter((opt) => prefs[opt.type]).length;

  return (
    <div
      style={{
        background: colors.surfaceSubtle,
        border: `1px solid ${colors.borderSubtle}`,
        borderRadius: radius.lg,
        padding: spacing.lg,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 32,
        }}
      >
        <div>
          <span style={typography.sectionEyebrow}>Window Alerts</span>
          {!expanded && (
            <p style={{ fontSize: 12, color: colors.textFaint, margin: '6px 0 0', lineHeight: 1.4 }}>
              {enabledCount} enabled
            </p>
          )}
        </div>
        <span style={{ color: expanded ? colors.positive : colors.textMuted, fontSize: 16, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 160ms ease, color 160ms ease' }}>
          ›
        </span>
      </button>

      {expanded && (
        <>
          <p style={{ fontSize: 12, color: colors.textFaint, margin: `${spacing.sm}px 0 ${spacing.md}px`, lineHeight: 1.4 }}>
            Get notified 10 minutes before a window starts. Alerts fire on this device.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {WINDOW_OPTIONS.map((opt) => {
              const enabled = prefs[opt.type];
              return (
                <button
                  type="button"
                  key={opt.type}
                  onClick={() => onChange({ ...prefs, [opt.type]: !enabled })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.md,
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    textAlign: 'left',
                    minHeight: 44,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: colors.textSecondary }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>{opt.hint}</div>
                  </div>
                  <div
                    style={{
                      width: 40,
                      height: 22,
                      borderRadius: radius.pill,
                      flexShrink: 0,
                      background: enabled ? '#1f4d34' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${enabled ? colors.positive : 'rgba(255,255,255,0.15)'}`,
                      position: 'relative',
                      transition: 'background 0.15s',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: enabled ? 20 : 2,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: enabled ? colors.positive : colors.textMuted,
                        transition: 'left 0.15s',
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
