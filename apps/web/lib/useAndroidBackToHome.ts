'use client';

import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isAnyModalOpen, closeTopmostModal } from '../components/ui';

/**
 * AURA-MOBILE-01-M2-B/AND-02 follow-up -- lib/useAndroidBackButton.ts only
 * covers DashboardPage (route '/'); /goals, /plan-day, /captures and /find
 * are separate Next.js routes (standalone pages, not activeTab views) that
 * fully unmount DashboardPage and its backButton listener on navigation, so
 * the hardware back button had no handler at all there and fell through to
 * Android's default (finish the activity / exit the app).
 *
 * Each of these pages already has its own on-screen "<- Back to Home" exit
 * (`window.location.href = '/'`) as its only way back -- there is no
 * per-page view history to replay, unlike DashboardPage's tab stack -- so
 * hardware back on these routes mirrors that exact affordance: close the
 * topmost modal if one is open (via the same shared registry
 * DashboardPage's hook uses), otherwise navigate home the same way the
 * page's own back link does.
 *
 * No-op on web/iOS, matching useAndroidBackButton.ts's own rationale.
 */
export function useAndroidBackToHome(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    const listenerPromise = App.addListener('backButton', () => {
      if (isAnyModalOpen()) {
        closeTopmostModal();
        return;
      }
      window.location.href = '/';
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);
}
