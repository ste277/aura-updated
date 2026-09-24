'use client';

import React, { useEffect, useState } from 'react';
import { colors, spacing, typography } from '../../../components/theme';
import { PageHeader, SurfaceCard, PrimaryButton, SecondaryButton, TextButton, DestructiveButton, StatusBadge, EmptyState, FieldLabel, TextInput, FieldError } from '../../../components/ui';
import { formatGoalProgressLabel, formatGoalTargetDateLabel, presentGoalActivityStateLabel, type GoalActivityView, type GoalDetailView } from '../../../lib/goalsPresentation';

/**
 * Goals -> Planning Integration V1 PR B -- Goal detail: "What does
 * progress toward this Goal look like?" (this ticket's own section 16).
 *
 * No scheduling occurs here (this ticket's own PRODUCT PRINCIPLE): every
 * activity row is either an uncommitted suggestion (Dismiss only -- no
 * selection controls, see the doc comment on SUGGESTED rows below for
 * why) or a read-only reflection of a REAL PlannedActivity/HabitLog
 * elsewhere in the app. Nothing here ever calls the Plan My Day/Day
 * Constructor/acceptance stack.
 */

type LoadState = { status: 'LOADING' } | { status: 'LOADED'; detail: GoalDetailView } | { status: 'NOT_FOUND' } | { status: 'ERROR' };

export function GoalDetailClient({ goalId, authenticated }: { goalId: string; authenticated: boolean }) {
  useEffect(() => {
    if (!authenticated) window.location.href = '/';
  }, [authenticated]);
  if (!authenticated) return null;

  return <GoalDetailView goalId={goalId} />;
}

function GoalDetailView({ goalId }: { goalId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'LOADING' });

  const load = async () => {
    setState({ status: 'LOADING' });
    try {
      const res = await fetch(`/api/goals/${goalId}`);
      if (res.status === 404) {
        setState({ status: 'NOT_FOUND' });
        return;
      }
      if (!res.ok) throw new Error('failed');
      const detail = await res.json();
      if (!detail?.goal) throw new Error('failed');
      setState({ status: 'LOADED', detail });
    } catch {
      setState({ status: 'ERROR' });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--as-bg)', color: colors.textPrimary, fontFamily: 'var(--as-font-body)', display: 'flex', justifyContent: 'center', padding: `${spacing.xxxl}px ${spacing.lg}px` }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ marginBottom: spacing.lg }}>
          <TextButton onClick={() => { window.location.href = '/goals'; }} color={colors.textMuted}>
            ← Back to Goals
          </TextButton>
        </div>

        {state.status === 'LOADING' && <DetailSkeleton />}

        {state.status === 'NOT_FOUND' && (
          <SurfaceCard>
            {/* This ticket's own section 31 -- identical presentation for
                "doesn't exist" and "belongs to another user"; the API
                itself already returns the same 404 for both. */}
            <EmptyState title="This goal isn't available" description="It may have been removed, or the link may be incorrect." action={<SecondaryButton onClick={() => { window.location.href = '/goals'; }}>Back to Goals</SecondaryButton>} />
          </SurfaceCard>
        )}

        {state.status === 'ERROR' && (
          <SurfaceCard>
            <FieldError>Couldn&apos;t load this goal.</FieldError>
            <div style={{ marginTop: spacing.md }}>
              <SecondaryButton onClick={() => void load()}>Try again</SecondaryButton>
            </div>
          </SurfaceCard>
        )}

        {state.status === 'LOADED' && <GoalDetailBody detail={state.detail} onChanged={load} />}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading goal">
      <SurfaceCard style={{ opacity: 0.5 }}>
        <div style={{ height: 18, width: '70%', background: colors.borderSubtle, borderRadius: 6 }} />
        <div style={{ height: 10, width: '40%', background: colors.borderSubtle, borderRadius: 6, marginTop: spacing.md }} />
      </SurfaceCard>
    </div>
  );
}

function GoalDetailBody({ detail, onChanged }: { detail: GoalDetailView; onChanged: () => void }) {
  const { goal, activities, progress } = detail;
  // This ticket's own section 20/23 -- dismissed activities are hidden
  // from the primary list entirely (no restore action exists, so a
  // collapsed "Dismissed" section would be dead weight -- absence is
  // preferable per this ticket's own section 19 principle, applied here
  // too).
  const primaryActivities = activities.filter((a) => a.derivedState !== 'DISMISSED');

  // Goals -> Planning Integration V1 PR C -- selection lives HERE (the
  // parent), not on each ActivityRow, because the primary CTA (below)
  // needs the complete selected set, and because eligibility can change
  // out from under a stale selection (e.g. `onChanged` refetches after a
  // Dismiss/Add elsewhere on this same page) -- `effectiveSelectedIds`
  // recomputes the intersection with CURRENTLY-SUGGESTED activities on
  // every render, so a row that became ineligible between selection and
  // render is silently dropped from the count/CTA rather than seeding a
  // stale id (this ticket's own section 8 applied client-side too, as a
  // first line of defense -- the real enforcement is server-side, at
  // /plan-day's own bootstrap).
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const suggestedIds = new Set(primaryActivities.filter((a) => a.derivedState === 'SUGGESTED').map((a) => a.id));
  const effectiveSelectedIds = Array.from(selectedIds).filter((id) => suggestedIds.has(id));

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePlanWithAura = () => {
    if (effectiveSelectedIds.length === 0) return;
    // This ticket's own section 6 -- IDs only, never titles/activityIds.
    // Plan My Day's own bootstrap (planDayBootstrap.ts's
    // resolveGoalActivityHandoff) re-resolves everything server-side from
    // these ids alone.
    const params = new URLSearchParams({ fromGoal: goal.id, activities: effectiveSelectedIds.join(',') });
    window.location.href = `/plan-day?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader title={goal.title} subtitle={goal.targetDate ? `Target ${formatGoalTargetDateLabel(goal.targetDate)}` : undefined} />

      <div style={{ marginTop: spacing.lg }}>
        <SurfaceCard>
          <div style={{ ...typography.bodyStrong }}>{formatGoalProgressLabel(progress)}</div>
          {progress.total > 0 && (
            <div style={{ marginTop: spacing.sm, height: 6, borderRadius: 999, background: colors.borderSubtle, overflow: 'hidden' }} role="progressbar" aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total} aria-label="Goal progress">
              <div style={{ height: '100%', width: `${Math.round((progress.completed / progress.total) * 100)}%`, background: colors.positive, borderRadius: 999 }} />
            </div>
          )}
        </SurfaceCard>
      </div>

      <div style={{ marginTop: spacing.xxl }}>
        <h2 style={typography.sectionEyebrow}>Activities</h2>
        {suggestedIds.size > 0 && <p style={{ ...typography.meta, marginTop: spacing.xs }}>What would you like Aura to help you plan?</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.md }}>
          {primaryActivities.length === 0 && (
            <SurfaceCard>
              <EmptyState title="No activities yet" description="Add an activity to get started." />
            </SurfaceCard>
          )}
          {primaryActivities.map((activity) => (
            <ActivityRow
              key={activity.id}
              activity={activity}
              onChanged={onChanged}
              selected={activity.derivedState === 'SUGGESTED' ? selectedIds.has(activity.id) : undefined}
              onToggleSelect={activity.derivedState === 'SUGGESTED' ? () => toggleSelected(activity.id) : undefined}
            />
          ))}
        </div>

        {/* This ticket's own section 5 -- appears only once at least one
            eligible activity is selected; "Plan with Aura" (existing
            product vocabulary), never "Schedule automatically" (Aura has
            committed nothing yet). */}
        {effectiveSelectedIds.length > 0 && (
          <div style={{ marginTop: spacing.md }}>
            <PrimaryButton onClick={handlePlanWithAura}>
              Plan with Aura{effectiveSelectedIds.length > 1 ? ` (${effectiveSelectedIds.length})` : ''}
            </PrimaryButton>
          </div>
        )}

        <div style={{ marginTop: spacing.md }}>
          <AddActivityControl goalId={goal.id} onAdded={onChanged} />
        </div>
      </div>

      <div style={{ marginTop: spacing.xxxl }}>
        <GoalLifecycleActions goal={goal} />
      </div>
    </div>
  );
}

// ============================================================
// ActivityRow (this ticket's own section 17/18/24/25/26)
// ============================================================

function ActivityRow({
  activity,
  onChanged,
  selected,
  onToggleSelect,
}: {
  activity: GoalActivityView;
  onChanged: () => void;
  /** Goals -> Planning Integration V1 PR C -- undefined for any non-
   * SUGGESTED activity (PLANNED/COMPLETED render no checkbox at all, not
   * a disabled one -- this ticket's own section 4: eligibility is
   * SUGGESTED only). Selection is local UI state owned by the parent; see
   * GoalDetailBody's own doc comment for why it lives there, not here. */
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateLabel = presentGoalActivityStateLabel(activity.derivedState);
  const isSelectable = activity.derivedState === 'SUGGESTED' && onToggleSelect !== undefined;

  const handleDismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals/${activity.goalId}/activities/${activity.id}/dismiss`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      onChanged();
    } catch {
      setError('Could not dismiss this. Try again.');
      setDismissing(false);
    }
  };

  return (
    <SurfaceCard style={activity.derivedState === 'COMPLETED' ? { opacity: 0.7 } : selected ? { borderColor: colors.accentBorder } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, flexWrap: 'wrap' }}>
        {/* Goals -> Planning Integration V1 PR C -- this ticket's own
            section 3/4: a real selection control now exists, answering
            "What would you like Aura to help you plan?" A checkbox
            renders ONLY for SUGGESTED (PLANNED/COMPLETED never show
            one, matching this ticket's own eligibility rule exactly).
            Selecting is pure local state -- it never mutates
            GoalActivity, never creates a PlannedActivity, never calls
            Day Constructor (this ticket's own section 4). */}
        <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, minWidth: 0, cursor: isSelectable ? 'pointer' : 'default' }}>
          {isSelectable && (
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={onToggleSelect}
              aria-label={`Select "${activity.title}" to plan with Aura`}
              style={{ width: 18, height: 18, flexShrink: 0, accentColor: colors.positive }}
            />
          )}
          <span style={{ ...typography.bodyStrong, minWidth: 0 }}>{activity.title}</span>
        </label>
        {stateLabel && <StatusBadge label={stateLabel} tone={activity.derivedState === 'COMPLETED' ? 'positive' : 'info'} />}
      </div>

      {error && (
        <div role="alert" style={{ marginTop: spacing.sm }}>
          <FieldError>{error}</FieldError>
        </div>
      )}

      {/* SUGGESTED is the only state with a Dismiss action. PLANNED/
          COMPLETED render as pure read-only status; there is no
          reschedule/cancel/mark-complete action anywhere on this page
          (this ticket's own section 24/25). */}
      {activity.derivedState === 'SUGGESTED' && (
        <div style={{ marginTop: spacing.sm }}>
          <TextButton onClick={handleDismiss} color={colors.textFaint}>
            {dismissing ? 'Dismissing…' : 'Dismiss'}
          </TextButton>
        </div>
      )}
    </SurfaceCard>
  );
}

// ============================================================
// AddActivityControl (this ticket's own section 20/21) -- title-only,
// no catalog/activityId exposure.
// ============================================================

function AddActivityControl({ goalId, onAdded }: { goalId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'IDLE' | 'SAVING' | 'ERROR'>('IDLE');
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <TextButton onClick={() => setOpen(true)} color={colors.info}>
        + Add activity
      </TextButton>
    );
  }

  const trimmed = title.trim();

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmed || status === 'SAVING') return;
    setStatus('SAVING');
    setError(null);
    try {
      const res = await fetch(`/api/goals/${goalId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error('failed');
      setTitle('');
      setOpen(false);
      setStatus('IDLE');
      onAdded();
    } catch {
      setError('Could not add this activity. Try again.');
      setStatus('ERROR');
    }
  };

  return (
    <SurfaceCard>
      <form onSubmit={handleAdd}>
        <FieldLabel htmlFor="add-activity-title" visuallyHidden>
          Activity title
        </FieldLabel>
        <TextInput id="add-activity-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Check final numbers" maxLength={200} disabled={status === 'SAVING'} autoFocus />
        {error && (
          <div role="alert" style={{ marginTop: spacing.sm }}>
            <FieldError>{error}</FieldError>
          </div>
        )}
        <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md }}>
          <PrimaryButton type="submit" disabled={!trimmed} loading={status === 'SAVING'}>
            Add activity
          </PrimaryButton>
          <SecondaryButton onClick={() => { setOpen(false); setError(null); }} disabled={status === 'SAVING'}>
            Cancel
          </SecondaryButton>
        </div>
      </form>
    </SurfaceCard>
  );
}

// ============================================================
// GoalLifecycleActions (this ticket's own section 27/28) -- Archive /
// Delete. Delete relies on the server's own retained-linkage check
// (PR A's deleteGoal) rather than duplicating that logic client-side --
// a 409 is presented with truthful, specific guidance, never a generic
// failure.
// ============================================================

function GoalLifecycleActions({ goal }: { goal: GoalDetailView['goal'] }) {
  const [archiveStatus, setArchiveStatus] = useState<'IDLE' | 'SAVING' | 'ERROR'>('IDLE');
  const [deleteStatus, setDeleteStatus] = useState<'IDLE' | 'CONFIRM' | 'SAVING' | 'ERROR'>('IDLE');
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [offerArchiveInstead, setOfferArchiveInstead] = useState(false);

  const handleArchive = async () => {
    setArchiveStatus('SAVING');
    try {
      const res = await fetch(`/api/goals/${goal.id}/archive`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      window.location.href = '/goals';
    } catch {
      setArchiveStatus('ERROR');
    }
  };

  const handleDelete = async () => {
    if (deleteStatus === 'IDLE') {
      setDeleteStatus('CONFIRM');
      return;
    }
    setDeleteStatus('SAVING');
    setDeleteMessage(null);
    setOfferArchiveInstead(false);
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' });
      if (res.status === 409) {
        // This ticket's own section 28 -- truthful, specific guidance,
        // never a generic failure message.
        setDeleteMessage('This goal has activities linked to your plan. Archive it instead.');
        setOfferArchiveInstead(true);
        setDeleteStatus('ERROR');
        return;
      }
      if (!res.ok) throw new Error('failed');
      window.location.href = '/goals';
    } catch {
      setDeleteMessage('Could not delete this goal. Try again.');
      setDeleteStatus('ERROR');
    }
  };

  if (goal.status === 'ARCHIVED') {
    // No unarchive endpoint exists in PR A (this ticket's own section
    // 29) -- an archived Goal's lifecycle is read-only here; inventing
    // one is explicitly out of scope.
    return <StatusBadge label="Archived" tone="neutral" />;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
        <SecondaryButton onClick={handleArchive} disabled={archiveStatus === 'SAVING'}>
          {archiveStatus === 'SAVING' ? 'Archiving…' : 'Archive'}
        </SecondaryButton>
        <DestructiveButton onClick={handleDelete} disabled={deleteStatus === 'SAVING'}>
          {deleteStatus === 'CONFIRM' ? 'Confirm delete?' : deleteStatus === 'SAVING' ? 'Deleting…' : 'Delete'}
        </DestructiveButton>
      </div>
      {archiveStatus === 'ERROR' && (
        <div role="alert" style={{ marginTop: spacing.sm }}>
          <FieldError>Could not archive this goal. Try again.</FieldError>
        </div>
      )}
      {deleteMessage && (
        <div role="alert" style={{ marginTop: spacing.sm }}>
          <FieldError>{deleteMessage}</FieldError>
          {offerArchiveInstead && (
            <div style={{ marginTop: spacing.sm }}>
              <SecondaryButton onClick={handleArchive} disabled={archiveStatus === 'SAVING'}>
                {archiveStatus === 'SAVING' ? 'Archiving…' : 'Archive instead'}
              </SecondaryButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
