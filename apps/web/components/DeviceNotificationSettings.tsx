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
 * "enabled" from permission alone) and renders one state per
 * PushCapabilityState. AURA-REM-01: "On" also requires the server to confirm
 * background delivery is running; every non-working state says what to do
 * and that in-app reminders continue.
 */
export function DeviceNotificationSettings() {
  const [state, setState] = useState<PushCapabilityState | 'LOADING'>('LOADING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getPushCapabilityState().then((next) => {
        if (!cancelled) setState(next);
      });
    };
    refresh();
    // AURA-REM-01: re-read (never prompt) when the user comes back, so
    // unblocking notifications in browser settings is picked up without a
    // reload.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    setError('');
    const outcome = await subscribeToPush({ replaceExisting: state === 'SUBSCRIPTION_EXPIRED' });
    if (outcome.ok) {
      trackEvent('WEB_PUSH_ENABLED');
      // Re-read rather than assume: "on" also needs background delivery to
      // be running on the server.
      setState(await getPushCapabilityState());
    } else if (outcome.reason === 'permission_denied') {
      // Brief section 6: "Do not repeatedly prompt after denial" -- this
      // state change is what switches the UI to the calm blocked-state
      // copy for good; there is no retry button that re-prompts.
      setState('DENIED');
    } else if (outcome.reason === 'not_configured') {
      setState('NOT_CONFIGURED');
    } else if (outcome.reason === 'unsupported') {
      setState('UNSUPPORTED');
    } else {
      setState('SUBSCRIPTION_ERROR');
      setError("Aura couldn't turn on notifications. Check your connection and try again.");
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

  const inAppFallback = 'Reminders still appear in Aura while it’s open.';

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }} data-push-state={state}>
      <span style={kickerStyle}>Device Notifications</span>

      {state === 'UNSUPPORTED' && (
        <p style={mutedTextStyle}>This browser can&apos;t show Aura notifications when Aura is closed. {inAppFallback}</p>
      )}

      {state === 'IOS_INSTALL_REQUIRED' && (
        <p style={mutedTextStyle}>
          On iPhone and iPad, notifications work once Aura is on your Home Screen: tap Share, then Add to Home Screen, and open Aura from there. {inAppFallback}
        </p>
      )}

      {state === 'NOT_CONFIGURED' && (
        <p style={mutedTextStyle}>Notifications when Aura is closed aren&apos;t available yet. {inAppFallback}</p>
      )}

      {state === 'DENIED' && (
        <p style={mutedTextStyle}>
          Notifications are blocked for Aura in this browser. To turn them on, allow notifications for this site in your browser&apos;s site settings, then come back here. {inAppFallback}
        </p>
      )}

      {(state === 'NOT_ASKED' || state === 'GRANTED' || state === 'SUBSCRIPTION_ERROR' || state === 'SUBSCRIPTION_EXPIRED') && (
        <>
          <p style={{ ...mutedTextStyle, marginBottom: 12 }}>
            {state === 'SUBSCRIPTION_EXPIRED'
              ? 'Notifications stopped working on this device. Turn them on again to keep getting reminders.'
              : 'Get reminders on this device, even when Aura is closed.'}
          </p>
          <button type="button" onClick={handleEnable} disabled={busy} style={{ ...enableButtonStyle, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Enabling…' : state === 'SUBSCRIPTION_EXPIRED' ? 'Turn on again' : 'Enable notifications'}
          </button>
          {error && <div style={{ color: '#fb7185', fontSize: 11, marginTop: 8, lineHeight: 1.4 }}>{error}</div>}
        </>
      )}

      {(state === 'SUBSCRIBED' || state === 'BACKGROUND_UNAVAILABLE') && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
          <div>
            {state === 'SUBSCRIBED' ? (
              <>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>On</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Reminders will reach this device, even when Aura is closed</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>Not working yet</div>
                <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
                  This device is set up, but Aura can&apos;t send notifications while it&apos;s closed yet. {inAppFallback}
                </div>
              </>
            )}
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
