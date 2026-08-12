'use client';

import React, { useState, useMemo } from 'react';
import { PastActivityModal } from './PastActivityModal';

export interface LoggedEntryItem {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
  logMinuteOfDay?: number;
  notes?: string | null;
}

interface CalendarViewSectionProps {
  logEntries?: LoggedEntryItem[];
  userLocation?: { latitude: number; longitude: number; timezone: string };
  onLogActivity?: (activityTitle: string, notes?: string, customTimestamp?: Date) => Promise<void>;
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
  const { activeDays, dailyLogs, monthTotalLogs } = useMemo(() => {
    const daysSet = new Set<number>();
    const logsMap: Record<number, LoggedEntryItem[]> = {};
    let total = 0;

    logEntries.forEach((entry) => {
      const d = new Date(entry.loggedAt);
      if (isNaN(d.getTime())) return;

      if (d.getFullYear() === displayYear && d.getMonth() === displayMonth) {
        const dayNum = d.getDate();
        daysSet.add(dayNum);

        if (!logsMap[dayNum]) logsMap[dayNum] = [];
        logsMap[dayNum].push(entry);
        total++;
      }
    });

    return { activeDays: daysSet, dailyLogs: logsMap, monthTotalLogs: total };
  }, [logEntries, displayYear, displayMonth]);

  // Check if selected day is in the future relative to today
  const isFutureDaySelected = useMemo(() => {
    const targetDate = new Date(displayYear, displayMonth, selectedDay);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return targetDate > startOfToday;
  }, [displayYear, displayMonth, selectedDay, today]);

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
          Track your daily window utilization and logged habits
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
            📊 {monthTotalLogs} Total Logs
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
                    ? 'rgba(74, 222, 128, 0.18)'
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
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--as-text, #fff)', fontFamily: 'sans-serif' }}>
              {monthName} {selectedDay}, {displayYear}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--as-abhijit, #4ade80)', marginLeft: 8 }}>
              ({dailyLogs[selectedDay]?.length || 0} logged)
            </span>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dailyLogs[selectedDay] && dailyLogs[selectedDay].length > 0 ? (
            dailyLogs[selectedDay].map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  fontSize: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(30, 41, 59, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--as-abhijit, #4ade80)', fontWeight: 700, fontSize: 13 }}>✓</span>
                    <span style={{ color: 'var(--as-text, #f8fafc)', fontWeight: 600, fontFamily: 'sans-serif', fontSize: 13 }}>
                      {log.activityTitle}
                    </span>
                  </div>
                  <span style={{ color: 'var(--as-text-muted, #94a3b8)', fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {log.activeWindow ? log.activeWindow.replace('_', ' ') : 'NEUTRAL'}
                  </span>
                </div>

                {log.notes && (
                  <p
                    style={{
                      margin: '2px 0 0 23px',
                      fontSize: 11,
                      color: 'var(--as-text-muted, #94a3b8)',
                      fontStyle: 'italic',
                      lineHeight: 1.4,
                      fontFamily: 'sans-serif',
                    }}
                  >
                    "{log.notes}"
                  </p>
                )}
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
          userLocation={userLocation}
          onClose={() => setIsLogModalOpen(false)}
          onConfirmLog={onLogActivity}
          onSuccess={() => setIsLogModalOpen(false)}
        />
      )}
    </div>
  );
}
