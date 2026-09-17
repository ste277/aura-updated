'use client';

import React, { useEffect, useState } from 'react';
import {
  PageHeader,
  SurfaceCard,
  PrimaryButton,
  SecondaryButton,
  TextButton,
  IconButton,
  DurationChip,
  SegmentedControl,
  TextInput,
  FieldLabel,
  FieldError,
} from '../../components/ui';
import { colors, spacing } from '../../components/theme';
import { DayPlanPreviewController } from '../../components/DayPlanPreviewController';
import type { ConstructDayPreview } from '../../lib/dayConstructorOrchestrator';
import type { PersistedPlanSummary } from '../../lib/acceptConstructedDay';
import { previewConstructedDay } from '../../lib/dayConstructorPreviewClient';
import {
  createEmptyIntentRow,
  canSubmitPlanDay,
  canAddAnotherRow,
  buildRequestedIntentsForSubmission,
  presentPlanDayPreviewFailure,
  PLAN_DAY_DURATION_OPTIONS_MINUTES,
  NO_DEADLINE,
  type PlanDayIntentRow,
  type PlanDayDeadlineChoice,
} from '../../lib/planDayEntry';

/**
 * Day Constructor V1 -- PR F2. The user-reachable "Plan my day" entry
 * experience (this ticket's own section 1): Home -> here -> a real
 * `ConstructDayPreview` (via F1's preview API) -> the already-built E3
 * `DayPlanPreviewController`/`DayPlanPreview` -> the already-built E2
 * accept endpoint -> back to Home.
 *
 * This file owns exactly the UI/state-machine glue this ticket's own
 * section 8 describes (ENTRY/SUBMITTING/PREVIEW/PREVIEW_ERROR) -- it never
 * makes a placement/scheduling decision of its own (all row->request
 * mapping, submittability, and FIXED-time date assembly are pure
 * functions in planDayEntry.ts), never calls `/api/plans` or the accept
 * endpoint directly (DayPlanPreviewController owns that entirely, this
 * ticket's own section 33), and never introduces a second preview UI
 * (DayPlanPreview, PR D, unmodified, this ticket's own section 32).
 *
 * Standalone route (`/plan-day`), not another Home `activeTab` (this
 * ticket's own section 5) -- mirrors `/find`'s own precedent of a
 * dedicated route outside the single-page tab system. Unlike `/find`
 * (public/guest), this route requires a real session -- an unauthenticated
 * visitor is sent to `/` (whose own LoginScreen already owns that
 * experience; this file does not duplicate it).
 *
 * Planning-date hardening -- `timezone`/`planningDate` are SERVER props
 * (page.tsx, a Server Component, via planDayBootstrap.ts's own
 * `resolvePlanDayServerProps`), never fetched or computed client-side.
 * `null` means the server itself found no valid session; this file's own
 * job in that case is only to redirect, matching this app's established
 * client-side-navigation convention -- never a second auth check, never
 * an authentication network call of its own (removed: the server already
 * performed the authoritative check before this component ever rendered).
 */

type Phase = 'REDIRECTING' | 'ENTRY' | 'SUBMITTING' | 'PREVIEW' | 'PREVIEW_ERROR';

interface EntryErrorState {
  message: string;
  retryable: boolean;
}

export interface PlanDayClientProps {
  timezone: string | null;
  planningDate: string | null;
}

export function PlanDayClient({ timezone, planningDate }: PlanDayClientProps) {
  const authenticated = !!timezone && !!planningDate;
  const [phase, setPhase] = useState<Phase>(() => (authenticated ? 'ENTRY' : 'REDIRECTING'));
  const [rows, setRows] = useState<PlanDayIntentRow[]>(() => [createEmptyIntentRow()]);
  const [preview, setPreview] = useState<ConstructDayPreview | null>(null);
  const [entryError, setEntryError] = useState<EntryErrorState | null>(null);

  useEffect(() => {
    if (phase === 'REDIRECTING') window.location.href = '/';
  }, [phase]);

  function updateRow(id: string, patch: Partial<PlanDayIntentRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => (canAddAnotherRow(current) ? [...current, createEmptyIntentRow()] : current));
  }

  function removeRow(id: string) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));
  }

  async function submitPreview() {
    if (!timezone || !planningDate || phase === 'SUBMITTING') return;
    setPhase('SUBMITTING');
    setEntryError(null);
    // `buildRequestedIntentsForSubmission` throws only for a past-deadline
    // row that "somehow" bypassed the primary UI gate (`canSubmitPlanDay`'s
    // own `isRowComplete` check, plus each date input's own
    // `min={planningDate}`) -- this ticket's own section 8 fail-closed
    // requirement. This should never actually happen through the real UI;
    // caught defensively rather than left to crash the component.
    let intents;
    try {
      intents = buildRequestedIntentsForSubmission(rows, timezone, planningDate);
    } catch {
      setEntryError({ message: "Something about your day didn't come through correctly. Try again.", retryable: false });
      setPhase('PREVIEW_ERROR');
      return;
    }
    const result = await previewConstructedDay(intents, planningDate);
    if (result.status === 'READY') {
      setPreview(result.preview);
      setPhase('PREVIEW');
    } else {
      setEntryError(presentPlanDayPreviewFailure(result));
      setPhase('PREVIEW_ERROR');
    }
  }

  function handleDiscard() {
    // Never saves, never calls acceptance (this ticket's own section 34)
    // -- rows are retained exactly as the user left them.
    setPreview(null);
    setPhase('ENTRY');
  }

  function handleRefreshRequested() {
    // "Review again": rerun the preview API against the CURRENT reviewed
    // inputs -- never reuse the stale preview, never save automatically
    // (this ticket's own section 35). A genuinely new preview naturally
    // gets its own identity inside DayPlanPreviewController (section 36).
    void submitPreview();
  }

  function handleSaved(_plans: PersistedPlanSummary[]) {
    // Return to Home; Home's own on-mount effects (loadMyDay/loadGuidance,
    // gated on activeTab==='home'/user?.id) already refresh Plan-backed
    // state on every fresh mount of `/` -- no additional refresh signal is
    // needed across this route boundary (this ticket's own section 38,
    // confirmed by direct audit of apps/web/app/page.tsx).
    window.location.href = '/';
  }

  if (phase === 'REDIRECTING') return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--as-bg)', color: colors.textPrimary, fontFamily: 'var(--as-font-body)', display: 'flex', justifyContent: 'center', padding: `${spacing.xxxl}px ${spacing.lg}px` }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {phase !== 'PREVIEW' && (
          <div style={{ marginBottom: spacing.lg }}>
            <TextButton onClick={() => { window.location.href = '/'; }} color={colors.textMuted}>
              ← Back to Home
            </TextButton>
          </div>
        )}

        {phase === 'PREVIEW' && preview ? (
          <DayPlanPreviewController preview={preview} onDiscard={handleDiscard} onSaved={handleSaved} onRefreshRequested={handleRefreshRequested} />
        ) : (
          <>
            <PageHeader title="Plan my day" subtitle="What do you want to get done today?" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xl }}>
              {rows.map((row, index) => (
                <IntentRowCard
                  key={row.id}
                  row={row}
                  index={index}
                  planningDate={planningDate}
                  canRemove={rows.length > 1}
                  disabled={phase === 'SUBMITTING'}
                  onChange={(patch) => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                />
              ))}
            </div>

            <div style={{ marginTop: spacing.md }}>
              <TextButton onClick={addRow} color={colors.info} style={{ opacity: canAddAnotherRow(rows) ? 1 : 0.4, pointerEvents: canAddAnotherRow(rows) ? 'auto' : 'none' }}>
                + Add another
              </TextButton>
            </div>

            {phase === 'PREVIEW_ERROR' && entryError && (
              <SurfaceCard style={{ marginTop: spacing.lg }}>
                <FieldError>{entryError.message}</FieldError>
                <div style={{ display: 'flex', gap: spacing.md, marginTop: spacing.md }}>
                  <SecondaryButton onClick={() => setPhase('ENTRY')}>Edit</SecondaryButton>
                  {entryError.retryable && <PrimaryButton onClick={() => void submitPreview()}>Try again</PrimaryButton>}
                </div>
              </SurfaceCard>
            )}

            <div style={{ marginTop: spacing.xxl, display: 'flex', justifyContent: 'flex-end' }}>
              <PrimaryButton onClick={() => void submitPreview()} disabled={!planningDate || !canSubmitPlanDay(rows, planningDate)} loading={phase === 'SUBMITTING'} ariaLabel="Plan my day">
                Plan my day
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IntentRowCard({
  row,
  index,
  planningDate,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  row: PlanDayIntentRow;
  index: number;
  planningDate: string | null;
  canRemove: boolean;
  disabled: boolean;
  onChange: (patch: Partial<PlanDayIntentRow>) => void;
  onRemove: () => void;
}) {
  const titleId = `plan-day-title-${row.id}`;
  const timeInputId = `plan-day-time-${row.id}`;
  const showIncompleteTimeError = row.title.trim().length > 0 && row.timeMode === 'FIXED' && !row.fixedTime;
  const showPastDeadlineError = row.title.trim().length > 0 && row.deadlineChoice.kind === 'CUSTOM' && !!planningDate && row.deadlineChoice.date < planningDate;

  return (
    <SurfaceCard>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FieldLabel htmlFor={titleId}>{`Task ${index + 1}`}</FieldLabel>
          <TextInput
            id={titleId}
            value={row.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g. Finish investor deck"
            disabled={disabled}
            maxLength={200}
          />
        </div>
        {canRemove && (
          <IconButton ariaLabel={`Remove ${row.title.trim() || `task ${index + 1}`}`} onClick={onRemove} style={{ marginTop: 22, width: 36, height: 36 }}>
            ✕
          </IconButton>
        )}
      </div>

      <div style={{ marginTop: spacing.md }}>
        <FieldLabel>Duration</FieldLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
          <DurationChip label="Automatic" selected={row.durationMinutes === null} onClick={() => onChange({ durationMinutes: null })} />
          {PLAN_DAY_DURATION_OPTIONS_MINUTES.map((minutes) => (
            <DurationChip key={minutes} label={`${minutes}m`} selected={row.durationMinutes === minutes} onClick={() => onChange({ durationMinutes: minutes })} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: spacing.md }}>
        <FieldLabel>Time</FieldLabel>
        <SegmentedControl
          options={[
            { value: 'FLEXIBLE', label: 'Flexible' },
            { value: 'FIXED', label: 'At a specific time' },
          ]}
          value={row.timeMode}
          onChange={(value) => onChange({ timeMode: value })}
        />
        {row.timeMode === 'FIXED' && (
          <div style={{ marginTop: spacing.sm }}>
            <TextInput id={timeInputId} type="time" value={row.fixedTime ?? ''} onChange={(e) => onChange({ fixedTime: e.target.value || null })} disabled={disabled} hasError={showIncompleteTimeError} />
            {showIncompleteTimeError && <FieldError>Pick a time, or switch back to Flexible.</FieldError>}
          </div>
        )}
      </div>

      <div style={{ marginTop: spacing.md }}>
        <DurationChip label="Important" selected={row.important} onClick={() => onChange({ important: !row.important })} />
      </div>

      <div style={{ marginTop: spacing.md }}>
        <DueByControl
          rowId={row.id}
          deadlineChoice={row.deadlineChoice}
          planningDate={planningDate}
          disabled={disabled}
          hasError={showPastDeadlineError}
          onChange={(deadlineChoice) => onChange({ deadlineChoice })}
        />
        {showPastDeadlineError && <FieldError>Pick today or a later date.</FieldError>}
      </div>
    </SurfaceCard>
  );
}

/**
 * "Due by" (this ticket's own section 5/10) -- progressive disclosure,
 * collapsed by default (`NO_DEADLINE`), never a permanent full date
 * picker per row. Deliberately never worded as if it were a clock time
 * (this ticket's own section 10) -- a row's `important`/deadline facts are
 * always rendered in a visually SEPARATE control from "At a specific
 * time" above, so the two intent facts (urgency vs. scheduling
 * constraint) are never presented as one choice.
 */
function DueByControl({
  rowId,
  deadlineChoice,
  planningDate,
  disabled,
  hasError,
  onChange,
}: {
  rowId: string;
  deadlineChoice: PlanDayDeadlineChoice;
  planningDate: string | null;
  disabled: boolean;
  hasError: boolean;
  onChange: (choice: PlanDayDeadlineChoice) => void;
}) {
  const [expanded, setExpanded] = useState(deadlineChoice.kind !== 'NONE');
  const dateInputId = `plan-day-deadline-${rowId}`;

  if (!expanded) {
    return (
      <TextButton onClick={() => setExpanded(true)} color={colors.textMuted} style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        + Due by
      </TextButton>
    );
  }

  return (
    <div>
      <FieldLabel>Due by</FieldLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
        <DurationChip label="Today" selected={deadlineChoice.kind === 'TODAY'} onClick={() => onChange({ kind: 'TODAY' })} />
        <DurationChip label="Tomorrow" selected={deadlineChoice.kind === 'TOMORROW'} onClick={() => onChange({ kind: 'TOMORROW' })} />
        <DurationChip label="This week" selected={deadlineChoice.kind === 'THIS_WEEK'} onClick={() => onChange({ kind: 'THIS_WEEK' })} />
        <DurationChip label="Pick date" selected={deadlineChoice.kind === 'CUSTOM'} onClick={() => onChange({ kind: 'CUSTOM', date: planningDate ?? '' })} />
      </div>
      {deadlineChoice.kind === 'CUSTOM' && (
        <div style={{ marginTop: spacing.sm }}>
          <TextInput
            id={dateInputId}
            type="date"
            value={deadlineChoice.date}
            min={planningDate ?? undefined}
            onChange={(e) => onChange({ kind: 'CUSTOM', date: e.target.value })}
            disabled={disabled}
            hasError={hasError}
          />
        </div>
      )}
      {deadlineChoice.kind !== 'NONE' && (
        <div style={{ marginTop: spacing.xs }}>
          <TextButton
            onClick={() => {
              onChange(NO_DEADLINE);
              setExpanded(false);
            }}
            color={colors.textMuted}
            style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
          >
            Clear
          </TextButton>
        </div>
      )}
    </div>
  );
}
