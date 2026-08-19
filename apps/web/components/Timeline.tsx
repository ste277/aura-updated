'use client';

import React, { useState, useRef } from 'react';
import { getActionCards, getActivityDiscoveryCards, ActionCard } from '../../../packages/recommendation/src/actionCards';
import { LoggedEntryItem } from './CalendarViewSection';
import { triggerHaptic } from '../lib/haptics';

export interface TimelineWindowItem {
  name: string;
  actionTitle?: string;
  startTime?: string;
  endTime?: string;
  type?: string;
  color?: string;
  startMinute?: number;
  endMinute?: number;
}

export interface TimelineViewProps {
  currentWindow?: {
    name: string;
    actionTitle?: string;
    endTime: string;
    timeRemaining: string;
  };
  windows?: TimelineWindowItem[];
  currentMinuteOfDay?: number;
  logEntries?: LoggedEntryItem[];
  loggedActivitiesToday?: string[];
  onLogActivity?: (
    activityTitle: string,
    notes?: string,
    customTimestamp?: Date,
    overrideWindowType?: string
  ) => Promise<void>;
  onPlanActivity?: (activityTitle: string) => void;
  onAskAuraClick?: () => void;
}

function getWindowMeta(typeStr: string) {
  const clean = (typeStr || '').replace('_', ' ').toUpperCase();
  if (clean.includes('BRAHMA')) {
    return {
      title: 'Deep Focus (Brahma)',
      color: '#f97316',
      gradient: ['#fb923c', '#ea580c'],
      icon: '🌅',
    };
  }
  if (clean.includes('ABHIJIT')) {
    return {
      title: 'Peak Productivity (Abhijit)',
      color: '#38bdf8',
      gradient: ['#38bdf8', '#0284c7'],
      icon: '⚡',
    };
  }
  if (clean.includes('RAHU')) {
    return {
      title: 'Proceed Carefully (Rahu Kalam)',
      color: '#f43f5e',
      gradient: ['#fb7185', '#e11d48'],
      icon: '⚠️',
    };
  }
  if (clean.includes('GULIKA')) {
    return {
      title: 'Steady Progress (Gulika)',
      color: '#8b5cf6',
      gradient: ['#a78bfa', '#6d28d9'],
      icon: '🌙',
    };
  }
  if (clean.includes('YAMA')) {
    return {
      title: 'Slow Down (Yama)',
      color: '#eab308',
      gradient: ['#fde047', '#ca8a04'],
      icon: '🐢',
    };
  }
  return {
    title: 'Neutral Flow',
    color: '#64748b',
    gradient: ['#475569', '#1e293b'],
    icon: '✨',
  };
}

function actionQueryForWindow(windowName: string): string {
  const clean = windowName.replace(/_/g, ' ').toUpperCase();
  if (clean.includes('RAHU')) return 'RAHU';
  if (clean.includes('BRAHMA')) return 'BRAHMA';
  if (clean.includes('ABHIJIT')) return 'ABHIJIT';
  if (clean.includes('GULIKA')) return 'GULIKA';
  if (clean.includes('YAMA')) return 'YAMA';
  return 'NEUTRAL';
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ');
}

export function TimelineView({
  currentWindow,
  windows = [],
  currentMinuteOfDay,
  logEntries = [],
  loggedActivitiesToday = [],
  onLogActivity,
  onPlanActivity,
  onAskAuraClick,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const todayStr = now.toDateString();
  const activeMinute = currentMinuteOfDay ?? (now.getHours() * 60 + now.getMinutes());
  const nowAngle = (activeMinute / 1440) * 360;
  const nowHandPos = polarToCartesian(100, 100, 72, nowAngle);

  // Interactive selection and logging state
  const [selectedWindowItem, setSelectedWindowItem] = useState<TimelineWindowItem | null>(null);
  const [loggingTitle, setLoggingTitle] = useState<string | null>(null);
  const [logError, setLogError] = useState('');
  const [optimisticLogged, setOptimisticLogged] = useState<string[]>([]);

  const selectedWindowName = selectedWindowItem?.name || null;
  const activeWindowName = selectedWindowName || currentWindow?.name || 'NEUTRAL';
  const activeMeta = getWindowMeta(activeWindowName);
  const currentRecommendedCards: ActionCard[] = React.useMemo(() => {
    const cards = getActionCards(actionQueryForWindow(currentWindow?.name || 'NEUTRAL'));
    return Array.isArray(cards) ? cards.slice(0, 3) : [];
  }, [currentWindow?.name]);

  // Chronologically sorted schedule windows
  const sortedWindows = React.useMemo(() => {
    return [...windows].sort((a, b) => (a.startMinute ?? 0) - (b.startMinute ?? 0));
  }, [windows]);

  const nextOpportunity = React.useMemo(() => {
    return sortedWindows
      .filter((window) => (window.startMinute ?? 0) > activeMinute)
      .filter((window) => /ABHIJIT|BRAHMA|VIJAYA/i.test(window.name))
      .sort((a, b) => (b.type?.includes('ABHIJIT') ? 1 : 0) - (a.type?.includes('ABHIJIT') ? 1 : 0) || (a.startMinute ?? 0) - (b.startMinute ?? 0))[0] ?? null;
  }, [sortedWindows, activeMinute]);

  // Derive recommended action cards safely
  const recommendedCards: ActionCard[] = React.useMemo(() => {
    if (!selectedWindowName) return [];
    const res = getActivityDiscoveryCards(selectedWindowName, 8);
    return Array.isArray(res) ? res : [];
  }, [selectedWindowName]);

  const handleQuickLog = async (title: string) => {
    const normTitle = title.trim().toLowerCase();
    if (!normTitle || loggingTitle || allLoggedNormalized.has(normTitle)) return;
    setLogError('');
    setLoggingTitle(title);
    setOptimisticLogged((prev) => [...prev, normTitle]);

    try {
      if (onLogActivity) {
        await onLogActivity(title, undefined, undefined, selectedWindowItem?.name);
        
        // Trigger success haptic vibration upon successful quick log
        triggerHaptic('success');
      }
    } catch (err) {
      console.error('Error logging activity:', err);
      setOptimisticLogged((prev) => prev.filter((item) => item !== normTitle));
      setLogError(`Could not log ${title}. Try again.`);
    } finally {
      setLoggingTitle(null);
    }
  };

  const allLoggedNormalized = React.useMemo(() => {
    const fromProps = loggedActivitiesToday.map((t) => (t || '').trim().toLowerCase());
    return new Set([...fromProps, ...optimisticLogged]);
  }, [loggedActivitiesToday, optimisticLogged]);

  const full24HourArcs = React.useMemo(() => {
    const segments: Array<{
      startMinute: number;
      endMinute: number;
      color: string;
      gradient: string[];
      name: string;
      typeKey: string;
      windowObj?: TimelineWindowItem;
    }> = [];

    let cursor = 0;
    sortedWindows.forEach((w) => {
      const s = w.startMinute ?? 0;
      const e = w.endMinute ?? 0;

      if (s > cursor) {
        segments.push({
          startMinute: cursor,
          endMinute: s,
          color: '#1e293b',
          gradient: ['#334155', '#0f172a'],
          name: 'Neutral',
          typeKey: 'NEUTRAL',
        });
      }

      const meta = getWindowMeta(w.name);
      segments.push({
        startMinute: s,
        endMinute: e,
        color: w.color || meta.color,
        gradient: meta.gradient,
        name: w.name,
        typeKey: w.name,
        windowObj: w,
      });
      cursor = Math.max(cursor, e);
    });

    if (cursor < 1440) {
      segments.push({
        startMinute: cursor,
        endMinute: 1440,
        color: '#1e293b',
        gradient: ['#334155', '#0f172a'],
        name: 'Neutral',
        typeKey: 'NEUTRAL',
      });
    }

    return segments;
  }, [sortedWindows]);

  const handleSelectWindow = (e: React.MouseEvent, winName: string, windowObj?: TimelineWindowItem) => {
    e.stopPropagation();
    if (selectedWindowName === winName) {
      setSelectedWindowItem(null);
    } else {
      const match = windowObj || sortedWindows.find((w) => w.name === winName) || { name: winName };
      setSelectedWindowItem(match);
    }
    setLogError('');
  };

  const handleResetSelect = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedWindowItem(null);
    setLogError('');
  };

  // Helper to filter log entries for a given window
  const getWindowLogs = (winName: string, startMinute?: number, endMinute?: number) => {
    const cleanWinName = winName.toUpperCase().replace('_', ' ');
    return logEntries.filter((entry) => {
      const entryDate = new Date(entry.loggedAt).toDateString();
      if (entryDate !== todayStr) return false;

      const entryWin = entry.activeWindow ? entry.activeWindow.toUpperCase().replace('_', ' ') : '';
      if (entryWin && entryWin === cleanWinName) return true;

      if (startMinute !== undefined && endMinute !== undefined) {
        const entryMinute = entry.logMinuteOfDay ?? (new Date(entry.loggedAt).getHours() * 60 + new Date(entry.loggedAt).getMinutes());
        if (startMinute <= endMinute) {
          return entryMinute >= startMinute && entryMinute <= endMinute;
        }
        return entryMinute >= startMinute || entryMinute <= endMinute;
      }
      return false;
    });
  };

  // ---------------------------------------------------------------------------
  // DETAIL RECOMMENDATION SCREEN
  // ---------------------------------------------------------------------------
  if (selectedWindowItem) {
    const meta = getWindowMeta(selectedWindowItem.name);
    const formatMinStr = (m?: number) => {
      if (m === undefined || isNaN(m)) return '--:--';
      const hrs = Math.floor(m / 60) % 24;
      const mins = m % 60;
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    };

    const timeRangeStr = selectedWindowItem.startTime && selectedWindowItem.endTime
      ? `${selectedWindowItem.startTime} – ${selectedWindowItem.endTime}`
      : `${formatMinStr(selectedWindowItem.startMinute)} – ${formatMinStr(selectedWindowItem.endMinute)}`;

    const currentWindowLogs = getWindowLogs(selectedWindowItem.name, selectedWindowItem.startMinute, selectedWindowItem.endMinute);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 24, color: '#f8fafc', fontFamily: 'sans-serif' }}>
        {/* Back Navigation Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            onClick={() => handleResetSelect()}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff',
              borderRadius: '50%',
              width: 38,
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            ←
          </button>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, fontFamily: 'sans-serif', lineHeight: 1.2 }}>
              {meta.title.split(' (')[0]}
            </h1>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0', fontFamily: 'monospace' }}>
              {timeRangeStr}
            </p>
          </div>
        </div>

        {/* Selected Window Banner Card */}
        <div
          style={{
            background: 'rgba(15, 23, 42, 0.9)',
            border: `1px solid ${meta.color}44`,
            borderRadius: 16,
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            boxShadow: `0 0 20px ${meta.color}15`,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: `${meta.color}22`,
              border: `1px solid ${meta.color}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {meta.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'sans-serif' }}>
              {meta.title}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, fontFamily: 'sans-serif' }}>
              {meta.title.startsWith('Neutral')
                ? 'Flexible window · good for everyday activities, habits, and steady progress.'
                : 'Activities that fit the qualities of this Panchang window.'}
            </div>

            {/* Render Logged Badges inside Banner if Any exist */}
            {currentWindowLogs.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {currentWindowLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: 'rgba(74, 222, 128, 0.12)',
                      border: '1px solid rgba(74, 222, 128, 0.3)',
                      color: '#4ade80',
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontWeight: 600,
                    }}
                  >
                    <span>✓</span>
                    <span>{log.activityTitle}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Activity Discovery Cards List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontFamily: 'var(--as-font-mono)', textTransform: 'uppercase', color: '#aab7d2', letterSpacing: '0.04em', fontWeight: 900 }}>
              Good choices for this window
            </span>
          </div>
          {logError && (
            <div style={{ color: '#fb7185', fontSize: 12, lineHeight: 1.35, background: 'rgba(251, 113, 133, 0.08)', border: '1px solid rgba(251, 113, 133, 0.22)', borderRadius: 10, padding: '9px 10px' }}>
              {logError}
            </div>
          )}

          {recommendedCards.map((card, idx) => {
            const cardTitleNorm = card.title.trim().toLowerCase();
            const isAlreadyLogged = allLoggedNormalized.has(cardTitleNorm);
            const isLoggingThis = loggingTitle === card.title;
            const fitLabel = card.fit === 'BEST' ? 'Best fit' : card.fit === 'GOOD' ? 'Good fit' : card.fit === 'CAUTION' ? 'Use lightly' : 'Usable';
            const fitColor = card.fit === 'CAUTION' ? '#facc15' : card.fit === 'USABLE' ? '#7dd3fc' : '#4ade80';

            return (
              <div
                key={card.id || idx}
                style={{
                  background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
                  border: isAlreadyLogged
                    ? '1px solid rgba(74, 222, 128, 0.25)'
                    : '1px solid rgba(96, 165, 250, 0.18)',
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <span style={{ fontSize: 22 }}>{card.icon || '🎯'}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 10, fontWeight: 900, color: fitColor, fontFamily: 'var(--as-font-mono)', letterSpacing: '0.05em', display: 'inline-block', marginBottom: 5, textTransform: 'uppercase' }}>
                      {fitLabel}
                    </span>
                    <h3 style={{ fontSize: 16, fontWeight: 900, color: '#fff', margin: 0, fontFamily: 'sans-serif', lineHeight: 1.18 }}>
                      {card.title}
                    </h3>
                    <p style={{ fontSize: 13, color: '#aab7d2', margin: '6px 0 0', lineHeight: 1.4, fontFamily: 'sans-serif' }}>
                      {card.description}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
                  {onPlanActivity && !isAlreadyLogged && (
                    <button
                      type="button"
                      onClick={() => onPlanActivity(card.title)}
                      style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#7dd3fc', border: '1px solid rgba(56, 189, 248, 0.42)', borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 850, cursor: 'pointer', fontFamily: 'sans-serif' }}
                    >
                      Plan
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleQuickLog(card.title)}
                    disabled={isAlreadyLogged || !!loggingTitle}
                    style={{
                      background: isAlreadyLogged
                        ? 'rgba(74, 222, 128, 0.12)'
                        : isLoggingThis
                        ? '#4ade80'
                        : 'rgba(255, 255, 255, 0.08)',
                      color: isAlreadyLogged ? '#4ade80' : isLoggingThis ? '#020617' : '#fff',
                      border: isAlreadyLogged
                        ? '1px solid rgba(74, 222, 128, 0.3)'
                        : '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 10,
                      padding: '8px 14px',
                      fontSize: 12,
                      fontWeight: 850,
                      cursor: isAlreadyLogged ? 'default' : 'pointer',
                      transition: 'all 0.15s ease',
                      fontFamily: 'sans-serif',
                    }}
                  >
                    {isAlreadyLogged ? '✓ Logged' : isLoggingThis ? 'Logging...' : 'Log'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Ask Aura Trigger */}
        {onAskAuraClick && (
          <div
            style={{
              background: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'sans-serif' }}>Not sure what to do?</div>
              <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'sans-serif' }}>Get a personalized suggestion</div>
            </div>
            <button
              type="button"
              onClick={onAskAuraClick}
              style={{
                background: '#4ade80',
                color: '#020617',
                border: 'none',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'sans-serif',
              }}
            >
              Ask Aura
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN ARC DIAL VIEW
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 24, color: '#f8fafc', fontFamily: 'sans-serif' }}
    >
      <style>{`
        @keyframes dialPulse {
          0% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.4); opacity: 0.25; }
          100% { transform: scale(1); opacity: 0.8; }
        }
        .dial-arc-path {
          transition: stroke-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), filter 0.2s ease, opacity 0.2s ease;
          cursor: pointer;
        }
        .dial-arc-path:hover {
          stroke-width: 17px !important;
          filter: drop-shadow(0 0 8px rgba(255,255,255,0.45));
        }
      `}</style>

      {/* Top Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: 'sans-serif' }}>
          Today's Timeline
        </h1>
        <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, fontFamily: 'sans-serif' }}>
          All times shown in your local time
        </p>
      </div>

      {/* Center 24-Hour Interactive Dial */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          padding: '10px 0',
        }}
      >
        <div style={{ position: 'relative', width: 260, height: 260 }}>
          <svg width="260" height="260" viewBox="0 0 200 200">
            <defs>
              {full24HourArcs.map((seg, i) => (
                <linearGradient id={`arc-grad-${i}`} key={i} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={seg.gradient[0]} />
                  <stop offset="100%" stopColor={seg.gradient[1]} />
                </linearGradient>
              ))}

              <filter id="knob-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Base Inner Ring Track */}
            <circle cx="100" cy="100" r="72" stroke="#0f172a" strokeWidth="16" fill="none" />

            {/* Continuous 24-Hour Interactive Arc Segments */}
            {full24HourArcs.map((seg, idx) => {
              let startDeg = (seg.startMinute / 1440) * 360;
              let endDeg = (seg.endMinute / 1440) * 360;
              if (endDeg <= startDeg) endDeg += 360;
              if (endDeg - startDeg > 1) {
                startDeg += 0.4;
                endDeg -= 0.4;
              }

              return (
                <path
                  key={idx}
                  className="dial-arc-path"
                  d={describeArc(100, 100, 72, startDeg, endDeg)}
                  fill="none"
                  stroke={`url(#arc-grad-${idx})`}
                  strokeWidth="14"
                  strokeLinecap="round"
                  onClick={(e) => handleSelectWindow(e, seg.typeKey, seg.windowObj)}
                />
              );
            })}

            {/* Hour Scale Markers */}
            <text x="100" y="16" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">00</text>
            <text x="156" y="38" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">03</text>
            <text x="186" y="103" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">06</text>
            <text x="156" y="168" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">09</text>
            <text x="100" y="192" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">12</text>
            <text x="44" y="168" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">15</text>
            <text x="14" y="103" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">18</text>
            <text x="44" y="38" fill="#64748b" fontSize="8" textAnchor="middle" fontFamily="monospace">21</text>

            {/* Active Time Floating Glow Knob */}
            <circle
              cx={nowHandPos.x}
              cy={nowHandPos.y}
              r="12"
              fill={getWindowMeta(currentWindow?.name || 'NEUTRAL').color}
              opacity="0.35"
              style={{ transformOrigin: `${nowHandPos.x}px ${nowHandPos.y}px`, animation: 'dialPulse 2s infinite ease-in-out' }}
            />
            <circle
              cx={nowHandPos.x}
              cy={nowHandPos.y}
              r="7.5"
              fill="#ffffff"
              stroke="#020617"
              strokeWidth="2"
              filter="url(#knob-glow)"
            />
          </svg>

          {/* Inner Center Display */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              width: 140,
            }}
          >
            <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.08em', fontWeight: 800 }}>
              NOW
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: 16 }}>{activeMeta.icon}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#ffffff', lineHeight: 1.2, fontFamily: 'sans-serif' }}>
                {activeMeta.title.split(' (')[0]}
              </span>
            </div>

            <span style={{ fontSize: 11, color: '#cbd5e1', marginTop: 8, fontFamily: 'sans-serif' }}>
              {currentWindow?.timeRemaining || '--'} remaining
            </span>

            <span style={{ fontSize: 9, color: '#94a3b8', marginTop: 5, lineHeight: 1.25, fontFamily: 'sans-serif' }}>
              {currentRecommendedCards.length > 0 ? `Good for ${currentRecommendedCards[0].title.toLowerCase()}` : 'Choose a task that fits your current energy.'}
            </span>
          </div>
        </div>
      </div>

      {nextOpportunity && (
        <div style={{ background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.28)', borderRadius: 14, padding: 13 }}>
          <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>⭐ Next Best Opportunity</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 6, alignItems: 'baseline' }}>
            <span style={{ color: '#f8fafc', fontWeight: 750, fontSize: 13 }}>{getWindowMeta(nextOpportunity.name).title.split(' (')[0]}</span>
            <span style={{ color: '#b6c2d1', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{nextOpportunity.startTime} - {nextOpportunity.endTime}</span>
          </div>
          <div style={{ color: '#dbe7f4', fontSize: 11, marginTop: 5 }}>Best suited for high-focus or high-impact work.</div>
        </div>
      )}

      {/* Schedule Items List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {sortedWindows.map((win, idx) => {
          const meta = getWindowMeta(win.name);
          
          // Strict time-range boundary check to ensure only the CURRENT card glows
          const sMin = win.startMinute ?? 0;
          const eMin = win.endMinute ?? 1440;
          const isActive = sMin <= eMin
            ? activeMinute >= sMin && activeMinute < eMin
            : activeMinute >= sMin || activeMinute < eMin;
          const isCompleted = !isActive && eMin <= activeMinute;
          const isUpcoming = !isActive && sMin > activeMinute;

          const formatMinStr = (m?: number) => {
            if (m === undefined || isNaN(m)) return '--:--';
            const hrs = Math.floor(m / 60) % 24;
            const mins = m % 60;
            return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
          };

          const timeRange = win.startTime && win.endTime
            ? `${win.startTime} – ${win.endTime}`
            : `${formatMinStr(win.startMinute)} – ${formatMinStr(win.endMinute)}`;

          const windowLogs = getWindowLogs(win.name, win.startMinute, win.endMinute);
          const overlappingWindow = sortedWindows.find((other) => {
            if (other === win || !(/ABHIJIT|GULIKA/i.test(win.name) && /ABHIJIT|GULIKA/i.test(other.name))) return false;
            const overlapStart = Math.max(sMin, other.startMinute ?? 0);
            const overlapEnd = Math.min(eMin, other.endMinute ?? 0);
            return overlapEnd > overlapStart;
          });
          const overlapMinutes = overlappingWindow
            ? Math.max(0, Math.min(eMin, overlappingWindow.endMinute ?? 0) - Math.max(sMin, overlappingWindow.startMinute ?? 0))
            : 0;

          return (
            <div
              key={idx}
              onClick={(e) => handleSelectWindow(e, win.name, win)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px 16px',
                borderRadius: 14,
                cursor: 'pointer',
                background: isActive ? 'rgba(139, 92, 246, 0.22)' : 'rgba(15, 23, 42, 0.6)',
                border: isActive ? '1px solid rgba(139, 92, 246, 0.5)' : isUpcoming ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(255, 255, 255, 0.04)',
                boxShadow: isActive ? '0 0 16px rgba(139, 92, 246, 0.25)' : 'none',
                opacity: isCompleted ? 0.58 : 1,
                transition: 'all 0.2s ease',
              }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: meta.color,
                      boxShadow: `0 0 8px ${meta.color}`,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? '#ffffff' : '#e2e8f0', fontFamily: 'sans-serif' }}>
                    {meta.title}
                  </span>
                </div>

                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: isActive ? '#c084fc' : '#94a3b8', whiteSpace: 'nowrap' }}>
                  {timeRange}
                  </span>
                </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 22, minHeight: 16 }}>
                <span style={{ fontSize: 10, color: isActive ? '#86efac' : isCompleted ? '#64748b' : '#94a3b8', fontWeight: 700 }}>
                  {isActive ? '● NOW' : isCompleted ? 'Passed' : 'Upcoming'}
                </span>
                {windowLogs.length > 0 && <span style={{ fontSize: 10, color: isCompleted ? '#64748b' : '#86efac' }}>{windowLogs.length} logged</span>}
              </div>

              {overlapMinutes > 0 && (
                <div style={{ paddingLeft: 22, color: '#c4b5fd', fontSize: 10, fontWeight: 700 }}>
                  {overlapMinutes} min overlap with {getWindowMeta(overlappingWindow?.name || '').title.split(' (')[0]}
                </div>
              )}

              {isActive && currentRecommendedCards.length > 0 && (
                <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 10, color: '#b6c2d1', fontWeight: 700 }}>Good for now</span>
                  {currentRecommendedCards.map((card) => (
                    <div key={card.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: '#dbe7f4', fontSize: 10 }}>{card.icon} {card.title}</span>
                      <span style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                        {onPlanActivity && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onPlanActivity(card.title); }} style={{ background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.28)', color: '#7dd3fc', borderRadius: 7, fontSize: 9, padding: '3px 6px' }}>
                            Plan
                          </button>
                        )}
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleQuickLog(card.title); }} disabled={allLoggedNormalized.has(card.title.toLowerCase()) || !!loggingTitle} style={{ background: 'rgba(74, 222, 128, 0.12)', border: '1px solid rgba(74, 222, 128, 0.28)', color: '#86efac', borderRadius: 7, fontSize: 9, padding: '3px 6px' }}>
                          {allLoggedNormalized.has(card.title.toLowerCase()) ? 'Logged' : 'Log'}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
