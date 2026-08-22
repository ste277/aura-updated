'use client';

import React from 'react';
import type { AuraUpdate } from '../lib/auraUpdates';
import * as theme from './theme';

/**
 * Product Structure V2 -- the bell's destination (brief section 25/26).
 * Reuses Aura Updates V1's own derivation exactly (lib/auraUpdates.ts's
 * summarizeAuraUpdates) -- `updates` here is the same already-sorted list
 * (requiresAction first, then most recent) the Home card and the You badge
 * are built from; this view does not re-derive or re-rank anything, it
 * only splits the same ordered list into NEW (unread) vs EARLIER (already
 * seen) sections. Not a generic notification platform (brief section 26) --
 * this is exclusively AuraMoment response updates.
 */
interface UpdatesViewProps {
  updates: AuraUpdate[];
  onBack: () => void;
  onViewMomentUpdate: (momentToken: string) => void;
  onFindAnotherTimeForMoment: (momentToken: string) => void;
}

const PREFERENCE_TEXT: Record<string, string> = {
  EARLIER: 'Earlier',
  LATER: 'Later',
  DIFFERENT_DAY: 'A different day',
  NO_PREFERENCE: 'Anything else',
};

function formatUpdateDateTime(iso: string) {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}

export function UpdatesView({ updates, onBack, onViewMomentUpdate, onFindAnotherTimeForMoment }: UpdatesViewProps) {
  const unseen = updates.filter((u) => u.unread);
  const seen = updates.filter((u) => !u.unread);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onBack} aria-label="Back to Home" style={backButtonStyle}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
          Home
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Updates</h1>
      </div>

      {updates.length === 0 && (
        <div style={cardStyle}>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Nothing yet -- responses to your shared Moments will show up here.</p>
        </div>
      )}

      {unseen.length > 0 && (
        <section>
          <SectionKicker label="New" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {unseen.map((update) => (
              <UpdateCard key={update.id} update={update} onView={onViewMomentUpdate} onFindAnotherTime={onFindAnotherTimeForMoment} />
            ))}
          </div>
        </section>
      )}

      {seen.length > 0 && (
        <section>
          <SectionKicker label="Earlier" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {seen.map((update) => (
              <UpdateCard key={update.id} update={update} onView={onViewMomentUpdate} onFindAnotherTime={onFindAnotherTimeForMoment} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionKicker({ label }: { label: string }) {
  return (
    <h2 style={{ margin: 0, color: '#aab7d2', fontFamily: 'var(--as-font-mono)', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </h2>
  );
}

function UpdateCard({ update, onView, onFindAnotherTime }: { update: AuraUpdate; onView: (token: string) => void; onFindAnotherTime: (token: string) => void }) {
  const isAccepted = update.type === 'MOMENT_ACCEPTED';
  const { day, time } = formatUpdateDateTime(update.eventStartAt);
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 13, fontWeight: 800, color: isAccepted ? '#4ade80' : '#facc15' }}>
        {isAccepted ? `❤️ ${update.recipientDisplayName ?? 'They'} is in` : `↻ ${update.recipientDisplayName ?? 'They'} want${update.recipientDisplayName ? 's' : ''} another time`}
      </div>
      <div style={{ marginTop: 8, fontSize: 14, fontWeight: 750, color: '#f8fafc' }}>{update.activityTitle}</div>
      <div style={{ marginTop: 3, fontSize: 12, color: '#aab7d2' }}>
        {isAccepted ? `${day} · ${time}` : `Prefers: ${PREFERENCE_TEXT[update.preference ?? 'NO_PREFERENCE']}`}
      </div>
      <button
        type="button"
        onClick={() => (isAccepted ? onView(update.momentToken) : onFindAnotherTime(update.momentToken))}
        style={actionButtonStyle}
      >
        {isAccepted ? 'View' : 'Find another time'}
      </button>
    </div>
  );
}

const cardStyle: React.CSSProperties = theme.panelStyle;
const backButtonStyle: React.CSSProperties = theme.backButtonStyle;
const actionButtonStyle: React.CSSProperties = { ...theme.outlineButtonStyle, borderRadius: 10, padding: '8px 16px', marginTop: 10 };
