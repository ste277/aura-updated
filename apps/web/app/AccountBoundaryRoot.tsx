'use client';

import React from 'react';
import { installAccountBoundFetch } from '../lib/accountBoundFetch';
import { isUpgradeRequired, subscribeAccount } from '../lib/accountSession';

/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- installs the client half of the shared
 * account boundary for EVERY page (rendered from the root layout; installed at
 * module evaluation, before any page effect can fetch), and shows the reload
 * prompt when the server reports this bundle is out of date
 * (client_upgrade_required) -- from any request, including automatic replay.
 */
if (typeof window !== 'undefined') installAccountBoundFetch();

export function AccountBoundaryRoot() {
  const upgrade = React.useSyncExternalStore(subscribeAccount, isUpgradeRequired, () => false);
  if (!upgrade) return null;
  return (
    <div role="alert" style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', zIndex: 1000, padding: 12, borderRadius: 10, border: '1px solid var(--as-border)', background: 'var(--as-surface, #0f172a)', color: 'var(--as-text, #f8fafc)', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
      <span>Aura was updated. Reload to continue; nothing saved on this device is lost.</span>
      <button type="button" onClick={() => window.location.reload()} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--as-border)', background: 'transparent', color: 'inherit' }}>
        Reload
      </button>
    </div>
  );
}
