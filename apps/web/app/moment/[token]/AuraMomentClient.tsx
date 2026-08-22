'use client';

import React, { useState } from 'react';
import type { PublicAuraMoment, PublicAuraMomentOutcome } from '../../../lib/auraMoments';
import { buildGoogleCalendarUrl } from '../../../../../packages/recommendation/src/dailyAssistant';

interface AuraMomentClientProps {
  token: string;
  initialOutcome: PublicAuraMomentOutcome;
}

const RATING_TEXT_GENERAL: Record<string, string> = {
  EXCELLENT: 'Excellent fit',
  STRONG: 'Strong fit',
  FAVORABLE: 'Favorable',
  ACCEPTABLE: 'Acceptable',
};

const RATING_TEXT_SHARED: Record<string, string> = {
  EXCELLENT_SHARED_FIT: 'Excellent shared fit',
  STRONG_SHARED_FIT: 'Strong shared fit',
  GOOD_SHARED_FIT: 'Good shared fit',
  MIXED_SHARED_FIT: 'Mixed fit',
};

function ratingDisplayText(ratingLabel: string | null, scope: string): string | null {
  if (!ratingLabel) return null;
  return (scope === 'SHARED' ? RATING_TEXT_SHARED[ratingLabel] : RATING_TEXT_GENERAL[ratingLabel]) ?? null;
}

function formatMomentDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric' });
}

function formatMomentTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

function introText(moment: PublicAuraMoment): string {
  const sender = moment.senderDisplayName ?? 'Someone';
  return moment.sharedPersonDisplayName
    ? `${sender} found a good moment for you both.`
    : `${sender} found a good moment for you.`;
}

export function AuraMomentClient({ token, initialOutcome }: AuraMomentClientProps) {
  const [outcome, setOutcome] = useState<PublicAuraMomentOutcome>(initialOutcome);
  const [responding, setResponding] = useState<'ACCEPTED' | 'ANOTHER_TIME' | null>(null);
  const [error, setError] = useState('');

  const respond = async (response: 'ACCEPTED' | 'ANOTHER_TIME') => {
    setResponding(response);
    setError('');
    try {
      const res = await fetch(`/api/aura-moments/${token}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to send your response.');
      setOutcome({ status: 'OK', moment: data as PublicAuraMoment });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send your response.');
    } finally {
      setResponding(null);
    }
  };

  if (outcome.status !== 'OK') {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 34, marginBottom: 14 }}>✦</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>This Aura Moment is no longer available.</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 10 }}>
            The person who shared it may have found a different time, or the link has expired.
          </p>
        </div>
        <FindYourOwnMomentCta />
      </Shell>
    );
  }

  const { moment } = outcome;
  const ratingText = ratingDisplayText(moment.ratingLabel, moment.scope);
  const calendarUrl = buildGoogleCalendarUrl(moment.activityTitle, moment.startAt, moment.endAt);

  return (
    <Shell>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#94a3b8', fontWeight: 800 }}>AURA</div>
        <div style={{ marginTop: 10, fontSize: 14, fontWeight: 800, color: '#fb7185' }}>❤️ A shared moment</div>
        <p style={{ marginTop: 14, color: '#dbe7f4', fontSize: 15, lineHeight: 1.5 }}>{introText(moment)}</p>

        <div style={{ fontSize: 44, margin: '22px 0 10px' }}>{moment.activityIcon ?? '✨'}</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>{moment.activityTitle}</h1>
        <div style={{ marginTop: 10, fontSize: 15, color: '#f8fafc', fontWeight: 700 }}>{formatMomentDate(moment.startAt, moment.timezone)}</div>
        <div style={{ marginTop: 4, fontSize: 14, color: '#38bdf8', fontWeight: 800 }}>
          {formatMomentTime(moment.startAt, moment.timezone)} – {formatMomentTime(moment.endAt, moment.timezone)}
        </div>
        {ratingText && <div style={{ marginTop: 10, fontSize: 12, color: '#4ade80', fontWeight: 800 }}>{ratingText}</div>}

        {moment.explanationSnapshot && (
          <p style={{ marginTop: 18, color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>{moment.explanationSnapshot}</p>
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 26, paddingTop: 22 }}>
        {moment.responseState === 'ACCEPTED' ? (
          <ResponseResult
            heading="❤️ It's a plan"
            body="This moment works for you both."
            action={
              <a href={calendarUrl} target="_blank" rel="noreferrer" style={outlineButtonStyle}>
                Add to calendar
              </a>
            }
          />
        ) : moment.responseState === 'ANOTHER_TIME' ? (
          <ResponseResult heading="No problem." body="Aura can help find another moment." action={<FindAnotherTimeLink />} />
        ) : (
          <>
            <div style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8', marginBottom: 14 }}>Does this work for you?</div>
            {error && <div style={{ color: '#fb6b6b', fontSize: 12, textAlign: 'center', marginBottom: 10 }}>{error}</div>}
            <button type="button" onClick={() => respond('ACCEPTED')} disabled={responding !== null} style={primaryButtonStyle}>
              {responding === 'ACCEPTED' ? 'Sending…' : "I'm in ❤️"}
            </button>
            <button type="button" onClick={() => respond('ANOTHER_TIME')} disabled={responding !== null} style={{ ...outlineButtonStyle, width: '100%', marginTop: 10, textAlign: 'center' }}>
              {responding === 'ANOTHER_TIME' ? 'Sending…' : 'Another time'}
            </button>
          </>
        )}
      </div>

      <FindYourOwnMomentCta />
    </Shell>
  );
}

function ResponseResult({ heading, body, action }: { heading: string; body: string; action: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{heading}</div>
      <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 8 }}>{body}</p>
      <div style={{ marginTop: 16 }}>{action}</div>
    </div>
  );
}

function FindAnotherTimeLink() {
  return (
    <a href="/" style={outlineButtonStyle}>
      Find another time
    </a>
  );
}

/** The acquisition loop (brief section 18) -- value first, signup second.
 * Works for both logged-out (root page shows sign-in) and logged-in
 * visitors (root page shows the app) without this page needing to know
 * which. */
function FindYourOwnMomentCta() {
  return (
    <div style={{ textAlign: 'center', marginTop: 30, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>Timing guidance by Aura</div>
      <a href="/" style={{ color: '#38bdf8', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>
        Find your own moment →
      </a>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#020617', color: '#f8fafc', fontFamily: 'sans-serif', display: 'flex', justifyContent: 'center', padding: '32px 18px' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 50,
  borderRadius: 14,
  border: 'none',
  background: '#fb7185',
  color: '#020617',
  fontSize: 15,
  fontWeight: 900,
  cursor: 'pointer',
};

const outlineButtonStyle: React.CSSProperties = {
  display: 'inline-block',
  minHeight: 44,
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: 'transparent',
  color: '#f8fafc',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  padding: '12px 18px',
  textDecoration: 'none',
};
