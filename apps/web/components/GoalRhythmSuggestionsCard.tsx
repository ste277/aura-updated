'use client';

import React from 'react';
import { colors, spacing, typography } from './theme';
import { SectionHeader, SurfaceCard, TextButton, PrimaryButton } from './ui';
import type { HomeGoalRhythmSuggestion } from '../lib/homeGoalRhythmSuggestions';

/**
 * HGR1 -- Home Goal-Rhythm Integration.
 *
 * A small, clearly SEPARATE card -- never woven into the astrology-ranked
 * `HomeTimeline`/"Best For You" guidance feed, and never rendered in place
 * of it. This is a factual weekly-progress nudge, not a competing
 * recommendation engine: it carries no priority/urgency score of its own
 * and cannot displace anything already ranked by `buildPersonalDailyGuidance`.
 *
 * Tapping "Plan it" hands off to the EXISTING Plan My Day flow via the
 * SAME `?fromGoal=&activities=` query contract `GoalDetailClient.tsx`'s
 * own `handlePlanWithAura` already uses -- never a new scheduling or
 * acceptance path, and the user still explicitly confirms inside Plan My
 * Day (this component commits nothing on its own).
 *
 * "Not now" is a NON-DESTRUCTIVE, purely local/client-side dismissal
 * (parent-held `dismissedIds`, reset once per day alongside the rest of
 * Home's day-scoped state) -- it never calls any API, never touches the
 * weekly target, and never marks anything completed/skipped. True
 * "skip this occurrence" or "skip the remaining weekly target" semantics
 * do not yet exist for a GoalActivity that has no PlannedActivity at all
 * (homeMissedRecovery.ts's own Skip only ever targets an already-missed,
 * already-scheduled plan) -- deliberately deferred, not built here; see
 * this PR's own delivery report for the exact product decision needed.
 */
export function GoalRhythmSuggestionsCard({
  suggestions,
  dismissedIds,
  onDismiss,
}: {
  suggestions: readonly HomeGoalRhythmSuggestion[];
  dismissedIds: ReadonlySet<string>;
  onDismiss: (goalActivityId: string) => void;
}) {
  const visible = suggestions.filter((s) => !dismissedIds.has(s.goalActivityId));
  if (visible.length === 0) return null;

  return (
    <div style={{ marginBottom: spacing.lg }}>
      <SectionHeader label="Your rhythm this week" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {visible.map((suggestion) => {
          // Mirrors GoalDetailClient.tsx's own handlePlanWithAura verbatim:
          // same two query params, same plain navigation, no new transport.
          const navigateToPlanDay = () => {
            const params = new URLSearchParams({ fromGoal: suggestion.planHandoff.fromGoal, activities: suggestion.planHandoff.activities });
            window.location.href = `/plan-day?${params.toString()}`;
          };
          return (
            <SurfaceCard key={suggestion.goalActivityId} padding={spacing.md}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <div>
                  <div style={{ ...typography.bodyStrong, color: colors.textPrimary }}>{suggestion.title}</div>
                  <div style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>{suggestion.progressLabel}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexShrink: 0 }}>
                  <TextButton onClick={() => onDismiss(suggestion.goalActivityId)} style={{ minHeight: 44, padding: '0 8px' }}>
                    Not now
                  </TextButton>
                  <PrimaryButton onClick={navigateToPlanDay} style={{ minHeight: 44, padding: '0 14px' }}>
                    Plan it
                  </PrimaryButton>
                </div>
              </div>
            </SurfaceCard>
          );
        })}
      </div>
    </div>
  );
}
