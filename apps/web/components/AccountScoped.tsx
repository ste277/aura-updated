'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ensureVerifiedAccount, getAccountEpoch, getVerifiedAccount, startForegroundReverification, subscribeAccount } from '../lib/accountSession';

/**
 * AURA-ANDROID-REL-04 IR-01 -- account-scoped page boundary for the
 * standalone signed-in surfaces (Goals, Goal detail, Captures, plan-day,
 * Connected Apps).
 *
 * R4 -- server-rendered pages pass `serverAccount`: the account their server
 * props were resolved for (lib/serverAccount.ts; null = rendered signed out).
 * The children -- the account-specific content AND its actions -- are shown
 * only while the client's own verified account AGREES with it:
 *   - not yet verified (including the very first verification, which does not
 *     change the epoch) -> a neutral "checking" state, no account content;
 *   - verification failed -> a retry state, no account content;
 *   - verified account differs -> the page is reloaded so the server renders
 *     for the current account (at most once automatically; then a Reload
 *     button), and nothing from the old render is shown meanwhile;
 *   - agreement is re-required after every later change (foreground
 *     re-verification, cross-tab news, 409 account_mismatch).
 * Pages without server-rendered account state keep the R3 behaviour
 * ('remount' on epoch change).
 */
/** Indirection so tests can observe the reload (jsdom's location.reload cannot be replaced). */
export const pageReload = { fn: () => window.location.reload() };

const RELOAD_GUARD_KEY = 'aura_ssr_account_reload_at';
const RELOAD_GUARD_MS = 15_000;

function mayAutoReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? '0');
    if (Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

const boxStyle: React.CSSProperties = { minHeight: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#cbd5e1', fontSize: 14, padding: 24, textAlign: 'center' };
const buttonStyle: React.CSSProperties = { padding: '8px 16px', borderRadius: 999, border: '1px solid #475569', background: 'transparent', color: '#f8fafc', cursor: 'pointer' };

export function AccountScoped({ children, onChange = 'remount', serverAccount }: { children: React.ReactNode; onChange?: 'remount' | 'reload'; serverAccount?: string | null }) {
  const epoch = React.useSyncExternalStore(subscribeAccount, getAccountEpoch, () => 0);
  // The server snapshot is "unverified" so the server HTML never contains the gated children.
  const verified = React.useSyncExternalStore(subscribeAccount, getVerifiedAccount, () => undefined);
  const firstEpoch = useRef(epoch);
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const reloadAsked = useRef(false);
  const gated = serverAccount !== undefined;

  useEffect(() => startForegroundReverification(), []);

  // Verify whenever the account is unknown (first load, and after any invalidation).
  useEffect(() => {
    if (verified !== undefined) { setCheckFailed(false); return; }
    let alive = true;
    setCheckFailed(false);
    void ensureVerifiedAccount().then((a) => { if (alive && a === undefined) setCheckFailed(true); });
    return () => { alive = false; };
  }, [verified, epoch, retryTick]);

  const mismatch = gated && verified !== undefined && verified !== serverAccount;
  useEffect(() => {
    if (!mismatch || reloadAsked.current) return;
    reloadAsked.current = true;
    if (mayAutoReload()) pageReload.fn();
  }, [mismatch]);

  // Ungated 'reload' pages (none in R4, kept for compatibility): reload on any epoch change.
  useEffect(() => {
    if (!gated && onChange === 'reload' && epoch !== firstEpoch.current) pageReload.fn();
  }, [epoch, onChange, gated]);

  if (gated) {
    if (verified === undefined) {
      return checkFailed ? (
        <div role="alert" data-account-gate="failed" style={boxStyle}>
          <div>Aura couldn&apos;t confirm which account is signed in.</div>
          <button type="button" style={buttonStyle} onClick={() => setRetryTick((t) => t + 1)}>Try again</button>
        </div>
      ) : (
        <div role="status" data-account-gate="checking" style={boxStyle}>Checking your account…</div>
      );
    }
    if (mismatch) {
      return (
        <div role="alert" data-account-gate="mismatch" style={boxStyle}>
          <div>The signed-in account changed. Reload to see this page for the current account.</div>
          <button type="button" style={buttonStyle} onClick={() => pageReload.fn()}>Reload</button>
        </div>
      );
    }
    // Agreement: remount on every epoch so no state from before a change survives.
    return <React.Fragment key={epoch}>{children}</React.Fragment>;
  }
  return <React.Fragment key={onChange === 'remount' ? epoch : 0}>{children}</React.Fragment>;
}
