'use client';

import React from 'react';

/**
 * Aura Reminders V1 (brief section 14/15) -- the minimal reminder
 * preference surface: a single "Upcoming reminders" toggle, default ON,
 * fixed at 15 minutes before start (not a picker -- see this feature's own
 * completion report for why a richer per-lead-time UI was deferred). Same
 * toggle-switch visual pattern as NotificationSettings' Window Alerts,
 * reused rather than reinvented, and rendered directly above it under one
 * shared "Notifications & Alerts" heading in YouView (section 15: evolve
 * toward that grouping without destroying Window Alerts' own behavior).
 */
export function ReminderSettings({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        background: 'rgba(30, 41, 59, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        padding: 16,
        marginBottom: 10,
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
        Reminders
      </span>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 12px', lineHeight: 1.4 }}>
        Get a reminder 15 minutes before a planned activity or Aura Moment starts.
      </p>

      <button
        type="button"
        onClick={() => onChange(!enabled)}
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
          width: '100%',
        }}
      >
        <div>
          <div style={{ fontSize: 13, color: '#e2e8f0' }}>Upcoming reminders</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>15 minutes before start</div>
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
    </div>
  );
}
