'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { computeSolarEphemeris } from '../../../packages/astronomy/src/ephemeris';
import {
  computePanchangWindows,
  getActiveWindow,
  SolarWindowType,
  WeekdayIndex,
} from '../../../packages/panchang/src/windows';
import { computeDailyEnergyInsight } from '../lib/scoreEngine';
import { getActionCards, ActionCard } from '../../../packages/recommendation/src/actionCards';
import { findActivityIntent } from '../../../packages/recommendation/src/personalizedTasks';
import type { PersonalMuhurtaContext } from '../../../packages/recommendation/src/auraFitEngine';
import type { DailyBriefing, PlanningHorizon } from '../../../packages/recommendation/src/dailyAssistant';
import type { TimingSearchDateRange, TimingSearchMode, TimingSearchResponse, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import type { AuraUpdatesResponse } from '../lib/auraUpdates';
import type { AuraReminder } from '../lib/auraReminders';
import type { DailyAgenda, DailyAgendaItem } from '../lib/dailyAgenda';
import type { DailyStory } from '../lib/dailyStory';
import type { DailyReflection } from '../lib/dailyReflection';
import type { TomorrowPreview } from '../lib/tomorrowPreview';

// UI Modules
import { HomeDashboard } from '../components/HomeDashboard';
import { TimelineView } from '../components/Timeline';
import { AskAuraView } from '../components/AskAuraView';
import { CalendarViewSection, LoggedEntryItem } from '../components/CalendarViewSection';
import { InsightsView } from '../components/InsightsView';
import { WindowShiftToast } from '../components/WindowShiftToast';
import { PlanWithAuraView } from '../components/PlanWithAuraView';
import { YouView } from '../components/YouView';
import { PanchangCalendarView } from '../components/PanchangCalendarView';
import { MuhurthamFinderView } from '../components/MuhurthamFinderView';
import { PeopleView } from '../components/PeopleView';
import { ExploreView } from '../components/ExploreView';
import { UpdatesView } from '../components/UpdatesView';

import { BirthChartSection } from '../components/BirthChartSection';
import { LoginScreen } from '../components/LoginScreen';
import { useCurrentMinuteOfDay } from '../lib/useCurrentMinuteOfDay';
import { resolveTzOffsetMinutes, getDatePartsInTimezone } from '../lib/timezone';
import { formatDisplayName } from '../lib/displayName';
import { trackEvent } from '../lib/trackEvent';
import { Capacitor } from '@capacitor/core';
import {
  loadNotificationPrefs,
  saveNotificationPrefs,
  syncWindowNotifications,
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefs,
} from '../lib/windowNotifications';

interface SessionUser {
  id: string;
  email: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
  remindersEnabled: boolean;
  reminderLeadMinutes: number;
  dayBuilderEnabled: boolean;
  dayBuilderMutedGroups: string[];
  dayBuilderPriorities: string[];
  dayBuilderPriorityPersonIds: string[];
  dayBuilderPrioritiesPromptDismissed: boolean;
}

interface DailyReflectionState {
  outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
  followedGuidance: boolean;
}

interface PlannedActivityState {
  id: string;
  title: string;
  icon?: string | null;
  status: 'UPCOMING' | 'LOGGED' | 'CANCELLED';
  plannedStartAt: string;
  plannedEndAt: string;
  durationMinutes: number;
  windowType?: string | null;
  windowLabel?: string | null;
  matchLabel?: string | null;
  recommendation?: string | null;
}

const FALLBACK_TZ = 'Asia/Kolkata';

type LogSource = 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
type ActivitySignificance = 'LOW' | 'MEDIUM' | 'HIGH';

function inferActivitySignificance(activityTitle: string): ActivitySignificance {
  return findActivityIntent(activityTitle)?.significance ?? 'MEDIUM';
}

function isFrictionWindow(windowName: string): boolean {
  const normalized = windowName.toUpperCase();
  return normalized.includes('RAHU') || normalized.includes('YAMA');
}

export default function DashboardPage() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [logEntries, setLogEntries] = useState<LoggedEntryItem[]>([]);
  const [, setHabits] = useState<any[]>([]);
  const [dailyBriefing, setDailyBriefing] = useState<DailyBriefing | null>(null);
  // Home Good Right Now Personalization V1 -- the owner's derived natal
  // context (never raw birth date/time/timezone), returned as a sibling
  // field alongside DailyBriefing by the SAME existing
  // GET /api/daily-assistant/briefing request below -- no second Home API
  // call. Undefined for an incomplete birth profile, exactly
  // buildPersonalMuhurtaContextForUser's own existing contract.
  const [personalContext, setPersonalContext] = useState<PersonalMuhurtaContext | undefined>(undefined);
  const [assistantInsight, setAssistantInsight] = useState<any>(null);
  const [todayReflection, setTodayReflection] = useState<DailyReflectionState | null>(null);
  const [plannedActivities, setPlannedActivities] = useState<PlannedActivityState[]>([]);
  // Recipient Conversion V1 Hardening (brief section 8) -- an existing
  // user routed here from /find with `?activity=` (their acquisition
  // intent, e.g. "Date Night") lands directly in Plan with it prefilled,
  // via the exact same mechanism handleOpenPlan() already uses for every
  // other "jump into Plan with this activity" entry point in the app.
  const [planPrefill, setPlanPrefill] = useState<{ activity: string; key: number; horizon?: PlanningHorizon } | null>(() => {
    if (typeof window === 'undefined') return null;
    const requested = new URLSearchParams(window.location.search).get('activity');
    return requested?.trim() ? { activity: requested.trim(), key: Date.now() } : null;
  });
  const [mounted, setMounted] = useState(false);
  const [auraUpdates, setAuraUpdates] = useState<AuraUpdatesResponse | null>(null);
  const [myDay, setMyDay] = useState<{ agenda: DailyAgenda; story: DailyStory; reflection: DailyReflection | null; tomorrowPreview: TomorrowPreview | null } | null>(null);
  // Product Structure V2 -- "Your Moments" now lives inside Plan (brief
  // section 19), so any entry point that used to jump to the standalone
  // Shared Moments tab (Home's actionable card, You's row) now jumps into
  // Plan and focuses this token instead.
  const [momentsFocusToken, setMomentsFocusToken] = useState<string | undefined>(undefined);
  const [momentsFocusKey, setMomentsFocusKey] = useState(0);
  // Product Structure V2 (brief section 28): Plan -> People -> Plan return
  // flow. One small piece of local state, not a global navigation
  // framework -- People's own onBack just reads it.
  const [peopleReturnTo, setPeopleReturnTo] = useState<'you' | 'plan' | 'home'>('you');

  type AppTab = 'home' | 'timeline' | 'ask' | 'plan' | 'insights' | 'you' | 'chart' | 'activity' | 'explore' | 'panchang' | 'muhurtham' | 'people' | 'updates';
  const VALID_TABS: AppTab[] = ['home', 'timeline', 'ask', 'plan', 'insights', 'you', 'chart', 'activity', 'explore', 'panchang', 'muhurtham', 'people', 'updates'];
  // Recipient Conversion V1 (brief section 16/33) -- an already-signed-in
  // visitor who lands on /find (e.g. via "Find your own moment" on a Moment
  // they received) is redirected to `/?tab=plan` rather than the guest
  // wizard. This is the one place that redirect needs to land on a specific
  // tab; every other entry to '/' keeps defaulting to Home, unaffected.
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window === 'undefined') return 'home';
    const requested = new URLSearchParams(window.location.search).get('tab');
    return (VALID_TABS as string[]).includes(requested ?? '') ? (requested as AppTab) : 'home';
  });
  const [panchangDateJump, setPanchangDateJump] = useState<{ date: string; key: number } | null>(null);
  const [muhurthamActivityJump, setMuhurthamActivityJump] = useState<{ activityId: string; key: number } | null>(null);

  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

  // Product Instrumentation V1 -- client-side "viewed"/"started" UI intent
  // signals with no reliable server equivalent. Fires once per tab switch,
  // only once the user is actually signed in (never for the logged-out
  // LoginScreen). Outcome events (searches completing, moments created,
  // etc.) are tracked server-side instead -- see the relevant API routes.
  useEffect(() => {
    if (!user) return;
    if (activeTab === 'home') trackEvent('AURA_HOME_VIEWED');
    else if (activeTab === 'panchang') trackEvent('PANCHANG_CALENDAR_VIEWED');
    else if (activeTab === 'plan') trackEvent('PLAN_STARTED');
  }, [activeTab, user]);

  useEffect(() => {
    setMounted(true);
    setNotificationPrefs(loadNotificationPrefs());

    // Web-only permission request (in-app toast alerts). In the native shells
    // the LocalNotifications plugin runs its own permission flow when window
    // alerts are scheduled — see syncWindowNotifications.
    if (
      typeof window !== 'undefined' &&
      !Capacitor.isNativePlatform() &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission();
    }

    // Register Service Worker for PWA Offline Caching
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('ServiceWorker registration failed:', err);
      });
    }

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      }).catch((err) => {
        console.warn('Could not clear development service worker:', err);
      });
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.filter((key) => key.startsWith('aura-')).forEach((key) => caches.delete(key));
        }).catch((err) => {
          console.warn('Could not clear development app cache:', err);
        });
      }
    }
  }, []);

  const currentMinuteOfDay = useCurrentMinuteOfDay(user?.timezone ?? FALLBACK_TZ);

  // Parallelize Session & Initial Data Fetches
  const loadUserDataAndLogs = useCallback(async () => {
    try {
      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();

      if (!sessionData?.user) {
        setUser(null);
        setPlannedActivities([]);
        return;
      }

      setUser(sessionData.user);

      const [logsRes, habitsRes, plansRes] = await Promise.all([
        fetch('/api/habit-logs'),
        fetch('/api/habits'),
        fetch('/api/plans'),
      ]);

      if (logsRes.ok) {
        const logs = await logsRes.json();
        setLogEntries(
          logs.map((l: any) => ({
            id: l.id,
            activityTitle: l.activityTitle,
            activeWindow: l.activeWindow,
            loggedAt: new Date(l.logTimestamp || l.createdAt || Date.now()),
            logMinuteOfDay: l.logMinuteOfDay,
            durationMinutes: l.durationMinutes ?? 30,
            notes: l.notes || null,
            logSource: l.logSource || 'MANUAL',
            activitySignificance: l.activitySignificance || 'MEDIUM',
          }))
        );
      }

      if (habitsRes.ok) {
        const habitsData = await habitsRes.json();
        setHabits(habitsData);
      }

      if (plansRes.ok) {
        setPlannedActivities(await plansRes.json());
      }
    } catch {
      setUser(null);
      setPlannedActivities([]);
    }
  }, []);

  useEffect(() => {
    loadUserDataAndLogs();
  }, [loadUserDataAndLogs]);

  useEffect(() => {
    if (!user) return;

    const loadAssistantSignals = async () => {
      const [briefingRes, insightRes, reflectionRes] = await Promise.all([
        fetch('/api/daily-assistant/briefing'),
        fetch('/api/daily-assistant/insights'),
        fetch('/api/daily-assistant/reflection'),
      ]);

      if (briefingRes.ok) {
        const briefingData = await briefingRes.json();
        setDailyBriefing(briefingData);
        setPersonalContext(briefingData.personalContext);
      }
      if (insightRes.ok) setAssistantInsight(await insightRes.json());
      if (reflectionRes.ok) {
        const reflection = await reflectionRes.json();
        setTodayReflection(reflection ? {
          outputLevel: reflection.outputLevel,
          followedGuidance: Boolean(reflection.followedGuidance),
        } : null);
      }
    };

    loadAssistantSignals().catch((err) => {
      console.error('Failed to load daily assistant signals:', err);
    });
  }, [user?.id]);

  // Aura Updates V1 -- ordinary fetch on the same lifecycle as the other
  // Home data above, no polling faster than the app's existing refresh
  // pattern (brief: "not faster than existing normal app refresh
  // patterns"). Refetched after actions that change seen/actionable state
  // (see loadAuraUpdates callers below) so the badge/section stay current
  // without a background timer.
  const loadAuraUpdates = useCallback(async () => {
    try {
      const res = await fetch('/api/aura-updates');
      if (res.ok) setAuraUpdates(await res.json());
    } catch {
      // Best-effort -- Home/You already render fine with no updates data.
    }
  }, []);

  // My Day V1 -- same on-mount/on-tab-switch lifecycle as Aura Updates
  // above, no polling. Home-only (unlike Aura Updates, which also serves
  // the Updates tab) since My Day's own agenda/story only render on Home.
  const loadMyDay = useCallback(async () => {
    try {
      const res = await fetch('/api/my-day');
      if (res.ok) {
        const data = await res.json();
        setMyDay({ agenda: data.agenda, story: data.story, reflection: data.reflection ?? null, tomorrowPreview: data.tomorrowPreview ?? null });
      }
    } catch {
      // Best-effort -- Home already degrades gracefully with myDay null.
    }
  }, []);

  // Web Push V1 (brief section 10) -- when a push notification is clicked
  // while Aura is ALREADY open, the service worker focuses this tab and
  // posts a message instead of opening a second one. The mark-seen call
  // and REMINDER_OPENED analytics already happened in the service worker
  // itself (sw.js's notificationclick handler) -- this listener only
  // handles navigation, reusing the EXACT same target semantics
  // handleOpenReminder already uses for in-app clicks, so a push-driven
  // open behaves identically to an in-app one once the tab is focused.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'AURA_REMINDER_NAVIGATE') return;
      const target = event.data.target as AuraReminder['target'] | undefined;
      if (!target) return;
      if (target.type === 'MOMENT') {
        window.open(`${window.location.origin}/moment/${target.momentToken}`, '_blank', 'noopener,noreferrer');
      } else {
        setActiveTab('plan');
      }
      loadAuraUpdates();
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [loadAuraUpdates]);

  // Aura Reminders V1 (brief section 27) extended this beyond its original
  // "once on sign-in" trigger: a Starting Soon reminder is time-sensitive in
  // a way moment responses alone weren't (a Plan saved for "15 minutes from
  // now" needs to actually show up within that window, not just at the next
  // full page load). Reusing the existing per-tab-switch refresh point (the
  // same activeTab effect above that fires AURA_HOME_VIEWED) rather than
  // adding a new timer -- signing in, or visiting Home/Updates, simply
  // re-fetches the same data those screens already render. Deliberately NOT
  // a setInterval/polling loop (section 27 explicitly forbids that); a
  // reminder becoming active while the user sits idle on Home only appears
  // on their next natural visit/switch, matching V1's scope (real-time
  // delivery while idle is Web Push V1's job).
  useEffect(() => {
    if (!user) return;
    if (activeTab === 'home' || activeTab === 'updates') loadAuraUpdates();
    if (activeTab === 'home') loadMyDay();
  }, [activeTab, user?.id, loadAuraUpdates, loadMyDay]);

  const handleViewMomentUpdate = useCallback((momentToken: string) => {
    window.open(`${window.location.origin}/moment/${momentToken}`, '_blank', 'noopener,noreferrer');
    // E2E Journey Coverage V1.1 stabilization -- this previously called
    // loadAuraUpdates() unchained, racing the seen POST instead of waiting
    // for it (handleOpenReminder below already gets this right). Matching
    // that convention: never blocks the popup open on the POST, but the
    // refetch now always happens after it settles.
    fetch(`/api/aura-moments/${momentToken}/seen`, { method: 'POST' }).catch(() => {}).finally(() => loadAuraUpdates());
  }, [loadAuraUpdates]);

  const handleFindAnotherTimeForMoment = useCallback((momentToken: string) => {
    setMomentsFocusToken(momentToken);
    setMomentsFocusKey(Date.now());
    setActiveTab('plan');
  }, []);

  // Aura Reminders V1 (brief section 22) -- every reminder needs an
  // explicit destination: MOMENT_APPROACHING opens the moment's own public
  // link (same navigation pattern handleViewMomentUpdate already uses,
  // reused rather than duplicated), PLAN_APPROACHING opens Plan (Plans have
  // no dedicated detail route -- Home's own Upcoming Plans section already
  // lives there). Never routes to Home itself.
  //
  // Notification Delivery Readiness V1 (brief section 6) -- this is the
  // ONE place a reminder is marked seen: the owner intentionally opening
  // this SPECIFIC reminder, from either Home's Starting Soon card or
  // Updates' Upcoming section (both already call this same handler, so
  // there is no separate Bell-vs-destination path to double-fire from --
  // opening the Bell itself never marks anything seen). Best-effort POST,
  // same convention as handleViewMomentUpdate's own /seen call just below:
  // never blocks the navigation/open action on it.
  const handleOpenReminder = useCallback((reminder: AuraReminder) => {
    if (reminder.target.type === 'MOMENT') {
      window.open(`${window.location.origin}/moment/${reminder.target.momentToken}`, '_blank', 'noopener,noreferrer');
    } else {
      setActiveTab('plan');
    }
    fetch('/api/reminders/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduledItemType: reminder.scheduledItemType,
        scheduledItemId: reminder.scheduledItemId,
        reminderAt: reminder.reminderAt,
      }),
    }).catch(() => {}).finally(() => loadAuraUpdates());
    trackEvent('REMINDER_OPENED', {
      metadata: {
        scheduledItemType: reminder.scheduledItemType,
        leadTimeMinutes: Math.max(0, Math.round((new Date(reminder.startAt).getTime() - new Date(reminder.reminderAt).getTime()) / 60000)),
        // Web Push V1 (brief section 31) -- distinguishes this in-app open
        // from the service worker's own REMINDER_OPENED call (source:
        // 'PUSH', sw.js) for the same canonical event.
        source: 'IN_APP',
      },
    });
  }, [loadAuraUpdates]);

  // My Day V1 (brief section 36) -- same routing convention
  // handleOpenReminder already uses: a Moment target opens the owner's own
  // public /moment/[token] link (the same one Aura Updates' "View" and
  // reminders already use), everything else opens Plan (My Day items have
  // no per-row deep link into Plan/Timeline yet -- a reasonable V1 scope
  // limit, not a new navigation system).
  const handleOpenAgendaItem = useCallback((item: DailyAgendaItem) => {
    trackEvent('MY_DAY_ITEM_OPENED', { metadata: { itemType: item.type, dayPhase: myDay?.story.phase ?? 'MORNING' } });
    if (item.target.type === 'MOMENT') {
      window.open(`${window.location.origin}/moment/${item.target.id}`, '_blank', 'noopener,noreferrer');
    } else {
      setActiveTab('plan');
    }
  }, [myDay]);

  // The focus token is only meant for ONE visit to Your Moments -- clear it
  // as soon as the tab changes away, so a later, unrelated visit to Plan
  // never auto-re-triggers an old moment's alternatives search.
  useEffect(() => {
    if (activeTab !== 'plan') setMomentsFocusToken(undefined);
  }, [activeTab]);

  const handleOpenUpdates = useCallback(() => {
    setActiveTab('updates');
  }, []);

  // Aura Reminders V1 (brief section 14/15) -- optimistic toggle, same
  // pattern as onLocationChanged: update local user state immediately, then
  // persist. Refetches Aura Updates so a just-disabled toggle clears
  // Starting Soon/Upcoming without waiting for the next natural refresh.
  const handleRemindersEnabledChange = useCallback(async (next: boolean) => {
    setUser((current) => (current ? { ...current, remindersEnabled: next } : current));
    try {
      const res = await fetch('/api/users/reminder-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remindersEnabled: next }),
      });
      if (res.ok) loadAuraUpdates();
    } catch {
      // Best-effort -- the optimistic UI already reflects the user's choice.
    }
  }, [loadAuraUpdates]);

  // Intentional Day Builder V1 (brief section 6/35), extended by
  // Personalization Foundation V1 -- same optimistic pattern as
  // handleRemindersEnabledChange above. Accepts a PARTIAL update (any
  // subset of the 5 Day Builder preference fields) -- PATCH
  // /api/users/day-builder-preferences itself defaults any omitted field
  // to the user's current stored value, so a caller that only knows about
  // priorities (PersonalizationPromptCard) never has to also know/send
  // dayBuilderEnabled/dayBuilderMutedGroups just to avoid wiping them.
  const handleDayBuilderPrefsChange = useCallback(async (next: Partial<{
    dayBuilderEnabled: boolean;
    dayBuilderMutedGroups: string[];
    dayBuilderPriorities: string[];
    dayBuilderPriorityPersonIds: string[];
    dayBuilderPrioritiesPromptDismissed: boolean;
  }>) => {
    setUser((current) => (current ? { ...current, ...next } : current));
    try {
      await fetch('/api/users/day-builder-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch {
      // Best-effort -- the optimistic UI already reflects the user's choice.
    }
  }, []);

  const handleOpenMomentsFromYou = useCallback(() => {
    setMomentsFocusKey(Date.now());
    setActiveTab('plan');
  }, []);

  // Offline Log Sync Listener
  useEffect(() => {
    const syncOfflineLogs = async () => {
      const rawQueue = localStorage.getItem('offline_habit_queue');
      if (!rawQueue) return;

      try {
        const queue: any[] = JSON.parse(rawQueue);
        if (queue.length === 0) return;

        for (const payload of queue) {
          await fetch('/api/habit-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        localStorage.removeItem('offline_habit_queue');
        loadUserDataAndLogs();
      } catch (err) {
        console.error('Failed to clear offline queue:', err);
      }
    };

    window.addEventListener('online', syncOfflineLogs);
    return () => window.removeEventListener('online', syncOfflineLogs);
  }, [loadUserDataAndLogs]);

  // The panchang day is defined by the USER'S timezone (their selected city),
  // never the browser clock or UTC: the weekday selects the Rahu/Gulika/Yama
  // segments and the date drives the ephemeris, so a NY browser with a Chennai
  // profile must still compute Chennai's "today".
  const userTz = user?.timezone ?? FALLBACK_TZ;
  const todayParts = mounted ? getDatePartsInTimezone(userTz, new Date()) : null;
  const todayDateStr = todayParts?.dateStr ?? '';

  // Precise Date-Filtered Titles for Activities Logged TODAY (user-tz day)
  const loggedActivitiesToday = useMemo(() => {
    if (!todayDateStr) return [];
    return logEntries
      .filter(
        (entry) =>
          getDatePartsInTimezone(userTz, new Date(entry.loggedAt)).dateStr === todayDateStr
      )
      .map((entry) => entry.activityTitle.trim().toLowerCase());
  }, [logEntries, userTz, todayDateStr]);

  // Date-memoized Solar Ephemeris Calculation
  const solar = useMemo(() => {
    if (!user || !mounted || !todayParts) return null;
    const tzOffsetMinutes = resolveTzOffsetMinutes(user.timezone, new Date());
    return computeSolarEphemeris({
      year: todayParts.year,
      month: todayParts.month,
      day: todayParts.day,
      latitude: user.latitude,
      longitude: user.longitude,
      tzOffsetMinutes,
    });
  }, [user?.latitude, user?.longitude, user?.timezone, todayDateStr, mounted]);

  const weekday = (todayParts?.weekday ?? 0) as WeekdayIndex;

  // Memoize static daily Panchang windows
  const windows = useMemo(() => {
    return solar ? computePanchangWindows(solar, weekday) : [];
  }, [solar, weekday]);

  // Keep the device's scheduled window alerts in sync with today's windows
  // and the user's per-window preferences. Reads the current minute through a
  // ref so the per-minute clock tick doesn't cancel/reschedule every minute.
  const minuteRef = React.useRef(currentMinuteOfDay);
  minuteRef.current = currentMinuteOfDay;
  useEffect(() => {
    if (!user || windows.length === 0) return;
    syncWindowNotifications(windows, minuteRef.current, notificationPrefs).catch((err) => {
      console.warn('Could not sync window notifications:', err);
    });
  }, [user?.id, windows, notificationPrefs]);

  // Active window type lookup
  const activeType = useMemo(() => {
    return solar ? getActiveWindow(windows, currentMinuteOfDay) : 'NEUTRAL';
  }, [solar, windows, currentMinuteOfDay]);

  // Daily energy insight score
  const energyInsight = useMemo(() => {
    return computeDailyEnergyInsight(windows, activeType, currentMinuteOfDay);
  }, [windows, activeType, currentMinuteOfDay]);

  // Safe Next Shift fallback computation
  const safeNextShift = useMemo(() => {
    if (!energyInsight?.nextShift) {
      return {
        windowName: 'Next Shift',
        startsIn: 'In 1h 20m',
        startTime: '04:30 AM',
        score: 7.8,
        themeText: 'Balanced and stable energy. Good for consistent, incremental execution.',
      };
    }

    const { windowName, startsIn, startTime, score, themeText } = energyInsight.nextShift;

    const validStartsIn = startsIn && !startsIn.includes('NaN') ? startsIn : 'In 45m';
    const validStartTime = startTime && !startTime.includes('NaN') ? startTime : '11:40 AM';

    return {
      windowName: windowName ? String(windowName).replace('_', ' ') : 'Next Shift',
      startsIn: validStartsIn,
      startTime: validStartTime,
      score,
      themeText,
    };
  }, [energyInsight]);

  // Current window timing calculations for TimelineView Banner.
  //
  // This answers "how long until the next meaningful timing change" — NOT
  // "how long until this window's underlying block ends." Those are different
  // questions: when we're in a Neutral gap, the gap itself may run until
  // midnight, but if a real window (Gulika, Rahu Kalam, etc.) starts sooner,
  // that's the moment the user's experience actually changes, so that's what
  // should drive the countdown. Previously this always used the matched
  // window's own end time and fell back to literal midnight for Neutral,
  // which produced misleading "8h 9m left" countdowns straight through a
  // window that started in the next hour.
  const currentWindowInfo = useMemo(() => {
    const activeTypeClean = activeType ? String(activeType).replace('_', ' ').toUpperCase() : 'NEUTRAL';

    const parseMinute = (val: any) => {
      if (typeof val === 'number' && !isNaN(val)) return val;
      if (typeof val === 'string' && val.includes(':')) {
        const [h, m] = val.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
      }
      return null;
    };

    const formatMinute = (minute: number) => {
      const totalMins = ((Math.floor(minute) % 1440) + 1440) % 1440;
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      const period = hrs >= 12 ? 'PM' : 'AM';
      const formattedHr = hrs % 12 === 0 ? 12 : hrs % 12;
      return `${formattedHr}:${String(mins).padStart(2, '0')} ${period}`;
    };

    const activeWin = windows.find((w: any) => {
      const rawType = String(w.type || w.windowType || w.name || '').replace('_', ' ').toUpperCase();
      return rawType === activeTypeClean;
    });

    // Windows sorted chronologically by start minute, so we can find the
    // soonest upcoming boundary regardless of which order they were computed in.
    const sortedByStart = [...windows]
      .map((w: any) => ({ w, start: parseMinute(w.startMinutes ?? w.startMinute) ?? 0 }))
      .sort((a, b) => a.start - b.start);

    let startMin: number | null;
    let nextBoundaryMin: number;

    if (activeWin) {
      // Currently inside a real (named) window: the boundary is simply its own end.
      startMin = parseMinute(activeWin.startMinutes ?? activeWin.startMinute);
      nextBoundaryMin = parseMinute(activeWin.endMinutes ?? activeWin.endMinute) ?? currentMinuteOfDay;
    } else {
      // Currently in a Neutral gap: the boundary is the start of whichever
      // named window begins soonest — today if one remains, otherwise the
      // earliest one tomorrow (wrapping past midnight).
      startMin = null;
      const upcomingToday = sortedByStart.find(({ start }) => start > currentMinuteOfDay);
      const soonest = upcomingToday ?? sortedByStart[0];
      let boundary = soonest ? soonest.start : currentMinuteOfDay;
      if (boundary <= currentMinuteOfDay) boundary += 1440; // wraps to tomorrow
      nextBoundaryMin = boundary;
    }

    const endTimeStr = formatMinute(nextBoundaryMin);

    let diff = nextBoundaryMin - currentMinuteOfDay;
    if (diff < 0) diff += 1440;
    const remHrs = Math.floor(diff / 60);
    const remMins = diff % 60;
    const timeRemainingStr = remHrs > 0 ? `${remHrs}h ${remMins}m` : `${remMins}m`;

    return {
      name: activeType.replace('_', ' '),
      startTime: startMin === null ? 'Current' : formatMinute(startMin),
      endTime: endTimeStr,
      timeRemaining: timeRemainingStr,
    };
  }, [windows, activeType, currentMinuteOfDay]);

  // Dynamically map timeline windows and auto-fill unassigned time gaps as Neutral Flow
  const mappedTimelineWindows = useMemo(() => {
    const parseMinute = (val: any) => {
      if (typeof val === 'number' && !isNaN(val)) return val;
      if (typeof val === 'string' && val.includes(':')) {
        const [h, m] = val.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
      }
      return 0;
    };

    const formatTime = (m: number) => {
      const totalMins = Math.floor(m) % 1440;
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      const period = hrs >= 12 ? 'PM' : 'AM';
      const displayHr = hrs % 12 === 0 ? 12 : hrs % 12;
      return `${displayHr}:${String(mins).padStart(2, '0')} ${period}`;
    };

    const rawWindows = windows
      .map((w: any) => {
        const windowType = w.type || w.windowType || w.name || 'NEUTRAL';
        const cleanName = String(windowType).replace('_', ' ');

        const sMin = parseMinute(w.startMinutes ?? w.startMinute ?? w.start);
        const eMin = parseMinute(w.endMinutes ?? w.endMinute ?? w.end);

        const isFriction = cleanName.includes('RAHU') || cleanName.includes('YAMA');
        const isAuspicious = cleanName.includes('ABHIJIT') || cleanName.includes('VIJAYA');

        return {
          name: cleanName,
          startMinute: sMin,
          endMinute: eMin,
          startTime: formatTime(sMin),
          endTime: formatTime(eMin),
          type: isFriction ? 'friction' : isAuspicious ? 'auspicious' : 'neutral',
          color: isFriction ? '#fb6b6b' : isAuspicious ? '#4ade80' : '#facc15',
        };
      })
      .sort((a, b) => a.startMinute - b.startMinute);

    const completeTimeline: typeof rawWindows = [];
    let currentCursor = 0;

    rawWindows.forEach((win) => {
      if (win.startMinute > currentCursor) {
        completeTimeline.push({
          name: 'Neutral Flow',
          startMinute: currentCursor,
          endMinute: win.startMinute,
          startTime: formatTime(currentCursor),
          endTime: formatTime(win.startMinute),
          type: 'neutral',
          color: '#64748b',
        });
      }
      completeTimeline.push(win);
      currentCursor = Math.max(currentCursor, win.endMinute);
    });

    if (currentCursor < 1440) {
      completeTimeline.push({
        name: 'Neutral Flow',
        startMinute: currentCursor,
        endMinute: 1440,
        startTime: formatTime(currentCursor),
        endTime: '12:00 AM',
        type: 'neutral',
        color: '#64748b',
      });
    }

    return completeTimeline;
  }, [windows]);

  // Quick-Log Habit Handler with Optimistic UI & Offline Queueing
  const handleLogActivity = useCallback(
    async (
      activityTitle: string,
      notes?: string,
      customTimestamp?: Date,
      overrideWindowType?: string,
      durationMinutes = 30,
      logSource: LogSource = 'MANUAL',
      activitySignificance?: ActivitySignificance
    ) => {
      const targetDate = customTimestamp ? new Date(customTimestamp) : new Date();
      const calculatedMinute = targetDate.getHours() * 60 + targetDate.getMinutes();
      const tempId = `temp-${Date.now()}`;
      const activeWindowForLog = overrideWindowType || activeType || 'NEUTRAL';
      const inferredSignificance = activitySignificance ?? inferActivitySignificance(activityTitle);
      const finalLogSource = logSource === 'MANUAL' && isFrictionWindow(activeWindowForLog) && inferredSignificance !== 'LOW'
        ? 'OVERRIDE_CAUTION'
        : logSource;

      const optimisticEntry: LoggedEntryItem = {
        id: tempId,
        activityTitle,
        activeWindow: activeWindowForLog,
        loggedAt: targetDate,
        logMinuteOfDay: calculatedMinute,
        durationMinutes,
        notes: notes ? String(notes).trim() : null,
        logSource: finalLogSource,
        activitySignificance: inferredSignificance,
      };

      // 1. Optimistic UI Update
      setLogEntries((prev) => [optimisticEntry, ...prev]);

      const payload = {
        activityTitle,
        activeWindow: optimisticEntry.activeWindow,
        logMinuteOfDay: calculatedMinute,
        logTimestamp: targetDate.toISOString(),
        notes: optimisticEntry.notes || undefined,
        durationMinutes,
        logSource: finalLogSource,
        activitySignificance: inferredSignificance,
      };

      try {
        const res = await fetch('/api/habit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const serverLog = await res.json();
          setLogEntries((prev) =>
            prev.map((item) =>
              item.id === tempId
                ? {
                    ...item,
                    id: serverLog.id,
                    loggedAt: new Date(serverLog.logTimestamp || serverLog.createdAt),
                    // Insights Correctness + Historical Integrity V1 -- the
                    // optimistic entry's own activeWindowForLog is at best a
                    // same-day guess (today's live activeType for a
                    // backdated log); the server now always computes the
                    // real, historically-correct window for the actual
                    // logTimestamp (apps/web/lib/historicalActivityWindow.ts).
                    // Sync it here so a backdated entry's displayed window
                    // (and everything InsightsView derives from it) reflects
                    // the authoritative value, not the optimistic guess.
                    activeWindow: serverLog.activeWindow ?? item.activeWindow,
                  }
                : item
            )
          );
        } else {
          // Buffer in local storage queue if server returns non-200
          const rawQueue = localStorage.getItem('offline_habit_queue');
          const queue = rawQueue ? JSON.parse(rawQueue) : [];
          queue.push(payload);
          localStorage.setItem('offline_habit_queue', JSON.stringify(queue));
        }
      } catch (err) {
        // Buffer in local storage queue if offline/network failure
        const rawQueue = localStorage.getItem('offline_habit_queue');
        const queue = rawQueue ? JSON.parse(rawQueue) : [];
        queue.push(payload);
        localStorage.setItem('offline_habit_queue', JSON.stringify(queue));
      }
    },
    [activeType]
  );

  const handleLogout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const handleLocationChanged = useCallback((city: { cityName: string; latitude: number; longitude: number; timezone: string }) => {
    setUser((prev) => (prev ? { ...prev, ...city } : prev));
  }, []);

  const handleTimingSearch = useCallback(async (request: {
    mode: TimingSearchMode;
    activityId?: string;
    taskTitle?: string;
    durationMinutes: number;
    dateRange?: TimingSearchDateRange;
    horizon?: PlanningHorizon;
    customStartDate?: string;
    customEndDate?: string;
    timePreference?: TimingTimePreference;
    limit?: number;
    candidateStart?: string;
    checkNearbyWindowMinutes?: number;
    candidateStarts?: string[];
  }): Promise<TimingSearchResponse> => {
    const res = await fetch('/api/timing-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, clientNow: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error('Unable to run timing search.');
    return res.json();
  }, []);

  const handleLogPlanFromHome = useCallback(async (planId: string) => {
    const res = await fetch(`/api/plans/${planId}/log`, { method: 'POST' });
    if (!res.ok) throw new Error('Unable to log planned activity.');
    await loadUserDataAndLogs();
  }, [loadUserDataAndLogs]);

  const handleOpenPlan = useCallback((activity?: string) => {
    const cleanActivity = activity?.trim();
    if (cleanActivity) {
      setPlanPrefill({ activity: cleanActivity, key: Date.now() });
    }
    setActiveTab('plan');
  }, []);

  // Daily Reflection & Tomorrow Preview V1 (brief section 5) -- "Plan
  // tomorrow" (generic, or from a "Make room for..." suggestion) never
  // creates a Plan directly. It routes into the exact same Plan/Timing
  // Search screen handleOpenPlan already uses, just with the horizon
  // preset to TOMORROW and, when a suggestion carried one, an activity
  // preselected -- the actual search/creation happens in Plan itself.
  const handlePlanTomorrow = useCallback((activityTitle?: string) => {
    const resolvedActivityId = activityTitle ? findActivityIntent(activityTitle)?.id : undefined;
    trackEvent('TOMORROW_PLAN_STARTED', resolvedActivityId ? { metadata: { activityId: resolvedActivityId } } : undefined);
    setPlanPrefill({ activity: activityTitle?.trim() ?? '', key: Date.now(), horizon: 'TOMORROW' });
    setActiveTab('plan');
  }, []);

  const handleViewFullPanchang = useCallback((dateStr: string) => {
    setPanchangDateJump({ date: dateStr, key: Date.now() });
    setActiveTab('panchang');
  }, []);

  // Bug fix: a plain "open Panchang" entry point (Explore's card, Muhurtham
  // Finder's "Open Panchang Calendar") used to just setActiveTab('panchang')
  // directly, leaving whatever panchangDateJump handleViewFullPanchang had
  // set earlier in the session still in place -- PanchangCalendarView's own
  // initialSelectedDate effect re-applies it on every fresh mount, so
  // clicking Explore's "Today · <date>" card could silently land on a stale
  // date from an unrelated earlier "View full Panchang" click instead of
  // today. Clearing the jump here (only handleViewFullPanchang above should
  // ever set a real one) fixes every plain entry point at once.
  const handleOpenPanchang = useCallback(() => {
    setPanchangDateJump(null);
    setActiveTab('panchang');
  }, []);

  // Explore's Quick Explore shortcuts -- identical pattern to
  // handleViewFullPanchang above, just for Muhurtham Finder's activity
  // instead of Panchang's date.
  const handleOpenMuhurthamWithActivity = useCallback((activityId: string) => {
    setMuhurthamActivityJump({ activityId, key: Date.now() });
    setActiveTab('muhurtham');
  }, []);

  const handleSubmitReflection = useCallback(async (
    outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW',
    followedGuidance: boolean
  ) => {
    const res = await fetch('/api/daily-assistant/reflection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputLevel, followedGuidance }),
    });
    if (!res.ok) throw new Error('Unable to save reflection.');

    const insightRes = await fetch('/api/daily-assistant/insights');
    if (insightRes.ok) setAssistantInsight(await insightRes.json());
    setTodayReflection({ outputLevel, followedGuidance });
  }, []);

  if (user === undefined) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--as-bg, #020617)', color: 'var(--as-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </main>
    );
  }

  if (user === null) {
    return <LoginScreen onLoggedInCheck={loadUserDataAndLogs} />;
  }

  const userNameDisplay = formatDisplayName(user.email);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--as-bg, #020617)',
        color: 'var(--as-text, #f8fafc)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'calc(env(safe-area-inset-top, 16px) + 12px) 16px 90px',
        boxSizing: 'border-box',
      }}
    >
      {/* Real-Time Solar Phase Shift Toast Banner */}
      <WindowShiftToast activeWindowName={activeType} />

      {activeTab === 'chart' && (
        <header
          style={{
            width: '100%',
            maxWidth: 760,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            padding: '0 4px',
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, margin: 0, lineHeight: 1.15 }}>Birth Chart</h1>
            <p style={{ fontSize: 12, color: '#b6c2d1', margin: '4px 0 0' }}>
              Personal timing map and daily transit context.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('you')}
            aria-label="Back to You"
            style={{
              fontSize: 11,
              color: '#4ade80',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid #4ade80',
              borderRadius: 14,
              padding: '6px 10px',
              cursor: 'pointer',
              minHeight: 32,
              flexShrink: 0,
            }}
          >
            Back to You
          </button>
        </header>
      )}

      {/* Aura UI Experience V2 (brief section 7/89) -- one shared content
       * max-width for every main screen. Was 760 for Home/Plan/Explore but
       * 420 for every other tab, a real "inconsistent screen widths" bug on
       * anything wider than a phone; harmless on mobile since the actual
       * rendered width is always min(100%, maxWidth). */}
      <div style={{ width: '100%', maxWidth: 760 }}>
        {activeTab === 'home' && (
          <HomeDashboard
            userName={userNameDisplay}
            energyScore={energyInsight.score}
            themeText={energyInsight.themeText}
            bestForToday={energyInsight.bestForToday}
            cautionItems={energyInsight.cautionItems}
            nextShift={safeNextShift}
            currentWindow={currentWindowInfo}
            activeWindowName={activeType}
            dayWindows={mappedTimelineWindows}
            loggedActivitiesToday={loggedActivitiesToday}
            dailyBriefing={dailyBriefing}
            personalContext={personalContext}
            todayReflection={todayReflection}
            onLogActivity={handleLogActivity}
            onSubmitReflection={handleSubmitReflection}
            onLogPlan={handleLogPlanFromHome}
            onNextShiftClick={() => setActiveTab('timeline')}
            onPlanClick={handleOpenPlan}
            onInsightsClick={() => setActiveTab('insights')}
            onNotificationsClick={handleOpenUpdates}
            unreadUpdatesCount={auraUpdates?.unreadCount}
            onPanchangClick={() => setActiveTab('explore')}
            // Only surface something that still needs the owner's attention --
            // updates[0] alone could be an already-resolved/seen entry that's
            // merely the most recent, which read as a stale "Find another
            // time" prompt after the owner had already handled it.
            topMomentUpdate={auraUpdates?.updates?.find((update) => update.requiresAction || (update.type === 'MOMENT_ACCEPTED' && update.unread))}
            onViewMomentUpdate={handleViewMomentUpdate}
            onFindAnotherTimeForMoment={handleFindAnotherTimeForMoment}
            startingSoonReminder={auraUpdates?.upcoming?.[0]}
            onOpenReminder={handleOpenReminder}
            myDayAgenda={myDay?.agenda}
            myDayStory={myDay?.story}
            myDayReflection={myDay?.reflection}
            myDayTomorrowPreview={myDay?.tomorrowPreview}
            onMyDayChanged={loadMyDay}
            onOpenPeople={() => { setPeopleReturnTo('home'); setActiveTab('people'); }}
            onOpenAgendaItem={handleOpenAgendaItem}
            onPlanTomorrow={handlePlanTomorrow}
            onMuteDayBuilderGroup={(groupId) =>
              handleDayBuilderPrefsChange({
                dayBuilderMutedGroups: Array.from(new Set([...user.dayBuilderMutedGroups, groupId])),
              })
            }
            dayBuilderEnabled={user.dayBuilderEnabled}
            dayBuilderPriorities={user.dayBuilderPriorities}
            dayBuilderPrioritiesPromptDismissed={user.dayBuilderPrioritiesPromptDismissed}
            onDayBuilderPrefsChange={handleDayBuilderPrefsChange}
          />
        )}

        {activeTab === 'timeline' && (
          <TimelineView
            currentWindow={currentWindowInfo}
            currentMinuteOfDay={currentMinuteOfDay}
            windows={mappedTimelineWindows}
            logEntries={logEntries}
            loggedActivitiesToday={loggedActivitiesToday}
            onLogActivity={handleLogActivity}
            onPlanActivity={handleOpenPlan}
            onAskAuraClick={() => setActiveTab('ask')}
          />
        )}

        {activeTab === 'ask' && (
          <AskAuraView
            userName={userNameDisplay}
            activeWindow={activeType}
            cityName={user.cityName}
            onPlanLogged={loadUserDataAndLogs}
            onViewTimeline={() => setActiveTab('timeline')}
            onOpenPlan={handleOpenPlan}
            onOpenPanchang={handleOpenPanchang}
            onOpenMuhurthamWithActivity={handleOpenMuhurthamWithActivity}
          />
        )}

        {activeTab === 'plan' && (
          <PlanWithAuraView
            onTimingSearch={handleTimingSearch}
            onViewDay={() => setActiveTab('timeline')}
            onPlanLogged={loadUserDataAndLogs}
            timezone={user.timezone}
            initialActivity={planPrefill?.activity}
            initialActivityKey={planPrefill?.key}
            initialHorizon={planPrefill?.horizon}
            onOpenPeople={() => { setPeopleReturnTo('plan'); setActiveTab('people'); }}
            focusMomentsKey={momentsFocusKey}
            focusMomentToken={momentsFocusToken}
            onMomentSeen={loadAuraUpdates}
          />
        )}

        {activeTab === 'insights' && (
          <InsightsView logEntries={logEntries} assistantInsight={assistantInsight} />
        )}

        {activeTab === 'you' && (
          <YouView
            userName={userNameDisplay}
            email={user.email}
            cityName={user.cityName}
            timezone={user.timezone}
            notificationPrefs={notificationPrefs}
            onNotificationPrefsChange={(next) => {
              setNotificationPrefs(next);
              saveNotificationPrefs(next);
            }}
            onLocationChanged={handleLocationChanged}
            onOpenHome={() => setActiveTab('home')}
            onOpenChart={() => setActiveTab('chart')}
            onOpenActivityLog={() => setActiveTab('activity')}
            onOpenPeople={() => { setPeopleReturnTo('you'); setActiveTab('people'); }}
            onOpenSharedMoments={handleOpenMomentsFromYou}
            onSignOut={handleLogout}
            // Deliberately the MOMENT-only unread count, not the combined
            // Bell badge total (auraUpdates.unreadCount now also folds in
            // active reminders, brief section 18) -- this row is
            // specifically "Moments you've created and their responses", so
            // it should never show a count driven by an unrelated Plan
            // reminder.
            sharedMomentsUnreadCount={auraUpdates?.updates?.filter((update) => update.unread).length}
            remindersEnabled={user.remindersEnabled}
            onRemindersEnabledChange={handleRemindersEnabledChange}
            dayBuilderEnabled={user.dayBuilderEnabled}
            dayBuilderMutedGroups={user.dayBuilderMutedGroups}
            dayBuilderPriorities={user.dayBuilderPriorities}
            dayBuilderPriorityPersonIds={user.dayBuilderPriorityPersonIds}
            onDayBuilderPrefsChange={handleDayBuilderPrefsChange}
          />
        )}

        {activeTab === 'chart' && <BirthChartSection />}

        {activeTab === 'people' && <PeopleView onBack={() => setActiveTab(peopleReturnTo)} />}

        {activeTab === 'activity' && (
          <CalendarViewSection
            logEntries={logEntries}
            userLocation={{ latitude: user.latitude, longitude: user.longitude, timezone: user.timezone }}
            onLogActivity={handleLogActivity}
            onBack={() => setActiveTab('you')}
          />
        )}

        {activeTab === 'explore' && (
          <ExploreView
            timezone={user.timezone}
            onOpenPanchang={handleOpenPanchang}
            onOpenMuhurtham={() => setActiveTab('muhurtham')}
            onOpenMuhurthamWithActivity={handleOpenMuhurthamWithActivity}
          />
        )}

        {activeTab === 'panchang' && (
          <PanchangCalendarView
            timezone={user.timezone}
            onBack={() => setActiveTab('explore')}
            onViewTodayRhythm={() => setActiveTab('timeline')}
            onExploreActivities={() => setActiveTab('plan')}
            onOpenMuhurtham={() => setActiveTab('muhurtham')}
            initialSelectedDate={panchangDateJump?.date}
            initialSelectedDateKey={panchangDateJump?.key}
          />
        )}

        {activeTab === 'muhurtham' && (
          <MuhurthamFinderView
            timingLocation={{ cityName: user.cityName, latitude: user.latitude, longitude: user.longitude, timezone: user.timezone }}
            onBack={() => setActiveTab('explore')}
            onOpenPanchangCalendar={handleOpenPanchang}
            onViewFullPanchang={handleViewFullPanchang}
            onPlanLogged={loadUserDataAndLogs}
            onOpenBirthProfile={() => setActiveTab('chart')}
            onOpenPeople={() => { setPeopleReturnTo('you'); setActiveTab('people'); }}
            initialActivityId={muhurthamActivityJump?.activityId}
            initialActivityIdKey={muhurthamActivityJump?.key}
          />
        )}

        {activeTab === 'updates' && (
          <UpdatesView
            updates={auraUpdates?.updates ?? []}
            upcoming={auraUpdates?.upcoming ?? []}
            onBack={() => setActiveTab('home')}
            onViewMomentUpdate={handleViewMomentUpdate}
            onFindAnotherTimeForMoment={handleFindAnotherTimeForMoment}
            onOpenReminder={handleOpenReminder}
          />
        )}
      </div>

      {/* Navigation Dock */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          padding: '4px 8px calc(env(safe-area-inset-bottom, 0px) + 4px)',
          zIndex: 9999,
        }}
      >
        <NavButton label="Home" icon="🏠" active={activeTab === 'home' || (activeTab === 'people' && peopleReturnTo === 'home')} onClick={() => setActiveTab('home')} />
        <NavButton label="Plan" icon="✨" active={activeTab === 'plan' || (activeTab === 'people' && peopleReturnTo === 'plan')} onClick={() => setActiveTab('plan')} />
        <NavButton label="Explore" icon="🧭" active={activeTab === 'explore' || activeTab === 'panchang' || activeTab === 'muhurtham'} onClick={() => setActiveTab('explore')} />
        <NavButton label="Ask Aura" icon="🤖" active={activeTab === 'ask'} onClick={() => setActiveTab('ask')} />
        <NavButton label="Insights" icon="📊" active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} />
        <NavButton label="You" icon="👤" active={activeTab === 'you' || activeTab === 'chart' || activeTab === 'activity' || (activeTab === 'people' && peopleReturnTo === 'you')} onClick={() => setActiveTab('you')} />
      </nav>
    </main>
  );
}

const NavButton = React.memo(function NavButton({ label, icon, active, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: active ? 'var(--as-abhijit, #4ade80)' : 'var(--as-text-muted, #94a3b8)',
        fontSize: 10,
        fontFamily: 'var(--as-font-mono, monospace)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
    </button>
  );
});
