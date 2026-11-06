'use client';

import React, { useEffect, useRef, useState } from 'react';
import { spacing, typography, colors } from './theme';
import { ModalShell, useModalA11y, PrimaryButton, SecondaryButton, TextButton, FieldLabel, FieldHint, FieldError, TextInput } from './ui';
import { getDatePartsInTimezone, getMinuteOfDayInTimezone, localDateTimeToUTC } from '../lib/timezone';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import {
  fetchWeeklyRhythmProposal,
  buildSessionDraftsFromProposal,
  isSessionLocked,
  selectSessionsPendingSubmission,
  applyAcceptanceSummaryToDrafts,
  submitWeeklyAcceptance,
  summarizeSessionReasons,
  formatSessionDayLabel,
  formatSessionTimeLabel,
  describeSessionFailure,
  fetchAdjustmentAlternatives,
  fetchAdjustmentCheck,
  draftFromAdjustmentCandidate,
  siblingLocalDatesExcluding,
  hasDateCollision,
  hasDuplicateActiveLocalDates,
  type WeeklyReviewSessionDraft,
} from '../lib/weeklyPlanReviewClient';

/**
 * HGR3-C2 -- Home weekly planning review/acceptance UI.
 *
 * Journey: Home's "Plan remaining N" -> this modal fetches the EXISTING
 * read-only weekly-proposal endpoint, shows the real proposed sessions,
 * lets the user Adjust/Remove individual sessions, then ONE explicit
 * "Accept all" confirmation calls the EXISTING weekly-accept endpoint.
 * Proposal generation performs zero writes (goalRhythmWeeklyProposal.ts is
 * unmodified and stays strictly read-only); the ONLY write boundary this
 * component ever crosses is the single `submitWeeklyAcceptance` call
 * below, and only once the user has explicitly pressed "Accept all".
 *
 * ACCEPTANCE IDENTITY LIFECYCLE (HGR3-C1 integration contract, mandatory):
 * `acceptanceIdRef` below is generated ONCE per mounted instance of this
 * modal -- i.e. once per explicit "Plan remaining N" open-and-confirm
 * journey -- and reused for every retry of THAT SAME confirmation
 * (a network timeout, a double-click, resubmitting after a partial
 * failure). A genuinely NEW confirmation decision (closing this modal and
 * reopening it later, including to re-book a slot the user previously
 * cancelled) always gets a brand-new instance of this component, and
 * therefore a brand-new UUID, automatically -- there is no code path in
 * this file that mints a second UUID within one mount, and none that
 * reuses this mount's UUID across a reopen. This modal only ever submits
 * sessions for ONE GoalActivity, so one UUID per confirmation is
 * sufficient here; a future surface that could confirm sessions for
 * MULTIPLE GoalActivities in one user action would need a DISTINCT UUID
 * per GoalActivity (the backend's own payload-binding check is scoped per
 * (acceptanceId, GoalActivity, localDate) -- reusing one id across two
 * different GoalActivities is rejected as a conflict, never silently
 * accepted).
 *
 * This file never claims the backend provides full batch-level binding:
 * the known HGR3-C1 limitation (P2-1 -- the payload-binding courtesy check
 * does not catch the SAME acceptanceId being reused for the SAME activity
 * on a DIFFERENT date in a wholly separate later confirmation) is a
 * backend-scope question, not something this UI works around -- every
 * confirmation this component performs is already a single, one-shot
 * submission per mount, so that specific gap is not reachable through this
 * surface at all.
 */
export interface WeeklyPlanReviewModalProps {
  goalActivityId: string;
  activityTitleFallback: string;
  timezone: string;
  onClose: () => void;
}

type LoadState =
  | { phase: 'LOADING' }
  | { phase: 'NOT_ELIGIBLE' }
  | { phase: 'SEARCH_FAILED' }
  | { phase: 'NETWORK_ERROR' }
  | { phase: 'EMPTY' }
  | { phase: 'READY'; activityTitle: string; remainingThisWeek: number; weeklyTarget: number; shortfall: boolean; activityId: string | null; durationMinutes: number };

type SubmitBanner = { kind: 'NETWORK_ERROR' } | { kind: 'HTTP_ERROR'; httpStatus: number } | { kind: 'DATE_COLLISION' } | null;

export function WeeklyPlanReviewModal({ goalActivityId, activityTitleFallback, timezone, onClose }: WeeklyPlanReviewModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // HGR3-C1 -- one UUID for this entire modal instance; see this file's
  // own header comment for the full lifecycle reasoning. Computed lazily,
  // in the render body, into a ref that starts null -- idempotent against
  // React 18 Strict Mode's dev-only double-invoke (the second pass sees
  // `current` already set and is a no-op), and stable for the rest of this
  // component's real mounted lifetime either way.
  const acceptanceIdRef = useRef<string | null>(null);
  if (!acceptanceIdRef.current) acceptanceIdRef.current = crypto.randomUUID();
  const acceptanceId = acceptanceIdRef.current;

  const [state, setState] = useState<LoadState>({ phase: 'LOADING' });
  const [drafts, setDrafts] = useState<WeeklyReviewSessionDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitBanner, setSubmitBanner] = useState<SubmitBanner>(null);
  const [adjustingIndex, setAdjustingIndex] = useState<number | null>(null);

  const [saving, setSavingForEscapeGuard] = useState(false); // true only while submitting -- mirrors EditProposedItemTimeModal.tsx's own Escape-while-saving guard convention.
  useEffect(() => setSavingForEscapeGuard(submitting), [submitting]);
  function noop() {}
  useModalA11y({ isOpen: true, onClose: saving ? noop : onClose, dialogRef, initialFocusRef: headingRef });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchWeeklyRhythmProposal(goalActivityId);
      if (cancelled) return;
      if (result.status === 'OK') {
        setDrafts(buildSessionDraftsFromProposal(result.proposals));
        if (result.proposals.length === 0) {
          setState({ phase: 'EMPTY' });
        } else {
          setState({
            phase: 'READY',
            activityTitle: result.activityTitle,
            remainingThisWeek: result.remainingThisWeek,
            weeklyTarget: result.weeklyTarget,
            shortfall: result.shortfallReason === 'FEWER_SUITABLE_DAYS_THAN_REQUESTED',
            activityId: result.activityId,
            durationMinutes: result.proposals[0].durationMinutes,
          });
        }
        return;
      }
      if (result.status === 'NOT_ELIGIBLE') setState({ phase: 'NOT_ELIGIBLE' });
      else if (result.status === 'NETWORK_ERROR') setState({ phase: 'NETWORK_ERROR' });
      else setState({ phase: 'SEARCH_FAILED' });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalActivityId]);

  function removeSession(index: number) {
    setDrafts((current) => current.filter((_, i) => i !== index));
  }

  function applyAdjustedDraft(index: number, updated: WeeklyReviewSessionDraft) {
    setDrafts((current) => current.map((d, i) => (i === index ? updated : d)));
    setAdjustingIndex(null);
  }

  async function handleAcceptAll() {
    if (state.phase !== 'READY' || submitting) return;
    const pending = selectSessionsPendingSubmission(drafts);
    if (pending.length === 0) return;
    // Defense in depth (HGR3-C2 remediation, P1): the Adjust flow's own
    // same-date guard below should make this unreachable, but "Accept
    // all" revalidates the complete active batch directly rather than
    // merely trusting that gate was never bypassed.
    if (hasDuplicateActiveLocalDates(drafts)) {
      setSubmitBanner({ kind: 'DATE_COLLISION' });
      return;
    }
    setSubmitting(true);
    setSubmitBanner(null);
    const result = await submitWeeklyAcceptance(goalActivityId, acceptanceId, pending);
    setSubmitting(false);
    if (result.status === 'OK') {
      setDrafts((current) => applyAcceptanceSummaryToDrafts(current, pending, result.summary));
      return;
    }
    if (result.status === 'NETWORK_ERROR') {
      // Network uncertainty -- the EXACT acceptanceId and EXACT payload
      // (`pending`, derived fresh from the current, unchanged drafts) are
      // preserved automatically: nothing in this file regenerates
      // `acceptanceIdRef.current`, and a retry re-derives `pending` from
      // the SAME draft state, so "Try again" below resubmits identically.
      setSubmitBanner({ kind: 'NETWORK_ERROR' });
      return;
    }
    setSubmitBanner({ kind: 'HTTP_ERROR', httpStatus: result.status === 'HTTP_ERROR' ? result.httpStatus : 0 });
  }

  const pendingCount = drafts.filter((d) => !isSessionLocked(d.outcome)).length;
  const acceptedCount = drafts.filter((d) => isSessionLocked(d.outcome)).length;
  // Defense in depth (HGR3-C2 remediation, P1) -- see handleAcceptAll's
  // own revalidation of the same condition at submit time.
  const dateCollision = hasDuplicateActiveLocalDates(drafts);

  return (
    <ModalShell
      dialogRef={dialogRef}
      labelledBy="weekly-plan-review-title"
      title={<span ref={headingRef} tabIndex={-1} id="weekly-plan-review-title-text">Plan this week&rsquo;s sessions</span>}
      onClose={saving ? undefined : onClose}
      maxWidth={440}
    >
      {state.phase === 'LOADING' && <div style={typography.caption}>Finding suitable times…</div>}

      {state.phase === 'NOT_ELIGIBLE' && (
        <div style={typography.caption}>This activity no longer has remaining sessions to plan this week.</div>
      )}

      {state.phase === 'SEARCH_FAILED' && (
        <div>
          <FieldError>Aura couldn&rsquo;t find suitable times just now.</FieldError>
          <div style={{ marginTop: spacing.md }}>
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </div>
      )}

      {state.phase === 'NETWORK_ERROR' && (
        <div>
          <FieldError>Couldn&rsquo;t reach Aura. Check your connection and try again.</FieldError>
          <div style={{ marginTop: spacing.md }}>
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </div>
      )}

      {state.phase === 'EMPTY' && (
        <div style={typography.caption}>Aura couldn&rsquo;t find a suitable time this week. Try planning just today instead.</div>
      )}

      {state.phase === 'READY' && (
        <div>
          <div style={{ ...typography.bodyStrong, color: colors.textPrimary }}>
            {state.activityTitle} — {state.remainingThisWeek} remaining
          </div>
          {state.shortfall && (
            <FieldHint>Fewer suitable days remained this week than the full remaining count.</FieldHint>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.md }}>
            {drafts.map((draft, index) => (
              <SessionRow
                key={`${draft.localDate}-${index}`}
                draft={draft}
                timezone={timezone}
                adjusting={adjustingIndex === index}
                disabled={submitting}
                onRemove={() => removeSession(index)}
                onToggleAdjust={() => setAdjustingIndex((current) => (current === index ? null : index))}
                onCancelAdjust={() => setAdjustingIndex(null)}
                onApplyAdjustment={(updated) => applyAdjustedDraft(index, updated)}
                siblingLocalDates={siblingLocalDatesExcluding(drafts, index)}
                activityId={state.activityId}
                activityTitleFallback={activityTitleFallback}
                durationMinutes={draft.durationMinutes}
              />
            ))}
          </div>

          {submitBanner?.kind === 'NETWORK_ERROR' && (
            <FieldError>Couldn&rsquo;t reach Aura to confirm these sessions. Your selections are unchanged -- try again.</FieldError>
          )}
          {submitBanner?.kind === 'HTTP_ERROR' && <FieldError>Aura couldn&rsquo;t confirm these sessions just now. Try again.</FieldError>}
          {(submitBanner?.kind === 'DATE_COLLISION' || dateCollision) && (
            <FieldError>Two sessions in this batch are on the same date. Adjust or remove one before accepting.</FieldError>
          )}

          {acceptedCount > 0 && pendingCount === 0 && (
            <div style={{ ...typography.caption, color: colors.positive, marginTop: spacing.md }}>
              {acceptedCount} of {drafts.length} session{drafts.length === 1 ? '' : 's'} planned.
            </div>
          )}
          {acceptedCount > 0 && pendingCount > 0 && (
            <div style={{ ...typography.caption, marginTop: spacing.md }}>
              {acceptedCount} of {drafts.length} sessions planned. {pendingCount} need{pendingCount === 1 ? 's' : ''} attention.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg, flexWrap: 'wrap' }}>
            <SecondaryButton onClick={onClose} disabled={submitting}>
              {pendingCount === 0 && acceptedCount > 0 ? 'Done' : 'Cancel'}
            </SecondaryButton>
            {pendingCount > 0 && (
              <PrimaryButton onClick={handleAcceptAll} disabled={submitting || pendingCount === 0 || dateCollision} style={{ minHeight: 44 }}>
                {submitting ? 'Confirming…' : `Accept all ${pendingCount}`}
              </PrimaryButton>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ============================================================
// One session row -- display, Remove, and the Adjust sub-flow.
// ============================================================

function SessionRow({
  draft,
  timezone,
  adjusting,
  disabled,
  onRemove,
  onToggleAdjust,
  onCancelAdjust,
  onApplyAdjustment,
  siblingLocalDates,
  activityId,
  activityTitleFallback,
  durationMinutes,
}: {
  draft: WeeklyReviewSessionDraft;
  timezone: string;
  adjusting: boolean;
  disabled: boolean;
  onRemove: () => void;
  onToggleAdjust: () => void;
  onCancelAdjust: () => void;
  onApplyAdjustment: (updated: WeeklyReviewSessionDraft) => void;
  siblingLocalDates: readonly string[];
  activityId: string | null;
  activityTitleFallback: string;
  durationMinutes: number;
}) {
  const locked = isSessionLocked(draft.outcome);
  const reasons = summarizeSessionReasons(draft.reasons);

  return (
    <div style={{ border: `1px solid ${colors.borderDefault}`, borderRadius: 10, padding: spacing.sm }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...typography.bodyStrong, color: colors.textPrimary }}>
            {formatSessionDayLabel(draft.localDate, timezone)} — {formatSessionTimeLabel(draft.start, timezone)}
            {draft.adjusted && <span style={typography.caption}> (adjusted)</span>}
          </div>
          {reasons.length > 0 && (
            <div style={{ ...typography.caption, marginTop: 2 }}>{reasons[0]}</div>
          )}
          {draft.outcome === 'FAILED' && (
            <div style={{ ...typography.caption, color: colors.danger, marginTop: 2 }}>{describeSessionFailure(draft.failureReason).message}</div>
          )}
          {locked && (
            <div style={{ ...typography.caption, color: colors.positive, marginTop: 2 }}>
              {draft.outcome === 'ACCEPTED' ? 'Confirmed' : 'Already confirmed'}
            </div>
          )}
        </div>
        {!locked && (
          <div style={{ display: 'flex', gap: spacing.xs, flexShrink: 0, flexWrap: 'wrap' }}>
            <TextButton onClick={onToggleAdjust} style={{ minHeight: 44, padding: '0 8px' }} disabled={disabled}>
              Adjust
            </TextButton>
            <TextButton onClick={onRemove} style={{ minHeight: 44, padding: '0 8px' }} disabled={disabled}>
              Remove
            </TextButton>
          </div>
        )}
      </div>

      {adjusting && !locked && (
        <SessionAdjuster
          draft={draft}
          timezone={timezone}
          activityId={activityId}
          activityTitleFallback={activityTitleFallback}
          durationMinutes={durationMinutes}
          siblingLocalDates={siblingLocalDates}
          onCancel={onCancelAdjust}
          onApply={onApplyAdjustment}
        />
      )}
    </div>
  );
}

// ============================================================
// Adjust sub-flow -- composes the EXISTING /api/timing-search FIND/CHECK
// modes (fetchAdjustmentAlternatives/fetchAdjustmentCheck). Never silently
// replaces the current selection: a candidate found here is only applied
// once the user presses this sub-flow's own "Use this time" confirmation.
// ============================================================

function minuteOfDayToTimeInputValue(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function SessionAdjuster({
  draft,
  timezone,
  activityId,
  activityTitleFallback,
  durationMinutes,
  siblingLocalDates,
  onCancel,
  onApply,
}: {
  draft: WeeklyReviewSessionDraft;
  timezone: string;
  activityId: string | null;
  activityTitleFallback: string;
  durationMinutes: number;
  siblingLocalDates: readonly string[];
  onCancel: () => void;
  onApply: (updated: WeeklyReviewSessionDraft) => void;
}) {
  const [date, setDate] = useState(() => getDatePartsInTimezone(timezone, new Date(draft.start)).dateStr);
  const [time, setTime] = useState(() => minuteOfDayToTimeInputValue(getMinuteOfDayInTimezone(timezone, new Date(draft.start))));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<TimingCandidate | null>(null);

  const params = { activityId, activityTitleFallback, durationMinutes };

  async function handleCheck() {
    if (!date || !time || checking) return;
    setChecking(true);
    setError(null);
    setCandidate(null);
    const candidateStart = localDateTimeToUTC(date, time, timezone);
    const result = await fetchAdjustmentCheck(params, candidateStart.toISOString());
    setChecking(false);
    if (result.status !== 'OK') {
      setError("Aura couldn't check that time just now.");
      return;
    }
    const checked = result.response.requestedCandidate ?? result.response.candidates[0];
    if (!checked) {
      setError("Aura couldn't check that time just now.");
      return;
    }
    setCandidate(checked);
  }

  async function handleFindAnother() {
    if (checking) return;
    setChecking(true);
    setError(null);
    setCandidate(null);
    const result = await fetchAdjustmentAlternatives(params, date);
    setChecking(false);
    if (result.status !== 'OK' || result.response.candidates.length === 0) {
      setError('No other suitable times found for this day.');
      return;
    }
    // The FIRST candidate not already at the exact current selection -- the
    // engine's own top-ranked result, never re-scored here.
    const alternative = result.response.candidates.find((c) => c.start !== draft.start) ?? result.response.candidates[0];
    setCandidate(alternative);
  }

  // HGR3-C2 remediation (P1) -- checked against the chosen `date` as soon
  // as it's picked, not only at the moment of applying: this is a purely
  // client-side gate (never touches `detectAcceptanceIdentityConflict` or
  // any other backend identity logic) that stops a colliding adjustment
  // from ever being committed to the draft list in the first place, so
  // the backend's own payload-binding check never has a reason to
  // misfire against an untouched sibling.
  const dateCollides = hasDateCollision(date, siblingLocalDates);

  function handleUseThisTime() {
    if (!candidate || dateCollides) return;
    onApply(draftFromAdjustmentCandidate(draft, candidate, date));
  }

  return (
    <div style={{ marginTop: spacing.sm, paddingTop: spacing.sm, borderTop: `1px solid ${colors.borderDefault}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
        <div>
          <FieldLabel htmlFor={`adjust-date-${draft.localDate}`}>Date</FieldLabel>
          <TextInput id={`adjust-date-${draft.localDate}`} type="date" value={date} disabled={checking} onChange={(e) => { setDate(e.target.value); setCandidate(null); setError(null); }} />
        </div>
        <div>
          <FieldLabel htmlFor={`adjust-time-${draft.localDate}`}>Time</FieldLabel>
          <TextInput id={`adjust-time-${draft.localDate}`} type="time" value={time} disabled={checking} onChange={(e) => { setTime(e.target.value); setCandidate(null); setError(null); }} />
        </div>
      </div>
      <FieldHint>Aura checks this time&rsquo;s fit -- nothing is confirmed until you accept the whole batch.</FieldHint>
      {dateCollides && <FieldError>Another session in this batch is already on this date.</FieldError>}
      {error && <FieldError>{error}</FieldError>}

      {candidate && (
        <div style={{ ...typography.caption, marginTop: spacing.xs }}>
          {summarizeSessionReasons(candidate.reasons)[0] ?? 'No notable Panchangam factors for this time.'}
          {candidate.conflicts && candidate.conflicts.length > 0 && (
            <div style={{ color: colors.danger, marginTop: 2 }}>{candidate.conflicts[0].message}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.xs, marginTop: spacing.sm, flexWrap: 'wrap' }}>
        <TextButton onClick={onCancel} disabled={checking} style={{ minHeight: 44, padding: '0 8px' }}>
          Cancel
        </TextButton>
        <SecondaryButton onClick={handleFindAnother} disabled={checking || !date || dateCollides}>
          Find another time
        </SecondaryButton>
        {!candidate ? (
          <SecondaryButton onClick={handleCheck} disabled={checking || !date || !time || dateCollides}>
            {checking ? 'Checking…' : 'Check this time'}
          </SecondaryButton>
        ) : (
          <PrimaryButton onClick={handleUseThisTime} disabled={checking || dateCollides}>
            Use this time
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}
