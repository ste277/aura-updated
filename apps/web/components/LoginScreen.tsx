'use client';

import React, { useState } from 'react';
import { SignInCodeActions } from './SignInCodeActions';
import { requestSignInCode, SIGN_IN_OFFLINE_MESSAGE } from '../lib/signInCode';

export function LoginScreen({ onLoggedInCheck }: { onLoggedInCheck: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [devLoginUrl, setDevLoginUrl] = useState<string | null>(null);
  const [devLoginCode, setDevLoginCode] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AURA-READY-03-F2 -- the address the pending code was sent to. Verification
  // always uses this (never a later edit), and Change email clears it.
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Both handlers must survive a rejected fetch: in the native shells the
  // device is routinely offline, and an unhandled rejection would leave the
  // button disabled on "Sending..." forever with no way to retry.
  const OFFLINE_MESSAGE = SIGN_IN_OFFLINE_MESSAGE;
  const onEmailStep = status !== 'sent' || !sentTo;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    const target = email.trim();
    const result = await requestSignInCode({ email: target });
    if (result.kind !== 'SENT') {
      setError(result.message);
      setStatus('idle');
      return;
    }
    setSentTo(target);
    setCode('');
    setDevLoginUrl(result.devLoginUrl);
    setDevLoginCode(result.devLoginCode);
    setStatus('sent');
  }

  // AURA-READY-03-F2 -- back to email entry with no pending verification:
  // the old code, its dev extras and the target address are all dropped.
  function handleChangeEmail() {
    setSentTo(null);
    setCode('');
    setDevLoginUrl(null);
    setDevLoginCode(null);
    setError(null);
    setStatus('idle');
  }

  // The emailed link opens in the system browser, which is the wrong context
  // inside the native app shells — the 6-digit code works everywhere.
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setVerifying(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sentTo, code }),
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
        boxSizing: 'border-box',
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

      {onEmailStep && (
        // AURA-READY-02-F3 -- say what Aura is before asking for an email.
        <section aria-labelledby="landing-intro-title" style={{ width: '100%', maxWidth: 320, textAlign: 'center', marginTop: 12 }}>
          <h2 id="landing-intro-title" style={{ fontFamily: 'var(--as-font-display)', fontSize: 20, lineHeight: 1.25, margin: '0 0 6px' }}>
            Make time for what matters.
          </h2>
          <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 14, lineHeight: 1.5, color: 'var(--as-text)', margin: 0 }}>
            Aura helps you find favorable times for your plans, balancing your schedule with Panchangam, the traditional
            Indian guide to auspicious timing.
          </p>
        </section>
      )}

      <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, color: 'var(--as-text-muted)', marginTop: onEmailStep ? 20 : undefined, marginBottom: onEmailStep ? 12 : 24 }}>
        Sign in with your email — no password needed.
      </p>

      {onEmailStep ? (
        <>
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

        {/* AURA-READY-02-F3 -- secondary entry to the EXISTING guest Find a Time
         * (/find). Saving a result there still asks for the same email code. */}
        <div style={{ width: '100%', maxWidth: 320, textAlign: 'center', marginTop: 20 }}>
          <a
            href="/find"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 44,
              boxSizing: 'border-box',
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--as-border)',
              color: 'var(--as-text)',
              fontFamily: 'var(--as-font-body)',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Try it without an account
          </a>
          <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 12, color: 'var(--as-text-muted)', margin: '6px 0 0' }}>
            Find a good time for a plan now. Sign in only when you want to save it.
          </p>
        </div>
        </>
      ) : (
        <div style={{ width: '100%', maxWidth: 320, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 14, marginBottom: 12 }}>
            We emailed you a 6-digit sign-in code. Enter it here.
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

          <SignInCodeActions
            sentTo={sentTo}
            disabled={verifying}
            requestCode={() => requestSignInCode({ email: sentTo })}
            onResent={(result) => {
              setCode('');
              setError(null);
              setDevLoginUrl(result.devLoginUrl);
              setDevLoginCode(result.devLoginCode);
            }}
            onChangeEmail={handleChangeEmail}
          />

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
