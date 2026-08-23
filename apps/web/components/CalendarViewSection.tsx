'use client';

import React, { useState, useMemo } from 'react';
import { PastActivityModal } from './PastActivityModal';
import { formatActivityDuration } from '../lib/activityDuration';

export interface LoggedEntryItem {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
  logMinuteOfDay?: number;
  durationMinutes?: number;
  notes?: string | null;
  logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
  activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH';
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

function getLogSourceLabel(source?: LoggedEntryItem['logSource']): { label: string; color: string; background: string; border: string } {
  switch (source) {
    case 'AURA_PLANNED':
      return { label: 'Aura plan', color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', border: 'rgba(74, 222, 128, 0.28)' };
    case 'AURA_DO_NOW':
      return { label: 'Do now', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.1)', border: 'rgba(56, 189, 248, 0.28)' };
    case 'OVERRIDE_CAUTION':
      return { label: 'Override', color: '#fb7185', background: 'rgba(251, 113, 133, 0.1)', border: 'rgba(251, 113, 133, 0.3)' };
    case 'MANUAL':
    default:
      return { label: 'Manual', color: '#cbd5e1', background: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.22)' };
  }
}

function getSignificanceLabel(significance?: LoggedEntryItem['activitySignificance']): { label: string; color: string; background: string; border: string } {
  switch (significance) {
    case 'HIGH':
      return { label: 'High impact', color: '#facc15', background: 'rgba(250, 204, 21, 0.1)', border: 'rgba(250, 204, 21, 0.3)' };
    case 'LOW':
      return { label: 'Light', color: '#a78bfa', background: 'rgba(167, 139, 250, 0.1)', border: 'rgba(167, 139, 250, 0.28)' };
    case 'MEDIUM':
    default:
      return { label: 'Medium', color: '#93c5fd', background: 'rgba(147, 197, 253, 0.1)', border: 'rgba(147, 197, 253, 0.25)' };
  }
}

interface CalendarViewSectionProps {
  logEntries?: LoggedEntryItem[];
  userLocation?: { latitude: number; longitude: number; timezone: string };
  onLogActivity?: (
    activityTitle: string,
    notes?: string,
    customTimestamp?: Date,
    overrideWindowType?: string,
    durationMinutes?: number,
    logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION',
    activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH'
  ) => Promise<void>;
  onBack?: () => void;
}

export function CalendarViewSection({
  logEntries = [],
  userLocation,
  onLogActivity,
  onBack,
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
  const isTodaySelected = isCurrentMonthView && selectedDay === today.getDate();
  const canGoNextMonth =
    displayYear < today.getFullYear() ||
    (displayYear === today.getFullYear() && displayMonth < today.getMonth());

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
    if (!canGoNextMonth) return;
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setSelectedDay(1);
  };

  const handleGoToToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(today.getDate());
  };

  // Group logged entries for the active month view
  const { activeDays, auraGuidedDays, highImpactDays, dailyLogs, activityCounts, monthTotalLogs, monthAuraGuidedLogs, monthHighImpactLogs } = useMemo(() => {
    const daysSet = new Set<number>();
    const auraGuidedDaysSet = new Set<number>();
    const highImpactDaysSet = new Set<number>();
    const logsMap: Record<number, LoggedEntryItem[]> = {};
    const countsMap: Record<number, number> = {};
    let total = 0;
    let auraGuided = 0;
    let highImpact = 0;

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
        if (entry.logSource === 'AURA_PLANNED' || entry.logSource === 'AURA_DO_NOW') {
          auraGuided++;
          auraGuidedDaysSet.add(dayNum);
        }
        if (entry.activitySignificance === 'HIGH') {
          highImpact++;
          highImpactDaysSet.add(dayNum);
        }
      }
    });

    Object.values(logsMap).forEach((logs) => {
      logs.sort((a, b) => new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime());
    });

    return { activeDays: daysSet, auraGuidedDays: auraGuidedDaysSet, highImpactDays: highImpactDaysSet, dailyLogs: logsMap, activityCounts: countsMap, monthTotalLogs: total, monthAuraGuidedLogs: auraGuided, monthHighImpactLogs: highImpact };
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
  const selectedAuraGuidedLogs = selectedLogs.filter((log) => log.logSource === 'AURA_PLANNED' || log.logSource === 'AURA_DO_NOW').length;
  const selectedAuraGuidedPercent =
    selectedLogs.length > 0 ? Math.round((selectedAuraGuidedLogs / selectedLogs.length) * 100) : null;
  const selectedHighImpactLogs = selectedLogs.filter((log) => log.activitySignificance === 'HIGH').length;
  const recentActivities = useMemo(() => [...new Set(logEntries.map((log) => log.activityTitle).filter(Boolean))].slice(0, 4), [logEntries]);
  const monthAuraGuidedPercent =
    monthTotalLogs > 0 ? Math.round((monthAuraGuidedLogs / monthTotalLogs) * 100) : null;

  // Date object for PastActivityModal
  const selectedDateObj = new Date(displayYear, displayMonth, selectedDay, 12, 0, 0);
  const selectedDateLabel = selectedDateObj.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to You"
            style={{ minHeight: 34, borderRadius: 17, border: '1px solid rgba(148, 163, 184, 0.22)', background: 'rgba(15, 23, 42, 0.75)', color: '#f8fafc', fontSize: 12, cursor: 'pointer', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', fontWeight: 800 }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
            You
          </button>
        )}
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--as-text, #f8fafc)', margin: 0, fontFamily: 'sans-serif', lineHeight: 1.2 }}>
            Activity Log
          </h1>
          <p style={{ fontSize: 12, color: 'var(--as-text-muted, #94a3b8)', marginTop: 4, fontFamily: 'sans-serif' }}>
            Review logged activities and how they aligned with your recommended windows.
          </p>
        </div>
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
              type="button"
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
              type="button"
              onClick={handleNextMonth}
              disabled={!canGoNextMonth}
              aria-label={canGoNextMonth ? 'Next month' : 'Current month'}
              style={{
                background: canGoNextMonth ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.025)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: canGoNextMonth ? '#fff' : 'rgba(148, 163, 184, 0.45)',
                borderRadius: 8,
                width: 28,
                height: 28,
                cursor: canGoNextMonth ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                opacity: canGoNextMonth ? 1 : 0.55,
              }}
            >
              →
            </button>
          </div>

          <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--as-text-muted, #94a3b8)', fontFamily: 'monospace', lineHeight: 1.35 }}>
            <div>📊 {monthTotalLogs} activities</div>
            <div style={{ color: monthAuraGuidedLogs > 0 ? '#4ade80' : '#64748b' }}>
              ✨ {monthAuraGuidedLogs} Aura-guided{monthAuraGuidedPercent !== null ? ` · ${monthAuraGuidedPercent}%` : ''}
            </div>
            {monthHighImpactLogs > 0 && (
              <div style={{ color: '#facc15' }}>
                ★ {monthHighImpactLogs} high impact
              </div>
            )}
          </div>
        </div>

        {!isTodaySelected && (
          <button
            type="button"
            onClick={handleGoToToday}
            style={{
              minHeight: 30,
              width: '100%',
              border: '1px solid rgba(74, 222, 128, 0.22)',
              borderRadius: 10,
              background: 'rgba(74, 222, 128, 0.08)',
              color: '#4ade80',
              fontSize: 12,
              fontWeight: 800,
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            Jump to today
          </button>
        )}

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
            const hasAuraGuided = auraGuidedDays.has(day);
            const hasHighImpact = highImpactDays.has(day);
            const activityCount = activityCounts[day] ?? 0;
            const isSelected = selectedDay === day;
            const isFutureDay = isCurrentMonthView ? day > todayDateNum : displayYear > today.getFullYear() || (displayYear === today.getFullYear() && displayMonth > today.getMonth());
            const dayLabelParts = [
              new Date(displayYear, displayMonth, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
              activityCount === 1 ? '1 activity' : `${activityCount} activities`,
              hasAuraGuided ? 'Aura-guided activity' : null,
              hasHighImpact ? 'High-impact activity' : null,
              isFutureDay ? 'future date' : null,
            ].filter(Boolean);

            return (
              <button
                type="button"
                key={day}
                disabled={isFutureDay}
                aria-label={dayLabelParts.join(', ')}
                aria-pressed={isSelected}
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
                  position: 'relative',
                  opacity: isFutureDay ? 0.35 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {day}
                {hasHighImpact && !isFutureDay && (
                  <span aria-hidden="true" style={{ position: 'absolute', right: 4, top: 3, color: isSelected ? '#854d0e' : '#facc15', fontSize: 8, lineHeight: 1 }}>
                    ★
                  </span>
                )}
                {hasAuraGuided && !isFutureDay && (
                  <span aria-hidden="true" style={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 999, background: isSelected ? '#064e3b' : '#4ade80' }} />
                )}
              </button>
            );
          })}
        </div>

        {(monthAuraGuidedLogs > 0 || monthHighImpactLogs > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10, color: '#94a3b8', fontSize: 10 }}>
            {monthAuraGuidedLogs > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: '#4ade80' }} />
                Aura-guided
              </span>
            )}
            {monthHighImpactLogs > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span aria-hidden="true" style={{ color: '#facc15', fontSize: 9, lineHeight: 1 }}>★</span>
                High impact
              </span>
            )}
          </div>
        )}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--as-text, #fff)' }}>
                {selectedDateLabel}
              </span>
              {isTodaySelected && (
                <span style={{ border: '1px solid rgba(74, 222, 128, 0.35)', borderRadius: 999, color: '#4ade80', background: 'rgba(74, 222, 128, 0.1)', padding: '2px 7px', fontSize: 10, fontWeight: 850 }}>
                  Today
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#b6c2d1', marginTop: 4 }}>
              {selectedLogs.length} {selectedLogs.length === 1 ? 'activity' : 'activities'} · {formatActiveDuration(selectedActiveMinutes)} active
              {selectedLogs.length > 0 ? ` · ${selectedAuraGuidedLogs} Aura-guided${selectedAuraGuidedPercent !== null ? ` (${selectedAuraGuidedPercent}%)` : ''}` : ''}
              {selectedHighImpactLogs > 0 ? ` · ${selectedHighImpactLogs} high impact` : ''}
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
                  {groupedSelectedLogs[category].map((log) => {
                    const sourceLabel = getLogSourceLabel(log.logSource);
                    const significanceLabel = getSignificanceLabel(log.activitySignificance);
                    return (
                    <div key={log.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 10px', borderRadius: 10, background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ color: '#4ade80', fontWeight: 800 }}>✓</span>
                          <span style={{ color: '#f8fafc', fontWeight: 650, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.activityTitle}</span>
                          <span style={{ border: `1px solid ${sourceLabel.border}`, borderRadius: 999, background: sourceLabel.background, color: sourceLabel.color, padding: '1px 6px', fontSize: 9, fontWeight: 850, flexShrink: 0 }}>
                            {sourceLabel.label}
                          </span>
                          <span style={{ border: `1px solid ${significanceLabel.border}`, borderRadius: 999, background: significanceLabel.background, color: significanceLabel.color, padding: '1px 6px', fontSize: 9, fontWeight: 850, flexShrink: 0 }}>
                            {significanceLabel.label}
                          </span>
                        </div>
                        <div style={{ color: '#b6c2d1', fontSize: 10, marginTop: 4, marginLeft: 19 }}>
                          {new Date(log.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {formatActivityDuration({ durationMinutes: log.durationMinutes ?? 30 })} · {log.activeWindow ? log.activeWindow.replace(/_/g, ' ') : 'NEUTRAL'}
                        </div>
                        {log.notes?.trim() && (
                          <div style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.4, marginTop: 5, marginLeft: 19 }}>
                            {log.notes.trim()}
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })}
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
