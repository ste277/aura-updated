import React from 'react';
import { spacing, typography, surfaceCardStyle } from './theme';
import { SectionHeader, SurfaceCard, TextButton } from './ui';
import { formatPlanTimeRange } from '../lib/planFormatting';
import type { BestForYouItem, GuidanceUiState } from '../lib/bestForYouViewModel';

/**
 * New Aura Home V1 -- "Best For You" section.
 *
 * PURE PRESENTATION ONLY: this component fetches nothing, ranks nothing,
 * sorts nothing, and calls no engine of any kind -- `items` arrives
 * already in #104's own final order (see bestForYouViewModel.ts's own
 * "order ownership" doc comment), and this component renders that array
 * exactly as given.
 *
 * Card content is deliberately minimal (title + time range only) --
 * no timing-label badge, no personal-relevance badge, no theme chips, no
 * selection-reason text, no source label. `source`/`sourceEntityId` are
 * carried on `BestForYouItem` for a future click affordance but are not
 * rendered or used for navigation in V1 -- no existing direct-open-this-
 * Plan/this-Day-Builder-suggestion route exists yet, so cards stay
 * informational/non-clickable rather than inventing one.
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

function BestForYouCard({ item, timezone }: { item: BestForYouItem; timezone: string }) {
  const timeRange = formatPlanTimeRange(new Date(item.start), new Date(item.end), timezone);
  return (
    <li style={{ ...surfaceCardStyle, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      <p style={typography.cardTitle}>{item.title}</p>
      <p style={typography.body}>{timeRange}</p>
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
  // NO_ACTIVITY_INTENT renders no Best For You shell at all -- the
  // existing DayBuilderCard is promoted to the top action slot instead
  // (HomeDashboard.tsx's own conditional JSX position), never a second,
  // duplicate "plan your day" prompt here.
  if (state.status === 'NO_ACTIVITY_INTENT') return null;

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
          {items.map((item) => (
            <BestForYouCard key={item.rank} item={item} timezone={timezone} />
          ))}
        </ul>
      )}
    </section>
  );
}
