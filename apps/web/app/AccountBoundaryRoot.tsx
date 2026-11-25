'use client';

import React from 'react';
import { installAccountBoundFetch } from '../lib/accountBoundFetch';
import { isUpgradeRequired, subscribeAccount } from '../lib/accountSession';
import { announceAccountBoundary, consumeReloadedNotice } from '../lib/serviceWorkerBridge';

/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- installs the client half of the shared
 * account boundary for EVERY page (rendered from the root layout; installed at
 * module evaluation, before any page effect can fetch), and shows the reload
 * prompt when the server reports this bundle is out of date
 * (client_upgrade_required) -- from any request, including automatic replay.
 */
if (typeof window !== 'undefined') {
  installAccountBoundFetch();
  // R4: this page speaks the account boundary; the service worker never reloads it as out of date.
  announceAccountBoundary();
}

export function AccountBoundaryRoot() {
  const upgrade = React.useSyncExternalStore(subscribeAccount, isUpgradeRequired, () => false);
  const [reloaded, setReloaded] = React.useState(false);
  React.useEffect(() => { if (consumeReloadedNotice()) setReloaded(true); }, []);
  const box: React.CSSProperties = { position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', zIndex: 1000, padding: 12, borderRadius: 10, border: '1px solid var(--as-border)', background: 'var(--as-surface, #0f172a)', color: 'var(--as-text, #f8fafc)', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' };
  const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 8, border: '1px solid var(--as-border)', background: 'transparent', color: 'inherit' };
  if (upgrade) {
    return (
      <div role="alert" style={box}>
        <span>Aura was updated. Reload to continue. Activity already saved on this device is kept; anything that was just refused was not saved, so try it again after reloading.</span>
        <button type="button" onClick={() => window.location.reload()} style={btn}>Reload</button>
      </div>
    );
  }
  if (reloaded) {
    return (
      <div role="status" data-aura-reloaded="upgrade" style={box}>
        <span>Aura was updated, so this page was reloaded. What you were doing when it reloaded (including signing out) did not complete. Please check and try again.</span>
        <button type="button" onClick={() => setReloaded(false)} style={btn}>OK</button>
      </div>
    );
  }
  return null;
}
