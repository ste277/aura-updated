/**
 * Day Constructor V1 -- PR D presentation adapters.
 *
 * PRESENTATION ONLY (this ticket's own section 1/5): every function here
 * turns a `ConstructDayPreview` (PR C's own stable contract) into plain
 * text/labels for the UI. Nothing here re-runs timing search, recomputes
 * capacity, re-ranks intents, re-evaluates blockers, or changes a
 * deferred reason -- the UI renders constructor truth verbatim; this
 * file only decides how to WORD that truth.
 *
 * Kept separate from `DayPlanPreview.tsx` so every mapping decision here
 * is a plain, directly-testable function, matching this repository's own
 * established convention (e.g. `dayConstructorOrchestrator.ts`'s own
 * `isActivePlanBlocker`/`mapTimingLabelToPlacementFit`) of keeping
 * presentation-adapter logic out of JSX.
 */

import type { CapacityState } from './dayCapacity';
import type { ConstructDayPreview, ConstructDayWarning, ResolvedIntentSummary } from './dayConstructorOrchestrator';
import type { PlacementDeferralReason, PlacementTimingFit, ProposedItem } from './dayConstructor';
import type { MuhurtaActivityFamily } from '../../../packages/muhurta/src/muhurtaEngine';

// ============================================================
// Capacity state (this ticket's own section 7/8). No independent capacity
// calculation -- every caller passes through `constructedDay.requestedCapacity.capacityState`
// (or `.proposedCapacity.capacityState`) verbatim; this function only
// supplies the copy for whichever `CapacityState` it is handed.
//
// PR D uses `requestedCapacity` (never `proposedCapacity`) for the
// header: `requestedCapacity` is "how full today would be if everything
// got placed" (dayConstructor.ts's own doc comment), which is the only
// one of the two snapshots that can ever read `OVERLOADED` -- exactly
// this ticket's own section 20 meaning ("not everything fits"). A day
// where everything already got placed can never be reported as
// overloaded by construction (`proposedCapacity` only ever sums minutes
// that were actually placed), so it would never surface this state at
// all.
// ============================================================

export interface CapacityPresentation {
  label: string;
  description: string;
}

export function presentCapacityState(state: CapacityState): CapacityPresentation {
  switch (state) {
    case 'OPEN':
      return { label: 'Open day', description: "There's still plenty of room in your day." };
    case 'BALANCED':
      return { label: 'Balanced day', description: 'Your priorities fit with some breathing room.' };
    case 'BUSY':
      return { label: 'Busy day', description: 'Most of your available time is accounted for.' };
    case 'OVERLOADED':
      return { label: 'Overloaded day', description: 'Not everything fits in the time available.' };
  }
}

// ============================================================
// Target date label (this ticket's own section 7: "Target date").
// Reproduces -- never imports, since it is a private, unexported helper
// -- `ForwardPlannerView.tsx`'s own `formatLocalDateLabel` formula
// verbatim: a `targetDate` dateStr (YYYY-MM-DD) is a local CALENDAR date,
// never an instant, so it is parsed as UTC noon-anchored to avoid any
// timezone-shift-induced off-by-one day.
// ============================================================

export function formatTargetDateLabel(targetDate: string): string {
  const [year, month, day] = targetDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ============================================================
// Item time formatting -- reproduces HomeTimeline.tsx's own private
// `formatItemTime` formula verbatim.
// ============================================================

export function formatItemClockTime(date: Date, timezone: string): string {
  return date.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

// ============================================================
// Placement provenance (this ticket's own section 9/17/18) -- the
// critical FIXED-vs-Aura-selected distinction, in plain language, never
// "Fixed constraint" and never a superlative claim about either time
// (this ticket's own section 19).
// ============================================================

export function presentPlacementSource(source: ProposedItem['placementSource']): string {
  return source === 'FIXED_CONSTRAINT' ? 'You chose this time' : 'Aura selected this time';
}

// Neither string above claims a superlative -- PR B's placement is
// deterministic greedy, not a global optimizer, so copy anywhere in this
// file must never assert a placed time is the single best one achievable.

// ============================================================
// Timing fit (this ticket's own section 16). Reuses the app's OWN
// already-established terminology for this exact tier set --
// `homeTimelineComposer.ts`'s `mapTimingLabelToHomeStatus` /
// `HomeTimeline.tsx`'s own `statusTone` already render precisely
// 'Best'/'Good'/'Workable'/'Caution' via `StatusBadge` elsewhere in the
// product (Home's own timeline rows) -- reproduced here verbatim rather
// than inventing new wording ("Strong fit"/"Good fit"/etc.), since real
// existing product language already exists and applies one-to-one.
// ============================================================

export type TimingFitTone = 'positive' | 'info' | 'neutral' | 'caution';

export function presentTimingFit(fit: PlacementTimingFit): { label: string; tone: TimingFitTone } {
  switch (fit) {
    case 'BEST':
      return { label: 'Best', tone: 'positive' };
    case 'GOOD':
      return { label: 'Good', tone: 'info' };
    case 'WORKABLE':
      return { label: 'Workable', tone: 'neutral' };
    case 'CAUTION':
      return { label: 'Caution', tone: 'caution' };
  }
}

// ============================================================
// Deferred reason mapping (this ticket's own section 13) -- ONE explicit
// adapter, covering every real `PlacementDeferralReason` value (not just
// the ticket's own illustrative subset), never exposing a raw enum
// string, never inventing causal detail the diagnostic doesn't state.
// ============================================================

export function presentDeferralReason(reason: PlacementDeferralReason): string {
  switch (reason) {
    case 'DURATION_UNKNOWN':
      return "Aura doesn't know how much time this needs yet.";
    case 'NO_CANDIDATES':
      return "Aura couldn't find a suitable time.";
    case 'NO_FEASIBLE_WINDOW':
      return "There isn't enough open time that fits this activity.";
    case 'OUTSIDE_CONSTRUCTION_WINDOW':
      return "The requested time is outside the part of the day you're planning.";
    case 'FIXED_WINDOW_CONFLICT':
      return 'That time conflicts with something already in your day.';
    case 'FIXED_WINDOW_INVALID':
      return "The fixed time couldn't be used.";
    case 'BLOCKED_BY_COMMITMENT':
      return 'That time is already taken by something on your schedule.';
    case 'CONFLICTS_WITH_PROPOSED_ITEM':
      return 'That time conflicts with another activity Aura placed today.';
  }
}

// ============================================================
// Warnings (this ticket's own section 14) -- secondary, per-intent
// context, never a raw warning code, never duplicating the deferred
// explanation. `NO_TIMING_CANDIDATES_FOUND` is deliberately DROPPED
// here (not mapped to any text): a deferred `NO_CANDIDATES` item already
// carries this exact fact via `presentDeferralReason` above, so showing
// it again as a separate warning would be duplicate noise for the same
// event (this ticket's own explicit instruction).
// ============================================================

export interface WarningPresentation {
  intentId: string;
  text: string;
}

function humanizeActivityFamily(family: MuhurtaActivityFamily): string {
  const lower = family.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * `resolvedIntents` is required so `ACTIVITY_RESOLVED_TO_COARSE_FAMILY`
 * can look up the actual resolved `activityFamily` (this ticket's own
 * section 14: "if family is available") -- `ConstructDayWarning` itself
 * carries only `{ intentId, code }`, never the family. When resolution
 * genuinely produced no family (should not happen for this specific
 * code in practice, since `dayConstructorOrchestrator.ts`'s own coarse-
 * family fallback always sets one, but this file never assumes an
 * upstream invariant it cannot verify), the warning is silently
 * dropped rather than shown with an invented/vague message.
 */
export function presentWarnings(warnings: readonly ConstructDayWarning[], resolvedIntents: readonly ResolvedIntentSummary[]): WarningPresentation[] {
  const familyByIntentId = new Map(resolvedIntents.map((resolved) => [resolved.requestedIntentId, resolved.dayIntent.activityFamily] as const));
  const presentations: WarningPresentation[] = [];
  for (const warning of warnings) {
    if (warning.code === 'NO_TIMING_CANDIDATES_FOUND') continue;
    if (warning.code === 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY') {
      const family = familyByIntentId.get(warning.intentId);
      if (family) presentations.push({ intentId: warning.intentId, text: `Aura interpreted this as ${humanizeActivityFamily(family)}` });
      continue;
    }
    if (warning.code === 'DURATION_FROM_GENERIC_FALLBACK') {
      presentations.push({ intentId: warning.intentId, text: 'Estimated duration' });
      continue;
    }
  }
  return presentations;
}

/** Groups warning text by `intentId` so a row can look up its own
 * warnings by a single map lookup instead of filtering the full list. */
export function groupWarningsByIntentId(presentations: readonly WarningPresentation[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const presentation of presentations) {
    (grouped[presentation.intentId] ??= []).push(presentation.text);
  }
  return grouped;
}

// ============================================================
// Chronology (this ticket's own section 11) -- DISPLAY ordering only.
// Never mutates the input array; never implies this order is
// `constructDay`'s own priority/placement order.
// ============================================================

export function sortProposedItemsForDisplay(items: readonly ProposedItem[]): ProposedItem[] {
  return [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ============================================================
// Deferred-item title lookup (this ticket's own section 10/12) --
// `DeferredItem` itself carries only `{ intentId, primaryReason,
// diagnostics }`, never a title; the title is recovered from
// `resolvedIntents`, which every requested intent (placed or deferred)
// always has an entry in.
// ============================================================

export function titleForIntentId(resolvedIntents: readonly ResolvedIntentSummary[], intentId: string): string {
  return resolvedIntents.find((resolved) => resolved.requestedIntentId === intentId)?.dayIntent.title ?? 'Untitled';
}

// ============================================================
// Proposal summary state (this ticket's own section 29/30) -- a pure
// classification of the three shapes a `ConstructDayPreview` can take,
// so `DayPlanPreview.tsx` never has to re-derive this branching itself.
// ============================================================

export type ProposalSummaryState = 'NOTHING_REQUESTED' | 'ALL_DEFERRED' | 'HAS_ITEMS';

export function classifyProposalSummary(preview: Pick<ConstructDayPreview, 'resolvedIntents' | 'constructedDay'>): ProposalSummaryState {
  if (preview.resolvedIntents.length === 0) return 'NOTHING_REQUESTED';
  if (preview.constructedDay.proposedItems.length === 0) return 'ALL_DEFERRED';
  return 'HAS_ITEMS';
}
