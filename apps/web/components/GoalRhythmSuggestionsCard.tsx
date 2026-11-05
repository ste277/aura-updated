'use client';

import React, { useState } from 'react';
import { colors, spacing, typography } from './theme';
import { SectionHeader, SurfaceCard, TextButton, PrimaryButton, SecondaryButton } from './ui';
import { computeGoalRhythmHomeView, type HomeGoalRhythmSuggestion } from '../lib/homeGoalRhythmSuggestions';
import { shouldOfferWeeklyReview } from '../lib/weeklyPlanReviewClient';
import { WeeklyPlanReviewModal } from './WeeklyPlanReviewModal';

/**
 * HGR1 -- Home Goal-Rhythm Integration.
 * HGR2 -- Home Goal-Rhythm Prioritization and Overflow.
 *
 * A small, clearly SEPARATE card -- never woven into the astrology-ranked
 * `HomeTimeline`/"Best For You" guidance feed, and never rendered in place
 * of it. This is a factual weekly-progress nudge, not a competing
 * recommendation engine: it carries no priority/urgency score of its own
 * and cannot displace anything already ranked by `buildPersonalDailyGuidance`.
 * Cross-surface duplicate suppression against that feed happens one level
 * up, in HomeDashboard.tsx (HGR2 section 6) -- `suggestions` here is
 * already deduplicated by the time it reaches this component.
 *
 * HGR2 caps the default view at `GOAL_RHYTHM_VISIBLE_CAP` (3) cards via
 * `computeGoalRhythmHomeView` (homeGoalRhythmSuggestions.ts -- see its own
 * module doc comment for the deterministic, non-urgency prioritization
 * rule). The underlying eligible set is never truncated: "View all"
 * expands to show every remaining eligible suggestion in full, and
 * "Show less" collapses back -- purely local UI state, never persisted.
 *
 * Tapping "Plan it" hands off to the EXISTING Plan My Day flow via the
 * SAME `?fromGoal=&activities=` query contract `GoalDetailClient.tsx`'s
 * own `handlePlanWithAura` already uses -- never a new scheduling or
 * acceptance path, and the user still explicitly confirms inside Plan My
 * Day (this component commits nothing on its own). This is identical for
 * a visible-by-default card and an overflow ("View all") card -- the same
 * render path, same `planHandoff`, no identity weakening either way.
 *
 * "Not now" is a NON-DESTRUCTIVE, purely local/client-side dismissal
 * (parent-held `dismissedIds`) -- it never calls any API, never touches
 * the weekly target, and never marks anything completed/skipped. It
 * lasts ONLY for the current mounted Home view: HomeDashboard.tsx resets
 * it on a local-day rollover, but in practice it also resets on any
 * ordinary remount (a tab switch, a refresh, navigating to Plan My Day
 * and back) -- this is a SESSION/mount-scoped convenience, never a
 * day-persistent guarantee, and must never be described as the latter.
 * Dismissing a visible card automatically promotes the next-ranked
 * overflow suggestion into its place (computeGoalRhythmHomeView's own
 * filter-then-split order makes this automatic, not a separate feature).
 * True "skip this occurrence" or "skip the remaining weekly target"
 * semantics do not yet exist for a GoalActivity that has no
 * PlannedActivity at all (homeMissedRecovery.ts's own Skip only ever
 * targets an already-missed, already-scheduled plan) -- deliberately
 * deferred, not built here; see this PR's own delivery report for the
 * exact product decision needed.
 *
 * HGR3-C2 -- for a GoalActivity with MORE than one remaining session this
 * week (`shouldOfferWeeklyReview`, weeklyPlanReviewClient.ts), the single
 * "Plan it" action above is replaced by a primary "Plan remaining N" (opens
 * `WeeklyPlanReviewModal`, the new weekly review/accept flow) and a
 * secondary "Just today" that preserves the EXACT pre-existing
 * `navigateToPlanDay` behavior and identity, byte-for-byte unchanged. With
 * exactly ONE remaining session, this card deliberately keeps the
 * single-action "Plan it" exactly as it already was -- a one-row weekly
 * review would be barely distinguishable from today's single-day flow and
 * would only add a tap, not remove one.
 */
export function GoalRhythmSuggestionsCard({
  suggestions,
  dismissedIds,
  onDismiss,
  timezone,
}: {
  suggestions: readonly HomeGoalRhythmSuggestion[];
  dismissedIds: ReadonlySet<string>;
  onDismiss: (goalActivityId: string) => void;
  timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reviewingGoalActivityId, setReviewingGoalActivityId] = useState<string | null>(null);
  const { visible, overflow } = computeGoalRhythmHomeView(suggestions, dismissedIds);
  if (visible.length === 0) return null;
  const shown = expanded ? [...visible, ...overflow] : visible;
  const reviewingSuggestion = shown.find((s) => s.goalActivityId === reviewingGoalActivityId) ?? suggestions.find((s) => s.goalActivityId === reviewingGoalActivityId);

  return (
    <div style={{ marginBottom: spacing.lg }}>
      <SectionHeader label="Your rhythm this week" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {shown.map((suggestion) => {
          // Mirrors GoalDetailClient.tsx's own handlePlanWithAura verbatim:
          // same two query params, same plain navigation, no new transport.
          // Identical for a visible-by-default and an overflow suggestion.
          const navigateToPlanDay = () => {
            const params = new URLSearchParams({ fromGoal: suggestion.planHandoff.fromGoal, activities: suggestion.planHandoff.activities });
            window.location.href = `/plan-day?${params.toString()}`;
          };
          const offerWeeklyReview = shouldOfferWeeklyReview(suggestion.remainingThisWeek);
          return (
            <SurfaceCard key={suggestion.goalActivityId} padding={spacing.md}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ ...typography.bodyStrong, color: colors.textPrimary }}>{suggestion.title}</div>
                  <div style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>{suggestion.progressLabel}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexShrink: 0, flexWrap: 'wrap' }}>
                  <TextButton onClick={() => onDismiss(suggestion.goalActivityId)} style={{ minHeight: 44, padding: '0 8px' }}>
                    Not now
                  </TextButton>
                  {offerWeeklyReview && (
                    <SecondaryButton onClick={navigateToPlanDay} style={{ minHeight: 44 }}>
                      Just today
                    </SecondaryButton>
                  )}
                  <PrimaryButton
                    onClick={offerWeeklyReview ? () => setReviewingGoalActivityId(suggestion.goalActivityId) : navigateToPlanDay}
                    style={{ minHeight: 44, padding: '0 14px' }}
                  >
                    {offerWeeklyReview ? `Plan remaining ${suggestion.remainingThisWeek}` : 'Plan it'}
                  </PrimaryButton>
                </div>
              </div>
            </SurfaceCard>
          );
        })}
      </div>
      {overflow.length > 0 && (
        <TextButton
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          style={{ minHeight: 44, padding: '0 8px', marginTop: spacing.xs }}
        >
          {expanded ? 'Show less' : `View all (+${overflow.length} more)`}
        </TextButton>
      )}
      {reviewingSuggestion && (
        <WeeklyPlanReviewModal
          goalActivityId={reviewingSuggestion.goalActivityId}
          activityTitleFallback={reviewingSuggestion.title}
          timezone={timezone}
          onClose={() => setReviewingGoalActivityId(null)}
        />
      )}
    </div>
  );
}
