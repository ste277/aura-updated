'use client';

import React, { useState, useMemo } from 'react';
import { PastActivityModal } from './PastActivityModal';

export interface LoggedEntryItem {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
  logMinuteOfDay?: number;
  durationMinutes?: number;
  notes?: string | null;
}

function activityCategory(title: string): 'WORK' | 'HEALTH' | 'PERSONAL' {
  const value = title.toLowerCase();
  if (/(work|code|writing|meeting|call|project|decision|docs|research|email|admin|study|planning|review|sprint|backlog|execution|architecture|optimization|pitch|proposal|client|task)/.test(value)) return 'WORK';
  if (/(workout|exercise|stretch|walk|run|health|hydration|rest|meditat|sleep|yoga|fitness)/.test(value)) return 'HEALTH';
  return 'PERSONAL';
}

function formatActiveDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

interface CalendarViewSectionProps {
  logEntries?: LoggedEntryItem[];
  userLocation?: { latitude: number; longitude: number; timezone: string };
  onLogActivity?: (activityTitle: string, notes?: string, customTimestamp?: Date, overrideWindowType?: string, durationMinutes?: number) => Promise<void>;
}

export function CalendarViewSection({
  logEntries = [],
  userLocation,
  onLogActivity,
}: CalendarViewSectionProps) {
  const today = useMemo(() => new Date(), []);
  
  // Dynamic Month & Year Navigation State
  const [currentDate, setCurrentDate] = useState<Date>(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  
  const [selectedDay, setSelectedDay] = useState<number>(today.getDate());
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);

  const displayYear = currentDate.getFullYear();
  const displayMonth = currentDate.getMonth();

  const isCurrentMonthView =
    displayYear === today.getFullYear() && displayMonth === today.getMonth();

  const todayDateNum = today.getDate();

  // Calculate days in the displayed month
  const totalDaysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
  const daysInMonth = Array.from({ length: totalDaysInMonth }, (_, i) => i + 1);

  const firstDayOfWeek = new Date(displayYear, displayMonth, 1).getDay();
  const paddingSlots = Array.from({ length: firstDayOfWeek });

  const monthName = currentDate.toLocaleString('en-US', { month: 'long' });

  // Navigation Handlers
  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setSelectedDay(1);
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedDay(1);
  };

  // Group logged entries for the active month view
  const { activeDays, dailyLogs, activityCounts, monthTotalLogs } = useMemo(() => {
    const daysSet = new Set<number>();
    const logsMap: Record<number, LoggedEntryItem[]> = {};
    const countsMap: Record<number, number> = {};
    let total = 0;

    logEntries.forEach((entry) => {
      const d = new Date(entry.loggedAt);
      if (isNaN(d.getTime())) return;

      if (d.getFullYear() === displayYear && d.getMonth() === displayMonth) {
        const dayNum = d.getDate();
        daysSet.add(dayNum);
        countsMap[dayNum] = (countsMap[dayNum] ?? 0) + 1;

        if (!logsMap[dayNum]) logsMap[dayNum] = [];
        logsMap[dayNum].push(entry);
        total++;
      }
    });

    return { activeDays: daysSet, dailyLogs: logsMap, activityCounts: countsMap, monthTotalLogs: total };
  }, [logEntries, displayYear, displayMonth]);

  // Check if selected day is in the future relative to today
  const isFutureDaySelected = useMemo(() => {
    const targetDate = new Date(displayYear, displayMonth, selectedDay);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return targetDate > startOfToday;
  }, [displayYear, displayMonth, selectedDay, today]);

  const selectedLogs = dailyLogs[selectedDay] ?? [];
  const groupedSelectedLogs = useMemo(() => {
    const groups: Record<'WORK' | 'HEALTH' | 'PERSONAL', LoggedEntryItem[]> = { WORK: [], HEALTH: [], PERSONAL: [] };
    selectedLogs.forEach((log) => groups[activityCategory(log.activityTitle)].push(log));
    return groups;
  }, [selectedLogs]);
  const selectedActiveMinutes = selectedLogs.reduce((total, log) => total + (log.durationMinutes ?? 30), 0);
  const recentActivities = useMemo(() => [...new Set(logEntries.map((log) => log.activityTitle).filter(Boolean))].slice(0, 4), [logEntries]);

  // Date object for PastActivityModal
  const selectedDateObj = new Date(displayYear, displayMonth, selectedDay, 12, 0, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--as-text, #f8fafc)', margin: 0, fontFamily: 'sans-serif', lineHeight: 1.2 }}>
          Activity Calendar
        </h1>
        <p style={{ fontSize: 12, color: 'var(--as-text-muted, #94a3b8)', marginTop: 4, fontFamily: 'sans-serif' }}>
          Track what you actually did and how it aligned with your recommended windows
        </p>
      </div>

      {/* Month Matrix Card */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 18,
        }}
      >
        {/* Month Header & Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handlePrevMonth}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                borderRadius: 8,
                width: 28,
                height: 28,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
              }}
            >
              ←
            </button>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--as-text, #fff)', fontFamily: 'sans-serif' }}>
              {monthName} {displayYear}
            </span>
            <button
              onClick={handleNextMonth}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                borderRadius: 8,
                width: 28,
                height: 28,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
              }}
            >
              →
            </button>
          </div>

          <span style={{ fontSize: 11, color: 'var(--as-text-muted, #94a3b8)', fontFamily: 'monospace' }}>
            📊 {monthTotalLogs} activities
          </span>
        </div>

        {/* Days Header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', fontSize: 11, fontFamily: 'monospace', color: 'var(--as-text-muted, #64748b)', fontWeight: 600, marginBottom: 8 }}>
          <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
        </div>

        {/* Days Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {paddingSlots.map((_, idx) => (
            <div key={`pad-${idx}`} />
          ))}

          {daysInMonth.map((day) => {
            const hasActivity = activeDays.has(day);
            const activityCount = activityCounts[day] ?? 0;
            const isSelected = selectedDay === day;
            const isFutureDay = isCurrentMonthView ? day > todayDateNum : displayYear > today.getFullYear() || (displayYear === today.getFullYear() && displayMonth > today.getMonth());

            return (
              <button
                key={day}
                disabled={isFutureDay}
                onClick={() => setSelectedDay(day)}
                style={{
                  aspectRatio: '1',
                  background: isSelected
                    ? 'var(--as-abhijit, #4ade80)'
                    : hasActivity
                    ? `rgba(74, 222, 128, ${Math.min(0.48, 0.12 + activityCount * 0.04)})`
                    : 'transparent',
                  color: isSelected
                    ? '#020617'
                    : isFutureDay
                    ? 'rgba(255, 255, 255, 0.2)'
                    : hasActivity
                    ? 'var(--as-abhijit, #4ade80)'
                    : 'var(--as-text, #cbd5e1)',
                  border: isSelected
                    ? 'none'
                    : hasActivity
                    ? '1px solid rgba(74, 222, 128, 0.4)'
                    : '1px solid rgba(255, 255, 255, 0.04)',
                  borderRadius: 10,
                  fontSize: 12,
                  fontFamily: 'sans-serif',
                  fontWeight: isSelected || hasActivity ? 700 : 400,
                  cursor: isFutureDay ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: isFutureDay ? 0.35 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Activity Log & Add Action */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--as-text, #fff)' }}>
              {monthName} {selectedDay}
            </div>
            <div style={{ fontSize: 11, color: '#b6c2d1', marginTop: 4 }}>
              {selectedLogs.length} {selectedLogs.length === 1 ? 'activity' : 'activities'} · {formatActiveDuration(selectedActiveMinutes)} active
            </div>
          </div>

          <button
            type="button"
            disabled={isFutureDaySelected}
            onClick={() => setIsLogModalOpen(true)}
            style={{
              fontSize: 11,
              padding: '6px 12px',
              borderRadius: 8,
              background: isFutureDaySelected ? '#334155' : 'var(--as-abhijit, #4ade80)',
              color: isFutureDaySelected ? '#94a3b8' : '#020617',
              border: 'none',
              fontWeight: 700,
              cursor: isFutureDaySelected ? 'not-allowed' : 'pointer',
              opacity: isFutureDaySelected ? 0.5 : 1,
              fontFamily: 'sans-serif',
              transition: 'all 0.15s ease',
            }}
          >
            + Log Activity
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selectedLogs.length > 0 ? (
            (['WORK', 'HEALTH', 'PERSONAL'] as const).map((category) => groupedSelectedLogs[category].length > 0 && (
              <div key={category}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 8 }}>
                  {category} · {groupedSelectedLogs[category].length}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {groupedSelectedLogs[category].map((log) => (
                    <div key={log.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 10px', borderRadius: 10, background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ color: '#4ade80', fontWeight: 800 }}>✓</span>
                          <span style={{ color: '#f8fafc', fontWeight: 650, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.activityTitle}</span>
                        </div>
                        <div style={{ color: '#b6c2d1', fontSize: 10, marginTop: 4, marginLeft: 19 }}>
                          {new Date(log.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {log.durationMinutes ?? 30}m · {log.activeWindow ? log.activeWindow.replace(/_/g, ' ') : 'NEUTRAL'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: 'var(--as-text-muted, #94a3b8)', textAlign: 'center', padding: '16px 0', fontFamily: 'sans-serif' }}>
              {isFutureDaySelected ? 'Cannot log activities for future dates.' : 'No activities logged for this day.'}
            </div>
          )}
        </div>
      </div>

      {/* Past Activity Modal */}
      {isLogModalOpen && !isFutureDaySelected && (
        <PastActivityModal
          isOpen={isLogModalOpen}
          initialDate={selectedDateObj}
          selectedDate={selectedDateObj}
          recentActivities={recentActivities}
          userLocation={userLocation}
          onClose={() => setIsLogModalOpen(false)}
          onConfirmLog={onLogActivity}
          onSuccess={() => setIsLogModalOpen(false)}
        />
      )}
    </div>
  );
}
