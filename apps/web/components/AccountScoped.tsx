'use client';

import React, { useEffect, useState } from 'react';
import { ensureVerifiedAccount, getAccountEpoch, getVerifiedAccount, startForegroundReverification, subscribeAccount } from '../lib/accountSession';

/**
 * AURA-ANDROID-REL-04 IR-01 -- account-scoped page boundary for the
 * standalone signed-in surfaces (Plan Day, Goals, Goal detail, Captures,
 * Connected Apps).
 *
 * R5 -- `verified` pages: the server response contains NO account-derived
 * data. Children are a function of the client's VERIFIED account and are not
 * mounted -- so they fetch nothing -- until verification has answered
 * (including the very first verification). Every later change (foreground
 * re-verification, cross-tab news, a 409 account_mismatch) unmounts them,
 * re-verifies, and mounts a fresh tree for the account now verified, which
 * fetches its own data through the account-bound API boundary. There is no
 * automatic page reload anywhere in this component (R4's reload fallback is
 * gone with the server-rendered account state it protected).
 *
 * Default mode ('remount'): children render immediately (their requests are
 * held by the shared fetch boundary until the account is verified) and are
 * remounted on every account change.
 */
const boxStyle: React.CSSProperties = { minHeight: '40vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#cbd5e1', fontSize: 14, padding: 24, textAlign: 'center' };
const buttonStyle: React.CSSProperties = { padding: '8px 16px', borderRadius: 999, border: '1px solid #475569', background: 'transparent', color: '#f8fafc', cursor: 'pointer' };

type VerifiedChildren = (account: string | null) => React.ReactNode;

export function AccountScoped(props: { verified: true; children: VerifiedChildren } | { verified?: false; children: React.ReactNode }) {
  const epoch = React.useSyncExternalStore(subscribeAccount, getAccountEpoch, () => 0);
  // The server snapshot is "unverified": the server HTML never contains the children.
  const account = React.useSyncExternalStore(subscribeAccount, getVerifiedAccount, () => undefined);
  const [checkFailed, setCheckFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => startForegroundReverification(), []);

  // Verify whenever the account is unknown (first load, and after any invalidation).
  useEffect(() => {
    if (account !== undefined) { setCheckFailed(false); return; }
    let alive = true;
    setCheckFailed(false);
    void ensureVerifiedAccount().then((a) => { if (alive && a === undefined) setCheckFailed(true); });
    return () => { alive = false; };
  }, [account, epoch, retryTick]);

  if (props.verified) {
    if (account === undefined) {
      return checkFailed ? (
        <div role="alert" data-account-gate="failed" style={boxStyle}>
          <div>Aura couldn&apos;t confirm which account is signed in.</div>
          <button type="button" style={buttonStyle} onClick={() => setRetryTick((t) => t + 1)}>Try again</button>
        </div>
      ) : (
        <div role="status" data-account-gate="checking" style={boxStyle}>Checking your account…</div>
      );
    }
    return <React.Fragment key={`${epoch}:${account ?? '~signed-out'}`}>{props.children(account)}</React.Fragment>;
  }
  return <React.Fragment key={epoch}>{props.children}</React.Fragment>;
}
