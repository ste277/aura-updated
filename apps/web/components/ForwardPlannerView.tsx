'use client';

import React, { useState } from 'react';
import { PageHeader, SectionHeader, SurfaceCard, ActivityChip, DurationChip, PrimaryButton, SecondaryButton, TextButton, EmptyState, StatusBadge } from './ui';
import { spacing, typography, colors, backButtonStyle } from './theme';
import { formatPlanTimeRange, RESULT_LABEL_TEXT } from '../lib/planFormatting';
import { saveUpcomingPlanFromCandidate } from './PlanWithAuraView';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import type { ForwardPlannerHorizon } from '../lib/forwardPlanner';
import type { ForwardPlannerResult, ForwardPlannerOption } from '../lib/forwardPlannerOrchestrator';
import type { TimingSearchResponse } from '../../../packages/recommendation/src/timingSearch';

/**
 * Forward Planner V1 -- "Plan Ahead" surface.
 *
 * A dedicated, user-invoked screen (never embedded in Home -- Home stays
 * today-first): pick an activity, pick a future range, get up to 3
 * personalized best-time options. Own client-owned fetch of
 * POST /api/forward-planner -- no server-owned search-session state, no
 * URL persistence.
 *
 * WHY AURA NOT REUSED (deliberate, see this feature's own architecture
 * audit): a Forward Planner option's timing "source" is neither an
 * existing Plan nor a Day Builder intention -- ConcreteGuidanceCandidateSource
 * is a closed 2-value union, and expanding it (or whyAuraViewModel.ts's own
 * signature) just for this one new caller was judged not worth the diff to
 * a protected, carefully-typed file. No "Why?" affordance in V1 -- result
 * cards show only date, time, and timing quality.
 *
 * SCHEDULE ACTION: `ForwardPlannerOption` deliberately never carries a raw
 * TimingCandidate/metadata/score (see forwardPlannerOrchestrator.ts's own
 * doc comment) -- so "Schedule" re-resolves a full TimingCandidate for the
 * exact chosen instant via the EXISTING general-purpose
 * POST /api/timing-search (mode: CHECK, the same endpoint PlanWithAuraView's
 * own CHECK tab already uses), then hands that straight to the existing
 * saveUpcomingPlanFromCandidate/POST /api/plans pipeline -- no new
 * persistence logic of any kind.
 */

const DURATION_OPTIONS_MINUTES = [15, 30, 60, 90, 120];

const HORIZON_OPTIONS: { value: ForwardPlannerHorizon; label: string }[] = [
  { value: 'TOMORROW', label: 'Tomorrow' },
  { value: 'WEEKEND', label: 'This weekend' },
  { value: 'SEVEN_DAYS', label: 'Next 7 days' },
  { value: 'CUSTOM', label: 'Pick a date' },
];

function formatLocalDateLabel(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function rangeHeaderLabel(horizon: ForwardPlannerHorizon, range: { startLocalDate: string; endLocalDate: string }): string {
  if (horizon === 'TOMORROW') return 'Best times tomorrow';
  if (horizon === 'WEEKEND') return 'Best times this weekend';
  if (horizon === 'SEVEN_DAYS') return 'Best times in the next 7 days';
  const startLabel = formatLocalDateLabel(range.startLocalDate).replace(/^\w+, /, '');
  const endLabel = formatLocalDateLabel(range.endLocalDate).replace(/^\w+, /, '');
  return range.startLocalDate === range.endLocalDate ? `Best times on ${startLabel}` : `Best within ${startLabel}–${endLabel}`;
}

interface ForwardPlannerViewProps {
  timezone: string;
  onBack: () => void;
  onOpenBirthProfile: () => void;
}

export function ForwardPlannerView({ timezone, onBack, onOpenBirthProfile }: ForwardPlannerViewProps) {
  const [activityId, setActivityId] = useState<string | null>(null);
  const [activityQuery, setActivityQuery] = useState('');
  const [horizon, setHorizon] = useState<ForwardPlannerHorizon>('TOMORROW');
  const [customDate, setCustomDate] = useState('');
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null);
  const [result, setResult] = useState<ForwardPlannerResult | null>(null);
  const [error, setError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [scheduledRanks, setScheduledRanks] = useState<Set<number>>(new Set());
  const [savingRank, setSavingRank] = useState<number | null>(null);
  const [scheduleError, setScheduleError] = useState('');

  const selectedActivity = activityId ? FULL_ACTIVITY_CATALOG.find((activity) => activity.id === activityId) : undefined;
  const matchingActivities = activityQuery.trim().length > 0 ? FULL_ACTIVITY_CATALOG.filter((activity) => activity.title.toLowerCase().includes(activityQuery.trim().toLowerCase())).slice(0, 8) : [];

  const effectiveDurationMinutes = durationMinutes ?? selectedActivity?.defaultDurationMinutes ?? 30;
  const canSearch = Boolean(activityId) && (horizon !== 'CUSTOM' || Boolean(customDate)) && !isSearching;

  async function handleSearch() {
    if (!activityId) return;
    setIsSearching(true);
    setError('');
    setResult(null);
    setScheduledRanks(new Set());
    setScheduleError('');
    try {
      const res = await fetch('/api/forward-planner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId,
          horizon,
          ...(horizon === 'CUSTOM' ? { customStartDate: customDate, customEndDate: customDate } : {}),
          durationMinutes: effectiveDurationMinutes,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError((body && typeof body.error === 'string' && body.error) || 'Something went wrong. Please try again.');
        return;
      }
      setResult(body as ForwardPlannerResult);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSchedule(option: ForwardPlannerOption) {
    if (!activityId || !selectedActivity) return;
    setSavingRank(option.rank);
    setScheduleError('');
    try {
      const checkRes = await fetch('/api/timing-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'CHECK', activityId, durationMinutes: effectiveDurationMinutes, candidateStart: option.start, checkNearbyWindowMinutes: 0 }),
      });
      if (!checkRes.ok) throw new Error('check-failed');
      const checkBody: TimingSearchResponse = await checkRes.json();
      const candidate = checkBody.requestedCandidate;
      if (!candidate) throw new Error('no-candidate');
      await saveUpcomingPlanFromCandidate(candidate, effectiveDurationMinutes, { activityId });
      setScheduledRanks((current) => new Set(current).add(option.rank));
    } catch {
      setScheduleError('Unable to schedule this time. Please try again.');
    } finally {
      setSavingRank(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xl }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <button type="button" onClick={onBack} aria-label="Back to Explore" style={backButtonStyle}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
          Explore
        </button>
      </div>

      <PageHeader title="Plan Ahead" subtitle="Find the best future time for something you want to do." />

      <SurfaceCard>
        <SectionHeader label="Choose an activity" />
        {selectedActivity ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
            <span style={typography.bodyStrong}>
              {selectedActivity.icon} {selectedActivity.title}
            </span>
            <TextButton
              onClick={() => {
                setActivityId(null);
                setActivityQuery('');
                setDurationMinutes(null);
                setResult(null);
              }}
            >
              Change
            </TextButton>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={activityQuery}
              onChange={(event) => setActivityQuery(event.target.value)}
              placeholder="Search activities…"
              aria-label="Search activities"
              style={{
                width: '100%',
                minHeight: 40,
                borderRadius: 10,
                border: `1px solid ${colors.borderSubtle}`,
                background: 'rgba(15, 23, 42, 0.6)',
                color: colors.textPrimary,
                fontSize: 14,
                padding: '0 12px',
                marginBottom: spacing.sm,
              }}
            />
            {matchingActivities.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
                {matchingActivities.map((activity) => (
                  <ActivityChip key={activity.id} label={activity.title} icon={activity.icon} onClick={() => setActivityId(activity.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader label="When?" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
          {HORIZON_OPTIONS.map((option) => (
            <ActivityChip key={option.value} label={option.label} selected={horizon === option.value} onClick={() => setHorizon(option.value)} />
          ))}
        </div>
        {horizon === 'CUSTOM' && (
          <input
            type="date"
            value={customDate}
            onChange={(event) => setCustomDate(event.target.value)}
            aria-label="Pick a date"
            style={{
              marginTop: spacing.sm,
              minHeight: 40,
              borderRadius: 10,
              border: `1px solid ${colors.borderSubtle}`,
              background: 'rgba(15, 23, 42, 0.6)',
              color: colors.textPrimary,
              fontSize: 14,
              padding: '0 12px',
            }}
          />
        )}
      </SurfaceCard>

      <SurfaceCard>
        <SectionHeader label="Duration" />
        <div style={{ display: 'flex', gap: spacing.xs }}>
          {DURATION_OPTIONS_MINUTES.map((minutes) => (
            <DurationChip key={minutes} label={`${minutes}m`} selected={effectiveDurationMinutes === minutes} onClick={() => setDurationMinutes(minutes)} />
          ))}
        </div>
      </SurfaceCard>

      <PrimaryButton onClick={handleSearch} disabled={!canSearch} loading={isSearching} ariaLabel="Find best times">
        Find best times
      </PrimaryButton>

      {error && (
        <SurfaceCard>
          <p style={{ ...typography.body, color: colors.danger }}>{error}</p>
        </SurfaceCard>
      )}

      {result?.status === 'BIRTH_PROFILE_REQUIRED' && (
        <SurfaceCard>
          <p style={typography.cardTitle}>Personalize your timing</p>
          <p style={{ ...typography.body, margin: `${spacing.xs}px 0 ${spacing.sm}px` }}>Add your birth details to get recommendations tailored to you.</p>
          <TextButton onClick={onOpenBirthProfile}>Add birth details →</TextButton>
        </SurfaceCard>
      )}

      {result?.status === 'NO_SUITABLE_WINDOW' && (
        <EmptyState title="No strong window found in this range." description="Try another date range." />
      )}

      {result?.status === 'READY' && (
        <section aria-label="Forward Planner results">
          <SectionHeader label={rangeHeaderLabel(horizon, result.range)} />
          <ul style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, margin: 0, padding: 0, listStyle: 'none' }}>
            {result.options.map((option) => {
              const start = new Date(option.start);
              const end = new Date(option.end);
              const scheduled = scheduledRanks.has(option.rank);
              const saving = savingRank === option.rank;
              return (
                <SurfaceCard key={option.rank}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                    <div>
                      <p style={typography.cardTitle}>{formatLocalDateLabel(option.localDate)}</p>
                      <p style={typography.body}>{formatPlanTimeRange(start, end, timezone)}</p>
                    </div>
                    <StatusBadge label={RESULT_LABEL_TEXT[option.timingLabel]} tone={option.timingLabel === 'EXCELLENT' || option.timingLabel === 'VERY_GOOD' ? 'positive' : 'info'} />
                  </div>
                  <div style={{ marginTop: spacing.sm }}>
                    {scheduled ? (
                      <StatusBadge label="Scheduled" tone="positive" />
                    ) : (
                      <SecondaryButton onClick={() => handleSchedule(option)} disabled={saving}>
                        {saving ? 'Scheduling…' : 'Schedule'}
                      </SecondaryButton>
                    )}
                  </div>
                </SurfaceCard>
              );
            })}
          </ul>
          {scheduleError && (
            <p style={{ ...typography.body, color: colors.danger, marginTop: spacing.sm }}>{scheduleError}</p>
          )}
        </section>
      )}
    </div>
  );
}
