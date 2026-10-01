'use client';

import React, { useEffect, useRef, useState } from 'react';
import { colors, spacing, typography } from '../../components/theme';
import {
  PageHeader,
  SurfaceCard,
  PrimaryButton,
  SecondaryButton,
  TextButton,
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
import { GOAL_TEMPLATES, GOAL_TEMPLATE_LIKELY_ONGOING, type GoalTemplateCategory } from '../../lib/goals';
import { RhythmPicker, type RhythmPickerValue } from '../../components/RhythmPicker';

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
  const [templateCategory, setTemplateCategory] = useState<string>(''); // '' means "Start from scratch" (null)
  // Goals V2 Rhythm R5 -- this ticket's own section 9/13: Rhythm belongs
  // to GoalActivity, never a single Goal-level frequency, so this is one
  // entry per template activity, in the same order as GOAL_TEMPLATES[cat]
  // (array length always matches that template's own activity count).
  // Defaults to Once (NONE) for every entry -- no unsupported preselected
  // default (this ticket's own section 15).
  const [activityRhythms, setActivityRhythms] = useState<ReadonlyArray<RhythmPickerValue | null>>([]);
  const [status, setStatus] = useState<'IDLE' | 'SUBMITTING' | 'ERROR'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  const activeCategory = (templateCategory || null) as GoalTemplateCategory | null;
  // This ticket's own section 10/11 classification -- PURELY advisory: it
  // decides only whether this step shows the frequency question at all,
  // never which N (section 15/34 -- FINISH_PROJECT's own activities stay
  // NONE unless the user later opts in through Goal Detail's per-row edit
  // affordance instead).
  const isOngoingTemplate = activeCategory !== null && GOAL_TEMPLATE_LIKELY_ONGOING[activeCategory];
  const templateActivities = activeCategory ? GOAL_TEMPLATES[activeCategory] : [];

  const handleTemplateChange = (next: string) => {
    setTemplateCategory(next);
    const nextCategory = (next || null) as GoalTemplateCategory | null;
    setActivityRhythms(nextCategory ? GOAL_TEMPLATES[nextCategory].map(() => ({ kind: 'NONE' })) : []);
  };

  const trimmedTitle = title.trim();
  // This ticket's own section 44 -- an ongoing template whose frequency
  // question is showing must not silently submit with an unresolved
  // Custom entry; every row must resolve to a real value first.
  const rhythmsValid = !isOngoingTemplate || (activityRhythms.length === templateActivities.length && activityRhythms.every((v) => v !== null));
  const canSubmit = trimmedTitle.length > 0 && trimmedTitle.length <= 200 && (targetDate === '' || isValidCivilDateString(targetDate)) && rhythmsValid;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || status === 'SUBMITTING') return; // double-submission guard (this ticket's own section 14)
    setStatus('SUBMITTING');
    setError(null);
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          ...(targetDate ? { targetDate } : {}), // submitted verbatim as "YYYY-MM-DD" -- never a constructed JS Date/timestamp (this ticket's own section 13)
          ...(templateCategory ? { templateCategory } : {}),
          // Only sent for an ongoing template actually showing the
          // question -- FINISH_PROJECT/"Start from scratch" never include
          // this at all, so the server's own omitted-means-NONE default
          // applies identically to before this ticket (section 42).
          ...(isOngoingTemplate ? { activityRhythms } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.goal?.id) {
        setError(res.status >= 400 && res.status < 500 ? (data?.error ?? 'Please check your goal details.') : 'Something went wrong. Your details are still here -- try again.');
        setStatus('ERROR');
        return;
      }
      window.location.href = `/goals/${data.goal.id}`;
    } catch {
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
            placeholder="Finish investor deck"
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
          <SelectInput id="goal-template-select" value={templateCategory} onChange={(e) => handleTemplateChange(e.target.value)} disabled={status === 'SUBMITTING'}>
            {GOAL_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.value ?? 'SCRATCH'} value={option.value ?? ''}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </div>

        {/* Goals V2 Rhythm R5 -- this ticket's own section 13/14: shown
            ONLY for a template classified ongoing (never for FINISH_PROJECT
            or "Start from scratch" -- no unnecessary question, this
            ticket's own section 34/58). One compact RhythmPicker per
            activity, reusing the exact same control Goal Detail's own Add
            activity/edit affordance use (one mechanism, section 9) --
            never a separate recurrence editor. */}
        {isOngoingTemplate && (
          <div style={{ marginTop: spacing.lg }}>
            <div style={{ ...typography.bodyStrong, fontSize: 14 }}>How often would these help?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
              {templateActivities.map((templateActivity, index) => (
                <div key={templateActivity.title}>
                  <div style={{ ...typography.meta, color: colors.textSecondary, marginBottom: spacing.xs }}>{templateActivity.title}</div>
                  <RhythmPicker
                    value={activityRhythms[index] ?? { kind: 'NONE' }}
                    onChange={(next) => setActivityRhythms((prev) => prev.map((v, i) => (i === index ? next : v)))}
                    idPrefix={`create-goal-activity-${index}`}
                    hideLabel
                  />
                </div>
              ))}
            </div>
          </div>
        )}

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
