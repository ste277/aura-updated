'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanningHorizon, TaskSlotRecommendation, TimePreference } from '../../../packages/recommendation/src/dailyAssistant';
import { triggerHaptic } from '../lib/haptics';

interface TaskSuggestion {
  title: string;
  icon: string;
  keywords: string[];
  accent: string;
}

interface PlanWithAuraViewProps {
  onSlotTask: (
    taskTitle: string,
    durationMinutes: number,
    horizon?: PlanningHorizon,
    customStartDate?: string,
    customEndDate?: string,
    timePreference?: TimePreference
  ) => Promise<TaskSlotRecommendation>;
  onViewDay?: () => void;
  onPlanLogged?: () => void;
  timezone?: string;
}

const TASKS: TaskSuggestion[] = [
  { title: 'Workout', icon: '🏋️', keywords: ['workout', 'exercise', 'gym', 'training', 'fitness'], accent: '#ff5f95' },
  { title: 'Deep work', icon: '🧠', keywords: ['deep work', 'focus', 'coding', 'research', 'writing'], accent: '#38bdf8' },
  { title: 'Study', icon: '📖', keywords: ['study', 'learn', 'course', 'exam', 'reading'], accent: '#4ade80' },
  { title: 'Date night', icon: '💞', keywords: ['date', 'romantic', 'relationship', 'partner'], accent: '#ff5f95' },
  { title: 'Journey', icon: '🚗', keywords: ['journey', 'travel', 'trip', 'flight', 'train'], accent: '#facc15' },
  { title: 'Party', icon: '🎉', keywords: ['party', 'social', 'celebration', 'night out'], accent: '#a78bfa' },
  { title: 'Meditation', icon: '🧘', keywords: ['meditation', 'mindful', 'breath', 'prayer'], accent: '#4ade80' },
  { title: 'Meal', icon: '🍽️', keywords: ['meal', 'dinner', 'lunch', 'breakfast', 'food'], accent: '#fb923c' },
];

const HORIZONS: Array<{ value: PlanningHorizon; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'WEEKEND', label: 'This weekend' },
  { value: 'SEVEN_DAYS', label: 'Next 7 days' },
  { value: 'CUSTOM', label: 'Pick dates' },
];

const DURATIONS = [
  { value: 15, label: '15 min', helper: 'Quick reset' },
  { value: 30, label: '30 min', helper: 'Short block' },
  { value: 60, label: '60 min', helper: 'You can adjust later' },
  { value: 90, label: '90 min', helper: 'Deep session' },
  { value: 120, label: '2h', helper: 'Long block' },
];

const TIME_PREFERENCES: Array<{ value: TimePreference; label: string; icon: string; accent: string }> = [
  { value: 'ANYTIME', label: 'Anytime', icon: '∞', accent: '#a855f7' },
  { value: 'MORNING', label: 'Morning', icon: '☀️', accent: '#facc15' },
  { value: 'AFTERNOON', label: 'Afternoon', icon: '☀', accent: '#fb923c' },
  { value: 'EVENING', label: 'Evening', icon: '🌅', accent: '#ff5f95' },
  { value: 'NIGHT', label: 'Night', icon: '🌙', accent: '#38bdf8' },
];

type PlanIcon = 'workout' | 'focus' | 'heart' | 'study' | 'meditate' | 'meeting' | 'journey';
type UpcomingPlanTemplate = {
  id: string;
  title: string;
  icon: PlanIcon;
  dayOffset: number;
  duration: string;
  time: string;
  window: string;
  match: 'Best Match' | 'Good Match';
  note: string;
  accent: string;
};
type UpcomingPlan = Omit<UpcomingPlanTemplate, 'dayOffset'> & {
  when: string;
  plannedStartAt: string;
  plannedEndAt: string;
  details: string;
  googleCalendarUrl?: string;
  source?: 'Aura' | 'Sample';
  status?: 'UPCOMING' | 'LOGGED';
  loggedAt?: string;
};

const UPCOMING_PLAN_TEMPLATES: UpcomingPlanTemplate[] = [
  { id: 'seed-workout', title: 'Workout', icon: 'workout', dayOffset: 1, duration: '45 min', time: '7:15 AM - 8:00 AM', window: 'Steady Progress (Gulika)', match: 'Best Match', note: 'Strong match', accent: '#ff5f95' },
  { id: 'seed-deep-work', title: 'Deep Work', icon: 'focus', dayOffset: 1, duration: '90 min', time: '10:05 AM - 11:35 AM', window: 'Peak Productivity (Abhijit)', match: 'Best Match', note: 'Excellent match', accent: '#38bdf8' },
  { id: 'seed-date-night', title: 'Date Night', icon: 'heart', dayOffset: 3, duration: '2h', time: '7:00 PM - 9:00 PM', window: 'Neutral Flow', match: 'Good Match', note: 'Good for relationships', accent: '#ff5f95' },
  { id: 'seed-study', title: 'Study Session', icon: 'study', dayOffset: 4, duration: '60 min', time: '9:00 AM - 10:00 AM', window: 'Steady Progress (Gulika)', match: 'Good Match', note: 'Good focus window', accent: '#4ade80' },
  { id: 'seed-meditation', title: 'Meditation', icon: 'meditate', dayOffset: 5, duration: '30 min', time: '5:15 AM - 5:45 AM', window: 'Brahma Muhurta', match: 'Good Match', note: 'Quiet reset', accent: '#a78bfa' },
  { id: 'seed-team-review', title: 'Team Review', icon: 'meeting', dayOffset: 6, duration: '45 min', time: '12:10 PM - 12:55 PM', window: 'Abhijit Muhurtham', match: 'Best Match', note: 'Clear decision window', accent: '#38bdf8' },
  { id: 'seed-travel-prep', title: 'Travel Prep', icon: 'journey', dayOffset: 7, duration: '60 min', time: '8:30 AM - 9:30 AM', window: 'Neutral Flow', match: 'Good Match', note: 'Low-friction planning', accent: '#facc15' },
];

function recommendedPreference(taskTitle: string): TimePreference {
  const title = taskTitle.toLowerCase();
  if (/(date|party|social|romantic|meal|dinner)/.test(title)) return 'EVENING';
  if (/(sleep|wind down|night)/.test(title)) return 'NIGHT';
  if (/(workout|exercise|journey|travel|deep work|study|learn|meditat|meeting)/.test(title)) return 'MORNING';
  return 'ANYTIME';
}

function durationLabel(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  return `${minutes / 60} hours`;
}

function getHorizonHelper(horizon: PlanningHorizon, timezone?: string): string {
  const today = getTodayForTimezone(timezone);
  if (horizon === 'TODAY') return 'Best moments today';
  if (horizon === 'TOMORROW') return `Tomorrow, ${formatShortDate(addDays(today, 1))}`;
  if (horizon === 'WEEKEND') {
    const day = today.getDay();
    const saturdayOffset = (6 - day + 7) % 7 || 7;
    const sundayOffset = saturdayOffset + 1;
    return `${formatShortDate(addDays(today, saturdayOffset))} to ${formatShortDate(addDays(today, sundayOffset))}`;
  }
  if (horizon === 'SEVEN_DAYS') return `Today to ${formatShortDate(addDays(today, 6))}`;
  return 'Choose a date range';
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function getTodayForTimezone(timezone?: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || undefined,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  if (!year || !month || !day) return new Date();
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function buildUpcomingPlans(timezone?: string): UpcomingPlan[] {
  const today = getTodayForTimezone(timezone);
  return UPCOMING_PLAN_TEMPLATES.map(({ dayOffset, ...plan }) => {
    const day = addDays(today, dayOffset);
    const [startTime, endTime] = plan.time.split(' - ');
    return {
      ...plan,
      when: dayOffset === 0 ? 'Today' : dayOffset === 1 ? 'Tomorrow' : formatShortDate(day),
      plannedStartAt: localPlanDateTime(day, startTime).toISOString(),
      plannedEndAt: localPlanDateTime(day, endTime).toISOString(),
      details: `${plan.note}. Aura placed this in ${plan.window} based on your activity, duration, and timing preference.`,
      source: 'Sample',
      status: 'UPCOMING' as const,
    };
  });
}

function planIconForTitle(title: string): PlanIcon {
  const lower = title.toLowerCase();
  if (/workout|exercise|gym|training/.test(lower)) return 'workout';
  if (/date|relationship|romantic/.test(lower)) return 'heart';
  if (/study|learn|course|exam|read/.test(lower)) return 'study';
  if (/meditat|breath|prayer/.test(lower)) return 'meditate';
  if (/meeting|review|call|interview|presentation/.test(lower)) return 'meeting';
  if (/journey|travel|trip|flight|train/.test(lower)) return 'journey';
  return 'focus';
}

function planAccentForTitle(title: string): string {
  const lower = title.toLowerCase();
  if (/date|relationship|romantic|workout|exercise|gym/.test(lower)) return '#ff5f95';
  if (/study|learn|meditat|breath/.test(lower)) return '#4ade80';
  if (/journey|travel|trip/.test(lower)) return '#facc15';
  return '#38bdf8';
}

function minutesFromDuration(duration: string): number {
  const hourMatch = duration.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
  const minuteMatch = duration.match(/(\d+)\s*min/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  return 60;
}

function localPlanDateTime(day: Date, timeLabel: string): Date {
  const match = timeLabel.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return day;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, Number(match[2]), 0, 0));
}

function formatPlanDay(date: Date): string {
  const today = getTodayForTimezone();
  const dateKey = date.toISOString().slice(0, 10);
  const todayKey = today.toISOString().slice(0, 10);
  const tomorrowKey = addDays(today, 1).toISOString().slice(0, 10);
  if (dateKey === todayKey) return 'Today';
  if (dateKey === tomorrowKey) return 'Tomorrow';
  return formatShortDate(date);
}

function formatPlanTimeRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString('en-US', opts)} - ${end.toLocaleTimeString('en-US', opts)}`;
}

function windowTypeFromLabel(label?: string): string {
  if (!label) return 'NEUTRAL';
  if (/abhijit/i.test(label)) return 'ABHIJIT';
  if (/gulika|steady/i.test(label)) return 'GULIKA';
  if (/brahma/i.test(label)) return 'BRAHMA';
  if (/rahu/i.test(label)) return 'RAHU_KALAM';
  if (/yama/i.test(label)) return 'YAMA';
  return 'NEUTRAL';
}

function mapPlanRow(row: any): UpcomingPlan {
  const start = new Date(row.plannedStartAt);
  const end = new Date(row.plannedEndAt);
  const title = row.title || row.activityType || 'Planned activity';
  const status = row.status === 'LOGGED' ? 'LOGGED' : 'UPCOMING';
  return {
    id: row.id,
    title,
    icon: planIconForTitle(row.icon || title),
    when: formatPlanDay(start),
    plannedStartAt: start.toISOString(),
    plannedEndAt: end.toISOString(),
    duration: `${row.durationMinutes ?? 60} min`,
    time: formatPlanTimeRange(start, end),
    window: row.windowLabel || row.windowType || 'Neutral Flow',
    match: row.matchLabel === 'Good Match' ? 'Good Match' : 'Best Match',
    note: status === 'LOGGED' ? 'Logged' : row.matchLabel || 'Good match',
    accent: planAccentForTitle(title),
    details: row.recommendation || 'Aura saved this as one of your planned moments.',
    googleCalendarUrl: row.calendarUrl || undefined,
    source: 'Aura',
    status,
    loggedAt: row.loggedAt ? new Date(row.loggedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : undefined,
  };
}

export function PlanWithAuraView({ onSlotTask, onViewDay, onPlanLogged, timezone }: PlanWithAuraViewProps) {
  const [taskTitle, setTaskTitle] = useState('');
  const [isCustomTask, setIsCustomTask] = useState(false);
  const [horizon, setHorizon] = useState<PlanningHorizon>('TODAY');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [timePreference, setTimePreference] = useState<TimePreference>('AFTERNOON');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [recommendation, setRecommendation] = useState<TaskSlotRecommendation | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAllPlans, setShowAllPlans] = useState(false);
  const [savedPlans, setSavedPlans] = useState<UpcomingPlan[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const plansSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/plans');
        if (!res.ok) throw new Error('Unable to load plans.');
        const rows = await res.json();
        if (cancelled) return;
        setSavedPlans(Array.isArray(rows) && rows.length > 0 ? rows.map(mapPlanRow) : buildUpcomingPlans(timezone));
      } catch {
        if (!cancelled) setSavedPlans(buildUpcomingPlans(timezone));
      }
    };

    loadPlans();
    setExpandedPlanId(null);
    return () => {
      cancelled = true;
    };
  }, [timezone]);

  const filteredTasks = useMemo(() => {
    const query = taskTitle.trim().toLowerCase();
    if (isCustomTask || !query) return TASKS.slice(0, 4);
    return TASKS.filter((task) => task.title.toLowerCase().includes(query) || task.keywords.some((keyword) => keyword.includes(query))).slice(0, 5);
  }, [taskTitle, isCustomTask]);

  const selectedHorizon = HORIZONS.find((item) => item.value === horizon) ?? HORIZONS[0];
  const selectedDuration = DURATIONS.find((item) => item.value === durationMinutes) ?? DURATIONS[2];
  const horizonHelper = useMemo(() => getHorizonHelper(horizon, timezone), [horizon, timezone]);
  const upcomingPlans = useMemo(() => savedPlans.filter((plan) => plan.status !== 'LOGGED'), [savedPlans]);
  const completedPlans = useMemo(() => savedPlans.filter((plan) => plan.status === 'LOGGED'), [savedPlans]);
  const visibleUpcomingPlans = showAllPlans ? upcomingPlans : upcomingPlans.slice(0, 3);
  const visibleCompletedPlans = showAllPlans ? completedPlans.slice(0, 5) : [];
  const canSubmit = Boolean(taskTitle.trim()) && (horizon !== 'CUSTOM' || Boolean(customStartDate && customEndDate && customEndDate >= customStartDate));

  const handleSavePlan = async (plan: UpcomingPlan): Promise<UpcomingPlan> => {
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: plan.title,
          activityType: plan.title,
          icon: plan.icon,
          plannedStartAt: plan.plannedStartAt,
          plannedEndAt: plan.plannedEndAt,
          durationMinutes: minutesFromDuration(plan.duration),
          windowType: windowTypeFromLabel(plan.window),
          windowLabel: plan.window,
          matchLabel: plan.match,
          recommendation: plan.details,
          calendarUrl: plan.googleCalendarUrl,
        }),
      });
      if (!res.ok) throw new Error('Unable to save plan.');
      const row = await res.json();
      const saved = mapPlanRow(row);
      setSavedPlans((plans) => [saved, ...plans.filter((item) => item.id !== saved.id && item.source !== 'Sample')]);
      setExpandedPlanId(saved.id);
      setShowAllPlans(true);
      triggerHaptic('success');
      return saved;
    } catch {
      setSavedPlans((plans) => [{ ...plan, status: 'UPCOMING' }, ...plans.filter((item) => item.id !== plan.id)]);
      setExpandedPlanId(plan.id);
      setShowAllPlans(true);
      triggerHaptic('success');
      return plan;
    }
  };

  const handleReschedulePlan = (plan: UpcomingPlan) => {
    setTaskTitle(plan.title);
    setIsCustomTask(true);
    setDurationMinutes(minutesFromDuration(plan.duration));
    setTimePreference(recommendedPreference(plan.title));
    setHorizon('SEVEN_DAYS');
    setCustomStartDate('');
    setCustomEndDate('');
    setRecommendation(null);
    setShowAllPlans(false);
    setExpandedPlanId(null);
    triggerHaptic('light');
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogPlan = async (plan: UpcomingPlan) => {
    if (plan.source === 'Sample') {
      const savedPlan = { ...plan, id: `aura-${plan.id}-${Date.now()}`, source: 'Aura' as const };
      const persisted = await handleSavePlan(savedPlan);
      if (persisted.id !== savedPlan.id) {
        await handleLogPlan(persisted);
      }
      return;
    }

    try {
      const res = await fetch(`/api/plans/${plan.id}/log`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to log plan.');
      const result = await res.json();
      const updated = mapPlanRow(result.plan);
      setSavedPlans((plans) => plans.map((item) => item.id === plan.id ? updated : item));
      setExpandedPlanId(plan.id);
      onPlanLogged?.();
      triggerHaptic('success');
    } catch {
      const loggedAt = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setSavedPlans((plans) => plans.map((item) => item.id === plan.id
        ? {
            ...item,
            status: 'LOGGED',
            loggedAt,
            note: 'Logged',
            details: `${item.details} Logged at ${loggedAt}.`,
          }
        : item
      ));
      setExpandedPlanId(plan.id);
      triggerHaptic('success');
    }
  };

  const handleFindTime = async () => {
    if (!canSubmit) return;
    setIsLoading(true);
    setError('');
    try {
      const next = await onSlotTask(taskTitle, durationMinutes, horizon, customStartDate, customEndDate, timePreference);
      setRecommendation(next);
      triggerHaptic('success');
    } catch {
      setError('Aura could not find a time for this request. Try a shorter duration or a wider date range.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMyPlansClick = () => {
    setShowAllPlans(true);
    requestAnimationFrame(() => {
      plansSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const options = recommendation?.planningOptions ?? [];
  const hasMultiOptions = options.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 17, paddingBottom: 24, fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, lineHeight: 1.08, margin: 0, color: '#f8fafc', letterSpacing: 0 }}>
            Plan with Aura ✨
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.35, color: '#b6c2d1', margin: '7px 0 0' }}>
            Tell Aura what you want to do.<br />We&apos;ll find your best moments.
          </p>
        </div>
        <button type="button" onClick={handleMyPlansClick} style={myPlansStyle}>
          <span style={{ fontSize: 15 }}>☷</span>
          My Plans
        </button>
      </header>

      <section style={panelStyle}>
        <SectionTitle number={1} label="What do you want to do?" />
        <div style={inputShellStyle}>
          <span style={{ fontSize: 21, color: '#7dd3fc' }}>✦</span>
          <input
            value={taskTitle}
            onChange={(event) => {
              setTaskTitle(event.target.value);
              setIsCustomTask(true);
              setRecommendation(null);
            }}
            placeholder="e.g. Workout, Deep work, Study, Date night..."
            style={inputStyle}
          />
          <button type="button" aria-label="Voice input" style={voiceButtonStyle}>🎙</button>
        </div>
        <div style={{ marginTop: 17, color: '#aab7d2', fontSize: 13 }}>Popular</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 12 }}>
          {filteredTasks.map((task) => (
            <ActivityChip
              key={task.title}
              task={task}
              active={taskTitle.toLowerCase() === task.title.toLowerCase()}
              onClick={() => {
                setTaskTitle(task.title);
                setIsCustomTask(false);
                setTimePreference(recommendedPreference(task.title));
                setRecommendation(null);
              }}
            />
          ))}
          <button type="button" style={moreChipStyle}>••• More</button>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <SelectPanel
          number={2}
          icon="🗓"
          label="When?"
          value={selectedHorizon.label}
          helper={horizonHelper}
          options={HORIZONS}
          selectedValue={horizon}
          onChange={(value) => setHorizon(value as PlanningHorizon)}
        />
        <SelectPanel
          number={3}
          icon="🕒"
          label="How long?"
          value={selectedDuration.label}
          helper={selectedDuration.helper}
          options={DURATIONS}
          selectedValue={durationMinutes}
          onChange={(value) => setDurationMinutes(Number(value))}
        />
      </div>

      {horizon === 'CUSTOM' && (
        <div style={{ ...panelStyle, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={dateLabelStyle}>
            Start
            <input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} style={dateInputStyle} />
          </label>
          <label style={dateLabelStyle}>
            End
            <input type="date" value={customEndDate} min={customStartDate || undefined} onChange={(event) => setCustomEndDate(event.target.value)} style={dateInputStyle} />
          </label>
        </div>
      )}

      <section style={panelStyle}>
        <SectionTitle number={4} icon="🕒" label="Preferred time" />
        <div style={{ fontSize: 13, color: '#b6c2d1', marginTop: 10 }}>When would you like to do this?</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
          {TIME_PREFERENCES.map((item) => (
            <TimeTile key={item.value} item={item} active={timePreference === item.value} onClick={() => setTimePreference(item.value)} />
          ))}
        </div>
        <button type="button" disabled={!canSubmit || isLoading} onClick={handleFindTime} style={{ ...ctaStyle, opacity: canSubmit ? 1 : 0.55 }}>
          {isLoading ? 'Finding...' : '✦ Find My Best Time'}
        </button>
        <div style={{ color: '#dbe7f4', fontSize: 12, textAlign: 'center', marginTop: 13 }}>
          🛡 Aura finds options using today&apos;s Panchang + your patterns
        </div>
        {error && <div style={{ color: '#fb6b6b', fontSize: 12, marginTop: 10, lineHeight: 1.35 }}>{error}</div>}
      </section>

      {recommendation && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader label="Aura's Best Moments" actionLabel={onViewDay ? 'View my day' : undefined} onAction={onViewDay} />
          {hasMultiOptions ? options.map((option, index) => (
            <OpportunityCard
              key={`${option.dateLabel}-${option.startTime}`}
              rank={index}
              title={recommendation.activityType}
              durationText={durationLabel(durationMinutes)}
              dateLabel={option.dateLabel}
              startTime={option.startTime}
              endTime={option.endTime}
              score={option.score}
              quality={option.quality}
              summary={option.summary}
              googleCalendarUrl={option.googleCalendarUrl}
              onPlan={() => handleSavePlan({
                id: `aura-${option.dateLabel}-${option.startTime}-${recommendation.activityType}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                title: recommendation.activityType,
                icon: planIconForTitle(recommendation.activityType),
                when: option.dateLabel,
                plannedStartAt: option.startsAtLocal,
                plannedEndAt: option.endsAtLocal,
                duration: durationLabel(durationMinutes),
                time: `${option.startTime} - ${option.endTime}`,
                window: option.summary.includes('Abhijit') ? 'Abhijit Muhurtham' : option.summary.includes('Gulika') ? 'Steady Progress (Gulika)' : option.summary.includes('Brahma') ? 'Brahma Muhurta' : 'Neutral Flow',
                match: option.quality === 'STRONG' ? 'Best Match' : 'Good Match',
                note: option.quality === 'STRONG' ? 'Excellent match' : option.quality === 'GOOD' ? 'Good match' : 'Usable match',
                accent: planAccentForTitle(recommendation.activityType),
                details: option.summary,
                googleCalendarUrl: option.googleCalendarUrl,
                source: 'Aura',
              })}
            />
          )) : (
            <OpportunityCard
              rank={0}
              title={recommendation.activityType}
              durationText={durationLabel(durationMinutes)}
              dateLabel={recommendation.timeStatus === 'NOW' ? 'Today' : 'Recommended'}
              startTime={recommendation.bestWindow.startTime}
              endTime={recommendation.bestWindow.endTime}
              score={recommendation.windowQuality === 'BEST' ? 92 : recommendation.windowQuality === 'GOOD' ? 84 : recommendation.windowQuality === 'AVOID' ? 35 : 72}
              quality={recommendation.windowQuality === 'BEST' ? 'STRONG' : recommendation.windowQuality === 'GOOD' ? 'GOOD' : 'USABLE'}
              summary={recommendation.bestWindow.reason}
              googleCalendarUrl={recommendation.calendar.googleCalendarUrl}
              onPlan={() => handleSavePlan({
                id: `aura-${recommendation.bestWindow.startTime}-${recommendation.activityType}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                title: recommendation.activityType,
                icon: planIconForTitle(recommendation.activityType),
                when: recommendation.timeStatus === 'NOW' ? 'Today' : 'Recommended',
                plannedStartAt: recommendation.calendar.startsAtLocal,
                plannedEndAt: recommendation.calendar.endsAtLocal,
                duration: durationLabel(durationMinutes),
                time: `${recommendation.bestWindow.startTime} - ${recommendation.bestWindow.endTime}`,
                window: recommendation.bestWindow.label,
                match: recommendation.windowQuality === 'BEST' ? 'Best Match' : 'Good Match',
                note: recommendation.windowQuality === 'BEST' ? 'Excellent match' : 'Good match',
                accent: planAccentForTitle(recommendation.activityType),
                details: recommendation.bestWindow.reason,
                googleCalendarUrl: recommendation.calendar.googleCalendarUrl,
                source: 'Aura',
              })}
            />
          )}
        </section>
      )}

      <section ref={plansSectionRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 18 }}>
        <SectionHeader
          label="Upcoming Plans"
          actionLabel={showAllPlans ? 'Show less' : 'View all'}
          onAction={() => setShowAllPlans((value) => !value)}
        />
        {visibleUpcomingPlans.length > 0 ? visibleUpcomingPlans.map((plan) => (
          <UpcomingPlan
            key={plan.id}
            plan={plan}
            expanded={expandedPlanId === plan.id}
            onToggle={() => setExpandedPlanId((id) => id === plan.id ? null : plan.id)}
            onReschedule={() => handleReschedulePlan(plan)}
            onLog={() => handleLogPlan(plan)}
          />
        )) : (
          <div style={emptyPlansStyle}>No upcoming plans yet.</div>
        )}
      </section>

      {showAllPlans && visibleCompletedPlans.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHeader label="Recently Completed" />
          {visibleCompletedPlans.map((plan) => (
            <UpcomingPlan
              key={plan.id}
              plan={plan}
              expanded={expandedPlanId === plan.id}
              onToggle={() => setExpandedPlanId((id) => id === plan.id ? null : plan.id)}
              onReschedule={() => handleReschedulePlan(plan)}
              onLog={() => handleLogPlan(plan)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function SectionTitle({ number, label, icon }: { number: number; label: string; icon?: string }) {
  return (
    <div style={{ color: '#4ade80', fontSize: 12, fontFamily: 'var(--as-font-mono)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon ? `${icon} ` : ''}{number}. {label}
    </div>
  );
}

function SectionHeader({ label, actionLabel, onAction }: { label: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <h2 style={{ margin: 0, color: '#aab7d2', fontFamily: 'var(--as-font-mono)', fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </h2>
      {actionLabel && (
        <button type="button" onClick={onAction} style={{ border: 'none', background: 'transparent', color: '#4ade80', fontSize: 14, fontWeight: 850, cursor: onAction ? 'pointer' : 'default' }}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function ActivityChip({ task, active, onClick }: { task: TaskSuggestion; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? task.accent : `${task.accent}55`}`,
        background: active ? `${task.accent}22` : 'rgba(2, 6, 23, 0.35)',
        color: active ? '#f8fafc' : '#dbe7f4',
        borderRadius: 999,
        padding: '9px 12px',
        fontSize: 12,
        fontWeight: 850,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: task.accent, marginRight: 5 }}>{task.icon}</span>{task.title}
    </button>
  );
}

function SelectPanel({
  number,
  icon,
  label,
  value,
  helper,
  options,
  selectedValue,
  onChange,
}: {
  number: number;
  icon: string;
  label: string;
  value: string;
  helper: string;
  options: Array<{ value: string | number; label: string }>;
  selectedValue: string | number;
  onChange: (value: string | number) => void;
}) {
  return (
    <section style={{ ...panelStyle, padding: 14, minWidth: 0 }}>
      <SectionTitle number={number} icon={icon} label={label} />
      <div style={{ position: 'relative', marginTop: 13 }}>
        <select
          value={selectedValue}
          onChange={(event) => onChange(event.target.value)}
          style={{
            width: '100%',
            minHeight: 51,
            appearance: 'none',
            border: '1px solid rgba(96, 165, 250, 0.25)',
            borderRadius: 10,
            background: 'rgba(2, 6, 23, 0.62)',
            color: '#f8fafc',
            fontSize: 17,
            fontWeight: 850,
            padding: '0 36px 0 13px',
            outline: 'none',
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span style={{ position: 'absolute', right: 14, top: 15, color: '#7dd3fc', pointerEvents: 'none', fontSize: 17 }}>⌄</span>
      </div>
      <div style={{ color: '#aab7d2', fontSize: 13, marginTop: 10 }}>{helper}</div>
    </section>
  );
}

function TimeTile({ item, active, onClick }: { item: typeof TIME_PREFERENCES[number]; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 76,
        minWidth: 0,
        border: `1px solid ${active ? '#4ade80' : 'rgba(148, 163, 184, 0.22)'}`,
        borderRadius: 14,
        background: active ? 'rgba(74, 222, 128, 0.1)' : 'rgba(2, 6, 23, 0.35)',
        color: active ? '#4ade80' : '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        cursor: 'pointer',
        padding: 6,
      }}
    >
      <span style={{ color: item.accent, fontSize: 25, lineHeight: 1 }}>{item.icon}</span>
      <span style={{ fontSize: 12, fontWeight: 850, lineHeight: 1.1 }}>{item.label}</span>
    </button>
  );
}

function UpcomingPlan({
  plan,
  expanded,
  onToggle,
  onReschedule,
  onLog,
}: {
  plan: UpcomingPlan;
  expanded: boolean;
  onToggle: () => void;
  onReschedule: () => void;
  onLog: () => void;
}) {
  const isLogged = plan.status === 'LOGGED';
  return (
    <article style={{ ...panelStyle, padding: 0, overflow: 'hidden', borderColor: isLogged ? 'rgba(74, 222, 128, 0.38)' : expanded ? 'rgba(56, 189, 248, 0.38)' : undefined }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          border: 'none',
          background: 'transparent',
          display: 'grid',
          gridTemplateColumns: '66px 1fr auto',
          alignItems: 'center',
          gap: 13,
          padding: 14,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <div style={{ width: 58, height: 58, borderRadius: 29, background: `${plan.accent}18`, border: `1px solid ${plan.accent}44`, color: plan.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 27 }}>
          <PlanGlyph type={plan.icon} color={plan.accent} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f8fafc', fontSize: 17, fontWeight: 900, lineHeight: 1.2 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.title}</span>
            {(plan.match === 'Best Match' || isLogged) && <span style={{ color: '#4ade80', fontSize: 14 }}>✓</span>}
          </div>
          <div style={{ color: '#aab7d2', fontSize: 14, marginTop: 3 }}>{plan.when} · {plan.duration}</div>
          {isLogged ? (
            <span style={{ display: 'inline-block', marginTop: 7, color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.3)', background: 'rgba(74, 222, 128, 0.1)', borderRadius: 7, padding: '3px 8px', fontSize: 11, fontWeight: 850 }}>
              Logged{plan.loggedAt ? ` ${plan.loggedAt}` : ''}
            </span>
          ) : plan.match === 'Best Match' ? (
            <span style={{ display: 'inline-block', marginTop: 7, color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.3)', background: 'rgba(74, 222, 128, 0.1)', borderRadius: 7, padding: '3px 8px', fontSize: 11, fontWeight: 850 }}>
              {plan.match}
            </span>
          ) : (
            <div style={{ color: '#76e7a5', fontSize: 12, fontWeight: 800, marginTop: 7 }}>{plan.match}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 150 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: isLogged ? '#a7f3d0' : '#4ade80', fontSize: 15, fontWeight: 900, whiteSpace: 'nowrap' }}>{plan.time}</div>
            <div style={{ color: '#dbe7f4', fontSize: 13, marginTop: 5 }}>{plan.window}</div>
            <div style={{ color: '#aab7d2', fontSize: 13, marginTop: 6 }}>{plan.note}</div>
          </div>
          <span style={{ color: '#aab7d2', fontSize: 27, lineHeight: 1, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 140ms ease' }}>›</span>
        </div>
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(96, 165, 250, 0.16)', padding: '0 14px 14px 93px' }}>
          <div style={{ color: '#dbe7f4', fontSize: 12, lineHeight: 1.45 }}>{plan.details}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {plan.googleCalendarUrl && (
              <a href={plan.googleCalendarUrl} target="_blank" rel="noreferrer" style={planActionStyle}>
                Add calendar
              </a>
            )}
            <button type="button" onClick={onReschedule} style={planSecondaryActionStyle}>Reschedule</button>
            <button type="button" onClick={onLog} disabled={isLogged} style={{ ...planSecondaryActionStyle, opacity: isLogged ? 0.55 : 1, cursor: isLogged ? 'default' : 'pointer' }}>
              {isLogged ? 'Logged' : 'Log activity'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function PlanGlyph({ type, color }: { type: PlanIcon; color: string }) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      {type === 'workout' && (
        <>
          <path {...common} d="M6 13v6M10 10v12M22 10v12M26 13v6M10 16h12" />
        </>
      )}
      {type === 'focus' && (
        <>
          <path {...common} d="M16 6a6 6 0 0 0-6 6v1.5A4.5 4.5 0 0 0 10 22" />
          <path {...common} d="M16 6a6 6 0 0 1 6 6v1.5A4.5 4.5 0 0 1 22 22" />
          <path {...common} d="M10 17h12M12 25c2.5-2 5.5-2 8 0" />
        </>
      )}
      {type === 'heart' && (
        <path {...common} d="M16 25s-9-5.4-9-12a4.8 4.8 0 0 1 8.6-2.9A4.8 4.8 0 0 1 25 13c0 6.6-9 12-9 12Z" />
      )}
      {type === 'study' && (
        <>
          <path {...common} d="M6 9.5h8a3 3 0 0 1 3 3V25a3 3 0 0 0-3-3H6Z" />
          <path {...common} d="M26 9.5h-8a3 3 0 0 0-3 3V25a3 3 0 0 1 3-3h8Z" />
        </>
      )}
      {type === 'meditate' && (
        <>
          <circle {...common} cx="16" cy="8" r="2.5" />
          <path {...common} d="M16 12v6M11 16l5 3 5-3M8 24c3.5-4 12.5-4 16 0" />
        </>
      )}
      {type === 'meeting' && (
        <>
          <rect {...common} x="7" y="8" width="18" height="16" rx="3" />
          <path {...common} d="M11 14h10M11 18h7M12 5v5M20 5v5" />
        </>
      )}
      {type === 'journey' && (
        <>
          <path {...common} d="M8 23c3-9 13-5 16-14" />
          <path {...common} d="M9 9h6v6M22 17h2v6h-6" />
        </>
      )}
    </svg>
  );
}

function OpportunityCard({
  rank,
  title,
  durationText,
  dateLabel,
  startTime,
  endTime,
  score,
  quality,
  summary,
  googleCalendarUrl,
  onPlan,
}: {
  rank: number;
  title: string;
  durationText: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  score: number;
  quality: 'STRONG' | 'GOOD' | 'USABLE';
  summary: string;
  googleCalendarUrl: string;
  onPlan: () => void;
}) {
  const label = rank === 0 ? 'Best Match' : rank === 1 ? 'Good Alternative' : 'Backup Option';
  return (
    <article style={{ ...panelStyle, padding: 15 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
        <div>
          <div style={{ color: '#4ade80', fontFamily: 'var(--as-font-mono)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div>
          <h2 style={{ margin: '7px 0 0', color: '#f8fafc', fontSize: 18 }}>{title}</h2>
          <div style={{ color: '#dbe7f4', fontSize: 14, marginTop: 5 }}>{dateLabel} · {startTime} - {endTime}</div>
          <div style={{ color: '#aab7d2', fontSize: 12, marginTop: 7 }}>{quality === 'STRONG' ? 'Excellent match' : quality === 'GOOD' ? 'Good match' : 'Usable match'} · {durationText}</div>
        </div>
        <div style={{ width: 58, height: 58, borderRadius: 29, border: '1px solid rgba(74, 222, 128, 0.6)', background: 'rgba(74, 222, 128, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ color: '#f8fafc', fontSize: 19, fontWeight: 900 }}>{Math.round(score)}</span>
          <span style={{ color: '#94a3b8', fontSize: 9 }}>/100</span>
        </div>
      </div>
      <div style={{ color: '#dbe7f4', fontSize: 12, lineHeight: 1.45, marginTop: 9 }}>{summary}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button type="button" onClick={onPlan} style={{ border: 'none', background: 'transparent', color: '#38bdf8', fontWeight: 850, fontSize: 12, padding: 0, cursor: 'pointer' }}>
          Plan this
        </button>
        <a href={googleCalendarUrl} target="_blank" rel="noreferrer" style={{ color: '#aab7d2', textDecoration: 'none', fontWeight: 750, fontSize: 12 }}>
          Add calendar
        </a>
      </div>
    </article>
  );
}

const panelStyle: React.CSSProperties = {
  background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
  border: '1px solid rgba(96, 165, 250, 0.18)',
  borderRadius: 16,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
  padding: 16,
};

const myPlansStyle: React.CSSProperties = {
  minHeight: 45,
  border: '1px solid rgba(96, 165, 250, 0.23)',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#4ade80',
  fontSize: 15,
  fontWeight: 900,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 15px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const inputShellStyle: React.CSSProperties = {
  minHeight: 62,
  marginTop: 14,
  border: '1px solid #2f95ff',
  borderRadius: 12,
  background: 'rgba(2, 6, 23, 0.52)',
  display: 'grid',
  gridTemplateColumns: '34px 1fr 44px',
  alignItems: 'center',
  gap: 7,
  padding: '0 10px 0 13px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  color: '#f8fafc',
  fontSize: 16,
  outline: 'none',
};

const voiceButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 21,
  border: '1px solid rgba(148, 163, 184, 0.2)',
  background: 'rgba(148, 163, 184, 0.16)',
  color: '#f8fafc',
  fontSize: 18,
  cursor: 'pointer',
};

const moreChipStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(2, 6, 23, 0.35)',
  color: '#f8fafc',
  borderRadius: 999,
  padding: '9px 13px',
  fontSize: 12,
  fontWeight: 850,
  cursor: 'pointer',
};

const ctaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 54,
  border: 'none',
  borderRadius: 12,
  background: 'linear-gradient(90deg, #4ade80 0%, #22d3ee 52%, #2f95ff 100%)',
  color: '#020617',
  fontSize: 17,
  fontWeight: 950,
  marginTop: 22,
  cursor: 'pointer',
};

const dateLabelStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
};

const dateInputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 6,
  background: '#020617',
  border: '1px solid #334155',
  borderRadius: 9,
  color: '#cbd5e1',
  fontSize: 12,
  padding: '9px 10px',
};

const emptyPlansStyle: React.CSSProperties = {
  ...panelStyle,
  color: '#aab7d2',
  fontSize: 13,
  lineHeight: 1.4,
  textAlign: 'center',
};

const planActionStyle: React.CSSProperties = {
  minHeight: 32,
  border: '1px solid rgba(56, 189, 248, 0.55)',
  borderRadius: 8,
  background: 'rgba(14, 165, 233, 0.14)',
  color: '#7dd3fc',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0 12px',
  textDecoration: 'none',
  fontSize: 12,
  fontWeight: 850,
};

const planSecondaryActionStyle: React.CSSProperties = {
  ...planActionStyle,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(148, 163, 184, 0.12)',
  color: '#dbe7f4',
  cursor: 'pointer',
};
