'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import type { PlanningHorizon } from '../../lib/planningHorizon';
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
 *
 * Planning Horizon V1 PR P2 -- `horizon`/`availabilityConfigured` are the
 * SAME kind of SERVER prop as `timezone`/`planningDate`: this component
 * reads no clock and performs no civil-date arithmetic of its own to
 * derive Tomorrow. Selecting Today/Tomorrow navigates to
 * `/plan-day?horizon=...`, which re-invokes page.tsx (a Server Component)
 * and re-derives every one of these props fresh -- this file only ever
 * renders whatever the server most recently issued.
 */

type Phase = 'REDIRECTING' | 'ENTRY' | 'SUBMITTING' | 'PREVIEW' | 'PREVIEW_ERROR' | 'SAVED';

interface EntryErrorState {
  message: string;
  retryable: boolean;
}

export interface PlanDayClientProps {
  timezone: string | null;
  planningDate: string | null;
  horizon: PlanningHorizon | null;
  availabilityConfigured: boolean | null;
}

export function PlanDayClient({ timezone, planningDate, horizon, availabilityConfigured }: PlanDayClientProps) {
  const router = useRouter();
  const authenticated = !!timezone && !!planningDate && !!horizon;
  const [phase, setPhase] = useState<Phase>(() => (authenticated ? 'ENTRY' : 'REDIRECTING'));
  const [rows, setRows] = useState<PlanDayIntentRow[]>(() => [createEmptyIntentRow()]);
  const [preview, setPreview] = useState<ConstructDayPreview | null>(null);
  const [entryError, setEntryError] = useState<EntryErrorState | null>(null);
  // Planning Horizon V1 PR P2 -- true only when a Preview call returned
  // FUTURE_AVAILABILITY_REQUIRED despite bootstrap saying configured
  // (another tab/session reset Availability between page load and
  // Preview -- a real, reachable race, not hypothetical). Reset whenever
  // `horizon` itself changes (below) so switching back to Today never
  // leaves a stale Tomorrow-only block in place.
  const [availabilityRequiredStale, setAvailabilityRequiredStale] = useState(false);

  useEffect(() => {
    if (phase === 'REDIRECTING') window.location.href = '/';
  }, [phase]);

  // A horizon switch is a fresh server render (page.tsx) landing on the
  // SAME mounted component -- React preserves `rows` across it by default
  // (this ticket's own section 13, intentionally relied upon, never
  // reimplemented). Only per-request UI state that could otherwise
  // describe the WRONG day is reset here.
  useEffect(() => {
    setEntryError(null);
    setAvailabilityRequiredStale(false);
    setPhase((current) => (current === 'PREVIEW_ERROR' ? 'ENTRY' : current));
  }, [horizon]);

  function updateRow(id: string, patch: Partial<PlanDayIntentRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => (canAddAnotherRow(current) ? [...current, createEmptyIntentRow()] : current));
  }

  function removeRow(id: string) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));
  }

  function selectHorizon(next: PlanningHorizon) {
    if (next === horizon) return;
    router.push(next === 'TOMORROW' ? '/plan-day?horizon=tomorrow' : '/plan-day?horizon=today');
  }

  async function submitPreview() {
    if (!timezone || !planningDate || !horizon || phase === 'SUBMITTING') return;
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
    } else if (result.status === 'FUTURE_AVAILABILITY_REQUIRED') {
      // Stale-availability race (this ticket's own section 17) -- route
      // to the SAME actionable prerequisite card the bootstrap-known case
      // renders, never a generic error.
      setAvailabilityRequiredStale(true);
      setPhase('ENTRY');
    } else {
      setEntryError(presentPlanDayPreviewFailure(result, horizon));
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
    // TODAY -- unchanged: return to Home; Home's own on-mount effects
    // (loadMyDay/loadGuidance, gated on activeTab==='home'/user?.id)
    // already refresh Plan-backed state on every fresh mount of `/` (this
    // ticket's own section 38, confirmed by direct audit of
    // apps/web/app/page.tsx).
    //
    // Planning Horizon V1 PR P2 -- TOMORROW: Home's own agenda queries are
    // Today-scoped, so a Tomorrow Plan would be silently invisible there.
    // Stay on this page and show an explicit confirmation instead of a
    // redirect that would read as though the save vanished (this ticket's
    // own section 28/29).
    if (horizon === 'TOMORROW') {
      setPhase('SAVED');
      return;
    }
    window.location.href = '/';
  }

  if (phase === 'REDIRECTING') return null;

  if (phase === 'SAVED') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--as-bg)', color: colors.textPrimary, fontFamily: 'var(--as-font-body)', display: 'flex', justifyContent: 'center', padding: `${spacing.xxxl}px ${spacing.lg}px` }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <SurfaceCard>
            <p style={{ margin: 0, fontWeight: 700 }}>Tomorrow is planned.</p>
            <div style={{ marginTop: spacing.md }}>
              <PrimaryButton onClick={() => { window.location.href = '/'; }}>Back to Home</PrimaryButton>
            </div>
          </SurfaceCard>
        </div>
      </div>
    );
  }

  const showAvailabilityPrerequisite = (horizon === 'TOMORROW' && availabilityConfigured === false) || availabilityRequiredStale;

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
            <PageHeader title="Plan my day" subtitle={horizon === 'TOMORROW' ? 'What do you want to get done tomorrow?' : 'What do you want to get done today?'} />

            <div style={{ marginTop: spacing.xl }}>
              <FieldLabel>When are you planning for?</FieldLabel>
              <SegmentedControl
                options={[
                  { value: 'TODAY', label: 'Today' },
                  { value: 'TOMORROW', label: 'Tomorrow' },
                ]}
                value={horizon ?? 'TODAY'}
                onChange={(value) => selectHorizon(value)}
              />
            </div>

            {showAvailabilityPrerequisite ? (
              <SurfaceCard style={{ marginTop: spacing.lg }}>
                <p style={{ margin: 0, fontWeight: 700 }}>Set your availability first</p>
                <p style={{ marginTop: spacing.xs, marginBottom: 0, color: colors.textSecondary }}>Aura needs to know when you're usually available before it can plan a future day.</p>
                <div style={{ marginTop: spacing.md }}>
                  <PrimaryButton onClick={() => { window.location.href = '/?tab=you'; }}>Set availability</PrimaryButton>
                </div>
              </SurfaceCard>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.lg }}>
                  {rows.map((row, index) => (
                    <IntentRowCard
                      key={row.id}
                      row={row}
                      index={index}
                      planningDate={planningDate}
                      horizon={horizon}
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
  horizon,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  row: PlanDayIntentRow;
  index: number;
  planningDate: string | null;
  horizon: PlanningHorizon | null;
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
          horizon={horizon}
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
 *
 * Planning Horizon V1 PR P2 -- `resolveDeadline`'s own `'TODAY'` choice
 * (planDayEntry.ts) has always resolved to `planningDate` verbatim,
 * whatever `planningDate` currently is -- the domain never distinguished
 * "the real calendar today" from "the day being planned." That was
 * invisible while only Today existed; once Tomorrow is selectable, a
 * chip literally labeled "Today" would misleadingly describe a same-day
 * (Tomorrow-relative) deadline. This is a PRESENTATION-ONLY fix
 * (`firstChipLabel` below) -- `resolveDeadline`/`PlanDayDeadlineChoice`'s
 * own `kind: 'TODAY'` value, and the deadline it resolves to, are
 * unchanged.
 */
function DueByControl({
  rowId,
  deadlineChoice,
  planningDate,
  horizon,
  disabled,
  hasError,
  onChange,
}: {
  rowId: string;
  deadlineChoice: PlanDayDeadlineChoice;
  planningDate: string | null;
  horizon: PlanningHorizon | null;
  disabled: boolean;
  hasError: boolean;
  onChange: (choice: PlanDayDeadlineChoice) => void;
}) {
  const [expanded, setExpanded] = useState(deadlineChoice.kind !== 'NONE');
  const dateInputId = `plan-day-deadline-${rowId}`;
  const firstChipLabel = horizon === 'TOMORROW' ? 'Same day' : 'Today';

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
        <DurationChip label={firstChipLabel} selected={deadlineChoice.kind === 'TODAY'} onClick={() => onChange({ kind: 'TODAY' })} />
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
