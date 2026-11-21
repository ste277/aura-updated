'use client';

/**
 * AURA-READY-03-F2 -- "Resend code" and "Change email" for a 6-digit
 * sign-in code screen (Home sign-in and the guest /find save flow).
 *
 * - Resend calls the screen's own `requestCode` (which reuses the existing
 *   request-link endpoint), is locked while a request is in flight, and is
 *   paused for RESEND_COOLDOWN_SECONDS after every send so repeated taps
 *   can't spend the server's quota. The server's 429 message is shown as-is.
 * - Change email hands control back to the screen, which clears the code
 *   and the pending verification and returns to email entry.
 * Messages never depend on whether the address already has an account.
 */
import React, { useEffect, useRef, useState } from 'react';
import { RESEND_COOLDOWN_SECONDS, type SignInCodeRequestResult } from '../lib/signInCode';

type Status = { tone: 'ok' | 'error'; text: string } | null;

export function SignInCodeActions({
  sentTo,
  requestCode,
  onResent,
  onChangeEmail,
  disabled = false,
  cooldownSeconds = RESEND_COOLDOWN_SECONDS,
}: {
  /** The address the current code was sent to (shown so a typo is visible). */
  sentTo: string;
  requestCode: () => Promise<SignInCodeRequestResult>;
  /** Called after a successful resend with the server's (dev-only) extras. */
  onResent: (result: Extract<SignInCodeRequestResult, { kind: 'SENT' }>) => void;
  onChangeEmail: () => void;
  /** True while the screen is verifying a code. */
  disabled?: boolean;
  cooldownSeconds?: number;
}) {
  // The code was just sent when this mounts, so the first resend waits too.
  const [cooldownUntil, setCooldownUntil] = useState(() => Date.now() + cooldownSeconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const inFlight = useRef(false);

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, now]);

  async function handleResend() {
    if (inFlight.current || secondsLeft > 0 || disabled) return;
    inFlight.current = true;
    setResending(true);
    setStatus(null);
    try {
      const result = await requestCode();
      if (result.kind === 'SENT') {
        onResent(result);
        setStatus({ tone: 'ok', text: `We sent a new code to ${sentTo}. Use the newest code.` });
      } else {
        setStatus({ tone: 'error', text: result.message });
      }
    } finally {
      const t = Date.now();
      setCooldownUntil(t + cooldownSeconds * 1000);
      setNow(t);
      setResending(false);
      inFlight.current = false;
    }
  }

  const linkStyle: React.CSSProperties = {
    minHeight: 44,
    padding: '10px 12px',
    background: 'none',
    border: 'none',
    color: 'var(--as-abhijit, #4ade80)',
    fontFamily: 'var(--as-font-body)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  };
  const resendDisabled = resending || secondsLeft > 0 || disabled;

  return (
    <div data-testid="sign-in-code-actions" style={{ marginTop: 8, textAlign: 'center' }}>
      <p style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, color: 'var(--as-text-muted)', margin: '0 0 4px' }}>
        Sent to <strong style={{ color: 'var(--as-text)', wordBreak: 'break-all' }}>{sentTo}</strong>
      </p>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 4 }}>
        <button
          type="button"
          onClick={handleResend}
          disabled={resendDisabled}
          aria-disabled={resendDisabled}
          style={{ ...linkStyle, opacity: resendDisabled ? 0.55 : 1, cursor: resendDisabled ? 'default' : 'pointer' }}
        >
          {resending ? 'Sending…' : secondsLeft > 0 ? `Resend code (${secondsLeft}s)` : 'Resend code'}
        </button>
        <button type="button" onClick={onChangeEmail} disabled={resending || disabled} style={linkStyle}>
          Change email
        </button>
      </div>
      {status && (
        <p
          role={status.tone === 'error' ? 'alert' : 'status'}
          style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, margin: '4px 0 0', color: status.tone === 'error' ? 'var(--as-rahu)' : 'var(--as-text-muted)' }}
        >
          {status.text}
        </p>
      )}
    </div>
  );
}
