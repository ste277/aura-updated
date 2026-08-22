'use client';

import React, { useEffect, useState } from 'react';

/**
 * Owner-facing moment management (Shared Muhurtham... err, Aura Moment
 * Sharing brief section 14) -- list what's been shared, see the recipient's
 * response, copy/open the link, revoke. Lives under You (no new bottom-nav
 * tab). No real-time updates (section 13): a normal fetch on mount is
 * sufficient.
 */

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
}

interface SharedMomentsViewProps {
  onBack: () => void;
}

function formatMomentDateLabel(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric' });
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
        moments.map((moment) => {
          const response = responseText(moment);
          return (
            <section key={moment.id} style={cardStyle}>
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

              <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
                <a href={moment.shareUrl} target="_blank" rel="noreferrer" style={linkButtonStyle}>
                  View →
                </a>
                <button type="button" onClick={() => handleCopy(moment)} style={linkButtonStyle}>
                  {copiedId === moment.id ? 'Copied ✓' : 'Copy link'}
                </button>
                {moment.status === 'ACTIVE' && (
                  confirmingRevokeId === moment.id ? (
                    <>
                      <button type="button" onClick={() => handleRevoke(moment)} disabled={revokingId === moment.id} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
                        {revokingId === moment.id ? 'Revoking…' : 'Confirm revoke'}
                      </button>
                      <button type="button" onClick={() => setConfirmingRevokeId(null)} style={linkButtonStyle}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmingRevokeId(moment.id)} style={{ ...linkButtonStyle, color: '#fb6b6b' }}>
                      Revoke
                    </button>
                  )
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
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
