'use client';

import React, { useEffect, useRef } from 'react';
import { ensureVerifiedAccount, getAccountEpoch, startForegroundReverification, subscribeAccount } from '../lib/accountSession';

/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- account-scoped page boundary for the
 * standalone signed-in surfaces (Goals, Captures, plan-day, Connected Apps).
 * It verifies the account on mount and on return to the foreground, and when
 * the account changes:
 *   - 'remount': remounts the client tree (state and caches start empty);
 *   - 'reload' : reloads the page, for pages whose initial data is rendered on
 *                the server from the cookie's account (a remount would keep
 *                the previous account's server props).
 * Requests themselves are protected by the shared fetch boundary and the
 * server; this keeps stale presentation from surviving an account change.
 */
/** Indirection so tests can observe the reload (jsdom's location.reload cannot be replaced). */
export const pageReload = { fn: () => window.location.reload() };

export function AccountScoped({ children, onChange = 'remount' }: { children: React.ReactNode; onChange?: 'remount' | 'reload' }) {
  const epoch = React.useSyncExternalStore(subscribeAccount, getAccountEpoch, () => 0);
  const firstEpoch = useRef(epoch);
  useEffect(() => { void ensureVerifiedAccount(); }, []);
  useEffect(() => startForegroundReverification(), []);
  useEffect(() => {
    if (onChange === 'reload' && epoch !== firstEpoch.current) pageReload.fn();
  }, [epoch, onChange]);
  return <React.Fragment key={onChange === 'remount' ? epoch : 0}>{children}</React.Fragment>;
}
