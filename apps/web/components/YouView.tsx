'use client';

import React from 'react';
import { NotificationSettings } from './NotificationSettings';
import type { NotificationPrefs } from '../lib/windowNotifications';

interface YouViewProps {
  userName: string;
  email: string;
  cityName: string;
  timezone: string;
  notificationPrefs: NotificationPrefs;
  onNotificationPrefsChange: (next: NotificationPrefs) => void;
  onOpenChart: () => void;
  onSignOut: () => void;
}

export function YouView({
  userName,
  email,
  cityName,
  timezone,
  notificationPrefs,
  onNotificationPrefsChange,
  onOpenChart,
  onSignOut,
}: YouViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div>
        <h1 style={{ fontSize: 22, margin: 0, lineHeight: 1.15 }}>You</h1>
        <p style={{ fontSize: 12, color: '#b6c2d1', margin: '5px 0 0' }}>
          Your preferences, timing profile, and settings.
        </p>
      </div>

      <section style={{ background: 'var(--as-surface-raised, #0f172a)', border: '1px solid var(--as-border, #1e293b)', borderRadius: 16, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(74, 222, 128, 0.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontSize: 20, fontWeight: 900 }}>
            {userName.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#f8fafc' }}>{userName}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
          </div>
        </div>
      </section>

      <section style={{ background: 'var(--as-surface-raised, #0f172a)', border: '1px solid var(--as-border, #1e293b)', borderRadius: 16, overflow: 'hidden' }}>
        <SettingsRow icon="📍" title="Location & Time" detail={`${cityName} · ${timezone}`} />
        <SettingsRow icon="✨" title="Birth Chart" detail="View personal timing map" onClick={onOpenChart} />
        <SettingsRow icon="📅" title="Calendar & Sync" detail="Google Calendar connected" />
        <SettingsRow icon="✅" title="Daily Check-In" detail="Customize reflection prompts" />
      </section>

      <NotificationSettings prefs={notificationPrefs} onChange={onNotificationPrefsChange} />

      <section style={{ background: 'var(--as-surface-raised, #0f172a)', border: '1px solid var(--as-border, #1e293b)', borderRadius: 16, overflow: 'hidden' }}>
        <SettingsRow icon="📋" title="Activity Log" detail="View logged activities" />
        <SettingsRow icon="⬇️" title="Export Data" detail="Download your timing data" />
        <SettingsRow icon="❔" title="Help & FAQ" detail="Learn more about myAuraMoment" />
        <SettingsRow icon="ℹ️" title="About myAuraMoment" detail="Version 1.0.0" />
      </section>

      <button
        type="button"
        onClick={onSignOut}
        style={{ minHeight: 44, border: '1px solid rgba(251, 107, 107, 0.3)', borderRadius: 12, background: 'rgba(251, 107, 107, 0.08)', color: '#fb6b6b', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}
      >
        Sign out
      </button>
    </div>
  );
}

function SettingsRow({ icon, title, detail, onClick }: { icon: string; title: string; detail: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{ width: '100%', minHeight: 58, border: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', background: 'transparent', color: '#f8fafc', display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
      </span>
      {onClick && <span style={{ color: '#94a3b8', fontSize: 16 }}>›</span>}
    </button>
  );
}
