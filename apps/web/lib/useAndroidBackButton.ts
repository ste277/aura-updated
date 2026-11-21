'use client';

import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isAnyModalOpen, closeTopmostModal } from '../components/ui';
import { decideBackAction } from './androidBackNavigation';

/**
 * AURA-MOBILE-01-M2-B/AND-02 -- Android's hardware back button has no
 * handler anywhere in this app (native or web), so Capacitor's BridgeActivity
 * falls through to the plain Android default of finishing the activity, from
 * any screen. This hook gives the app a single, centralized `backButton`
 * handler instead, without touching any of the ~50 existing `setActiveTab`
 * call sites: it watches `activeTab` and maintains its own lightweight
 * view-history stack, and defers to the shared open-modal registry
 * (components/ui.tsx's useModalA11y) for anything overlay-related, so any
 * current or future modal built with that hook is covered automatically.
 *
 * No-op on web (`Capacitor.isNativePlatform()` false) and inside iOS, which
 * has no hardware back button -- Capacitor's `backButton` event is
 * Android-only by design.
 *
 * Explicitly out of scope (AURA_MOBILE_01_M2_B_REMEDIATION_PLAN.md Section
 * 4.2): component-internal sub-navigation (e.g. PeopleView.tsx's own
 * LIST/ADD/DETAIL/EDIT modes) is invisible to this tab-level stack. Hardware
 * back from such a sub-view pops a full tab level rather than one internal
 * step the way that component's own on-screen "Back" button would -- a
 * known, accepted limitation, not a general-navigation redesign.
 */
export function useAndroidBackButton<T>(activeTab: T, setActiveTab: (tab: T) => void, isAuthenticated: boolean) {
  const historyStackRef = useRef<T[]>([]);
  const previousTabRef = useRef<T>(activeTab);
  const isAuthenticatedRef = useRef(isAuthenticated);

  // Logout (or any authenticated -> unauthenticated transition) discards any
  // history accumulated under the previous session -- DashboardPage never
  // unmounts on logout (it's one component conditionally rendering the
  // login screen vs. the authenticated app), so this ref would otherwise
  // persist stale tab history across a login boundary.
  useEffect(() => {
    if (isAuthenticatedRef.current && !isAuthenticated) {
      historyStackRef.current = [];
    }
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    if (previousTabRef.current !== activeTab) {
      historyStackRef.current.push(previousTabRef.current);
      previousTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    const listenerPromise = App.addListener('backButton', () => {
      const action = decideBackAction({
        isAuthenticated: isAuthenticatedRef.current,
        anyModalOpen: isAnyModalOpen(),
        historyStack: historyStackRef.current,
      });
      switch (action.kind) {
        case 'close-modal':
          closeTopmostModal();
          return;
        case 'navigate':
          historyStackRef.current.pop();
          previousTabRef.current = action.tab;
          setActiveTab(action.tab);
          return;
        case 'exit':
          App.exitApp();
          return;
      }
    });

    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
    // Registered exactly once per mount -- all mutable reads inside the
    // listener go through refs (isAuthenticatedRef/historyStackRef), so a
    // stale closure over setActiveTab (stable from useState) is the only
    // thing this would need to guard against, and it is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
