'use client';

import React, { useState, useMemo } from 'react';
import { getPersonalizedTasks, UserChartContext } from '../../../packages/recommendation/src/personalizedTasks';
import type { DailyBriefing, TaskSlotRecommendation } from '../../../packages/recommendation/src/dailyAssistant';
import { triggerHaptic } from '../lib/haptics';

interface HomeDashboardProps {
  userName: string;
  energyScore: number;
  themeText: string;
  bestForToday: string[];
  cautionItems: string[];
  nextShift: {
    windowName: string;
    startsIn: string;
    startTime: string;
  };
  activeWindowName?: string;
  loggedActivitiesToday?: string[];
  dailyBriefing?: DailyBriefing | null;
  userChart?: UserChartContext;
  onLogActivity?: (activityTitle: string, notes?: string) => Promise<void>;
  onSlotTask?: (taskTitle: string, durationMinutes: number) => Promise<TaskSlotRecommendation>;
  onSubmitReflection?: (outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW', followedGuidance: boolean) => Promise<void>;
  onNextShiftClick?: () => void;
}

// Helper to determine status text and color dynamically from the energy score and window
function getEnergyStatus(score: number, windowName: string) {
  const cleanWindow = (windowName || '').toUpperCase();
  
  if (cleanWindow.includes('RAHU') || cleanWindow.includes('YAMA') || score < 4) {
    return {
      label: 'Caution Period',
      color: '#fb6b6b', // Red / High friction
    };
  }
  if (score >= 7.5) {
    return {
      label: 'High Alignment',
      color: '#4ade80', // Green / Auspicious
    };
  }
  if (score >= 5.0) {
    return {
      label: 'Steady Flow',
      color: '#facc15', // Yellow / Neutral
    };
  }
  return {
    label: 'Moderate Energy',
    color: '#fb923c', // Orange
  };
}

export function HomeDashboard({
  userName,
  energyScore,
  themeText,
  bestForToday,
  cautionItems,
  nextShift,
  activeWindowName = 'NEUTRAL',
  loggedActivitiesToday = [],
  dailyBriefing,
  userChart,
  onLogActivity,
  onSlotTask,
  onSubmitReflection,
  onNextShiftClick,
}: HomeDashboardProps) {
  const [selectedHabit, setSelectedHabit] = useState<string | null>(null);
  const [activityNote, setActivityNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDuration, setTaskDuration] = useState(30);
  const [taskRecommendation, setTaskRecommendation] = useState<TaskSlotRecommendation | null>(null);
  const [isSlottingTask, setIsSlottingTask] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);

  // Compute personalized tasks tailored to active window, birth chart, and current log history
  const personalizedTasks = useMemo(() => {
    return getPersonalizedTasks(activeWindowName, userChart, loggedActivitiesToday);
  }, [activeWindowName, userChart, loggedActivitiesToday]);

  const starCount = Math.round((energyScore / 10) * 5 * 2) / 2;

  // Dynamic Status Label & Accent Color based on active score and window
  const status = getEnergyStatus(energyScore, activeWindowName);
  const allWindowsComplete = Boolean(
    dailyBriefing &&
      dailyBriefing.briefingState === 'COMPLETED' &&
      dailyBriefing.otherFavorableWindows.every((window) => window.state === 'COMPLETED')
  );
  const briefTitle = allWindowsComplete ? 'Evening Status' : 'Morning Brief';
  const briefStateLabel = allWindowsComplete
    ? 'Recovery phase'
    : dailyBriefing?.briefingState === 'ACTIVE'
      ? 'Active now'
      : dailyBriefing?.briefingState === 'COMPLETED'
        ? 'Peak complete'
        : 'Upcoming';
  const currentHour = new Date().getHours();
  const greeting = allWindowsComplete || currentHour >= 17
    ? 'Good Evening'
    : currentHour >= 12
      ? 'Good Afternoon'
      : 'Good Morning';
  const summaryWindows = dailyBriefing
    ? [
        {
          name: dailyBriefing.peakWindow.name,
          startTime: dailyBriefing.peakWindow.startTime,
          endTime: dailyBriefing.peakWindow.endTime,
          windowType: 'ABHIJIT',
          state: dailyBriefing.briefingState,
        },
        ...dailyBriefing.otherFavorableWindows,
      ]
    : [];

  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = energyScore <= 10 ? energyScore * 10 : energyScore;
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;

  const handleConfirmLog = async () => {
    if (!selectedHabit || !onLogActivity) return;
    setIsSubmitting(true);
    try {
      await onLogActivity(selectedHabit, activityNote);
      
      // Trigger success haptic vibration upon successful log confirmation
      triggerHaptic('success');

      setSelectedHabit(null);
      setActivityNote('');
    } catch (err) {
      console.error('Failed to log activity:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSlotTask = async () => {
    if (!onSlotTask || !taskTitle.trim()) return;
    setIsSlottingTask(true);
    try {
      const recommendation = await onSlotTask(taskTitle, taskDuration);
      setTaskRecommendation(recommendation);
      triggerHaptic('success');
    } catch (err) {
      console.error('Failed to slot task:', err);
    } finally {
      setIsSlottingTask(false);
    }
  };

  const handleReflection = async (outputLevel: 'LOW' | 'MODERATE' | 'PEAK_FLOW') => {
    if (!onSubmitReflection) return;
    try {
      await onSubmitReflection(outputLevel, loggedActivitiesToday.length > 0);
      setReflectionSaved(true);
      triggerHaptic('success');
    } catch (err) {
      console.error('Failed to save reflection:', err);
    }
  };

  const getIconForBadge = (item: string) => {
    if (item.toLowerCase().includes('learn')) return '📖';
    if (item.toLowerCase().includes('exercise')) return '🏋️';
    if (item.toLowerCase().includes('plan')) return '📅';
    return '✨';
  };

  const getIconForCaution = (item: string) => {
    if (item.toLowerCase().includes('emotion')) return '❤️';
    if (item.toLowerCase().includes('financial')) return '🪙';
    return '⚠️';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 24, position: 'relative', fontFamily: 'sans-serif' }}>
      {/* 1. Greeting Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          {greeting}, {userName}! 👋
        </h1>
        <p style={{ fontSize: 11, color: '#b6c2d1', marginTop: 2 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* 2a. Morning Briefing / Evening Recovery Status */}
      {dailyBriefing && (
        <div
          style={{
            background: 'var(--as-surface-raised, #0f172a)',
            border: allWindowsComplete ? '1px solid rgba(148, 163, 184, 0.24)' : '1px solid rgba(74, 222, 128, 0.28)',
            borderRadius: 16,
            padding: '18px 17px 19px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: allWindowsComplete ? '#cbd5e1' : '#4ade80', fontWeight: 800 }}>
              {briefTitle}
            </span>
            <span style={{ background: allWindowsComplete ? 'rgba(148, 163, 184, 0.16)' : 'rgba(74, 222, 128, 0.14)', border: `1px solid ${allWindowsComplete ? 'rgba(148, 163, 184, 0.24)' : 'rgba(74, 222, 128, 0.28)'}`, borderRadius: 999, color: allWindowsComplete ? '#cbd5e1' : '#86efac', fontSize: 10, fontWeight: 800, padding: '4px 8px' }}>
              {briefStateLabel}
            </span>
          </div>
          {allWindowsComplete ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', marginTop: 15 }}>
                All favorable windows complete
              </div>
              <div style={{ fontSize: 12, color: '#dbe7f4', marginTop: 6, lineHeight: 1.45 }}>
                Focus on light activity, reflection, and sleep preparation.
              </div>
              <div style={{ marginTop: 17, paddingTop: 14, borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ fontSize: 10, color: '#b6c2d1', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>
                  Today&apos;s summary
                </div>
                {summaryWindows.map((window) => {
                  const isComplete = window.state === 'COMPLETED';
                  const stateLabel = window.state === 'ACTIVE' ? 'Active now' : isComplete ? 'Complete' : 'Upcoming';
                  return (
                    <div key={`${window.windowType}-${window.startTime}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: '9px 10px', alignItems: 'center', marginTop: 9, opacity: isComplete ? 0.58 : 1 }}>
                      <span style={{ color: isComplete ? '#7f8da1' : '#dbe7f4', fontSize: 11 }}>{window.name}</span>
                      <span style={{ color: isComplete ? '#7f8da1' : '#b6c2d1', fontSize: 10, whiteSpace: 'nowrap' }}>{window.startTime} - {window.endTime}</span>
                      <span style={{ background: isComplete ? 'rgba(148, 163, 184, 0.12)' : window.state === 'ACTIVE' ? 'rgba(74, 222, 128, 0.14)' : 'rgba(56, 189, 248, 0.14)', borderRadius: 999, color: isComplete ? '#7f8da1' : window.state === 'ACTIVE' ? '#86efac' : '#7dd3fc', fontSize: 9, fontWeight: 800, padding: '4px 7px' }}>{stateLabel}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', marginTop: 10 }}>
                {dailyBriefing.peakWindow.name}: {dailyBriefing.peakWindow.startTime} - {dailyBriefing.peakWindow.endTime}
              </div>
              <div style={{ fontSize: 12, color: '#dbe7f4', marginTop: 6, lineHeight: 1.45 }}>
                {dailyBriefing.greenLight.title}: {dailyBriefing.greenLight.description}
              </div>
              <div style={{ fontSize: 11, color: '#b6c2d1', marginTop: 9, lineHeight: 1.4 }}>
                {dailyBriefing.nextAction}
              </div>
            </>
          )}
          {!allWindowsComplete && dailyBriefing.briefingState === 'COMPLETED' && dailyBriefing.nextWindow && (
            <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 8, lineHeight: 1.35, fontWeight: 700 }}>
              Next favorable window: {dailyBriefing.nextWindow.startTime} - {dailyBriefing.nextWindow.endTime} · {dailyBriefing.nextWindow.name}
            </div>
          )}
        </div>
      )}

      {/* 2. Current Alignment Score Card */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 20,
          position: 'relative',
        }}
      >
        <div style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>
          Current Alignment
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: status.color, margin: 0 }}>
              {status.label}
            </h2>
            <div style={{ display: 'flex', gap: 2, color: '#facc15', fontSize: 14, margin: '6px 0 0 0' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i}>{i < Math.floor(starCount) ? '★' : '☆'}</span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, fontWeight: 500 }}>
              Active Window: <span style={{ color: status.color, fontWeight: 600 }}>{activeWindowName.replace('_', ' ')}</span>
            </div>
          </div>

          <div style={{ position: 'relative', width: 76, height: 76, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="38" cy="38" r={radius} stroke="rgba(255, 255, 255, 0.08)" strokeWidth="6" fill="none" />
              <circle
                cx="38"
                cy="38"
                r={radius}
                stroke={status.color}
                strokeWidth="6"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>
            <div style={{ position: 'absolute', textAlign: 'center' }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--as-text, #fff)', display: 'block' }}>
                {energyScore}
              </span>
              <span style={{ fontSize: 9, color: 'var(--as-text-muted, #94a3b8)' }}>/ 10</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Personalized Actions Playbook Section */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.05em', fontWeight: 700 }}>
            ⚡ Personalized Actions
          </span>
          <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>
            {activeWindowName.replace(/_/g, ' ')}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {personalizedTasks.map((task) => {
            const isAlreadyLogged = loggedActivitiesToday.some(
              (title) => title.toLowerCase() === task.title.toLowerCase()
            );

            return (
              <div
                key={task.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: isAlreadyLogged
                    ? 'rgba(74, 222, 128, 0.08)'
                    : 'rgba(30, 41, 59, 0.6)',
                  border: isAlreadyLogged
                    ? '1px solid rgba(74, 222, 128, 0.3)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                  <span style={{ fontSize: 20 }}>{task.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isAlreadyLogged ? '#e2e8f0' : '#f8fafc' }}>
                      {task.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, lineHeight: 1.3 }}>
                      {task.description}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => !isAlreadyLogged && setSelectedHabit(task.title)}
                  disabled={isAlreadyLogged}
                  style={{
                    background: isAlreadyLogged ? 'rgba(74, 222, 128, 0.15)' : '#4ade80',
                    color: isAlreadyLogged ? '#4ade80' : '#020617',
                    border: isAlreadyLogged ? '1px solid rgba(74, 222, 128, 0.3)' : 'none',
                    borderRadius: 8,
                    padding: '6px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: isAlreadyLogged ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {isAlreadyLogged ? '✓ Logged' : '+ Log This'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Smart Task Planner */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#38bdf8', letterSpacing: '0.05em', fontWeight: 700 }}>
            Slot My Task
          </span>
          <select
            value={taskDuration}
            onChange={(e) => setTaskDuration(Number(e.target.value))}
            style={{
              background: '#020617',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#cbd5e1',
              fontSize: 11,
              padding: '5px 8px',
            }}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
            <option value={90}>90 min</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Pitch deck, 1-on-1, code review..."
            style={{
              flex: 1,
              minWidth: 0,
              background: '#020617',
              border: '1px solid #334155',
              borderRadius: 10,
              color: '#f8fafc',
              fontSize: 12,
              padding: '10px 12px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSlotTask}
            disabled={!taskTitle.trim() || isSlottingTask}
            style={{
              background: '#38bdf8',
              border: 'none',
              borderRadius: 10,
              color: '#020617',
              cursor: taskTitle.trim() ? 'pointer' : 'default',
              fontSize: 12,
              fontWeight: 800,
              padding: '0 12px',
              opacity: taskTitle.trim() ? 1 : 0.55,
              whiteSpace: 'nowrap',
            }}
          >
            {isSlottingTask ? '...' : 'Slot'}
          </button>
        </div>
        {taskRecommendation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <div style={{ border: `1px solid ${taskRecommendation.recommendationState === 'AVOID' ? 'rgba(251, 107, 107, 0.35)' : taskRecommendation.recommendationState === 'NO_FIT' ? 'rgba(251, 191, 36, 0.35)' : 'rgba(74, 222, 128, 0.3)'}`, background: taskRecommendation.recommendationState === 'AVOID' ? 'rgba(251, 107, 107, 0.08)' : taskRecommendation.recommendationState === 'NO_FIT' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(74, 222, 128, 0.08)', borderRadius: 12, padding: 12 }}>
              <div style={{ fontSize: 11, color: taskRecommendation.recommendationState === 'AVOID' ? '#fb6b6b' : taskRecommendation.recommendationState === 'NO_FIT' ? '#fbbf24' : '#4ade80', fontWeight: 800 }}>
                {taskRecommendation.activityIcon} {taskRecommendation.recommendationLabel}
              </div>
              <div style={{ fontSize: 12, color: '#dbe7f4', fontWeight: 700, marginTop: 7 }}>
                For {taskRecommendation.activityType.toLowerCase()}
              </div>
              <div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 700, marginTop: 3 }}>
                {taskRecommendation.bestWindow.startTime} - {taskRecommendation.bestWindow.endTime} · {taskRecommendation.bestWindow.label}
              </div>
              {!taskRecommendation.durationFits && (
                <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 5, lineHeight: 1.35 }}>
                  Only {taskRecommendation.availableMinutes} minutes fit inside this period; try a shorter block or choose another window.
                </div>
              )}
              <div style={{ fontSize: 11, color: '#dbe7f4', marginTop: 4, lineHeight: 1.35 }}>
                {taskRecommendation.bestWindow.reason}
              </div>
              {taskRecommendation.recommendationState !== 'NO_FIT' && <a
                href={taskRecommendation.calendar.googleCalendarUrl}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: '#38bdf8', fontWeight: 700, textDecoration: 'none' }}
              >
                Add to Google Calendar
              </a>}
            </div>
            {taskRecommendation.recommendationState === 'BEST_NOW' && taskRecommendation.bestWindowToday && (
              <div style={{ border: '1px solid rgba(56, 189, 248, 0.28)', background: 'rgba(56, 189, 248, 0.08)', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#7dd3fc', fontWeight: 800 }}>
                  ⭐ Best Window Today{taskRecommendation.bestWindowToday.startsInMinutes > 0 ? ` · Starts in ${taskRecommendation.bestWindowToday.startsInMinutes} min` : ''}
                </div>
                <div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 700, marginTop: 5 }}>
                  {taskRecommendation.bestWindowToday.startTime} - {taskRecommendation.bestWindowToday.endTime} · {taskRecommendation.bestWindowToday.label}
                </div>
                <div style={{ fontSize: 11, color: '#dbe7f4', marginTop: 4, lineHeight: 1.35 }}>
                  {taskRecommendation.bestWindowToday.reason}
                </div>
                <a
                  href={taskRecommendation.bestWindowToday.googleCalendarUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-block', marginTop: 8, fontSize: 11, color: '#38bdf8', fontWeight: 700, textDecoration: 'none' }}
                >
                  Schedule Best Window
                </a>
              </div>
            )}
            {taskRecommendation.avoidWindow && taskRecommendation.recommendationState !== 'AVOID' && (
              <div style={{ border: '1px solid rgba(251, 107, 107, 0.25)', background: 'rgba(251, 107, 107, 0.07)', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: '#fb6b6b', fontWeight: 800 }}>Avoid Window</div>
                <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700, marginTop: 3 }}>
                  {taskRecommendation.avoidWindow.startTime} - {taskRecommendation.avoidWindow.endTime} · {taskRecommendation.avoidWindow.label}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* End-of-Day Reflection */}
      {onSubmitReflection && (
        <div
          style={{
            background: 'var(--as-surface-raised, #0f172a)',
            border: '1px solid var(--as-border, #1e293b)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#facc15', letterSpacing: '0.05em', fontWeight: 700 }}>
            Daily Check-in
          </span>
          <div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 700, marginTop: 8 }}>
            How was your output today?
          </div>
          {reflectionSaved ? (
            <div style={{ fontSize: 12, color: '#4ade80', marginTop: 8 }}>
              Saved. Your alignment proof gets stronger with every check-in.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
              {[
                ['LOW', 'Low'],
                ['MODERATE', 'Moderate'],
                ['PEAK_FLOW', 'Peak Flow'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => handleReflection(value as 'LOW' | 'MODERATE' | 'PEAK_FLOW')}
                  style={{
                    background: 'rgba(30, 41, 59, 0.7)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 10,
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    minHeight: 38,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal Prompt */}
      {selectedHabit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.82)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: 20,
              padding: 20,
              width: '100%',
              maxWidth: 360,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6)',
              color: '#f8fafc',
            }}
          >
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
              Log {selectedHabit}?
            </h3>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              Tagging this under current active window ({activeWindowName.replace(/_/g, ' ')}).
            </p>

            <textarea
              placeholder="Optional notes or reflection..."
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              style={{
                width: '100%',
                height: 70,
                marginTop: 12,
                borderRadius: 10,
                background: '#020617',
                border: '1px solid #334155',
                color: '#f8fafc',
                padding: 10,
                fontSize: 12,
                resize: 'none',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => setSelectedHabit(null)}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid #334155',
                  color: '#94a3b8',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmLog}
                disabled={isSubmitting}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 10,
                  background: '#4ade80',
                  border: 'none',
                  color: '#020617',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {isSubmitting ? 'Saving...' : 'Confirm Log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Active Guidance Card */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
          Active Guidance
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#e2e8f0', lineHeight: 1.4, marginTop: 6 }}>
          <span style={{ fontSize: 16 }}>🌿</span>
          <span>&ldquo;{themeText}&rdquo;</span>
        </div>
      </div>

      {/* 5. Optimal Activities Card */}
      <div
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.05em' }}>
          Optimal Activities
        </span>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {bestForToday.map((item) => (
            <div
              key={item}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                padding: '8px 14px',
                borderRadius: 20,
                background: 'rgba(30, 41, 59, 0.7)',
                color: '#f8fafc',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                fontWeight: 500,
              }}
            >
              <span>{getIconForBadge(item)}</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 6. Friction Guardrails Card */}
      {cautionItems.length > 0 && (
        <div
          style={{
            background: 'var(--as-surface-raised, #0f172a)',
            border: '1px solid var(--as-border, #1e293b)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#fb6b6b', letterSpacing: '0.05em' }}>
            Friction Guardrails
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {cautionItems.map((caution) => (
              <div
                key={caution}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12,
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.04)',
                  color: '#94a3b8',
                }}
              >
                <span>{getIconForCaution(caution)}</span>
                <span>{caution}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. Next Energy Shift */}
      <div
        onClick={onNextShiftClick}
        style={{
          background: 'var(--as-surface-raised, #0f172a)',
          border: '1px solid var(--as-border, #1e293b)',
          borderRadius: 16,
          padding: '14px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: onNextShiftClick ? 'pointer' : 'default',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'rgba(250, 204, 21, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            ☀️
          </div>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#94a3b8' }}>Next Energy Shift</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{nextShift.windowName}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>{nextShift.startsIn}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>{nextShift.startTime}</div>
          </div>
          {onNextShiftClick && (
            <span style={{ fontSize: 16, color: '#94a3b8' }}>›</span>
          )}
        </div>
      </div>
    </div>
  );
}
