'use client';

import { useState } from 'react';

export function LoginScreen({ onLoggedInCheck }: { onLoggedInCheck: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    const res = await fetch('/api/auth/request-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      setError('Something went wrong. Try again.');
      setStatus('idle');
      return;
    }

    const data = await res.json();
    setStatus('sent');
    if (data.devLoginUrl) setDevLoginUrl(data.devLoginUrl);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--as-bg)',
        color: 'var(--as-text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <h1 style={{ fontFamily: 'var(--as-font-display)', fontSize: 24, marginBottom: 4 }}>AuraSchedule</h1>
      <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, color: 'var(--as-text-muted)', marginBottom: 24 }}>
        Sign in with a magic link — no password needed.
      </p>

      {status !== 'sent' ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--as-border)',
              background: 'var(--as-surface)',
              color: 'var(--as-text)',
              fontFamily: 'var(--as-font-body)',
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={status === 'sending'}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--as-border)',
              background: 'var(--as-abhijit-dim, #1f4d34)',
              color: 'var(--as-abhijit, #4ade80)',
              fontFamily: 'var(--as-font-body)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {status === 'sending' ? 'Sending...' : 'Send link'}
          </button>
        </form>
      ) : (
        <div style={{ maxWidth: 320, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 14, marginBottom: 12 }}>
            Check your email for a sign-in link.
          </p>
          {devLoginUrl && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 8,
                background: 'var(--as-surface-raised)',
                border: '1px dashed var(--as-border)',
                fontSize: 12,
                color: 'var(--as-text-muted)',
                fontFamily: 'var(--as-font-body)',
              }}
            >
              <div style={{ marginBottom: 8 }}>
                Dev mode — no email provider wired up yet, so here's the link directly:
              </div>
              <a href={devLoginUrl} style={{ color: 'var(--as-gulika)', wordBreak: 'break-all' }}>
                {devLoginUrl}
              </a>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--as-rahu)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </div>
  );
}
