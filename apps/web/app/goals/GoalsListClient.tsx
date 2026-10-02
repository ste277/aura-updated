'use client';

import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, typography } from '../../components/theme';
import {
  PageHeader,
  SurfaceCard,
  PrimaryButton,
  SecondaryButton,
  TextButton,
  IconButton,
  EmptyState,
  SegmentedControl,
  ModalShell,
  useModalA11y,
  FieldLabel,
  TextInput,
  SelectInput,
  FieldError,
} from '../../components/ui';
import { GOAL_TEMPLATE_OPTIONS, formatGoalProgressLabel, formatGoalTargetDateLabel, isValidCivilDateString, type GoalSummary } from '../../lib/goalsPresentation';
import { matchGoalTemplateCategory, type GoalTemplateCategory } from '../../lib/goals';
import { RhythmPicker, type RhythmPickerValue } from '../../components/RhythmPicker';
import {
  createInitialProposalState,
  reconcileProposalForTitleChange,
  deriveEffectiveGoalTemplateCategory,
  selectManualCategory,
  useAutomaticSuggestion,
  refreshProposalFromEffectiveCategory,
  removeProposalRow,
  renameProposalRow,
  updateProposalRowRhythm,
  addFreeformProposalRow,
  isProposalReadyToSubmit,
  buildReviewedActivitiesForSubmission,
  type GoalActivityProposalState,
} from '../../lib/goalActivityProposal';
import { trackEvent } from '../../lib/trackEvent';
import {
  createInitialObservabilityState,
  recordNewBaseline,
  recordRowRemoved,
  recordRowRenamed,
  recordFreeformRowAdded,
  recordRhythmChanged,
  buildDecompositionShownMetadata,
  buildGoalDecompositionSummaryMetadata,
  classifyGoalCreateError,
  type GoalDecompositionObservabilityState,
} from '../../lib/goalDecompositionObservability';

/**
 * Goals -> Planning Integration V1 PR B -- the primary "What am I working
 * toward?" experience (this ticket's own section 5). Answers that
 * question directly, never reads as an admin database list: no Goal ids,
 * no raw status enum, no timestamps, no template-category internals
 * (this ticket's own section 6).
 */

type ViewFilter = 'ACTIVE' | 'ARCHIVED';
type LoadState = { status: 'LOADING' } | { status: 'LOADED'; goals: GoalSummary[] } | { status: 'ERROR' };

export function GoalsListClient({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    if (!authenticated) window.location.href = '/';
  }, [authenticated]);
  if (!authenticated) return null;

  return <GoalsListView />;
}

function GoalsListView() {
  const [view, setView] = useState<ViewFilter>('ACTIVE');
  const [state, setState] = useState<LoadState>({ status: 'LOADING' });
  const [createOpen, setCreateOpen] = useState(false);

  const load = async (filter: ViewFilter) => {
    setState({ status: 'LOADING' });
    try {
      const res = await fetch(`/api/goals?status=${filter}`);
      if (!res.ok) throw new Error('failed');
      const goals = await res.json();
      if (!Array.isArray(goals)) throw new Error('failed');
      setState({ status: 'LOADED', goals });
    } catch {
      setState({ status: 'ERROR' });
    }
  };

  useEffect(() => {
    void load(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--as-bg)', color: colors.textPrimary, fontFamily: 'var(--as-font-body)', display: 'flex', justifyContent: 'center', padding: `${spacing.xxxl}px ${spacing.lg}px` }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ marginBottom: spacing.lg }}>
          <TextButton onClick={() => { window.location.href = '/'; }} color={colors.textMuted}>
            ← Back to Home
          </TextButton>
        </div>

        <PageHeader
          title="Goals"
          subtitle="What are you working toward?"
          rightAction={<PrimaryButton onClick={() => setCreateOpen(true)}>+ New goal</PrimaryButton>}
        />

        <div style={{ marginTop: spacing.xl }}>
          <SegmentedControl
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
            value={view}
            onChange={setView}
          />
        </div>

        <div style={{ marginTop: spacing.lg }}>
          {state.status === 'LOADING' && <GoalListSkeleton />}

          {state.status === 'ERROR' && (
            <SurfaceCard>
              <FieldError>Couldn&apos;t load your goals.</FieldError>
              <div style={{ marginTop: spacing.md }}>
                <SecondaryButton onClick={() => void load(view)}>Try again</SecondaryButton>
              </div>
            </SurfaceCard>
          )}

          {state.status === 'LOADED' && state.goals.length === 0 && view === 'ACTIVE' && (
            <SurfaceCard>
              <EmptyState
                title="What do you want to make progress on?"
                description="Create a goal and Aura can help turn it into actions you can plan."
                action={<PrimaryButton onClick={() => setCreateOpen(true)}>Create a goal</PrimaryButton>}
              />
            </SurfaceCard>
          )}

          {state.status === 'LOADED' && state.goals.length === 0 && view === 'ARCHIVED' && (
            <SurfaceCard>
              <EmptyState title="No archived goals" description="Goals you archive will show up here." />
            </SurfaceCard>
          )}

          {state.status === 'LOADED' && state.goals.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
              {state.goals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} />
              ))}
            </div>
          )}
        </div>
      </div>

      {createOpen && <CreateGoalModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}

function GoalListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }} aria-busy="true" aria-label="Loading goals">
      {[0, 1].map((i) => (
        <SurfaceCard key={i} style={{ opacity: 0.5 }}>
          <div style={{ height: 14, width: '60%', background: colors.borderSubtle, borderRadius: 6 }} />
          <div style={{ height: 10, width: '40%', background: colors.borderSubtle, borderRadius: 6, marginTop: spacing.md }} />
        </SurfaceCard>
      ))}
    </div>
  );
}

// ============================================================
// GoalCard (this ticket's own section 6/7) -- title, optional target
// date, derived progress, an open affordance. Never a Goal id, raw status
// enum, database timestamp, template-category internal, or activity id.
// ============================================================

function GoalCard({ goal }: { goal: GoalSummary }) {
  return (
    <button
      type="button"
      onClick={() => { window.location.href = `/goals/${goal.id}`; }}
      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
    >
      <SurfaceCard>
        <div style={{ ...typography.bodyStrong, fontSize: 16 }}>{goal.title}</div>
        {goal.targetDate && <div style={{ ...typography.meta, marginTop: spacing.xs }}>Target: {formatGoalTargetDateLabel(goal.targetDate)}</div>}
        <div style={{ ...typography.body, marginTop: spacing.sm, color: colors.textSecondary }}>
          <GoalCardProgress goalId={goal.id} />
        </div>
        <div style={{ marginTop: spacing.md }}>
          <span style={{ ...typography.badgeText, color: colors.info }}>View goal →</span>
        </div>
      </SurfaceCard>
    </button>
  );
}

/** Progress isn't in the list response (GET /api/goals returns plain Goal
 * rows -- this ticket's own section 40: reuse the existing API rather than
 * broadening it for a slightly different shape), so each card fetches its
 * own detail once, silently. A failure here just omits the progress line
 * -- never blocks the card from being openable. */
function GoalCardProgress({ goalId }: { goalId: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/goals/${goalId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.progress) setLabel(formatGoalProgressLabel(data.progress));
      } catch {
        // silent -- progress is a nice-to-have on the card, not required to open it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [goalId]);
  if (!label) return null;
  return <>{label}</>;
}

// ============================================================
// CreateGoalModal (this ticket's own section 9-15)
// ============================================================

function CreateGoalModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  useModalA11y({ isOpen: true, onClose, dialogRef, initialFocusRef: titleInputRef });

  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState(''); // "" | "YYYY-MM-DD"
  // Goals V2 Candidate B2 (resumed) -- the transient activity-proposal
  // review state (title->category matching, PRISTINE/USER_EDITED,
  // AUTO/MANUAL category precedence) lives entirely in
  // goalActivityProposal.ts's own pure state machine; this component only
  // holds the one value and calls its pure transition functions.
  const [proposal, setProposal] = useState<GoalActivityProposalState>(createInitialProposalState);
  const [status, setStatus] = useState<'IDLE' | 'SUBMITTING' | 'ERROR'>('IDLE');
  const [error, setError] = useState<string | null>(null);
  // Goals V2 Candidate B3.1 -- one stable id for this entire logical
  // Create Goal attempt (this ticket's own section 5). A lazy useState
  // initializer runs exactly once per mount, so every submit/retry within
  // THIS modal instance reuses the identical id (same primitive,
  // crypto.randomUUID(), DayPlanPreviewController.tsx already uses for an
  // analogous client-request id) -- never regenerated merely because the
  // network request is retried. A genuinely new logical Create Goal
  // action gets a fresh id for free: closing and reopening the modal
  // unmounts this component (GoalsListView's own `{createOpen && ...}`
  // conditional render) and the next open mounts a brand new instance
  // with its own fresh initializer call. A successful submission
  // navigates away (`window.location.href` below), which has the same
  // practical effect as an explicit reset -- there is no "next attempt"
  // to reuse it for.
  const [clientRequestId] = useState<string>(() => crypto.randomUUID());
  // Goals V2 Candidate B4 -- transient, session-scoped telemetry
  // bookkeeping maintained ALONGSIDE `proposal` (goalDecompositionObservability.ts's
  // own doc comment covers the exact reset/sticky semantics). Never
  // influences `proposal`/`canSubmit`/the submitted payload.
  const [observability, setObservability] = useState<GoalDecompositionObservabilityState>(createInitialObservabilityState);
  // Always-current ref so the title-change effect below can read the
  // LATEST proposal without adding it to its own dependency array (which
  // would make the effect re-run on every unrelated edit) -- a standard,
  // safe React pattern; reassigning .current during render triggers
  // nothing further.
  const proposalRef = useRef(proposal);
  proposalRef.current = proposal;

  // This ticket's own sections 20-22, "the title-change problem": while
  // the proposal is still AUTO + PRISTINE, a title edit re-resolves the
  // matching template (or clears to no proposal); a MANUAL choice or any
  // USER_EDITED proposal is never touched by a title edit alone.
  useEffect(() => {
    const current = proposalRef.current;
    const next = reconcileProposalForTitleChange(current, title);
    if (next === current) return; // nothing actually changed -- no redundant SHOWN/state update
    setProposal(next);
    // Goals V2 Candidate B4 -- SHOWN fires only for an actual
    // template-backed proposal becoming visible (never for NO_MATCH/
    // empty, this ticket's own section 8/9). A known, accepted, dev-only
    // limitation: React Strict Mode's development-time effect
    // double-invocation could in principle re-run this effect body twice
    // for the same render; this never happens in a production build,
    // where real telemetry is collected, so it is not guarded against
    // further here.
    if (next.rows.length > 0 && next.pristineAutoCategory) {
      trackEvent('GOAL_DECOMPOSITION_SHOWN', { metadata: { ...buildDecompositionShownMetadata('AUTO_MATCH', next.pristineAutoCategory, next.rows.length) } });
    }
    setObservability((obs) => recordNewBaseline(obs, { activityCount: next.rows.length, isManualOverride: false, isScratch: false, isRefresh: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const trimmedTitle = title.trim();
  const autoCategory = matchGoalTemplateCategory(title);
  const effectiveCategory = deriveEffectiveGoalTemplateCategory(proposal, trimmedTitle);
  const canOfferAutomaticSuggestion = proposal.isManualCategory && autoCategory !== null;
  const canRefreshSuggestions = proposal.edited && effectiveCategory !== null;

  const handleCategorySelectChange = (next: string) => {
    const nextCategory = (next || null) as GoalTemplateCategory | null;
    const nextState = selectManualCategory(proposal, nextCategory);
    setProposal(nextState);
    if (nextCategory) {
      trackEvent('GOAL_DECOMPOSITION_SHOWN', { metadata: { ...buildDecompositionShownMetadata('MANUAL_TEMPLATE', nextCategory, nextState.rows.length) } });
    }
    setObservability((obs) => recordNewBaseline(obs, { activityCount: nextState.rows.length, isManualOverride: nextCategory !== null, isScratch: nextCategory === null, isRefresh: false }));
  };
  const handleUseAutomaticSuggestion = () => {
    const nextState = useAutomaticSuggestion(title);
    setProposal(nextState);
    if (nextState.rows.length > 0 && nextState.pristineAutoCategory) {
      trackEvent('GOAL_DECOMPOSITION_SHOWN', { metadata: { ...buildDecompositionShownMetadata('AUTO_MATCH', nextState.pristineAutoCategory, nextState.rows.length) } });
    }
    setObservability((obs) => recordNewBaseline(obs, { activityCount: nextState.rows.length, isManualOverride: false, isScratch: false, isRefresh: false }));
  };
  const handleRefreshSuggestions = () => {
    const nextState = refreshProposalFromEffectiveCategory(proposal, title);
    setProposal(nextState);
    // Deliberately no SHOWN event here (this ticket's own section 31) --
    // a refresh is represented purely via `refreshUsed` in the eventual
    // confirmation summary, not a second "decomposition shown" signal.
    setObservability((obs) => recordNewBaseline(obs, { activityCount: nextState.rows.length, isManualOverride: false, isScratch: false, isRefresh: true }));
  };
  const handleRemoveRow = (localId: string) => {
    setProposal((current) => removeProposalRow(current, localId));
    setObservability((obs) => recordRowRemoved(obs));
  };
  const handleRenameRow = (localId: string, nextTitle: string) => {
    setProposal((current) => renameProposalRow(current, localId, nextTitle));
    setObservability((obs) => recordRowRenamed(obs, localId));
  };
  const handleRowRhythmChange = (localId: string, nextRhythm: RhythmPickerValue | null) => {
    setProposal((current) => updateProposalRowRhythm(current, localId, nextRhythm));
    setObservability((obs) => recordRhythmChanged(obs));
  };
  const handleAddFreeform = () => {
    setProposal((current) => addFreeformProposalRow(current));
    setObservability((obs) => recordFreeformRowAdded(obs));
  };

  const canSubmit = trimmedTitle.length > 0 && trimmedTitle.length <= 200 && (targetDate === '' || isValidCivilDateString(targetDate)) && isProposalReadyToSubmit(proposal, 200);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // UI-level double-click guard ONLY -- this is NOT the idempotency
    // mechanism (Candidate B3.1's own section 24). It never fires for a
    // genuine network-level retry (a fresh click after a dropped
    // response, a second tab), which `clientRequestId` above is what
    // actually protects against, server-side.
    if (!canSubmit || status === 'SUBMITTING') return;
    setStatus('SUBMITTING');
    setError(null);
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          ...(targetDate ? { targetDate } : {}), // submitted verbatim as "YYYY-MM-DD" -- never a constructed JS Date/timestamp (this ticket's own section 13)
          // Goals V2 Candidate B3's explicit-review mode -- the reviewed
          // proposal rows are the final, authoritative set (this ticket's
          // own section 17: never templateCategory/activityRhythms, even
          // for an untouched template proposal; always `activities[]`,
          // including the empty array when every row was removed).
          activities: buildReviewedActivitiesForSubmission(proposal.rows),
          // Goals V2 Candidate B3.1 -- lets the server deduplicate a
          // network-level retry of this exact logical request (a lost
          // response, a double-click despite the SUBMITTING guard below).
          clientRequestId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.goal?.id) {
        // Goals V2 Candidate B4 -- a bounded error category only (this
        // ticket's own section 18), never the raw error message/response
        // body. matchSource/no activity counts needed for a failure.
        trackEvent('GOAL_DECOMPOSITION_CREATE_FAILED', {
          metadata: { errorCategory: classifyGoalCreateError(res.status, data?.code), matchSource: buildGoalDecompositionSummaryMetadata(proposal, observability).matchSource },
        });
        setError(res.status >= 400 && res.status < 500 ? (data?.error ?? 'Please check your goal details.') : 'Something went wrong. Your details are still here -- try again.');
        setStatus('ERROR');
        return;
      }
      // Goals V2 Candidate B4 -- fired exactly once, only on a genuinely
      // successful response, from the SAME branch that immediately
      // navigates away -- see this file's own CLIENT_TRACKED_EVENTS doc
      // comment (productEvents.ts) for why this can never double-fire
      // within one modal mount, including for a B3.1 idempotent replay.
      trackEvent('GOAL_DECOMPOSITION_CONFIRMED', { metadata: { ...buildGoalDecompositionSummaryMetadata(proposal, observability) } });
      window.location.href = `/goals/${data.goal.id}`;
    } catch {
      trackEvent('GOAL_DECOMPOSITION_CREATE_FAILED', {
        metadata: { errorCategory: classifyGoalCreateError(null, null), matchSource: buildGoalDecompositionSummaryMetadata(proposal, observability).matchSource },
      });
      setError('Something went wrong. Your details are still here -- try again.');
      setStatus('ERROR');
    }
  };

  return (
    <ModalShell
      dialogRef={dialogRef}
      labelledBy="create-goal-title"
      onClose={status === 'SUBMITTING' ? undefined : onClose}
      title="New goal"
      description="Give it a name -- a target date and starting activities are optional."
    >
      <form onSubmit={handleSubmit}>
        <div>
          <FieldLabel htmlFor="goal-title-input">Goal</FieldLabel>
          <TextInput
            id="goal-title-input"
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Get fitter"
            disabled={status === 'SUBMITTING'}
            hasError={trimmedTitle.length > 200}
          />
        </div>

        <div style={{ marginTop: spacing.lg }}>
          <FieldLabel htmlFor="goal-target-date-input">Target date (optional)</FieldLabel>
          <TextInput
            id="goal-target-date-input"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            disabled={status === 'SUBMITTING'}
            hasError={targetDate !== '' && !isValidCivilDateString(targetDate)}
          />
        </div>

        <div style={{ marginTop: spacing.lg }}>
          <FieldLabel htmlFor="goal-template-select">Starting activities (optional)</FieldLabel>
          <SelectInput id="goal-template-select" value={effectiveCategory ?? ''} onChange={(e) => handleCategorySelectChange(e.target.value)} disabled={status === 'SUBMITTING'}>
            {GOAL_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.value ?? 'SCRATCH'} value={option.value ?? ''}>
                {option.label}
              </option>
            ))}
          </SelectInput>
          {/* This ticket's own section 26 -- the one explicit escape from
              MANUAL mode back to AUTO (title-driven) matching. Shown only
              when there is actually an automatic suggestion to return to. */}
          {canOfferAutomaticSuggestion && (
            <div style={{ marginTop: spacing.xs }}>
              <TextButton onClick={handleUseAutomaticSuggestion} disabled={status === 'SUBMITTING'}>
                Use Aura&apos;s suggestion
              </TextButton>
            </div>
          )}
        </div>

        {/* Goals V2 Candidate B2 (resumed) -- a transient, reviewable
            proposal: Aura's suggestion once the Goal title (or an explicit
            category choice) matches, never persisted until Create Goal
            succeeds. This ticket's own section 27 -- "Suggested
            activities" only while the rows are still untouched; once the
            user edits anything, the label stops claiming to be Aura's
            current recommendation. */}
        <div style={{ marginTop: spacing.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
            {proposal.rows.length > 0 && <div style={{ ...typography.bodyStrong, fontSize: 14 }}>{proposal.edited ? 'Activities' : 'Suggested activities'}</div>}
            {canRefreshSuggestions && (
              <TextButton onClick={handleRefreshSuggestions} disabled={status === 'SUBMITTING'}>
                Refresh suggestions
              </TextButton>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: proposal.rows.length > 0 ? spacing.sm : 0 }}>
            {proposal.rows.map((row) => (
              <div key={row.localId} style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <FieldLabel htmlFor={`${row.localId}-title`} visuallyHidden>
                    Activity title
                  </FieldLabel>
                  <TextInput
                    id={`${row.localId}-title`}
                    value={row.title}
                    onChange={(e) => handleRenameRow(row.localId, e.target.value)}
                    maxLength={200}
                    disabled={status === 'SUBMITTING'}
                    hasError={row.title.trim().length === 0 || row.title.trim().length > 200}
                  />
                  <div style={{ marginTop: spacing.xs }}>
                    <RhythmPicker
                      value={row.rhythm ?? { kind: 'NONE' }}
                      onChange={(next) => handleRowRhythmChange(row.localId, next)}
                      idPrefix={row.localId}
                      hideLabel
                    />
                  </div>
                </div>
                <IconButton
                  ariaLabel={`Remove ${row.title.trim() || 'activity'}`}
                  onClick={status === 'SUBMITTING' ? undefined : () => handleRemoveRow(row.localId)}
                  style={{ marginTop: 22, width: 36, height: 36 }}
                >
                  ✕
                </IconButton>
              </div>
            ))}
          </div>

          <div style={{ marginTop: spacing.md }}>
            <SecondaryButton onClick={handleAddFreeform} disabled={status === 'SUBMITTING'}>
              + Add activity
            </SecondaryButton>
          </div>
        </div>

        {error && (
          <div role="alert" style={{ marginTop: spacing.md }}>
            <FieldError>{error}</FieldError>
          </div>
        )}

        <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.xxl }}>
          <PrimaryButton type="submit" disabled={!canSubmit} loading={status === 'SUBMITTING'}>
            Create goal
          </PrimaryButton>
          <SecondaryButton onClick={onClose} disabled={status === 'SUBMITTING'}>
            Cancel
          </SecondaryButton>
        </div>
      </form>
    </ModalShell>
  );
}
