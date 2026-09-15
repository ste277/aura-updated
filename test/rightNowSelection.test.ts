/**
 * AURA HOME IA V2 FOLLOW-UP FIXES -- Finding E regression coverage.
 *
 * selectRightNowState() (apps/web/lib/rightNowSelection.ts) is a pure
 * function over an already-composed HomeTimelineItem[] -- fully testable
 * here without a component harness, a live DATABASE_URL, or the real
 * homeTimelineComposer pipeline. Fixtures below are minimal, hand-built
 * HomeTimelineItem objects (never fabricated engine output -- this module
 * never reads score/evidence/raw astrology, only kind/source/rank/
 * metadata.agendaStatus/metadata.isCurrent, all of which the real Composer
 * already guarantees).
 */
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import type { HomeTimelineItem } from '../apps/web/lib/homeTimelineTypes';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function planItem(overrides: Partial<HomeTimelineItem> = {}): HomeTimelineItem {
  return {
    id: 'plan-1',
    kind: 'PLAN',
    start: '2026-09-15T13:54:00.000Z',
    end: '2026-09-15T15:24:00.000Z',
    title: 'Family dinner',
    planned: true,
    source: 'PLAN',
    rank: 1,
    metadata: { agendaStatus: 'CURRENT', isCurrent: true, isPast: false },
    ...overrides,
  };
}

function opportunityItem(overrides: Partial<HomeTimelineItem> = {}): HomeTimelineItem {
  return {
    id: 'opportunity-1',
    kind: 'OPPORTUNITY',
    start: '2026-09-15T15:29:00.000Z',
    end: '2026-09-15T15:59:00.000Z',
    title: 'Deep Work',
    planned: false,
    source: 'DAY_BUILDER_INTENTION',
    rank: 1,
    status: 'Good',
    metadata: { isCurrent: true, isPast: false },
    ...overrides,
  };
}

// ============================================================
// 1. Active Plan -> ACTIVE_PLAN, never OPPORTUNITY.
// ============================================================
{
  const timeline = [planItem()];
  const state = selectRightNowState(timeline);
  check('1. An active Plan (agendaStatus CURRENT, rank 1) resolves to ACTIVE_PLAN', state.kind === 'ACTIVE_PLAN');
  check('1. ACTIVE_PLAN never reads as an "option" state', state.kind !== 'OPPORTUNITY');
}

// ============================================================
// 2. Future non-imminent Plan cannot become Best Option merely because
// highly ranked.
// ============================================================
{
  const timeline = [planItem({ metadata: { agendaStatus: 'UPCOMING', isCurrent: false, isPast: false } })];
  const state = selectRightNowState(timeline);
  check('2. A rank-1 Plan that is neither CURRENT nor STARTING_SOON falls through to CONTEXT_OPEN, never OPPORTUNITY', state.kind === 'CONTEXT_OPEN');
}

// ============================================================
// 3. Valid unplanned Opportunity -> OPPORTUNITY (Best Option Right Now).
// ============================================================
{
  const timeline = [opportunityItem()];
  const state = selectRightNowState(timeline);
  check('3. A currently-actionable rank-1 Opportunity resolves to OPPORTUNITY', state.kind === 'OPPORTUNITY');
}

// ============================================================
// 4. Plan + Opportunity coexist -> only the rank-1 item is ever
// considered (mirrors the pre-existing spotlight's own scope -- this
// module never widens which item can appear), and its own state wins.
// ============================================================
{
  const timelineActivePlanWins = [planItem({ rank: 1 }), opportunityItem({ id: 'opportunity-2', rank: 2 })];
  check('4a. Rank-1 active Plan coexisting with a lower-ranked Opportunity: ACTIVE_PLAN wins (the rank-1 item is a commitment)', selectRightNowState(timelineActivePlanWins).kind === 'ACTIVE_PLAN');

  const timelineOpportunityWins = [opportunityItem({ rank: 1 }), planItem({ id: 'plan-2', rank: 2, metadata: { agendaStatus: 'CURRENT', isCurrent: true, isPast: false } })];
  check('4b. Rank-1 Opportunity coexisting with a lower-ranked active Plan: OPPORTUNITY wins (the rank-1 item is genuinely current)', selectRightNowState(timelineOpportunityWins).kind === 'OPPORTUNITY');
}

// ============================================================
// 5. Planned version of an otherwise-recommended activity is not
// duplicated/re-presented as an unplanned option -- this is the
// Composer's own dedupe (dailyGuidanceCandidates.ts's dedupeCandidates),
// which this selector never re-derives; it only proves the SAME rank-1
// item (now sourced PLAN, never a second OPPORTUNITY entry for the same
// activity) resolves as a commitment, not an option.
// ============================================================
{
  const timeline = [planItem({ id: 'family-dinner-plan', rank: 1 })];
  const state = selectRightNowState(timeline);
  check('5. A Plan that also matches the rank-1 recommendation resolves as a commitment state, never OPPORTUNITY', state.kind === 'ACTIVE_PLAN' || state.kind === 'IMMINENT_PLAN');
}

// ============================================================
// 6. No Plan + no Opportunity -> contextual/open fallback.
// ============================================================
{
  check('6. Empty timeline -> CONTEXT_OPEN', selectRightNowState([]).kind === 'CONTEXT_OPEN');
  check('6. Timeline with no rank-1 item at all -> CONTEXT_OPEN', selectRightNowState([planItem({ rank: undefined })]).kind === 'CONTEXT_OPEN');
}

// ============================================================
// 7. COMPLETED Plan cannot become current recommendation.
// ============================================================
{
  // homeTimelineComposer.ts's own lifecycle override already forces
  // isCurrent=false for a COMPLETED item -- this fixture mirrors that real
  // contract rather than inventing a new one.
  const timeline = [planItem({ metadata: { agendaStatus: 'COMPLETED', isCurrent: false, isPast: true, isCompleted: true } })];
  const state = selectRightNowState(timeline);
  check('7. A COMPLETED Plan never resolves to ACTIVE_PLAN or IMMINENT_PLAN', state.kind !== 'ACTIVE_PLAN' && state.kind !== 'IMMINENT_PLAN');
  check('7. A COMPLETED Plan resolves to CONTEXT_OPEN', state.kind === 'CONTEXT_OPEN');
}

// ============================================================
// 8. MISSED Plan cannot become current recommendation.
// ============================================================
{
  const timeline = [planItem({ metadata: { agendaStatus: 'MISSED', isCurrent: false, isPast: true } })];
  const state = selectRightNowState(timeline);
  check('8. A MISSED Plan never resolves to ACTIVE_PLAN or IMMINENT_PLAN', state.kind !== 'ACTIVE_PLAN' && state.kind !== 'IMMINENT_PLAN');
  check('8. A MISSED Plan resolves to CONTEXT_OPEN', state.kind === 'CONTEXT_OPEN');
}

// ============================================================
// Imminent Plan -> IMMINENT_PLAN, reusing dailyAgenda.ts's own existing
// STARTING_SOON convention (no new threshold invented here).
// ============================================================
{
  const timeline = [planItem({ metadata: { agendaStatus: 'STARTING_SOON', isCurrent: false, isPast: false } })];
  const state = selectRightNowState(timeline);
  check('A Plan starting soon (agendaStatus STARTING_SOON) resolves to IMMINENT_PLAN, never OPPORTUNITY or ACTIVE_PLAN', state.kind === 'IMMINENT_PLAN');
}

// ============================================================
// An Opportunity whose own window is not yet current cannot win Best
// Option Right Now merely because it's rank 1.
// ============================================================
{
  const timeline = [opportunityItem({ metadata: { isCurrent: false, isPast: false } })];
  const state = selectRightNowState(timeline);
  check('A rank-1 Opportunity that is not currently actionable falls through to CONTEXT_OPEN, never OPPORTUNITY', state.kind === 'CONTEXT_OPEN');
}

// ============================================================
// A non-PLAN, non-OPPORTUNITY item (a Moment/HabitLog) never legitimately
// carries a rank in the real Composer output, but this selector must not
// crash or misclassify one defensively either.
// ============================================================
{
  const timeline: HomeTimelineItem[] = [
    { id: 'moment-1', kind: 'MOMENT', start: '2026-09-15T10:00:00.000Z', title: 'Coffee with Priya', planned: true, source: 'MOMENT', rank: 1, metadata: { agendaStatus: 'CURRENT', isCurrent: true } },
  ];
  const state = selectRightNowState(timeline);
  check('A rank-1 item whose source is neither PLAN nor an OPPORTUNITY kind resolves defensively to CONTEXT_OPEN, never fabricated as an option', state.kind === 'CONTEXT_OPEN');
}

// ============================================================
// 9/10 (regression, not new behavior): selectRightNowState never sorts,
// reorders, or filters the timeline it's given -- it only reads the
// single rank-1 item exactly as the Composer already ordered/ranked it.
// ============================================================
{
  const timeline = [planItem({ id: 'a', rank: 2, metadata: { agendaStatus: 'CURRENT', isCurrent: true, isPast: false } }), opportunityItem({ id: 'b', rank: 1 })];
  const state = selectRightNowState(timeline);
  check('Only the genuine rank-1 item is ever selected, even when a differently-ranked item appears earlier in the array (no re-ranking/re-sorting here)', state.kind === 'OPPORTUNITY' && state.item.id === 'b');
}

if (!allPassed) {
  console.error('\nSome Right Now Selection checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL RIGHT NOW SELECTION CHECKS PASSED');
}
