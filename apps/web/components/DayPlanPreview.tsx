'use client';

import React from 'react';
import type { ConstructDayPreview } from '../lib/dayConstructorOrchestrator';
import type { ProposedItem, DeferredItem } from '../lib/dayConstructor';
import {
  presentCapacityState,
  formatTargetDateLabel,
  formatItemClockTime,
  presentPlacementSource,
  presentTimingFit,
  presentDeferralReason,
  presentWarnings,
  groupWarningsByIntentId,
  sortProposedItemsForDisplay,
  titleForIntentId,
  classifyProposalSummary,
} from '../lib/dayPlanPreviewPresentation';
import { formatActivityDuration } from '../lib/activityDuration';
import { colors, spacing, typography } from './theme';
import { SectionHeader, SurfaceCard, StatusBadge, PrimaryButton, SecondaryButton, EmptyState, type StatusTone } from './ui';

/**
 * Day Constructor V1 -- PR D. PROPOSE + EXPLAIN only (this ticket's own
 * section 1): this component never implements CONFIRM or CHANGE. It
 * renders a `ConstructDayPreview` exactly as `constructDay` (PR B, via
 * PR C's own orchestrator) produced it -- no re-ranking, no re-running
 * timing search, no recomputing capacity, no moving/shortening/splitting
 * any item, no changing a deferred reason. `onContinue`/`onDiscard` are
 * plain callbacks; NEITHER performs any persistence or network mutation
 * -- what "Continue" actually does belongs to a future PR E.
 *
 * Deliberately does NOT accept an `OrchestrateConstructDayResult` (the
 * outer discriminated union PR C's `orchestrateConstructDay` returns).
 * This component only ever renders the already-successful `'READY'`
 * payload (`ConstructDayPreview`); a caller holding a `'NO_USABLE_CAPACITY'`
 * or `'TIMING_SEARCH_FAILED'` result renders its own failure/retry state
 * and never constructs a `<DayPlanPreview>` at all (this ticket's own
 * section 21: "keep failure rendering outside this component" -- since
 * no real call site exists yet in this PR, building that rendering here
 * would be speculative UI for a caller that does not exist).
 */
export interface DayPlanPreviewProps {
  preview: ConstructDayPreview;
  onContinue?: (preview: ConstructDayPreview) => void;
  onDiscard?: () => void;
}

export function DayPlanPreview({ preview, onContinue, onDiscard }: DayPlanPreviewProps) {
  const { targetDate, timezone, resolvedIntents, constructedDay, warnings } = preview;
  const capacity = presentCapacityState(constructedDay.requestedCapacity.capacityState);
  const summaryState = classifyProposalSummary(preview);
  const sortedProposed = sortProposedItemsForDisplay(constructedDay.proposedItems);
  const warningsByIntentId = groupWarningsByIntentId(presentWarnings(warnings, resolvedIntents));
  const everythingFits = summaryState === 'HAS_ITEMS' && constructedDay.deferredItems.length === 0;

  return (
    <div>
      <div style={{ ...typography.pageTitle, fontSize: 22 }}>Aura built a plan for your day</div>
      <p style={{ ...typography.pageSubtitle, margin: '4px 0 0' }}>{formatTargetDateLabel(targetDate)}</p>

      <SurfaceCard style={{ marginTop: spacing.lg }}>
        <div style={typography.sectionTitle}>{capacity.label}</div>
        <p style={{ ...typography.body, marginTop: spacing.xs }}>{capacity.description}</p>
      </SurfaceCard>

      <section style={{ marginTop: spacing.xxl }}>
        <SectionHeader label="Proposed schedule" />
        {summaryState === 'NOTHING_REQUESTED' && (
          <EmptyState title="Nothing to plan yet" description="Aura has no requested activities for this day." />
        )}
        {summaryState === 'ALL_DEFERRED' && (
          <EmptyState title="Nothing could be scheduled" description="See below for why each activity didn't fit." />
        )}
        {summaryState === 'HAS_ITEMS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {sortedProposed.map((item) => (
              <ProposedItemRow key={item.intentId} item={item} timezone={timezone} warningTexts={warningsByIntentId[item.intentId] ?? []} />
            ))}
          </div>
        )}
        {everythingFits && <p style={{ ...typography.meta, marginTop: spacing.md }}>Everything fits.</p>}
      </section>

      {constructedDay.deferredItems.length > 0 && (
        <section style={{ marginTop: spacing.xxl }}>
          <SectionHeader label="Couldn't fit" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {constructedDay.deferredItems.map((item) => (
              <DeferredItemRow
                key={item.intentId}
                item={item}
                title={titleForIntentId(resolvedIntents, item.intentId)}
                warningTexts={warningsByIntentId[item.intentId] ?? []}
              />
            ))}
          </div>
        </section>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.xxl }}>
        {onDiscard && <SecondaryButton onClick={onDiscard}>Discard</SecondaryButton>}
        {onContinue && <PrimaryButton onClick={() => onContinue(preview)}>Continue</PrimaryButton>}
      </div>
    </div>
  );
}

function ProposedItemRow({ item, timezone, warningTexts }: { item: ProposedItem; timezone: string; warningTexts: string[] }) {
  const durationMinutes = Math.round((item.end.getTime() - item.start.getTime()) / 60000);
  const timingFit = item.placementSource === 'SELECTED_CANDIDATE' && item.timingFit ? presentTimingFit(item.timingFit) : null;

  return (
    <SurfaceCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }}>
        <div style={{ minWidth: 0 }}>
          <div style={typography.cardTitle}>{item.title}</div>
          <div style={{ ...typography.meta, marginTop: spacing.xs }}>{presentPlacementSource(item.placementSource)}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ ...typography.bodyStrong }}>{formatItemClockTime(item.start, timezone)}</div>
          <div style={{ ...typography.caption, marginTop: 2 }}>{formatActivityDuration({ durationMinutes })}</div>
        </div>
      </div>
      {(timingFit || warningTexts.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {timingFit && <StatusBadge label={timingFit.label} tone={timingFit.tone as StatusTone} />}
          {warningTexts.map((text, index) => (
            <span key={index} style={{ ...typography.caption, color: colors.textMuted }}>
              {text}
            </span>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

function DeferredItemRow({ item, title, warningTexts }: { item: DeferredItem; title: string; warningTexts: string[] }) {
  return (
    <SurfaceCard style={{ opacity: 0.8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.md }}>
        <span aria-hidden="true" style={{ color: colors.textMuted, fontSize: 15 }}>
          –
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={typography.cardTitle}>{title}</div>
          <div style={{ ...typography.meta, marginTop: spacing.xs }}>{presentDeferralReason(item.primaryReason)}</div>
          {warningTexts.map((text, index) => (
            <div key={index} style={{ ...typography.caption, color: colors.textMuted, marginTop: 2 }}>
              {text}
            </div>
          ))}
        </div>
      </div>
    </SurfaceCard>
  );
}
