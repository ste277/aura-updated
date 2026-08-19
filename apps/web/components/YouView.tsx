'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LocationPicker } from './LocationPicker';
import { NotificationSettings } from './NotificationSettings';
import type { NotificationPrefs } from '../lib/windowNotifications';

interface YouViewProps {
  userName: string;
  email: string;
  cityName: string;
  timezone: string;
  notificationPrefs: NotificationPrefs;
  onNotificationPrefsChange: (next: NotificationPrefs) => void;
  onLocationChanged: (city: { cityName: string; latitude: number; longitude: number; timezone: string }) => void;
  onOpenHome: () => void;
  onOpenChart: () => void;
  onOpenActivityLog: () => void;
  onSignOut: () => void;
  focusNotificationsKey?: number;
}

export function YouView({
  userName,
  email,
  cityName,
  timezone,
  notificationPrefs,
  onNotificationPrefsChange,
  onLocationChanged,
  onOpenHome,
  onOpenChart,
  onOpenActivityLog,
  onSignOut,
  focusNotificationsKey,
}: YouViewProps) {
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const [openSettingsPanel, setOpenSettingsPanel] = useState<
    'location' | 'calendar' | 'checkIn' | 'help' | 'about' | null
  >(null);
  const [calendarCopyState, setCalendarCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const calendarFeedUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/api/calendar/feed';
    return `${window.location.origin}/api/calendar/feed`;
  }, []);

  const handleCopyCalendarFeed = async () => {
    try {
      await navigator.clipboard.writeText(calendarFeedUrl);
      setCalendarCopyState('copied');
      window.setTimeout(() => setCalendarCopyState('idle'), 1800);
    } catch {
      setCalendarCopyState('failed');
      window.setTimeout(() => setCalendarCopyState('idle'), 1800);
    }
  };

  const toggleSettingsPanel = (panel: NonNullable<typeof openSettingsPanel>) => {
    setOpenSettingsPanel((current) => (current === panel ? null : panel));
  };

  useEffect(() => {
    if (!focusNotificationsKey) return;
    requestAnimationFrame(() => {
      notificationsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focusNotificationsKey]);

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
        <SettingsRow icon="📍" title="Location & Time" detail={`${cityName} · ${timezone}`} expanded={openSettingsPanel === 'location'} onClick={() => toggleSettingsPanel('location')} />
        {openSettingsPanel === 'location' && (
          <div style={settingsPanelStyle}>
            <div style={{ color: '#dbe7f4', fontSize: 12, lineHeight: 1.45, marginBottom: 10 }}>
              Your selected location determines Panchang windows, calendar feed timing, and daily suggestions.
            </div>
            <LocationPicker currentCity={cityName} onChanged={onLocationChanged} />
          </div>
        )}
        <SettingsRow icon="✨" title="Birth Chart" detail="View personal timing map" onClick={onOpenChart} />
        <SettingsRow icon="📅" title="Calendar & Sync" detail="Aura plans + Panchang windows" expanded={openSettingsPanel === 'calendar'} onClick={() => toggleSettingsPanel('calendar')} />
        {openSettingsPanel === 'calendar' && (
          <div style={settingsPanelStyle}>
            <div style={{ color: '#dbe7f4', fontSize: 12, lineHeight: 1.45 }}>
              Export your upcoming Aura plans and today&apos;s Panchang windows as an `.ics` calendar file.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <a href="/api/calendar/feed" target="_blank" rel="noreferrer" style={calendarPrimaryActionStyle}>
                Open calendar
              </a>
              <button type="button" onClick={handleCopyCalendarFeed} style={calendarSecondaryActionStyle}>
                {calendarCopyState === 'copied' ? 'Copied' : calendarCopyState === 'failed' ? 'Copy failed' : 'Copy link'}
              </button>
            </div>
          </div>
        )}
        <SettingsRow icon="✅" title="Daily Check-In" detail="How check-ins affect Insights" expanded={openSettingsPanel === 'checkIn'} onClick={() => toggleSettingsPanel('checkIn')} />
        {openSettingsPanel === 'checkIn' && (
          <div style={settingsPanelStyle}>
            <div style={{ color: '#dbe7f4', fontSize: 12, lineHeight: 1.45 }}>
              Daily Check-In compares how the day felt with your logged activity timing. Low counts as 0%, Balanced as 50%, and Strong as 100% toward Alignment Proof.
            </div>
            <button type="button" onClick={onOpenHome} style={{ ...calendarPrimaryActionStyle, marginTop: 12 }}>
              Update today&apos;s check-in
            </button>
          </div>
        )}
      </section>

      <div ref={notificationsRef} style={{ scrollMarginTop: 18 }}>
        <NotificationSettings prefs={notificationPrefs} onChange={onNotificationPrefsChange} />
      </div>

      <section style={{ background: 'var(--as-surface-raised, #0f172a)', border: '1px solid var(--as-border, #1e293b)', borderRadius: 16, overflow: 'hidden' }}>
        <SettingsRow icon="📋" title="Activity Log" detail="View logged activities" onClick={onOpenActivityLog} />
        <SettingsLinkRow icon="⬇️" title="Export Data" detail="Download your timing data" href="/api/users/export" />
        <SettingsRow icon="❔" title="Help & FAQ" detail="Learn more about myAuraMoment" expanded={openSettingsPanel === 'help'} onClick={() => toggleSettingsPanel('help')} />
        {openSettingsPanel === 'help' && (
          <div style={settingsPanelStyle}>
            <HelpItem
              question="How does Aura choose a moment?"
              answer="Aura calculates Panchang windows for your location, scores the Muhurtham fit for the activity, then blends in time of day, duration, personal patterns, and logged outcomes."
            />
            <HelpItem
              question="Do I need birth details?"
              answer="No. Without birth details, Aura still uses location-based Panchang and Muhurtham timing. Birth details add a personal secondary signal when available."
            />
            <HelpItem
              question="Why log activities?"
              answer="Logs teach Insights which suggestions you actually follow and whether those windows line up with stronger days, streaks, and completion patterns."
            />
            <HelpItem
              question="Can I get my data out?"
              answer="Yes. Export Data downloads your profile settings, planned activities, logged activities, and daily check-ins as JSON."
            />
          </div>
        )}
        <SettingsRow icon="ℹ️" title="About myAuraMoment" detail="Version 1.0.0" expanded={openSettingsPanel === 'about'} onClick={() => toggleSettingsPanel('about')} />
        {openSettingsPanel === 'about' && (
          <div style={settingsPanelStyle}>
            <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 850 }}>myAuraMoment</div>
            <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>
              A personal timing assistant that turns Panchang and Muhurtham calculations into simple decisions: what to do now, when to plan something, and what your patterns are teaching you.
            </div>
            <div style={{ display: 'grid', gap: 6, marginTop: 12, color: '#b6c2d1', fontSize: 11 }}>
              <span>Version 1.0.0</span>
              <span>Panchang Engine + Muhurta Fit Engine</span>
              <span>Your activity history stays tied to your account and can be exported any time.</span>
            </div>
          </div>
        )}
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

const settingsPanelStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  background: 'rgba(2, 6, 23, 0.28)',
  padding: '0 14px 14px 52px',
};

const calendarPrimaryActionStyle: React.CSSProperties = {
  minHeight: 34,
  border: '1px solid rgba(74, 222, 128, 0.38)',
  borderRadius: 9,
  background: 'rgba(74, 222, 128, 0.12)',
  color: '#4ade80',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 12px',
  textDecoration: 'none',
  fontSize: 12,
  fontWeight: 850,
};

const calendarSecondaryActionStyle: React.CSSProperties = {
  minHeight: 34,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: 9,
  background: 'rgba(148, 163, 184, 0.1)',
  color: '#dbe7f4',
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 850,
  cursor: 'pointer',
};

function SettingsRow({
  icon,
  title,
  detail,
  expanded,
  onClick,
}: {
  icon: string;
  title: string;
  detail: string;
  expanded?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-expanded={onClick ? Boolean(expanded) : undefined}
      style={{ width: '100%', minHeight: 58, border: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', background: 'transparent', color: '#f8fafc', display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
      </span>
      {onClick && (
        <span style={{ color: expanded ? '#4ade80' : '#94a3b8', fontSize: 16, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 160ms ease, color 160ms ease' }}>
          ›
        </span>
      )}
    </button>
  );
}

function SettingsLinkRow({ icon, title, detail, href }: { icon: string; title: string; detail: string; href: string }) {
  return (
    <a
      href={href}
      style={{ width: '100%', minHeight: 58, borderBottom: '1px solid rgba(255, 255, 255, 0.06)', background: 'transparent', color: '#f8fafc', display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 10, padding: '10px 14px', textAlign: 'left', cursor: 'pointer', boxSizing: 'border-box', textDecoration: 'none' }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
      </span>
      <span style={{ color: '#94a3b8', fontSize: 16 }}>›</span>
    </a>
  );
}

function HelpItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
      <div style={{ color: '#f8fafc', fontSize: 12, fontWeight: 850 }}>{question}</div>
      <div style={{ color: '#b6c2d1', fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>{answer}</div>
    </div>
  );
}
