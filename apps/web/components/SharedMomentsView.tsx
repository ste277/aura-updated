'use client';

import React, { useEffect, useState } from 'react';

/**
 * Owner-facing moment management (Aura Moment Sharing brief section 14,
 * extended by Aura Moment Rescheduling) -- list what's been shared, see the
 * recipient's response and reschedule preference, copy/open the link,
 * revoke, and (for a SHARED moment the recipient asked to reschedule) find
 * and suggest an alternative. Lives under You (no new bottom-nav tab). No
 * real-time updates: a normal fetch on mount/after an action is sufficient.
 */

type AlternativePreference = 'EARLIER' | 'LATER' | 'DIFFERENT_DAY' | 'NO_PREFERENCE';

interface SharedMomentRow {
  id: string;
  publicToken: string;
  shareUrl: string;
  scope: 'GENERAL' | 'PERSONAL' | 'SHARED';
  activityTitle: string;
  activityIcon: string | null;
  startAt: string;
  timezone: string;
  sharedPersonDisplayName: string | null;
  status: 'ACTIVE' | 'REVOKED';
  responseState: 'ACCEPTED' | 'ANOTHER_TIME' | null;
  responsePreference: AlternativePreference | null;
}

interface AlternativeCandidate {
  date: string;
  startAt: string;
  endAt: string;
  ratingLabel: string;
}

type AlternativesOutcome =
  | { status: 'OK'; candidates: AlternativeCandidate[] }
  | { status: 'NOT_APPLICABLE' }
  | { status: 'USER_PROFILE_INCOMPLETE' }
  | { status: 'SAVED_PERSON_PROFILE_INCOMPLETE' };

interface SharedMomentsViewProps {
  onBack: () => void;
}

const PREFERENCE_TEXT: Record<AlternativePreference, string> = {
  EARLIER: 'Earlier',
  LATER: 'Later',
  DIFFERENT_DAY: 'A different day',
  NO_PREFERENCE: 'Anything else',
};

const RATING_TEXT_SHARED: Record<string, string> = {
  EXCELLENT_SHARED_FIT: 'Excellent shared fit',
  STRONG_SHARED_FIT: 'Strong shared fit',
  GOOD_SHARED_FIT: 'Good shared fit',
  MIXED_SHARED_FIT: 'Mixed fit',
};

function formatMomentDateLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric' });
}

function formatMomentTimeRange(startIso: string, endIso: string, timezone: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

function responseText(moment: SharedMomentRow): { text: string; color: string } {
  if (moment.status === 'REVOKED') return { text: 'Revoked', color: '#64748b' };
  if (moment.responseState === 'ACCEPTED') return { text: "❤️ They're in", color: '#4ade80' };
  if (moment.responseState === 'ANOTHER_TIME') return { text: '↻ Another time requested', color: '#facc15' };
  return { text: 'Waiting for response', color: '#94a3b8' };
}

export function SharedMomentsView({ onBack }: SharedMomentsViewProps) {
  const [moments, setMoments] = useState<SharedMomentRow[] | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadMoments = async () => {
    setError('');
    try {
      const res = await fetch('/api/aura-moments');
      if (!res.ok) throw new Error('Unable to load shared moments.');
      setMoments(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shared moments.');
      setMoments([]);
    }
  };

  useEffect(() => {
    loadMoments();
  }, []);

  const handleCopy = async (moment: SharedMomentRow) => {
    try {
      await navigator.clipboard.writeText(moment.shareUrl);
      setCopiedId(moment.id);
      setTimeout(() => setCopiedId((current) => (current === moment.id ? null : current)), 2000);
    } catch {
      // Clipboard access can fail (permissions/insecure context) -- non-fatal.
    }
  };

  const handleRevoke = async (moment: SharedMomentRow) => {
    setRevokingId(moment.id);
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to revoke this moment.');
      await loadMoments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke this moment.');
    } finally {
      setRevokingId(null);
      setConfirmingRevokeId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button type="button" onClick={onBack} aria-label="Back to You" style={backButtonStyle}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
          You
        </button>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>Shared Moments</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Moments you&apos;ve shared and their responses.</p>
        </div>
      </div>

      {error && <div style={errorBoxStyle}>{error}</div>}

      {moments === null ? (
        <p style={{ fontSize: 13, color: '#94a3b8' }}>Loading…</p>
      ) : moments.length === 0 ? (
        <section style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>No shared moments yet</div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
            Tap &quot;Share this moment&quot; on a favorable date in Muhurtham Finder to share it.
          </p>
        </section>
      ) : (
        moments.map((moment) => (
          <MomentCard
            key={moment.id}
            moment={moment}
            copied={copiedId === moment.id}
            onCopy={() => handleCopy(moment)}
            confirmingRevoke={confirmingRevokeId === moment.id}
            revoking={revokingId === moment.id}
            onRequestRevoke={() => setConfirmingRevokeId(moment.id)}
            onCancelRevoke={() => setConfirmingRevokeId(null)}
            onConfirmRevoke={() => handleRevoke(moment)}
            onSuggested={loadMoments}
          />
        ))
      )}
    </div>
  );
}

function MomentCard({
  moment,
  copied,
  onCopy,
  confirmingRevoke,
  revoking,
  onRequestRevoke,
  onCancelRevoke,
  onConfirmRevoke,
  onSuggested,
}: {
  moment: SharedMomentRow;
  copied: boolean;
  onCopy: () => void;
  confirmingRevoke: boolean;
  revoking: boolean;
  onRequestRevoke: () => void;
  onCancelRevoke: () => void;
  onConfirmRevoke: () => void;
  /** Called after a successful "Suggest this" so the parent can refetch the
   * list (the new moment shows up as its own row -- no separate thread UI). */
  onSuggested: () => void;
}) {
  const response = responseText(moment);
  const [alternatives, setAlternatives] = useState<AlternativesOutcome | null>(null);
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);
  const [alternativesError, setAlternativesError] = useState('');
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<{ shareUrl: string } | null>(null);

  // Brief section 16: ACCEPTED is terminal for V1 -- no reschedule CTA.
  const canFindAnotherTime = moment.scope === 'SHARED' && moment.status === 'ACTIVE' && moment.responseState === 'ANOTHER_TIME';

  const handleFindAlternatives = async () => {
    setLoadingAlternatives(true);
    setAlternativesError('');
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}/alternatives`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to find alternatives.');
      setAlternatives(data as AlternativesOutcome);
    } catch (err) {
      setAlternativesError(err instanceof Error ? err.message : 'Unable to find alternatives.');
    } finally {
      setLoadingAlternatives(false);
    }
  };

  const handleSuggest = async (index: number) => {
    setSuggestingIndex(index);
    setAlternativesError('');
    try {
      const res = await fetch(`/api/aura-moments/${moment.publicToken}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Unable to suggest this time.');
      setSuggested({ shareUrl: data.shareUrl });
      setAlternatives(null);
      onSuggested();
    } catch (err) {
      setAlternativesError(err instanceof Error ? err.message : 'Unable to suggest this time.');
    } finally {
      setSuggestingIndex(null);
    }
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>
            {moment.activityIcon ?? '✨'} {moment.activityTitle}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
            {formatMomentDateLabel(moment.startAt, moment.timezone)}
            {moment.sharedPersonDisplayName ? ` · with ${moment.sharedPersonDisplayName}` : ''}
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: response.color, whiteSpace: 'nowrap' }}>{response.text}</span>
      </div>

      {moment.responseState === 'ANOTHER_TIME' && moment.responsePreference && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#dbe7f4' }}>
          <span style={{ color: '#94a3b8' }}>Preference: </span>
          <span style={{ fontWeight: 800 }}>{PREFERENCE_TEXT[moment.responsePreference]}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <a href={moment.shareUrl} target="_blank" rel="noreferrer" style={linkButtonStyle}>
          View →
        </a>
        <button type="button" onClick={onCopy} style={linkButtonStyle}>
          {copied ? 'Copied ✓' : 'Copy link'}
        </button>
        {moment.status === 'ACTIVE' && (
          confirmingRevoke ? (
            <>
              <button type="button" onClick={onConfirmRevoke} disabled={revoking} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
                {revoking ? 'Revoking…' : 'Confirm revoke'}
              </button>
              <button type="button" onClick={onCancelRevoke} style={linkButtonStyle}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={onRequestRevoke} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
              Revoke
            </button>
          )
        )}
      </div>

      {canFindAnotherTime && !alternatives && !suggested && (
        <button type="button" onClick={handleFindAlternatives} disabled={loadingAlternatives} style={{ ...outlineButtonStyle, marginTop: 12 }}>
          {loadingAlternatives ? 'Finding alternatives…' : 'Find another time'}
        </button>
      )}

      {alternativesError && <div style={{ ...errorBoxStyle, marginTop: 10 }}>{alternativesError}</div>}

      {alternatives && alternatives.status === 'USER_PROFILE_INCOMPLETE' && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>Complete your own birth profile to find alternatives.</p>
      )}
      {alternatives && alternatives.status === 'SAVED_PERSON_PROFILE_INCOMPLETE' && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>This person&apos;s profile is incomplete.</p>
      )}
      {alternatives && alternatives.status === 'OK' && alternatives.candidates.length === 0 && (
        <p style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>No favorable alternatives found nearby -- try again later.</p>
      )}
      {alternatives && alternatives.status === 'OK' && alternatives.candidates.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={sectionKickerStyle}>Aura found a few alternatives</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {alternatives.candidates.map((candidate, index) => (
              <div key={`${candidate.startAt}-${index}`} style={{ ...panchangaCellStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  {index === 0 && <div style={{ fontSize: 10, fontWeight: 800, color: '#fb7185', marginBottom: 2 }}>❤️ BEST ALTERNATIVE</div>}
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{formatMomentDateLabel(candidate.startAt, moment.timezone)}</div>
                  <div style={{ fontSize: 12, color: '#38bdf8', marginTop: 2 }}>{formatMomentTimeRange(candidate.startAt, candidate.endAt, moment.timezone)}</div>
                  <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2, fontWeight: 800 }}>{RATING_TEXT_SHARED[candidate.ratingLabel] ?? candidate.ratingLabel}</div>
                </div>
                <button type="button" onClick={() => handleSuggest(index)} disabled={suggestingIndex !== null} style={linkButtonStyle}>
                  {suggestingIndex === index ? 'Suggesting…' : 'Suggest this'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {suggested && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
          ✓ New moment created -- share it from the top of this list.
        </div>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: 'var(--as-surface-raised, #0f172a)',
  border: '1px solid var(--as-border, #1e293b)',
  borderRadius: 16,
  padding: 16,
};

const backButtonStyle: React.CSSProperties = {
  minHeight: 34,
  borderRadius: 17,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#f8fafc',
  fontSize: 12,
  cursor: 'pointer',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 10px',
  fontWeight: 800,
};

const errorBoxStyle: React.CSSProperties = {
  color: '#fb6b6b',
  fontSize: 12,
  lineHeight: 1.45,
};

const linkButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#38bdf8',
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'none',
};

const outlineButtonStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 40,
  borderRadius: 12,
  border: '1px solid rgba(74, 222, 128, 0.35)',
  background: 'rgba(74, 222, 128, 0.08)',
  color: '#4ade80',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};

const sectionKickerStyle: React.CSSProperties = {
  color: '#4ade80',
  fontSize: 10,
  fontFamily: 'var(--as-font-mono)',
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const panchangaCellStyle: React.CSSProperties = {
  background: 'rgba(2, 6, 23, 0.4)',
  border: '1px solid rgba(148, 163, 184, 0.14)',
  borderRadius: 8,
  padding: '9px 11px',
};
