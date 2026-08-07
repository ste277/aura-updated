'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeSolarEphemeris } from '../../../packages/astronomy/src/ephemeris';
import {
  computePanchangWindows,
  getActiveWindow,
  SolarWindowType,
  WeekdayIndex,
} from '../../../packages/panchang/src/windows';
import { getActionCards, ActionCard } from '../../../packages/recommendation/src/actionCards';
import { Dial } from '../components/Dial';
import { DayTimeline } from '../components/DayTimeline';
import { ActionCards } from '../components/ActionCards';
import { HabitLogEntry } from '../components/HabitLog';
import { HabitsSection, HabitData } from '../components/HabitsSection';
import { CalendarView } from '../components/CalendarView';
import { TodayOverview } from '../components/TodayOverview';
import { BirthChartSection } from '../components/BirthChartSection';
import { LoginScreen } from '../components/LoginScreen';
import { LocationPicker } from '../components/LocationPicker';
import { useCurrentMinuteOfDay } from '../lib/useCurrentMinuteOfDay';
import { useCurrentSecondOfDay } from '../lib/useCurrentSecondOfDay';
import { resolveTzOffsetMinutes } from '../lib/timezone';

interface SessionUser {
  id: string;
  email: string;
  cityName: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

const FALLBACK_TZ = 'Asia/Kolkata';

export default function DashboardPage() {
  const [selectedType, setSelectedType] = useState<SolarWindowType | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [logEntries, setLogEntries] = useState<HabitLogEntry[]>([]);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [todayLoggedHabitIds, setTodayLoggedHabitIds] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'dial' | 'recommendations' | 'habits' | 'chart'>('dial');

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentMinuteOfDay = useCurrentMinuteOfDay(user?.timezone ?? FALLBACK_TZ);
  const currentSecondOfDay = useCurrentSecondOfDay(user?.timezone ?? FALLBACK_TZ);

  async function checkSession() {
    const res = await fetch('/api/auth/session');
    const data = await res.json();
    setUser(data.user);

    if (data.user) {
      const [logsRes, habitsRes] = await Promise.all([fetch('/api/habit-logs'), fetch('/api/habits')]);

      if (logsRes.ok) {
        const logs = await logsRes.json();
        setLogEntries(
          logs.map((l: { id: string; activityTitle: string; activeWindow: string; logTimestamp: string }) => ({
            id: l.id,
            activityTitle: l.activityTitle,
            activeWindow: l.activeWindow,
            loggedAt: new Date(l.logTimestamp),
          }))
        );
      }

      if (habitsRes.ok) {
        const habitsData = await habitsRes.json();
        setHabits(habitsData);
      }
    }
  }

  useEffect(() => {
    checkSession();
  }, []);

  const solar = useMemo(() => {
    if (!user || !mounted) return null;
    const now = new Date();
    const tzOffsetMinutes = resolveTzOffsetMinutes(user.timezone, now);
    return computeSolarEphemeris({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      latitude: user.latitude,
      longitude: user.longitude,
      tzOffsetMinutes,
    });
  }, [user?.latitude, user?.longitude, user?.timezone, mounted]);

  const weekday = (mounted ? new Date().getDay() : 0) as WeekdayIndex;
  const windows = useMemo(() => (solar ? computePanchangWindows(solar, weekday) : []), [solar, weekday]);
  const activeType = solar ? getActiveWindow(windows, currentMinuteOfDay) : 'NEUTRAL';
  const displayedType = selectedType ?? activeType;
  const cards = getActionCards(displayedType);

  function handleSelectWindow(type: SolarWindowType | null) {
    setSelectedType(type);
    if (type !== null) {
      setIsModalOpen(true);
    }
  }

  async function handleLog(card: ActionCard) {
    setLoggedIds((prev) => new Set(prev).add(card.id));
    const res = await fetch('/api/habit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activityTitle: card.title,
        activeWindow: displayedType,
        logMinuteOfDay: currentMinuteOfDay,
      }),
    });
    if (!res.ok) return;
    const saved = await res.json();
    setLogEntries((prev) => [
      { id: saved.id, activityTitle: saved.activityTitle, activeWindow: saved.activeWindow, loggedAt: new Date(saved.logTimestamp) },
      ...prev,
    ]);
  }

  async function handleCreateHabit(input: { title: string; category: string; targetWindowType: string }) {
    const res = await fetch('/api/habits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (res.ok) {
      const habit = await res.json();
      setHabits((prev) => [...prev, habit]);
    }
  }

  async function handleLogHabit(habitId: string) {
    setTodayLoggedHabitIds((prev) => new Set(prev).add(habitId));
    const res = await fetch(`/api/habits/${habitId}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeWindow: displayedType, logMinuteOfDay: currentMinuteOfDay }),
    });
    if (res.ok) {
      const updated = await res.json();
      setHabits((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    }
  }

  async function handleArchiveHabit(habitId: string) {
    setHabits((prev) => prev.filter((h) => h.id !== habitId));
    await fetch(`/api/habits/${habitId}`, { method: 'DELETE' });
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }

  function handleLocationChanged(city: { cityName: string; latitude: number; longitude: number; timezone: string }) {
    setUser((prev) => (prev ? { ...prev, ...city } : prev));
    setSelectedType(null);
  }

  if (user === undefined) {
    return (
      <main style={{ minHeight: '100vh', background: 'var(--as-bg)', color: 'var(--as-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        Loading...
      </main>
    );
  }

  if (user === null) {
    return <LoginScreen onLoggedInCheck={checkSession} />;
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--as-bg)',
        color: 'var(--as-text)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 'calc(env(safe-area-inset-top, 16px) + 12px) 16px 90px',
        boxSizing: 'border-box',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--as-font-mono)', fontSize: 11, color: 'var(--as-text-muted)', opacity: 0.8 }}>
            {user.email.split('@')[0]}
          </span>
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

      <h1 style={{ fontFamily: 'var(--as-font-display)', fontSize: 20, fontWeight: 500, margin: '0 0 16px', letterSpacing: '-0.01em' }}>
        AuraSchedule
      </h1>

      <div style={{ width: '100%', maxWidth: 420 }}>
        {activeTab === 'dial' && (
          <>
            {solar && (
              <section style={{ width: '100%', maxWidth: 360, margin: '0 auto 16px' }}>
                <Dial
                  windows={windows}
                  currentMinuteOfDay={currentMinuteOfDay}
                  currentSecondOfDay={currentSecondOfDay}
                  selectedType={selectedType}
                  activeType={activeType}
                  onSelectWindow={handleSelectWindow}
                />
              </section>
            )}

            {solar && (
              <DayTimeline
                windows={windows}
                sunriseMinutes={solar.sunriseMinutes}
                sunsetMinutes={solar.sunsetMinutes}
                currentMinuteOfDay={currentMinuteOfDay}
                selectedType={selectedType}
                activeType={activeType}
                onSelectWindow={handleSelectWindow}
              />
            )}

            <TodayOverview />
          </>
        )}

        {activeTab === 'recommendations' && (
          <ActionCards cards={cards} onLog={handleLog} loggedIds={loggedIds} />
        )}

        {activeTab === 'habits' && (
          <>
            <HabitsSection
              habits={habits}
              onCreate={handleCreateHabit}
              onLog={handleLogHabit}
              onArchive={handleArchiveHabit}
              todayLoggedHabitIds={todayLoggedHabitIds}
            />
            <CalendarView />
          </>
        )}

        {activeTab === 'chart' && <BirthChartSection />}
      </div>

      {/* Pop-up Recommendation Modal */}
      {isModalOpen && (
        <div
          onClick={() => setIsModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              maxHeight: '80vh',
              overflowY: 'auto',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '20px 20px 16px 16px',
              padding: '20px 16px',
              boxShadow: '0 -10px 30px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontFamily: 'var(--as-font-mono)', color: '#94a3b8', textTransform: 'uppercase' }}>
                Recommendations for {displayedType.replace('_', ' ')}
              </span>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 28,
                  height: 28,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            <ActionCards cards={cards} onLog={handleLog} loggedIds={loggedIds} />
          </div>
        </div>
      )}

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
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center',
          padding: '4px 8px calc(env(safe-area-inset-bottom, 0px) + 4px)',
          zIndex: 9999,
        }}
      >
        <button
          onClick={() => {
            setActiveTab('dial');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            flex: 1,
            height: '100%',
            background: 'none',
            border: 'none',
            color: activeTab === 'dial' ? 'var(--as-text, #ffffff)' : 'var(--as-text-muted, #94a3b8)',
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
          <span style={{ fontSize: 16 }}>⏱️</span>
          <span style={{ fontWeight: activeTab === 'dial' ? 600 : 400 }}>Dial & Timeline</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('recommendations');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            flex: 1,
            height: '100%',
            background: 'none',
            border: 'none',
            color: activeTab === 'recommendations' ? 'var(--as-text, #ffffff)' : 'var(--as-text-muted, #94a3b8)',
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
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontWeight: activeTab === 'recommendations' ? 600 : 400 }}>Recommended</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('habits');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            flex: 1,
            height: '100%',
            background: 'none',
            border: 'none',
            color: activeTab === 'habits' ? 'var(--as-text, #ffffff)' : 'var(--as-text-muted, #94a3b8)',
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
          <span style={{ fontSize: 16 }}>📅</span>
          <span style={{ fontWeight: activeTab === 'habits' ? 600 : 400 }}>Habits & Calendar</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('chart');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          style={{
            flex: 1,
            height: '100%',
            background: 'none',
            border: 'none',
            color: activeTab === 'chart' ? 'var(--as-text, #ffffff)' : 'var(--as-text-muted, #94a3b8)',
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
          <span style={{ fontSize: 16 }}>✨</span>
          <span style={{ fontWeight: activeTab === 'chart' ? 600 : 400 }}>Birth Chart</span>
        </button>
      </nav>
    </main>
  );
}