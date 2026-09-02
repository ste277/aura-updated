'use client';

import React, { useEffect, useState } from 'react';
import { swapSuggestion, type IntentionalDaySuggestion } from '../lib/dayBuilder';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import type { EverydaySharedCandidate } from '../../../packages/recommendation/src/everydayTimingFit';
import type { DailyStoryPhase } from '../lib/dailyStory';
import type { DailyIntentionGroupId } from '../lib/dailyIntentions';
import { RESULT_LABEL_TEXT, EVERYDAY_SHARED_RATING_TEXT, saveUpcomingPlanFromCandidate } from './PlanWithAuraView';
import { trackEvent } from '../lib/trackEvent';
import { colors, spacing, radius, typography } from './theme';
import { PrimaryButton, SecondaryButton, TextButton, StatusBadge } from './ui';

/**
 * Intentional Day Builder V1 -- Daily Story's proactive suggestion cards
 * (brief sections 18-26). A self-contained sibling to MyDayStoryCard (not a
 * rewrite of it): fetches GET /api/my-day/suggestions itself, and every
 * action reuses the SAME canonical creation paths the manual My Day flow
 * already uses -- saveUpcomingPlanFromCandidate() for Add, the existing
 * POST /api/aura-moments for Invite (brief section 19/21). Zero suggestions
 * renders nothing at all, not an empty-state card (brief section 13: "Zero
 * suggestions is a successful result").
 */

function formatTimeRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${new Date(startIso).toLocaleTimeString('en-US', opts)} – ${new Date(endIso).toLocaleTimeString('en-US', opts)}`;
}

type ActionStatus = 'IDLE' | 'SAVING' | 'DONE' | 'ERROR';

interface SuggestionState {
  addStatus: ActionStatus;
  addedPlannedActivityId?: string;
  inviteStatus: ActionStatus;
  dismissStatus: ActionStatus;
  error?: string;
  /** Home Compactness + Flexible Day Story V1 (brief section 26/29) -- a
   * PURE local UI selection into `suggestion.candidate.candidates`, never
   * persisted, never triggers a re-search. Defaults to 0 (the engine's own
   * highest-ranked slot). Switching this does nothing else -- Add/Invite
   * read it at the moment of the real action, nothing more. */
  selectedCandidateIndex: number;
  showOtherTimes: boolean;
}

const IDLE_STATE: SuggestionState = { addStatus: 'IDLE', inviteStatus: 'IDLE', dismissStatus: 'IDLE', selectedCandidateIndex: 0, showOtherTimes: false };

export function DayBuilderCard({
  dayPhase,
  localDate,
  onCreated,
  onMuteGroup,
}: {
  dayPhase: DailyStoryPhase;
  /** Today's local calendar date ('YYYY-MM-DD') -- part of the Add
   * idempotency key (brief section 20), so a retry on a NEW day never
   * collides with yesterday's already-created Plan for the same suggestion id. */
  localDate: string;
  onCreated: () => void;
  /** "Show me less like this" (Day Builder dismiss support) -- updates the
   * EXISTING preference/muted-group mechanism (You -> Day Builder), never
   * the daily dismissal table. Optional: when not provided, the follow-up
   * link after a dismissal simply doesn't render. */
  onMuteGroup?: (groupId: DailyIntentionGroupId) => void;
}) {
  const [suggestions, setSuggestions] = useState<IntentionalDaySuggestion[] | null>(null);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const [stateById, setStateById] = useState<Record<string, SuggestionState>>({});
  // "Show me less like this" -- a quiet, ephemeral follow-up to the MOST
  // RECENT dismissal only (not per-card state, since the dismissed card
  // itself is already gone by the time this would render).
  const [lastDismissed, setLastDismissed] = useState<{ groupId: DailyIntentionGroupId; label: string } | null>(null);

  /** Personalized Daily Story V2 (brief section 10) -- the ONE place this
   * component talks to GET /api/my-day/suggestions, reused by both the
   * mount effect and the post-Add/Invite refresh below. Returns null on
   * any failure (silent -- an empty/failed fetch just means Day Builder
   * shows nothing this load; the existing manual intention flow inside
   * MyDayStoryCard always remains available regardless). */
  const fetchSuggestions = async (): Promise<IntentionalDaySuggestion[] | null> => {
    try {
      const res = await fetch('/api/my-day/suggestions');
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.suggestions)) return null;
      return data.suggestions;
    } catch {
      return null;
    }
  };

  // Brief section 27/33/34 -- NIGHT is never fetched at all, matching the
  // orchestrator's own early return; nothing to show and nothing worth a
  // network call for.
  useEffect(() => {
    if (dayPhase === 'NIGHT') {
      setSuggestions(null);
      setVisibleIds([]);
      setLastDismissed(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const fresh = await fetchSuggestions();
      if (cancelled || !fresh) return;
      setSuggestions(fresh);
      setVisibleIds(fresh.slice(0, 3).map((s) => s.id));
      setLastDismissed(null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayPhase, localDate]);

  // "Show me less like this" can still have something to say even after
  // the last visible suggestion was dismissed (brief section 8: "zero
  // suggestions is valid") -- only bail out entirely when there's ALSO no
  // pending follow-up to show.
  if (dayPhase === 'NIGHT' || !suggestions || (visibleIds.length === 0 && !lastDismissed)) return null;

  const visible = visibleIds
    .map((id) => suggestions.find((s) => s.id === id))
    .filter((s): s is IntentionalDaySuggestion => Boolean(s));
  const reserve = suggestions.filter((s) => !visibleIds.includes(s.id));

  const stateFor = (id: string): SuggestionState => stateById[id] ?? IDLE_STATE;
  const setState = (id: string, next: Partial<SuggestionState>) => {
    setStateById((prev) => ({ ...prev, [id]: { ...stateFor(id), ...next } }));
  };

  const swap = (suggestion: IntentionalDaySuggestion) => {
    trackEvent('DAY_BUILDER_ANOTHER_IDEA', { metadata: { intentionCategory: suggestion.groupId, dayPhase } });
    // Pure array recombination over the ALREADY-fetched suggestion set --
    // see swapSuggestion's own doc comment for why this can never trigger
    // a new search/scoring call or create a Plan/Moment.
    setVisibleIds((prev) => swapSuggestion(prev, suggestions, suggestion.id));
  };

  /** Brief section 26/27/28 -- resolves to the exact TimingCandidate the
   * client has selected (default index 0, the engine's own highest-ranked
   * slot), never silently reverting to the top-ranked one regardless of
   * what the user tapped. For a SHARED suggestion, Add still saves a
   * personal Plan from the underlying `generalCandidate` (unchanged from
   * before this brief -- Add and Invite were always two independent
   * actions on the same resolved time, see handleInvite below for the
   * SHARED-specific candidate itself). */
  const selectedGeneralCandidate = (suggestion: IntentionalDaySuggestion): TimingCandidate => {
    const index = Math.min(stateFor(suggestion.id).selectedCandidateIndex, suggestion.candidate.candidates.length - 1);
    return suggestion.candidate.kind === 'SOLO' ? suggestion.candidate.candidates[index] : suggestion.candidate.candidates[index].generalCandidate;
  };

  const selectCandidate = (suggestion: IntentionalDaySuggestion, index: number) => {
    // Brief section 29 -- a pure local state write. No fetch, no Timing
    // Search / Shared Timing re-run, no Plan/Moment creation.
    setState(suggestion.id, { selectedCandidateIndex: index });
    trackEvent('DAY_BUILDER_SLOT_SELECTED', { metadata: { activityId: suggestion.activityId, candidateRank: index, dayPhase, hasPerson: suggestion.candidate.kind === 'SHARED' } });
  };

  const handleAdd = async (suggestion: IntentionalDaySuggestion) => {
    setState(suggestion.id, { addStatus: 'SAVING', error: undefined });
    try {
      // Brief section 20 -- a stable id per (suggestion, local date), so a
      // double-tap or a benign re-render can never create a second Plan.
      const clientRequestId = `daybuilder:${suggestion.id}:${localDate}`;
      const plan = await saveUpcomingPlanFromCandidate(selectedGeneralCandidate(suggestion), suggestion.durationMinutes, undefined, undefined, clientRequestId);
      trackEvent('DAY_BUILDER_SUGGESTION_ADDED', { metadata: { intentionCategory: suggestion.groupId, activityId: suggestion.activityId, dayPhase } });
      setState(suggestion.id, { addStatus: 'DONE', addedPlannedActivityId: plan.id });
      onCreated();
      await refreshAfterCreate();
    } catch {
      setState(suggestion.id, { addStatus: 'ERROR', error: 'Could not add this to your day. Try again.' });
    }
  };

  const handleInvite = async (suggestion: IntentionalDaySuggestion) => {
    if (suggestion.candidate.kind !== 'SHARED') return;
    const shared = suggestion.candidate.candidates[Math.min(stateFor(suggestion.id).selectedCandidateIndex, suggestion.candidate.candidates.length - 1)];
    const person = suggestion.candidate.person;
    setState(suggestion.id, { inviteStatus: 'SAVING', error: undefined });
    try {
      const res = await fetch('/api/aura-moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'SHARED',
          source: 'PLAN',
          activityId: suggestion.activityId,
          // Brief section 28 -- the EXACT selected candidate's own
          // start/end, never re-derived from generalCandidate or re-searched.
          startAt: shared.start,
          endAt: shared.end,
          ratingLabel: shared.rating,
          savedPersonId: person.id,
          // Brief section 22 -- if this suggestion was already Added as a
          // personal Plan first, link the Moment to it (the same dedup
          // linkage dailyAgenda.ts already understands: one agenda row,
          // not two, for the same real event).
          ...(stateFor(suggestion.id).addedPlannedActivityId ? { plannedActivityId: stateFor(suggestion.id).addedPlannedActivityId } : {}),
        }),
      });
      if (!res.ok) throw new Error('failed');
      trackEvent('DAY_BUILDER_INVITE_SENT', { metadata: { intentionCategory: suggestion.groupId, activityId: suggestion.activityId, dayPhase } });
      setState(suggestion.id, { inviteStatus: 'DONE' });
      onCreated();
      await refreshAfterCreate();
    } catch {
      setState(suggestion.id, { inviteStatus: 'ERROR', error: 'Could not send this invite. Try again.' });
    }
  };

  /** Personalized Daily Story V2 (brief section 10) -- after a real
   * creation (Add or Invite), re-derive Day Builder's own list from
   * scratch rather than just locally removing the one card: the agenda
   * (and therefore DailyPriorityCoverage) genuinely changed, so ordering
   * and diversity for the REMAINING suggestions may have changed too. No
   * fake client-side narrative -- a real GET against the freshly-updated
   * agenda. Falls back to a plain local removal if the refetch itself
   * fails, so a transient network blip never leaves a stale, already-acted-
   * on suggestion sitting in the reserve pool. */
  const refreshAfterCreate = async () => {
    const fresh = await fetchSuggestions();
    if (fresh) {
      setSuggestions(fresh);
      setVisibleIds(fresh.slice(0, 3).map((s) => s.id));
    }
  };

  // "Not today" -- declines this exact (activityId, person) suggestion for
  // the rest of the local day (brief: dismiss support). Never a "Cancel":
  // no Plan/Moment exists yet to cancel, this is purely a preference not
  // to see this specific pairing again today. Persisted server-side
  // (POST .../dismiss) so a refresh doesn't bring it back; the visible
  // list itself reuses swapSuggestion() -- the exact same "replace from
  // reserve, else shrink, zero is valid" semantics as "Another idea".
  const handleDismiss = async (suggestion: IntentionalDaySuggestion) => {
    if (stateFor(suggestion.id).dismissStatus === 'SAVING') return; // guards a rapid double-click -- TextButton has no disabled prop to rely on
    const sharedPerson = suggestion.candidate.kind === 'SHARED' ? suggestion.candidate.person : null;
    trackEvent('DAY_BUILDER_SUGGESTION_DISMISSED', {
      metadata: { activityId: suggestion.activityId, intentionCategory: suggestion.groupId, hasPerson: sharedPerson !== null, dayPhase },
    });
    setState(suggestion.id, { dismissStatus: 'SAVING', error: undefined });
    try {
      const res = await fetch('/api/my-day/suggestions/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: suggestion.activityId, ...(sharedPerson ? { personId: sharedPerson.id } : {}) }),
      });
      if (!res.ok) throw new Error('failed');
      setVisibleIds((prev) => swapSuggestion(prev, suggestions, suggestion.id));
      setLastDismissed({ groupId: suggestion.groupId, label: suggestion.label });
    } catch {
      setState(suggestion.id, { dismissStatus: 'ERROR', error: 'Could not dismiss this. Try again.' });
    }
  };

  const handleMuteGroup = () => {
    if (lastDismissed) onMuteGroup?.(lastDismissed.groupId);
    setLastDismissed(null);
  };

  return (
    <section
      style={{
        background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(13, 28, 62, 0.82))',
        border: '1px solid rgba(96, 165, 250, 0.18)',
        borderRadius: radius.lg,
        padding: spacing.xxl,
      }}
    >
      <div style={{ ...typography.sectionEyebrow }}>Make room for what matters</div>
      <h2 style={{ ...typography.pageTitle, fontSize: 19, margin: '6px 0 0' }}>{dayPhase === 'MORNING' ? 'Shape your day' : 'What would make today feel worthwhile?'}</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.lg }}>
        {visible.map((suggestion) => {
          const state = stateFor(suggestion.id);
          const candidates = suggestion.candidate.candidates;
          const selectedIndex = Math.min(state.selectedCandidateIndex, candidates.length - 1);
          const selected = candidates[selectedIndex];
          const fitLabel =
            suggestion.candidate.kind === 'SOLO'
              ? RESULT_LABEL_TEXT[(selected as TimingCandidate).label]
              : EVERYDAY_SHARED_RATING_TEXT[(selected as EverydaySharedCandidate).rating] ?? 'Good fit';
          const sharedCandidate = suggestion.candidate.kind === 'SHARED' ? suggestion.candidate : null;
          const isShared = sharedCandidate !== null;
          // Brief section 24 -- 2 visible time chips by default, an
          // "Other times" reveal for a 3rd when one exists.
          const visibleSlotCount = state.showOtherTimes ? candidates.length : Math.min(2, candidates.length);

          return (
            <div
              key={suggestion.id}
              data-testid="day-builder-suggestion"
              data-activity-id={suggestion.activityId}
              data-group-id={suggestion.groupId}
              style={{ border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.md, padding: spacing.lg }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <div style={{ ...typography.bodyStrong }}>
                  {suggestion.icon} {suggestion.label}
                  {sharedCandidate ? ` with ${sharedCandidate.person.name}` : ''}
                </div>
                <StatusBadge label={fitLabel} tone={isShared ? 'relationship' : 'positive'} />
              </div>

              {/* Brief section 24/26/52 -- real, selectable controls (not
               * plain text): each slot is its own button, the selected one
               * is visually AND semantically marked (aria-pressed), never
               * color-only. Switching slots is a pure local state change
               * (brief section 29) -- no network call happens here. */}
              <div role="group" aria-label={`Choose a time for ${suggestion.label}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {candidates.slice(0, visibleSlotCount).map((c, index) => (
                  <button
                    key={c.start}
                    type="button"
                    aria-pressed={index === selectedIndex}
                    onClick={() => selectCandidate(suggestion, index)}
                    style={{
                      border: `1px solid ${index === selectedIndex ? colors.accentBorder : colors.borderSubtle}`,
                      borderRadius: radius.sm,
                      background: index === selectedIndex ? colors.positiveSoft : 'transparent',
                      color: index === selectedIndex ? colors.positive : colors.textSecondary,
                      fontSize: 12.5,
                      fontWeight: index === selectedIndex ? 850 : 700,
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {formatTimeRange(c.start, c.end)}
                    {index === 0 && candidates.length > 1 ? ' · Best' : ''}
                  </button>
                ))}
                {!state.showOtherTimes && candidates.length > 2 && (
                  <TextButton onClick={() => setState(suggestion.id, { showOtherTimes: true })} color={colors.textMuted}>
                    Other times →
                  </TextButton>
                )}
              </div>

              <p style={{ ...typography.caption, color: colors.textFaint, marginTop: 8, lineHeight: 1.4 }}>{suggestion.reason}</p>

              {state.error && <div style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>{state.error}</div>}

              <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap', alignItems: 'center' }}>
                {state.addStatus === 'DONE' ? (
                  <StatusBadge label="✓ Added to your day" tone="positive" />
                ) : (
                  <PrimaryButton onClick={() => handleAdd(suggestion)} disabled={state.addStatus === 'SAVING'}>
                    {state.addStatus === 'SAVING' ? 'Adding…' : '+ Add'}
                  </PrimaryButton>
                )}

                {sharedCandidate &&
                  (state.inviteStatus === 'DONE' ? (
                    <StatusBadge label="✓ Invite sent" tone="relationship" />
                  ) : (
                    <SecondaryButton onClick={() => handleInvite(suggestion)} disabled={state.inviteStatus === 'SAVING'}>
                      {state.inviteStatus === 'SAVING' ? 'Sending…' : `Invite ${sharedCandidate.person.name}`}
                    </SecondaryButton>
                  ))}

                {state.addStatus !== 'DONE' && (
                  <TextButton onClick={() => handleDismiss(suggestion)} color={colors.textFaint}>
                    {state.dismissStatus === 'SAVING' ? 'Dismissing…' : 'Not today'}
                  </TextButton>
                )}

                {reserve.length > 0 && state.addStatus !== 'DONE' && (
                  <TextButton onClick={() => swap(suggestion)} color={colors.textMuted}>
                    Another idea →
                  </TextButton>
                )}
              </div>
            </div>
          );
        })}

        {lastDismissed && onMuteGroup && (
          <div style={{ marginTop: 2 }}>
            <TextButton onClick={handleMuteGroup} color={colors.textFaint}>
              Show me less like this
            </TextButton>
          </div>
        )}
      </div>
    </section>
  );
}
