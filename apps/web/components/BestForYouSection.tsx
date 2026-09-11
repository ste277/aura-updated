'use client';

import React, { useEffect, useState } from 'react';
import { spacing, typography, surfaceCardStyle } from './theme';
import { SectionHeader, SurfaceCard, TextButton } from './ui';
import { formatPlanTimeRange } from '../lib/planFormatting';
import type { BestForYouItem, GuidanceUiState } from '../lib/bestForYouViewModel';
import { buildWhyAuraExplanation, resolveExpandedWhyAuraId } from '../lib/whyAuraViewModel';
import type { WhyAuraViewModel } from '../lib/whyAuraViewModel';

/**
 * New Aura Home V1 -- "Best For You" section.
 *
 * PURE PRESENTATION ONLY: this component fetches nothing, ranks nothing,
 * sorts nothing, and calls no engine of any kind -- `items` arrives
 * already in #104's own final order (see bestForYouViewModel.ts's own
 * "order ownership" doc comment), and this component renders that array
 * exactly as given.
 *
 * Card content is deliberately minimal (title + time range only, plus
 * Why Aura V1's own per-card "Why?" disclosure below) -- no timing-label
 * badge, no personal-relevance badge, no theme chips, no selection-reason
 * text, no source label ever shown raw. `source`/`sourceEntityId` are
 * carried on `BestForYouItem` for a future click affordance but are not
 * used for navigation in V1 -- no existing direct-open-this-Plan/this-
 * Day-Builder-suggestion route exists yet, so cards stay non-clickable as
 * a whole, only the "Why?" affordance is interactive.
 *
 * WHY AURA V1: each card's explanation is derived HERE, at render time,
 * from `state.guidance.recommendations` (the full `DailyGuidanceContext`
 * already present on `state` when READY) joined back to its `BestForYouItem`
 * by `rank` -- `whyAuraViewModel.ts` itself never reads `bestForYouViewModel.ts`
 * or vice versa; this component is the only place the two are joined.
 */

const skeletonBlockStyle: React.CSSProperties = {
  height: 56,
  borderRadius: 10,
  background: 'rgba(148, 163, 184, 0.08)',
};

function BestForYouSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }} aria-hidden="true">
      <div style={skeletonBlockStyle} />
      <div style={skeletonBlockStyle} />
    </div>
  );
}

/**
 * Why Aura V1 -- the "Why?" affordance is hidden entirely when
 * `explanation.lines` is empty (should not happen in practice -- see
 * whyAuraViewModel.ts's own doc comment -- but this component never
 * fabricates a generic fallback line if it does). At most one card's
 * panel is expanded at a time across the whole section (`isExpanded` is
 * computed by the parent from a single shared `expandedSourceEntityId`).
 */
function BestForYouCard({
  item,
  timezone,
  explanation,
  isExpanded,
  onToggleWhy,
}: {
  item: BestForYouItem;
  timezone: string;
  explanation: WhyAuraViewModel;
  isExpanded: boolean;
  onToggleWhy: () => void;
}) {
  const timeRange = formatPlanTimeRange(new Date(item.start), new Date(item.end), timezone);
  const hasExplanation = explanation.lines.length > 0;
  const panelId = `why-aura-panel-${item.sourceEntityId}`;

  return (
    <li style={{ ...surfaceCardStyle, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm }}>
        <p style={{ ...typography.cardTitle, margin: 0 }}>{item.title}</p>
        {hasExplanation && (
          <button
            type="button"
            onClick={onToggleWhy}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            style={{ fontSize: 12, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
          >
            Why?
          </button>
        )}
      </div>
      <p style={typography.body}>{timeRange}</p>
      {hasExplanation && isExpanded && (
        <div
          id={panelId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
            color: 'var(--as-text-muted)',
            background: 'var(--as-surface-raised)',
            border: '1px solid var(--as-border)',
            borderRadius: 8,
            padding: '10px 12px',
            lineHeight: 1.5,
          }}
        >
          {explanation.lines.map((line, index) => (
            <p key={index} style={{ margin: 0 }}>
              {line}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

export interface BestForYouSectionProps {
  state: GuidanceUiState;
  items: BestForYouItem[];
  timezone: string;
  onOpenBirthProfile?: () => void;
}

export function BestForYouSection({ state, items, timezone, onOpenBirthProfile }: BestForYouSectionProps) {
  // Why Aura V1 -- at most one card's explanation panel open at a time,
  // section-wide (mobile-cleanliness preference from this feature's own
  // architecture audit). Keyed by `sourceEntityId` (the concrete Plan/Day
  // Builder intention this card represents), never by `rank` -- see
  // whyAuraViewModel.ts's own module doc comment. No persistence beyond
  // this component's own lifetime.
  const [expandedSourceEntityId, setExpandedSourceEntityId] = useState<string | null>(null);

  // Why Aura V1 -- merge-critical stale-expansion fix: reconciles the
  // expanded id against the CURRENT items every time `items` changes
  // (every guidance refresh), via resolveExpandedWhyAuraId. Without this,
  // an id that disappears in one refresh and coincidentally reappears
  // (the same underlying Plan/Day Builder intention re-selected into a
  // later recommendation) could silently reopen its panel without the
  // user clicking "Why?" again. A still-present id is returned unchanged
  // (setState is a no-op for an unchanged value -- no extra re-render,
  // and the open panel's own content still refreshes normally since
  // `buildWhyAuraExplanation` is recomputed from the live recommendation
  // on every render regardless of this effect).
  useEffect(() => {
    setExpandedSourceEntityId((current) => resolveExpandedWhyAuraId(current, items.map((item) => item.sourceEntityId)));
  }, [items]);

  // NO_ACTIVITY_INTENT renders no Best For You shell at all -- the
  // existing DayBuilderCard is promoted to the top action slot instead
  // (HomeDashboard.tsx's own conditional JSX position), never a second,
  // duplicate "plan your day" prompt here.
  if (state.status === 'NO_ACTIVITY_INTENT') return null;

  // Why Aura V1 -- joins each BestForYouItem back to its own full
  // DailyGuidanceRecommendation (only present on `state`, never on
  // `BestForYouItem` itself, by #106's own deliberate minimality) by
  // `rank` -- #106's own order-preserving mapping guarantees exactly one
  // recommendation per rank.
  const recommendationsByRank = state.status === 'READY' ? new Map(state.guidance.recommendations.map((recommendation) => [recommendation.rank, recommendation])) : null;

  return (
    <section aria-label="Best For You">
      <SectionHeader label="Best For You" />

      {state.status === 'loading' && <BestForYouSkeleton />}

      {state.status === 'error' && (
        <SurfaceCard>
          <p style={typography.body}>Best For You unavailable.</p>
        </SurfaceCard>
      )}

      {state.status === 'BIRTH_PROFILE_REQUIRED' && (
        <SurfaceCard>
          <p style={typography.cardTitle}>Personalize your timing</p>
          <p style={{ ...typography.body, margin: `${spacing.xs}px 0 ${spacing.sm}px` }}>Add your birth details to get recommendations tailored to you.</p>
          {onOpenBirthProfile && <TextButton onClick={onOpenBirthProfile}>Add birth details →</TextButton>}
        </SurfaceCard>
      )}

      {state.status === 'READY' && items.length === 0 && (
        <SurfaceCard>
          <p style={typography.body}>Nothing in your plans stands out for timing right now.</p>
        </SurfaceCard>
      )}

      {state.status === 'READY' && items.length > 0 && (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, margin: 0, padding: 0 }}>
          {items.map((item) => {
            const recommendation = recommendationsByRank?.get(item.rank);
            // Behavior-aware Why Aura V1 -- `state.selectedActivities` is
            // already present on `state` when READY (same object Why Aura's
            // own `source` join already reads via `item.source`); no new
            // fetch, just reading a field that already reached the client.
            const behavioralAffinity = recommendation && state.status === 'READY' ? state.selectedActivities[recommendation.activityFamily]?.behavioralAffinity : undefined;
            const explanation = recommendation ? buildWhyAuraExplanation(recommendation, item.source, behavioralAffinity) : { lines: [] };
            return (
              <BestForYouCard
                key={item.rank}
                item={item}
                timezone={timezone}
                explanation={explanation}
                isExpanded={expandedSourceEntityId === item.sourceEntityId}
                onToggleWhy={() => setExpandedSourceEntityId((current) => (current === item.sourceEntityId ? null : item.sourceEntityId))}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
