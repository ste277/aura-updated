'use client';

import React, { useState, useMemo } from 'react';
import { getPersonalizedTasks, UserChartContext } from '../../../packages/recommendation/src/personalizedTasks';
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
  userChart?: UserChartContext;
  onLogActivity?: (activityTitle: string, notes?: string) => Promise<void>;
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
  userChart,
  onLogActivity,
  onNextShiftClick,
}: HomeDashboardProps) {
  const [selectedHabit, setSelectedHabit] = useState<string | null>(null);
  const [activityNote, setActivityNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Compute personalized tasks tailored to active window, birth chart, and current log history
  const personalizedTasks = useMemo(() => {
    return getPersonalizedTasks(activeWindowName, userChart, loggedActivitiesToday);
  }, [activeWindowName, userChart, loggedActivitiesToday]);

  const starCount = Math.round((energyScore / 10) * 5 * 2) / 2;

  // Dynamic Status Label & Accent Color based on active score and window
  const status = getEnergyStatus(energyScore, activeWindowName);

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
          Good Evening, {userName}! 👋
        </h1>
        <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, fontFamily: 'monospace' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

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