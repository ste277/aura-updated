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
import type { DailyBriefing, PlanningHorizon, TaskSlotRecommendation, TimePreference } from '../../../packages/recommendation/src/dailyAssistant';

// UI Modules
import { HomeDashboard } from '../components/HomeDashboard';
import { TimelineView } from '../components/Timeline';
import { AskAuraView } from '../components/AskAuraView';
import { LoggedEntryItem } from '../components/CalendarViewSection';
import { InsightsView } from '../components/InsightsView';
import { WindowShiftToast } from '../components/WindowShiftToast';
import { PlanWithAuraView } from '../components/PlanWithAuraView';
import { YouView } from '../components/YouView';

import { BirthChartSection } from '../components/BirthChartSection';
import { LoginScreen } from '../components/LoginScreen';
import { LocationPicker } from '../components/LocationPicker';
import { useCurrentMinuteOfDay } from '../lib/useCurrentMinuteOfDay';
import { resolveTzOffsetMinutes, getDatePartsInTimezone } from '../lib/timezone';
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
}

interface DailyReflectionState {
  outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW';
  followedGuidance: boolean;
}

const FALLBACK_TZ = 'Asia/Kolkata';

function formatDisplayName(email: string): string {
  const localPart = email.split('@')[0] || 'there';
  const withoutDigits = localPart.replace(/[0-9]+/g, '');
  const words = withoutDigits.split(/[._-]+/).filter(Boolean);
  const name = words.join(' ').trim() || localPart;
  return name.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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
  const [assistantInsight, setAssistantInsight] = useState<any>(null);
  const [todayReflection, setTodayReflection] = useState<DailyReflectionState | null>(null);
  const [mounted, setMounted] = useState(false);

  const [activeTab, setActiveTab] = useState<'home' | 'timeline' | 'ask' | 'plan' | 'insights' | 'you' | 'chart'>('home');

  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);

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
        return;
      }

      setUser(sessionData.user);

      const [logsRes, habitsRes] = await Promise.all([
        fetch('/api/habit-logs'),
        fetch('/api/habits'),
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
    } catch {
      setUser(null);
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

      if (briefingRes.ok) setDailyBriefing(await briefingRes.json());
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
      };
    }

    const { windowName, startsIn, startTime } = energyInsight.nextShift;

    const validStartsIn = startsIn && !startsIn.includes('NaN') ? startsIn : 'In 45m';
    const validStartTime = startTime && !startTime.includes('NaN') ? startTime : '11:40 AM';

    return {
      windowName: windowName ? String(windowName).replace('_', ' ') : 'Next Shift',
      startsIn: validStartsIn,
      startTime: validStartTime,
    };
  }, [energyInsight]);

  // Current window timing calculations for TimelineView Banner
  const currentWindowInfo = useMemo(() => {
    const activeTypeClean = activeType ? String(activeType).replace('_', ' ').toUpperCase() : 'NEUTRAL';

    const currentWin = windows.find((w: any) => {
      const rawType = String(w.type || w.windowType || w.name || '').replace('_', ' ').toUpperCase();
      return rawType === activeTypeClean;
    });

    const parseMinute = (val: any) => {
      if (typeof val === 'number' && !isNaN(val)) return val;
      if (typeof val === 'string' && val.includes(':')) {
        const [h, m] = val.split(':').map(Number);
        if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
      }
      return null;
    };

    const startMin = currentWin ? parseMinute(currentWin.startMinutes ?? currentWin.startMinute) : null;
    let endMin = currentWin ? parseMinute(currentWin.endMinutes ?? currentWin.endMinute) : null;

    if (endMin === null) {
      endMin = 1440; // Default midnight fallback
    }

    const formatMinute = (minute: number) => {
      const totalMins = Math.floor(minute) % 1440;
      const hrs = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      const period = hrs >= 12 ? 'PM' : 'AM';
      const formattedHr = hrs % 12 === 0 ? 12 : hrs % 12;
      return `${formattedHr}:${String(mins).padStart(2, '0')} ${period}`;
    };

    const endTimeStr = formatMinute(endMin);

    let diff = endMin - currentMinuteOfDay;
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

  const handleSlotTask = useCallback(async (taskTitle: string, durationMinutes: number, horizon: PlanningHorizon = 'TODAY', customStartDate?: string, customEndDate?: string, timePreference: TimePreference = 'ANYTIME'): Promise<TaskSlotRecommendation> => {
    const res = await fetch('/api/daily-assistant/slot-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskTitle, durationMinutes, horizon, customStartDate, customEndDate, timePreference }),
    });
    if (!res.ok) throw new Error('Unable to slot task.');
    return res.json();
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
            maxWidth: 420,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            padding: '0 4px',
          }}
        >
          <LocationPicker currentCity={user.cityName} onChanged={handleLocationChanged} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setActiveTab('home')}
              style={{
                fontSize: 11,
                color: '#4ade80',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid #4ade80',
                borderRadius: 14,
                padding: '6px 10px',
                cursor: 'pointer',
                minHeight: 32,
              }}
            >
              Home
            </button>
            <button
              onClick={handleLogout}
              style={{
                fontSize: 11,
                color: 'var(--as-text-muted)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: '6px 12px',
                cursor: 'pointer',
                minHeight: 32,
              }}
            >
              sign out
            </button>
          </div>
        </header>
      )}

      <div style={{ width: '100%', maxWidth: 420 }}>
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
            loggedActivitiesToday={loggedActivitiesToday}
            dailyBriefing={dailyBriefing}
            todayReflection={todayReflection}
            onLogActivity={handleLogActivity}
            onSubmitReflection={handleSubmitReflection}
            onNextShiftClick={() => setActiveTab('timeline')}
            onPlanClick={() => setActiveTab('plan')}
            onInsightsClick={() => setActiveTab('insights')}
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
            onAskAuraClick={() => setActiveTab('ask')}
          />
        )}

        {activeTab === 'ask' && (
          <AskAuraView
            userName={userNameDisplay}
            activeWindow={activeType}
            cityName={user.cityName}
          />
        )}

        {activeTab === 'plan' && (
          <PlanWithAuraView
            onSlotTask={handleSlotTask}
            onViewDay={() => setActiveTab('timeline')}
            onPlanLogged={loadUserDataAndLogs}
            timezone={user.timezone}
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
            onOpenChart={() => setActiveTab('chart')}
            onSignOut={handleLogout}
          />
        )}

        {activeTab === 'chart' && <BirthChartSection />}
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
          gridTemplateColumns: 'repeat(5, 1fr)',
          padding: '4px 8px calc(env(safe-area-inset-bottom, 0px) + 4px)',
          zIndex: 9999,
        }}
      >
        <NavButton label="Home" icon="🏠" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
        <NavButton label="Plan" icon="✨" active={activeTab === 'plan'} onClick={() => setActiveTab('plan')} />
        <NavButton label="Ask Aura" icon="🤖" active={activeTab === 'ask'} onClick={() => setActiveTab('ask')} />
        <NavButton label="Insights" icon="📊" active={activeTab === 'insights'} onClick={() => setActiveTab('insights')} />
        <NavButton label="You" icon="👤" active={activeTab === 'you'} onClick={() => setActiveTab('you')} />
      </nav>
    </main>
  );
}

const NavButton = React.memo(function NavButton({ label, icon, active, onClick }: any) {
  return (
    <button
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
