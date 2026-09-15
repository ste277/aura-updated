'use client';

import React from 'react';
import type { HomeTimelineItem, HomeTimelineStatus } from '../lib/homeTimelineTypes';
import type { PendingActivityPresentationItem } from '../lib/myDayPendingOverlay';
import { formatActivityDuration } from '../lib/activityDuration';
import { colors, spacing, radius, typography } from './theme';
import { SectionHeader, TextButton, PrimaryButton, EmptyState, StatusBadge, type StatusTone } from './ui';

/**
 * Home UI V2 -- the canonical Home timeline. Evolved from
 * `YourDayTimeline.tsx` (renders a superset of what that component
 * rendered: real agenda rows, PLUS unscheduled opportunities and Panchang
 * context bands). Reuses that file's own established row/marker/
 * subdued-styling/empty-state conventions.
 *
 * MERGE-CRITICAL: `items` is rendered in EXACTLY the order
 * `buildHomeTimeline()` (apps/web/lib/homeTimelineComposer.ts) already
 * produced. This component never sorts, reorders, dedupes, caps, or
 * re-derives current/past classification -- all of that is the composer's
 * job, already done before this component ever sees the array.
 */

const isDisplayableIcon = (icon: string) => !/^[a-zA-Z]+$/.test(icon);

function statusTone(status: HomeTimelineStatus): StatusTone {
  if (status === 'Best') return 'positive';
  if (status === 'Good') return 'info';
  if (status === 'Workable') return 'neutral';
  return 'caution'; // 'Caution'
}

function formatItemTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

function markerFor(item: HomeTimelineItem): string {
  if (item.kind === 'OPPORTUNITY') return '○';
  if (item.metadata?.agendaStatus === 'COMPLETED') return '✓';
  // A calm, plain fact -- never a warning glyph (matches YourDayTimeline's own convention).
  if (item.metadata?.agendaStatus === 'MISSED') return '–';
  if (item.metadata?.isCurrent) return '●';
  if (item.metadata?.agendaStatus === 'WAITING') return '◌';
  if (item.icon && isDisplayableIcon(item.icon)) return item.icon;
  return item.kind === 'MOMENT' ? '❤️' : '•';
}

function markerColor(item: HomeTimelineItem): string {
  if (item.kind === 'OPPORTUNITY') return colors.textMuted;
  if (item.metadata?.agendaStatus === 'COMPLETED') return colors.positive;
  if (item.metadata?.agendaStatus === 'MISSED') return colors.textMuted;
  if (item.metadata?.isCurrent) return colors.info;
  if (item.metadata?.agendaStatus === 'WAITING') return colors.caution;
  return colors.textMuted;
}

/** Matches YourDayTimeline.tsx's own statusLabel wording exactly -- 'Confirmed' (never 'Planned') for an accepted shared Moment, since "Planned" is ambiguous with a Plan. */
function lifecycleLabel(item: HomeTimelineItem): string | null {
  if (item.metadata?.agendaStatus === 'WAITING') return 'Waiting for response';
  if (item.metadata?.agendaStatus === 'CONFIRMED') return 'Confirmed';
  return null;
}

export interface HomeTimelineProps {
  /** Already-composed, already-ordered output of `buildHomeTimeline()`. */
  items: HomeTimelineItem[];
  timezone: string;
  /** Pending Activity My Day Visibility V1 -- a still-unconfirmed,
   * client-only logged entry. Deliberately NOT merged into `items`/the
   * composer (a pending log was never confirmed by the server); rendered
   * in its own clearly-separated section above, exactly as
   * `YourDayTimeline.tsx` already did. */
  pendingActivities?: PendingActivityPresentationItem[];
  /** Real Why-Aura lines already resolved by the caller (HomeDashboard),
   * keyed by `HomeTimelineItem.id` -- this component never calls
   * `buildWhyAuraExplanation` itself, it only renders lines already handed
   * to it. Absent/empty for an item with no real explanation (fails
   * closed, never a placeholder). */
  explanationsById: Record<string, string[]>;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onOpenItem?: (item: HomeTimelineItem) => void;
  /** Fired when the user taps "Plan" on an OPPORTUNITY row. Loading state
   * for the specific item being planned is owned by the caller
   * (`planningId`), never invented locally. */
  onPlanOpportunity?: (item: HomeTimelineItem) => void;
  planningId?: string | null;
  onAddSomething?: () => void;
  /** Rendered inside the empty state (Day Builder's own intent-setting UI,
   * reused unchanged) -- this component owns no intent-setting logic of
   * its own. */
  emptyStateExtra?: React.ReactNode;
  /** The same canonical "what's next" id `DailyAgenda.nextItem` already
   * computes (`YourDayTimeline.tsx`'s own `nextItemId`, carried over
   * unchanged) -- never recomputed here, only used to flag which row gets
   * the NEXT eyebrow. */
  nextItemId?: string;
}

export function HomeTimeline({
  items,
  timezone,
  explanationsById,
  expandedId,
  onToggleExpand,
  onOpenItem,
  onPlanOpportunity,
  planningId,
  onAddSomething,
  emptyStateExtra,
  pendingActivities = [],
  nextItemId,
}: HomeTimelineProps) {
  if (items.length === 0 && pendingActivities.length === 0) {
    return (
      <section>
        <SectionHeader label="Your Day" />
        <EmptyState
          title="Your day is open"
          description="Aura can help you make room for something meaningful."
          action={onAddSomething ? <TextButton onClick={onAddSomething}>Plan your day →</TextButton> : undefined}
        />
        {emptyStateExtra}
      </section>
    );
  }

  return (
    <section>
      <SectionHeader label="Your Day" right={onAddSomething ? <TextButton onClick={onAddSomething}>+ Add something</TextButton> : undefined} />
      <div style={{ background: colors.surfaceSubtle, border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.lg, padding: `0 ${spacing.lg}px` }}>
        {/* Pending Activity My Day Visibility V1 -- its own clearly-separated
         * section, never interleaved into the composer's own ordering. */}
        {pendingActivities.map((item) => (
          <PendingActivityRow key={item.id} item={item} timezone={timezone} />
        ))}
        {items.map((item) =>
          item.kind === 'CONTEXT_WINDOW' ? (
            <ContextBand key={item.id} item={item} timezone={timezone} />
          ) : (
            <TimelineRow
              key={item.id}
              item={item}
              timezone={timezone}
              isExpanded={expandedId === item.id}
              onToggleExpand={() => onToggleExpand(item.id)}
              explanationLines={explanationsById[item.id] ?? []}
              onOpen={onOpenItem}
              onPlan={onPlanOpportunity}
              isPlanning={planningId === item.id}
              isNext={item.id === nextItemId}
            />
          )
        )}
      </div>
      {emptyStateExtra}
    </section>
  );
}

/** Carried over verbatim from `YourDayTimeline.tsx`'s own `PendingActivityRow`. */
function PendingActivityRow({ item, timezone }: { item: PendingActivityPresentationItem; timezone: string }) {
  const time = item.loggedAt.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: spacing.md, width: '100%', padding: `${spacing.sm}px 0`, borderBottom: `1px solid ${colors.borderSubtle}`, minHeight: 44 }}>
      <span aria-hidden="true" style={{ fontSize: 15, textAlign: 'center' }}>⏳</span>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
        <span style={{ ...typography.bodyStrong, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.activityTitle}</span>
        <StatusBadge label="Pending sync" tone="caution" />
      </span>
      <span style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ ...typography.meta, color: colors.textMuted }}>{time}</div>
      </span>
    </div>
  );
}

function ContextBand({ item, timezone }: { item: HomeTimelineItem; timezone: string }) {
  return (
    <div
      style={{
        padding: `${spacing.sm}px 0`,
        borderBottom: `1px solid ${colors.borderSubtle}`,
        display: 'flex',
        alignItems: 'center',
        gap: spacing.sm,
        opacity: 0.75,
      }}
    >
      <div style={{ flex: 1, height: 1, background: colors.borderDefault }} />
      <div style={{ textAlign: 'center', minWidth: 0 }}>
        <div style={{ ...typography.meta, color: colors.textMuted }}>
          {formatItemTime(item.start, timezone)}
          {item.end ? ` – ${formatItemTime(item.end, timezone)}` : ''}
        </div>
        <div style={{ ...typography.bodyStrong, fontWeight: 800, fontSize: 13, color: item.status === 'Caution' ? colors.caution : colors.textSecondary }}>{item.title}</div>
      </div>
      <div style={{ flex: 1, height: 1, background: colors.borderDefault }} />
    </div>
  );
}

function TimelineRow({
  item,
  timezone,
  isExpanded,
  onToggleExpand,
  explanationLines,
  onOpen,
  onPlan,
  isPlanning,
  isNext,
}: {
  item: HomeTimelineItem;
  timezone: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  explanationLines: string[];
  onOpen?: (item: HomeTimelineItem) => void;
  onPlan?: (item: HomeTimelineItem) => void;
  isPlanning: boolean;
  isNext?: boolean;
}) {
  const isOpportunity = item.kind === 'OPPORTUNITY';
  const subdued = item.metadata?.agendaStatus === 'COMPLETED' || item.metadata?.agendaStatus === 'MISSED';
  const emphasized = item.metadata?.isCurrent === true || isNext;
  const hasExplanation = explanationLines.length > 0;
  const label = lifecycleLabel(item);
  const panelId = `home-timeline-why-${item.id}`;

  return (
    <div
      style={{
        padding: `${spacing.sm}px 0`,
        borderBottom: `1px solid ${colors.borderSubtle}`,
        borderLeft: isNext ? `2px solid ${colors.info}` : '2px solid transparent',
        paddingLeft: isNext ? spacing.sm - 2 : 0,
        opacity: isOpportunity ? 0.85 : subdued ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: spacing.md, minHeight: 44 }}>
        <span aria-hidden="true" style={{ color: markerColor(item), fontSize: item.metadata?.isCurrent || item.metadata?.agendaStatus === 'WAITING' ? 10 : 15, textAlign: 'center' }}>
          {markerFor(item)}
        </span>
        <button
          type="button"
          onClick={() => (isOpportunity || item.rank !== undefined ? onToggleExpand() : onOpen?.(item))}
          style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0, minWidth: 0 }}
        >
          {isNext && <div style={{ ...typography.caption, color: colors.info, fontWeight: 900, letterSpacing: 0.4, marginBottom: 2 }}>NEXT</div>}
          <div
            style={{
              ...typography.bodyStrong,
              fontWeight: emphasized ? 850 : 700,
              textDecoration: item.metadata?.agendaStatus === 'COMPLETED' ? 'line-through' : 'none',
              textDecorationColor: colors.borderDefault,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontStyle: isOpportunity ? 'normal' : 'normal',
              color: isOpportunity ? colors.textSecondary : colors.textPrimary,
            }}
          >
            {item.title}
          </div>
        </button>
        <span style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ ...typography.meta, color: emphasized ? colors.info : colors.textMuted }}>{formatItemTime(item.start, timezone)}</div>
          {label && <div style={{ ...typography.caption, color: item.metadata?.agendaStatus === 'WAITING' ? colors.caution : colors.positive, marginTop: 2 }}>{label}</div>}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, paddingLeft: 24 + spacing.md, marginTop: 2 }}>
        {item.metadata?.durationMinutes !== undefined && (
          <span style={{ ...typography.caption, color: colors.textMuted }}>{formatActivityDuration({ durationMinutes: item.metadata.durationMinutes })}</span>
        )}
        {item.status && <StatusBadge label={item.status} tone={statusTone(item.status)} />}
        {hasExplanation && (
          <button type="button" onClick={onToggleExpand} aria-expanded={isExpanded} aria-controls={panelId} style={{ ...typography.caption, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            Why?
          </button>
        )}
        {!isOpportunity && item.primaryAction && onOpen && (
          <TextButton onClick={() => onOpen(item)} style={{ marginLeft: 'auto' }}>
            {item.primaryAction.label}
          </TextButton>
        )}
      </div>
      {isOpportunity && (
        <div style={{ paddingLeft: 24 + spacing.md, marginTop: spacing.sm }}>
          <PrimaryButton onClick={() => onPlan?.(item)} disabled={isPlanning} style={{ padding: '6px 16px', fontSize: 13 }}>
            {isPlanning ? 'Planning…' : 'Plan'}
          </PrimaryButton>
        </div>
      )}
      {isExpanded && hasExplanation && (
        <div id={panelId} style={{ paddingLeft: 24 + spacing.md, marginTop: spacing.sm, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ ...typography.caption, color: colors.textMuted, fontWeight: 800 }}>Why this time?</div>
          {explanationLines.map((line, index) => (
            <div key={index} style={{ ...typography.caption, color: colors.textSecondary }}>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
