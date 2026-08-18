'use client';

import { useState } from 'react';

export function LoginScreen({ onLoggedInCheck }: { onLoggedInCheck: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);
  const [devLoginCode, setDevLoginCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both handlers must survive a rejected fetch: in the native shells the
  // device is routinely offline, and an unhandled rejection would leave the
  // button disabled on "Sending..." forever with no way to retry.
  const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Sign-in request failed (${res.status}). Try again.`);
        setStatus('idle');
        return;
      }

      setStatus('sent');
      if (data?.devLoginUrl) setDevLoginUrl(data.devLoginUrl);
      if (data?.devLoginCode) setDevLoginCode(data.devLoginCode);
    } catch (err) {
      console.error('request-link failed:', err);
      setError(OFFLINE_MESSAGE);
      setStatus('idle');
    }
  }

  // The emailed link opens in the system browser, which is the wrong context
  // inside the native app shells — the 6-digit code works everywhere.
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `That code did not work (${res.status}). Try again.`);
        return;
      }

      onLoggedInCheck();
    } catch (err) {
      console.error('verify-code failed:', err);
      setError(OFFLINE_MESSAGE);
    } finally {
      setVerifying(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--as-border)',
    background: 'var(--as-surface)',
    color: 'var(--as-text)',
    fontFamily: 'var(--as-font-body)',
    fontSize: 14,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '10px 16px',
    borderRadius: 8,
    border: '1px solid var(--as-border)',
    background: 'var(--as-abhijit-dim, #1f4d34)',
    color: 'var(--as-abhijit, #4ade80)',
    fontFamily: 'var(--as-font-body)',
    fontSize: 14,
    cursor: 'pointer',
  };

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
        Sign in with your email — no password needed.
      </p>

      {status !== 'sent' ? (
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" disabled={status === 'sending'} style={buttonStyle}>
            {status === 'sending' ? 'Sending...' : 'Continue'}
          </button>
        </form>
      ) : (
        <div style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 14, marginBottom: 12 }}>
            We emailed you a sign-in link and a 6-digit code. Enter the code here, or tap the link.
          </p>

          <form onSubmit={handleVerifyCode} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ ...inputStyle, textAlign: 'center', letterSpacing: 6, fontFamily: 'var(--as-font-mono)' }}
            />
            <button type="submit" disabled={verifying || code.length !== 6} style={buttonStyle}>
              {verifying ? 'Checking...' : 'Sign in'}
            </button>
          </form>

          {(devLoginUrl || devLoginCode) && (
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
                textAlign: 'left',
              }}
            >
              <div style={{ marginBottom: 8 }}>
                Dev mode — no email provider wired up yet, so here's everything directly:
              </div>
              {devLoginCode && (
                <div style={{ marginBottom: 8 }}>
                  Code: <span style={{ fontFamily: 'var(--as-font-mono)', color: 'var(--as-text)' }}>{devLoginCode}</span>
                </div>
              )}
              {devLoginUrl && (
                <a href={devLoginUrl} style={{ color: 'var(--as-gulika)', wordBreak: 'break-all' }}>
                  {devLoginUrl}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--as-rahu)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </div>
  );
}
