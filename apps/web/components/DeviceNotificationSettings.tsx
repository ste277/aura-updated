'use client';

import React, { useEffect, useState } from 'react';
import { getPushCapabilityState, PushCapabilityState, subscribeToPush, unsubscribeFromPush } from '../lib/webPushClient';
import { trackEvent } from '../lib/trackEvent';

/**
 * Web Push V1 (brief section 6/7) -- lives inside ReminderSettings.tsx's
 * existing "Reminders" card, directly under the "Upcoming reminders"
 * toggle. Never calls Notification.requestPermission() itself except from
 * the "Enable notifications" button's own onClick -- there is no
 * mount-time/automatic permission request anywhere in this component.
 *
 * Reads the REAL capability state on mount (a passive read of
 * Notification.permission plus a server round-trip to confirm an active
 * PushSubscription actually exists -- brief section 7: never claim
 * "enabled" from permission alone) and renders one of six states.
 */
export function DeviceNotificationSettings() {
  const [state, setState] = useState<PushCapabilityState | 'LOADING'>('LOADING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getPushCapabilityState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    setError('');
    const outcome = await subscribeToPush();
    if (outcome.ok) {
      setState('SUBSCRIBED');
      trackEvent('WEB_PUSH_ENABLED');
    } else if (outcome.reason === 'permission_denied') {
      // Brief section 6: "Do not repeatedly prompt after denial" -- this
      // state change is what switches the UI to the calm blocked-state
      // copy for good; there is no retry button that re-prompts.
      setState('DENIED');
    } else {
      setState('SUBSCRIPTION_ERROR');
      setError('Something went wrong enabling notifications. You can try again.');
    }
    setBusy(false);
  };

  const handleDisable = async () => {
    setBusy(true);
    await unsubscribeFromPush();
    setState('GRANTED');
    trackEvent('WEB_PUSH_DISABLED');
    setBusy(false);
  };

  if (state === 'LOADING') return null; // avoids a flash of the wrong button before the real state resolves

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      <span style={kickerStyle}>Device Notifications</span>

      {state === 'UNSUPPORTED' && (
        <p style={mutedTextStyle}>Notifications aren&apos;t supported in this browser.</p>
      )}

      {state === 'DENIED' && (
        <p style={mutedTextStyle}>Notifications are blocked in your browser. You can continue using in-app reminders.</p>
      )}

      {(state === 'NOT_ASKED' || state === 'GRANTED' || state === 'SUBSCRIPTION_ERROR') && (
        <>
          <p style={{ ...mutedTextStyle, marginBottom: 12 }}>Get reminders when Aura isn&apos;t open.</p>
          <button type="button" onClick={handleEnable} disabled={busy} style={{ ...enableButtonStyle, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Enabling…' : 'Enable notifications'}
          </button>
          {error && <div style={{ color: '#fb7185', fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>{error}</div>}
        </>
      )}

      {state === 'SUBSCRIBED' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
          <div>
            <div style={{ fontSize: 13, color: '#e2e8f0' }}>Enabled</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Reminders will reach this device</div>
          </div>
          <button type="button" onClick={handleDisable} disabled={busy} style={{ ...turnOffButtonStyle, opacity: busy ? 0.6 : 1 }}>
            {busy ? '…' : 'Turn off'}
          </button>
        </div>
      )}
    </div>
  );
}

const kickerStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'monospace',
  textTransform: 'uppercase',
  color: '#94a3b8',
  letterSpacing: '0.05em',
  fontWeight: 600,
};

const mutedTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  margin: '6px 0 0',
  lineHeight: 1.4,
};

const enableButtonStyle: React.CSSProperties = {
  minHeight: 36,
  padding: '0 16px',
  borderRadius: 10,
  border: '1px solid rgba(74, 222, 128, 0.32)',
  background: 'rgba(74, 222, 128, 0.1)',
  color: '#4ade80',
  fontSize: 12,
  fontWeight: 850,
  cursor: 'pointer',
};

const turnOffButtonStyle: React.CSSProperties = {
  minHeight: 32,
  padding: '0 14px',
  borderRadius: 9,
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'transparent',
  color: '#94a3b8',
  fontSize: 12,
  fontWeight: 750,
  cursor: 'pointer',
};
