'use client';

import React from 'react';
import type { SolarWindowType } from '../../../packages/panchang/src/windows';
import type { NotificationPrefs } from '../lib/windowNotifications';

const WINDOW_OPTIONS: { type: SolarWindowType; label: string; hint: string }[] = [
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', hint: 'Peak productivity window' },
  { type: 'BRAHMA', label: 'Brahma Muhurtham', hint: 'Pre-dawn — early alert' },
  { type: 'GULIKA', label: 'Gulika Kalam', hint: 'Steady progress window' },
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', hint: 'Caution window' },
  { type: 'YAMA', label: 'Yama Gandam', hint: 'Caution window' },
];

export function NotificationSettings({
  prefs,
  onChange,
}: {
  prefs: NotificationPrefs;
  onChange: (next: NotificationPrefs) => void;
}) {
  return (
    <div
      style={{
        background: 'rgba(30, 41, 59, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        padding: 16,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          color: '#94a3b8',
          letterSpacing: '0.05em',
          fontWeight: 600,
        }}
      >
        Window Alerts
      </span>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 12px', lineHeight: 1.4 }}>
        Get notified 10 minutes before a window starts. Alerts fire on this device.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {WINDOW_OPTIONS.map((opt) => {
          const enabled = prefs[opt.type];
          return (
            <button
              key={opt.type}
              onClick={() => onChange({ ...prefs, [opt.type]: !enabled })}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                minHeight: 32,
              }}
            >
              <div>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>{opt.label}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{opt.hint}</div>
              </div>
              <div
                style={{
                  width: 40,
                  height: 22,
                  borderRadius: 11,
                  flexShrink: 0,
                  background: enabled ? '#1f4d34' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${enabled ? '#4ade80' : 'rgba(255,255,255,0.15)'}`,
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
                    background: enabled ? '#4ade80' : '#94a3b8',
                    transition: 'left 0.15s',
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
