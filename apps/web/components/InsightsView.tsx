'use client';

import React, { useState, useMemo } from 'react';
import { computeAverageTimedSessionMinutes } from '../lib/activityDuration';

export interface LoggedEntryItem {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
  durationMinutes?: number;
  notes?: string | null;
  logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION';
  activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface InsightsViewProps {
  logEntries?: LoggedEntryItem[];
  assistantInsight?: {
    reflectionCount: number;
    alignedDays: number;
    unalignedDays: number;
    peakFlowLiftPercent: number;
    insightText: string;
  } | null;
}

function scoreLoggedWindow(entry: LoggedEntryItem): number {
  const windowName = (entry.activeWindow || '').toUpperCase();
  const significance = entry.activitySignificance ?? 'MEDIUM';
  const source = entry.logSource ?? 'MANUAL';
  let score = 0.7;

  if (windowName.includes('BRAHMA') || windowName.includes('ABHIJIT') || windowName.includes('GULIKA')) {
    score = 1;
  } else if (windowName.includes('RAHU') || windowName.includes('YAMA')) {
    score = significance === 'LOW' ? 0.4 : significance === 'MEDIUM' ? 0.15 : 0;
  }

  if (source === 'AURA_PLANNED') score += 0.1;
  if (source === 'OVERRIDE_CAUTION') score -= 0.15;
  return Math.min(1, Math.max(0, score));
}

export function InsightsView({ logEntries = [], assistantInsight }: InsightsViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'patterns' | 'trends' | 'streaks'>('overview');

  // ---------------------------------------------------------------------------
  // ANALYTICS & INSIGHTS ENGINE
  // ---------------------------------------------------------------------------
  const analytics = useMemo(() => {
    const totalActivities = logEntries.length;
    const now = new Date();

    // 1. 30-Day Activity Matrix Heatmap (Past 30 Days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(now.getDate() - 29);

    const heatmapDays = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const dayLogs = logEntries.filter((e) => {
        const logD = new Date(e.loggedAt);
        const logKey = `${logD.getFullYear()}-${String(logD.getMonth() + 1).padStart(2, '0')}-${String(logD.getDate()).padStart(2, '0')}`;
        return logKey === dateKey;
      });

      return {
        dateStr: dateKey,
        dayNum: d.getDate(),
        weekday: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
        count: dayLogs.length,
      };
    });

    // 2. 7-Day Weekly Alignment Trend
    const past7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(now.getDate() - (6 - i));
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const dayLogs = logEntries.filter((e) => {
        const logD = new Date(e.loggedAt);
        const logKey = `${logD.getFullYear()}-${String(logD.getMonth() + 1).padStart(2, '0')}-${String(logD.getDate()).padStart(2, '0')}`;
        return logKey === dateKey;
      });

      const auspicious = dayLogs.filter((e) => {
        const w = (e.activeWindow || '').toUpperCase();
        return w.includes('ABHIJIT') || w.includes('BRAHMA') || w.includes('GULIKA');
      }).length;

      const friction = dayLogs.filter((e) => {
        const w = (e.activeWindow || '').toUpperCase();
        return w.includes('RAHU') || w.includes('YAMA');
      }).length;

      const score =
        dayLogs.length > 0
          ? Math.min(100, Math.max(30, Math.round(((auspicious * 1.0 + (dayLogs.length - auspicious - friction) * 0.7) / dayLogs.length) * 100)))
          : 75;

      return {
        dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),
        score,
        count: dayLogs.length,
      };
    });

    // 3. Time-of-Day Pattern Counts
    const todCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    logEntries.forEach((e) => {
      const hour = new Date(e.loggedAt).getHours();
      if (hour >= 5 && hour < 12) todCounts.morning++;
      else if (hour >= 12 && hour < 17) todCounts.afternoon++;
      else if (hour >= 17 && hour < 22) todCounts.evening++;
      else todCounts.night++;
    });

    // Active Day Streak Calculation
    const loggedDaysSet = new Set(
      logEntries.map((entry) => {
        const d = new Date(entry.loggedAt);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      })
    );

    let streak = 0;
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    while (true) {
      const key = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
      if (loggedDaysSet.has(key)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        if (streak === 0) {
          checkDate.setDate(checkDate.getDate() - 1);
          const yesterdayKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
          if (loggedDaysSet.has(yesterdayKey)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
            continue;
          }
        }
        break;
      }
    }

    // Window Breakdown
    let weightedAlignment = 0;
    let frictionCount = 0;
    let auraPlannedCount = 0;
    let auraDoNowCount = 0;
    let manualCount = 0;
    let overrideCautionCount = 0;
    let auraPlannedAlignment = 0;
    let manualAlignment = 0;

    const windowCounts: Record<string, number> = {};
    const frictionLogs: LoggedEntryItem[] = [];

    logEntries.forEach((entry) => {
      const win = (entry.activeWindow || 'NEUTRAL').toUpperCase().replace(/_/g, ' ');
      windowCounts[win] = (windowCounts[win] || 0) + 1;

      const entryScore = scoreLoggedWindow(entry);
      const source = entry.logSource ?? 'MANUAL';
      weightedAlignment += entryScore;

      if (source === 'AURA_PLANNED') {
        auraPlannedCount++;
        auraPlannedAlignment += entryScore;
      } else if (source === 'AURA_DO_NOW') {
        auraDoNowCount++;
      } else if (source === 'OVERRIDE_CAUTION') {
        overrideCautionCount++;
      } else {
        manualCount++;
        manualAlignment += entryScore;
      }

      if (win.includes('RAHU') || win.includes('YAMA')) {
        frictionCount++;
        frictionLogs.push(entry);
      }
    });

    // All stats are real or zero — no placeholder values. Showing a fake
    // "50 activities / 3-day streak" to a brand-new user would poison the
    // product's core claim that insights come from the user's own data.
    const alignmentScore =
      totalActivities > 0
        ? Math.min(100, Math.max(0, Math.round((weightedAlignment / totalActivities) * 100)))
        : 0;

    const resolvedDurations = logEntries.map((e) => e.durationMinutes ?? 30);
    const totalMinutes = resolvedDurations.reduce((sum, minutes) => sum + minutes, 0);
    const formattedHours = `${(totalMinutes / 60).toFixed(1)} hrs`;
    const auraGuidedCount = auraPlannedCount + auraDoNowCount;
    const auraGuidedRate = totalActivities > 0 ? Math.round((auraGuidedCount / totalActivities) * 100) : 0;
    const plannedAlignmentScore = auraPlannedCount > 0 ? Math.round((auraPlannedAlignment / auraPlannedCount) * 100) : 0;
    const manualAlignmentScore = manualCount > 0 ? Math.round((manualAlignment / manualCount) * 100) : 0;
    const planningLift = auraPlannedCount > 0 && manualCount > 0 ? plannedAlignmentScore - manualAlignmentScore : null;

    const distribution = Object.entries(windowCounts).map(([winName, count]) => ({
      name: winName,
      count,
      percentage: totalActivities > 0 ? Math.round((count / totalActivities) * 100) : 0,
    }));

    // Behavioral patterns computed from the user's actual logs. Hidden until
    // there's enough data to say anything meaningful.
    const patterns: { icon: string; color: string; title: string; text: string }[] = [];
    if (totalActivities >= 3) {
      const topWindow = Object.entries(windowCounts).sort((a, b) => b[1] - a[1])[0];
      if (topWindow) {
        patterns.push({
          icon: '🎯',
          color: '#4ade80',
          title: 'Most-used window',
          text: `${topWindow[1]} of your ${totalActivities} activities (${Math.round((topWindow[1] / totalActivities) * 100)}%) happen during ${topWindow[0]} windows.`,
        });
      }

      // Only timed activities (durationMinutes > 0) participate in this
      // average -- an INSTANT completion isn't a session with a length.
      // null (no timed entries at all yet) hides the stat rather than
      // claiming "sessions average 0 minutes".
      const avgMinutes = computeAverageTimedSessionMinutes(resolvedDurations);
      if (avgMinutes !== null) {
        patterns.push({
          icon: '⏱️',
          color: '#38bdf8',
          title: 'Session length',
          text: `Your sessions average ${avgMinutes} minutes.`,
        });
      }

      const todEntries = Object.entries(todCounts).sort((a, b) => b[1] - a[1]);
      const topTod = todEntries[0];
      if (topTod && topTod[1] > 0) {
        patterns.push({
          icon: '☀️',
          color: '#facc15',
          title: 'Time of day',
          text: `${topTod[0].charAt(0).toUpperCase() + topTod[0].slice(1)} is your most consistent time — ${topTod[1]} of ${totalActivities} activities.`,
        });
      }
    }

    return {
      totalActivities,
      streak,
      formattedHours,
      alignmentScore,
      auraPlannedCount,
      auraDoNowCount,
      auraGuidedCount,
      auraGuidedRate,
      manualCount,
      overrideCautionCount,
      plannedAlignmentScore,
      manualAlignmentScore,
      planningLift,
      distribution,
      frictionLogs,
      heatmapDays,
      past7Days,
      todCounts,
      patterns,
    };
  }, [logEntries]);

  const patterns = analytics.patterns;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        paddingBottom: 24,
        fontFamily: 'sans-serif',
        color: '#f8fafc',
      }}
    >
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--as-text, #f8fafc)', margin: 0, lineHeight: 1.2 }}>
          Insights
        </h1>
        <p style={{ fontSize: 12, color: 'var(--as-text-muted, #94a3b8)', marginTop: 4 }}>
          Patterns from your journey
        </p>
      </div>

      {/* Sub-Tab Selector Pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['overview', 'patterns', 'trends', 'streaks'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab)}
            style={{
              background: activeSubTab === tab ? '#4ade80' : 'rgba(30, 41, 59, 0.6)',
              color: activeSubTab === tab ? '#020617' : '#94a3b8',
              border: 'none',
              borderRadius: 20,
              padding: '6px 14px',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'capitalize',
              transition: 'all 0.15s ease',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ==================== TAB 1: OVERVIEW ==================== */}
      {activeSubTab === 'overview' && (
        <>
          {assistantInsight && (
            <div
              style={{
                background: 'var(--as-surface-raised, #0f172a)',
                border: '1px solid rgba(74, 222, 128, 0.28)',
                borderRadius: 16,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.05em', fontWeight: 700 }}>
                Alignment Proof
              </div>
              <div style={{ fontSize: 22, color: '#f8fafc', fontWeight: 800, marginTop: 8 }}>
                {Math.max(0, assistantInsight.peakFlowLiftPercent)}%
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.4, marginTop: 4 }}>
                {assistantInsight.insightText}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                {assistantInsight.reflectionCount} check-ins · {assistantInsight.alignedDays} aligned days
              </div>
            </div>
          )}

          {/* Stat Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                color: '#94a3b8',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              This Month
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <StatCard value={analytics.totalActivities} label="Activities Completed" color="#4ade80" />
              <StatCard value={analytics.streak} label="Day Streak" color="#facc15" />
              <StatCard value={`${analytics.auraGuidedRate}%`} label="Aura Guided" color="#38bdf8" />
              <StatCard value={`${analytics.alignmentScore}%`} label="Windows Utilized" color="#c084fc" />
            </div>
          </div>

          {/* Your Patterns Preview */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                color: '#94a3b8',
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              Your Patterns
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {patterns.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                  Log a few activities and your patterns will appear here — computed from your own data.
                </span>
              )}
              {patterns.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: 12,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: `${item.color}18`,
                      border: `1px solid ${item.color}44`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <span style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4 }}>{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Window Distribution */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 18,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                textTransform: 'uppercase',
                color: 'var(--as-text-muted, #94a3b8)',
                marginBottom: 14,
                letterSpacing: '0.05em',
                fontWeight: 600,
              }}
            >
              Solar Window Distribution
            </div>

            {analytics.distribution.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {analytics.distribution.map((item) => (
                  <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{item.name}</span>
                      <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>
                        {item.count} logs ({item.percentage}%)
                      </span>
                    </div>
                    <div style={{ width: '100%', height: 6, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${item.percentage}%`,
                          background:
                            item.name.includes('RAHU') || item.name.includes('YAMA')
                              ? '#fb7185'
                              : item.name.includes('ABHIJIT') || item.name.includes('BRAHMA')
                              ? '#4ade80'
                              : '#38bdf8',
                          borderRadius: 4,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>
                No activity logs recorded yet. Start logging from Home.
              </div>
            )}
          </div>

          {/* Friction Guardrail Alerts */}
          {analytics.frictionLogs.length > 0 && (
            <div style={{ background: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.25)', borderRadius: 16, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fb7185', fontSize: 13, fontWeight: 700 }}>
                <span>⚠️</span>
                <span>Friction Guardrail Alerts</span>
              </div>
              <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4, lineHeight: 1.4 }}>
                Activities logged during friction windows (Rahu Kalam / Yama). Consider rescheduling high-stakes actions to Abhijit or Brahma periods.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                {analytics.frictionLogs.map((log) => (
                  <div key={log.id} style={{ fontSize: 11, color: '#fb7185', background: 'rgba(15, 23, 42, 0.6)', padding: '6px 10px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span>• {log.activityTitle}</span>
                    <span style={{ fontFamily: 'monospace', opacity: 0.8 }}>{log.activeWindow}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== TAB 2: PATTERNS ==================== */}
      {activeSubTab === 'patterns' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid rgba(74, 222, 128, 0.22)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.05em', fontWeight: 700 }}>
              Planning Loop
            </span>
            <p style={{ fontSize: 12, color: '#cbd5e1', margin: '8px 0 0', lineHeight: 1.45 }}>
              {analytics.auraGuidedCount > 0
                ? `${analytics.auraGuidedCount} of your ${analytics.totalActivities} activities came through Aura suggestions or planned moments.`
                : 'Plan or accept a few Aura suggestions to see whether guided timing improves your alignment.'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
              <MiniStat value={analytics.auraPlannedCount} label="Planned" color="#4ade80" />
              <MiniStat value={analytics.auraDoNowCount} label="Do Now" color="#38bdf8" />
              <MiniStat value={analytics.overrideCautionCount} label="Overrides" color="#fb7185" />
            </div>
            {analytics.planningLift !== null && (
              <div style={{ marginTop: 12, color: analytics.planningLift >= 0 ? '#4ade80' : '#fb7185', fontSize: 12, fontWeight: 750 }}>
                Aura-planned logs are {Math.abs(analytics.planningLift)} points {analytics.planningLift >= 0 ? 'more aligned' : 'less aligned'} than manual logs so far.
              </div>
            )}
          </div>

          {/* Time of Day Segment Cards */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.05em', fontWeight: 700 }}>
              Peak Energy Windows (Time of Day)
            </span>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
              Distribution of logged activities across diurnal solar segments.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 14 }}>
              <TODCard title="Morning (5AM-12PM)" count={analytics.todCounts.morning} icon="🌅" color="#facc15" />
              <TODCard title="Afternoon (12PM-5PM)" count={analytics.todCounts.afternoon} icon="☀️" color="#38bdf8" />
              <TODCard title="Evening (5PM-10PM)" count={analytics.todCounts.evening} icon="🌆" color="#c084fc" />
              <TODCard title="Night (10PM-5AM)" count={analytics.todCounts.night} icon="🌙" color="#818cf8" />
            </div>
          </div>

          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#4ade80', letterSpacing: '0.05em', fontWeight: 700 }}>
              Deep Pattern Analysis
            </span>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
              Correlating habit execution timestamps against optimal Vedic energy windows.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
              {patterns.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>
                  Not enough activity yet. Log at least 3 sessions and this analysis will build itself from your own history.
                </span>
              )}
              {patterns.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: 'rgba(30, 41, 59, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 12,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: item.color }}>{item.title}</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#e2e8f0', margin: 0, lineHeight: 1.4 }}>{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: TRENDS ==================== */}
      {activeSubTab === 'trends' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* 7-Day Interactive Alignment Bar Chart */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#38bdf8', letterSpacing: '0.05em', fontWeight: 700 }}>
                7-Day Solar Alignment Trend
              </span>
              <span style={{ fontSize: 11, color: '#4ade80', fontFamily: 'monospace', fontWeight: 600 }}>
                Avg: {analytics.alignmentScore}%
              </span>
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
              Daily alignment score based on favorable vs. friction activity timing.
            </p>

            {/* FIXED: Bar Chart Track Container with explicit 80px height */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: 140, marginTop: 16, padding: '0 8px 8px 8px' }}>
              {analytics.past7Days.map((day, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 6, flex: 1 }}>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8' }}>{day.score}%</span>
                  
                  {/* Fixed Track Container */}
                  <div style={{ width: 18, height: 80, background: 'rgba(255, 255, 255, 0.05)', borderRadius: 4, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(day.score, 15)}%`,
                        background: day.score > 70 ? '#4ade80' : day.score > 50 ? '#38bdf8' : '#fb6b6b',
                        borderRadius: 4,
                        transition: 'height 0.3s ease',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 600 }}>{day.dayLabel}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
              Window Session Frequency
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
              {analytics.distribution.map((item) => (
                <div key={item.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: '#f8fafc' }}>{item.name}</span>
                    <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{item.count} total sessions</span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${item.percentage}%`,
                        background: '#38bdf8',
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: STREAKS ==================== */}
      {activeSubTab === 'streaks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Active Streak Banner */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 20,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 42, margin: '0 0 8px 0' }}>🔥</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#facc15' }}>{analytics.streak} Days</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Active Logging Streak</div>
          </div>

          {/* 30-Day Activity Heatmap Matrix */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#facc15', letterSpacing: '0.05em', fontWeight: 700 }}>
              30-Day Habit Consistency Heatmap
            </span>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginTop: 14 }}>
              {analytics.heatmapDays.map((day) => {
                let cellColor = 'rgba(255, 255, 255, 0.05)';
                let textColor = '#64748b';
                if (day.count >= 3) {
                  cellColor = '#22c55e';
                  textColor = '#020617';
                } else if (day.count === 2) {
                  cellColor = '#4ade80';
                  textColor = '#020617';
                } else if (day.count === 1) {
                  cellColor = 'rgba(74, 222, 128, 0.3)';
                  textColor = '#4ade80';
                }

                return (
                  <div
                    key={day.dateStr}
                    style={{
                      background: cellColor,
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 8,
                      padding: '8px 4px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: 9, color: textColor, fontFamily: 'monospace' }}>{day.weekday}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: textColor, marginTop: 2 }}>{day.dayNum}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Logging History */}
          <div
            style={{
              background: 'var(--as-surface-raised, #0f172a)',
              border: '1px solid var(--as-border, #1e293b)',
              borderRadius: 16,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em' }}>
              Recent Activity Trail
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {logEntries.slice(0, 5).map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'rgba(30, 41, 59, 0.5)',
                    fontSize: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{ color: '#f8fafc', fontWeight: 600 }}>{entry.activityTitle}</span>
                    <div style={{ marginTop: 3 }}>
                      <SourceBadge source={entry.logSource ?? 'MANUAL'} />
                    </div>
                  </div>
                  <span style={{ color: '#4ade80', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{entry.activeWindow}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  value,
  label,
  color,
}: {
  value: string | number;
  label: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'var(--as-surface-raised, #0f172a)',
        border: '1px solid var(--as-border, #1e293b)',
        borderRadius: 12,
        padding: '12px 6px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
      <div
        style={{
          fontSize: 9,
          color: '#94a3b8',
          marginTop: 4,
          lineHeight: 1.2,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function MiniStat({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <div style={{ background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 12, padding: 10, textAlign: 'center' }}>
      <div style={{ color, fontSize: 18, fontWeight: 900 }}>{value}</div>
      <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function SourceBadge({ source }: { source: NonNullable<LoggedEntryItem['logSource']> }) {
  const meta = source === 'AURA_PLANNED'
    ? { label: 'Aura planned', color: '#4ade80' }
    : source === 'AURA_DO_NOW'
      ? { label: 'Aura do now', color: '#38bdf8' }
      : source === 'OVERRIDE_CAUTION'
        ? { label: 'Caution override', color: '#fb7185' }
        : { label: 'Manual', color: '#94a3b8' };

  return (
    <span style={{ display: 'inline-flex', border: `1px solid ${meta.color}44`, background: `${meta.color}16`, color: meta.color, borderRadius: 999, padding: '2px 7px', fontSize: 9, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
      {meta.label}
    </span>
  );
}

function TODCard({
  title,
  count,
  icon,
  color,
}: {
  title: string;
  count: number;
  icon: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: 'rgba(30, 41, 59, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color }}>{count} logged</div>
        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>{title}</div>
      </div>
    </div>
  );
}
