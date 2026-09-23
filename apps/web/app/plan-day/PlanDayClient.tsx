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
import { colors, spacing, radius } from '../../components/theme';
import { DayPlanPreviewController } from '../../components/DayPlanPreviewController';
import type { ConstructDayPreview } from '../../lib/dayConstructorOrchestrator';
import type { PersistedPlanSummary } from '../../lib/acceptConstructedDay';
import { previewConstructedDay } from '../../lib/dayConstructorPreviewClient';
import type { PlanningHorizon } from '../../lib/planningHorizon';
import { PLAN_DAY_QUICK_PICKS, quickPickIcon, type PlanDayQuickPick } from '../../lib/planDayQuickPicks';
import {
  createEmptyIntentRow,
  createIntentRowFromQuickPick,
  isRowUntouched,
  formatIntentRowSummary,
  canSubmitPlanDay,
  canAddAnotherRow,
  buildRequestedIntentsForSubmission,
  presentPlanDayPreviewFailure,
  PLAN_DAY_DURATION_OPTIONS_MINUTES,
  NO_DEADLINE,
  type PlanDayIntentRow,
  type PlanDayDeadlineChoice,
  type PlanDayEntryErrorPresentation,
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
 *
 * Plan My Day UX V2 PR U1 -- Quick Picks (planDayQuickPicks.ts) let a
 * user add a common intent without typing; typing remains fully
 * available (`+ Something else`, and every row's own title stays
 * editable regardless of collapsed/expanded state). `expandedRowIds` is
 * PRESENTATION-ONLY UI state -- never added to `PlanDayIntentRow` itself
 * (this ticket's own section 7: no field beyond `activityId` belongs on
 * the domain row model). A row collapses to a one-line summary
 * (`formatIntentRowSummary`, planDayEntry.ts) by default; "Edit"/"Done"
 * toggles disclosure without ever discarding values.
 *
 * Plan My Day UX V2 PR U2 -- `planRevealed` is likewise PRESENTATION-ONLY
 * UI state (this ticket's own section 5): the internal single untouched
 * blank row from U1 is deliberately RETAINED (smallest safe
 * implementation, this ticket's own section 5's own explicit
 * permission) -- U2 only stops RENDERING a plan card/CTA for it until
 * the user has actually taken an action (a Quick Pick or `+ Something
 * else`), both of which set this flag. `addPickerExpanded` toggles the
 * compact `+ Add another` affordance open/closed once a real plan
 * exists -- it reuses the EXACT SAME `QuickPicksAndSomethingElse` block
 * (same data, same handlers) the fresh state already renders, never a
 * second picker implementation (this ticket's own section 18).
 */

type Phase = 'REDIRECTING' | 'ENTRY' | 'SUBMITTING' | 'PREVIEW' | 'PREVIEW_ERROR' | 'SAVED';

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
  // Plan My Day UX V2 PR U1 -- every row starts collapsed, including a
  // freshly-typed one (this ticket's own section 23: defaults already
  // require no configuration, so there is no product reason to force
  // Edit open merely because a row is new).
  const [expandedRowIds, setExpandedRowIds] = useState<ReadonlySet<string>>(new Set());
  // The one row id (if any) that should receive keyboard focus on the
  // NEXT render -- set by `+ Something else` reusing/creating a blank
  // row (this ticket's own section 16: "focus it"). Quick Picks never
  // set this -- they already fill the title themselves.
  const [pendingFocusRowId, setPendingFocusRowId] = useState<string | null>(null);
  // Plan My Day UX V2 PR U2 -- true once the user has taken a real
  // action (a Quick Pick or `+ Something else`), never derived from row
  // content alone: this is what lets `+ Something else` on a fresh page
  // reveal/focus the SAME still-untouched internal blank row (this
  // ticket's own section 8) without that row already having rendered as
  // a visible card the instant before.
  const [planRevealed, setPlanRevealed] = useState(false);
  // Whether the compact `+ Add another` affordance is currently showing
  // the full Quick Picks grid (this ticket's own section 15/19) -- only
  // meaningful once `planRevealed` is true.
  const [addPickerExpanded, setAddPickerExpanded] = useState(false);
  const [preview, setPreview] = useState<ConstructDayPreview | null>(null);
  const [entryError, setEntryError] = useState<PlanDayEntryErrorPresentation | null>(null);
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

  // Plan My Day UX V2 PR U1 -- `+ Something else` focus handoff. Uses the
  // SAME deterministic `plan-day-title-${id}` element id every row's own
  // title input already carries (no new ref plumbing).
  useEffect(() => {
    if (!pendingFocusRowId) return;
    document.getElementById(`plan-day-title-${pendingFocusRowId}`)?.focus();
    setPendingFocusRowId(null);
  }, [pendingFocusRowId]);

  // Plan My Day UX V2 PR U2 Release Gate (section 12) -- editing a row's
  // title back to blank, or removing rows, can bring the plan back to
  // "no meaningful content at all" (every remaining row is itself
  // untouched). Left alone, the revealed-state UI (the plan heading,
  // Add-another, CTA) would keep showing with nothing real behind it -- this
  // collapses back to the fresh entry state instead, matching this
  // ticket's own explicit invariant. Depending only on `rows` (never on
  // `planRevealed`/`pendingFocusRowId` themselves) means this only ever
  // reconsiders when row CONTENT changes, and reads pendingFocusRowId as
  // of that same render -- so it never fires in the render pass
  // `handleSomethingElse` reveals a still-untouched row for the user to
  // type into (pendingFocusRowId is set in that exact same batch).
  useEffect(() => {
    if (planRevealed && pendingFocusRowId === null && rows.every(isRowUntouched)) {
      setPlanRevealed(false);
      setAddPickerExpanded(false);
    }
  }, [rows]);

  function updateRow(id: string, patch: Partial<PlanDayIntentRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow(id: string) {
    setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));
  }

  function toggleRowExpanded(id: string) {
    setExpandedRowIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Plan My Day UX V2 PR U1 -- Quick Pick tap (this ticket's own sections
  // 12/13/15). ACTIONS, never a toggle/multi-select: every tap adds one
  // intent, duplicates always allowed (section 13). The single existing
  // untouched blank row is reused in place rather than left alongside a
  // second, redundant row (section 15) -- `isRowUntouched` (planDayEntry.ts)
  // defines "blank" by full row state, never title alone. Never focuses
  // the title input -- the pick already supplied it.
  function handleQuickPick(pick: PlanDayQuickPick) {
    setPlanRevealed(true);
    // Plan My Day UX V2 PR U2 (this ticket's own section 19) -- a
    // successful pick always returns the Add-another picker to its
    // collapsed state, whether it was opened from the compact `+ Add
    // another` affordance or this was simply the very first pick on a
    // fresh page (where it is already false, a harmless no-op).
    setAddPickerExpanded(false);
    setRows((current) => {
      if (current.length === 1 && isRowUntouched(current[0])) {
        return [{ ...current[0], title: pick.label, activityId: pick.activityId }];
      }
      if (!canAddAnotherRow(current)) return current;
      return [...current, createIntentRowFromQuickPick(pick)];
    });
  }

  // "+ Something else" (this ticket's own section 16) -- the SAME
  // blank-row-reuse rule as a Quick Pick, but focuses the title input
  // afterward (typing is the whole point of this action) instead of
  // pre-filling it.
  function handleSomethingElse() {
    // Plan My Day UX V2 PR U2 (this ticket's own section 8/20) -- reveals
    // the plan (and, on a fresh page, the still-untouched internal blank
    // row this reuses) in the SAME render pass the focus is requested in,
    // so the title input already exists in the DOM by the time the
    // pending-focus effect below runs.
    setPlanRevealed(true);
    setAddPickerExpanded(false);
    setRows((current) => {
      if (current.length === 1 && isRowUntouched(current[0])) {
        setPendingFocusRowId(current[0].id);
        return current;
      }
      if (!canAddAnotherRow(current)) return current;
      const row = createEmptyIntentRow();
      setPendingFocusRowId(row.id);
      return [...current, row];
    });
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
      setEntryError({ message: "Something about your day didn't come through correctly.", showEdit: true, actions: [] });
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
  const atIntentCap = !canAddAnotherRow(rows) && !(rows.length === 1 && isRowUntouched(rows[0]));

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
                {!planRevealed && (
                  <div style={{ marginTop: spacing.lg }}>
                    <FieldLabel>What do you want to accomplish?</FieldLabel>
                    <QuickPicksAndSomethingElse
                      disabled={phase === 'SUBMITTING' || atIntentCap}
                      onQuickPick={handleQuickPick}
                      onSomethingElse={handleSomethingElse}
                    />
                  </div>
                )}

                {planRevealed && (
                  <>
                    <div style={{ marginTop: spacing.xl }}>
                      <FieldLabel>Your plan</FieldLabel>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
                      {rows.map((row, index) => (
                        <IntentRowCard
                          key={row.id}
                          row={row}
                          index={index}
                          planningDate={planningDate}
                          horizon={horizon}
                          expanded={expandedRowIds.has(row.id)}
                          canRemove={rows.length > 1}
                          disabled={phase === 'SUBMITTING'}
                          onChange={(patch) => updateRow(row.id, patch)}
                          onRemove={() => removeRow(row.id)}
                          onToggleExpanded={() => toggleRowExpanded(row.id)}
                        />
                      ))}
                    </div>

                    <div style={{ marginTop: spacing.md }}>
                      {addPickerExpanded ? (
                        <QuickPicksAndSomethingElse
                          disabled={phase === 'SUBMITTING' || atIntentCap}
                          onQuickPick={handleQuickPick}
                          onSomethingElse={handleSomethingElse}
                        />
                      ) : (
                        <SecondaryButton onClick={() => setAddPickerExpanded(true)} disabled={phase === 'SUBMITTING' || atIntentCap}>
                          + Add another
                        </SecondaryButton>
                      )}
                    </div>

                    {phase === 'PREVIEW_ERROR' && entryError && (
                      // Plan My Day U3, this ticket's own section 17 --
                      // `role="alert"` so assistive technology announces
                      // the failure as soon as it renders, matching the
                      // standard ARIA live-region pattern for a message
                      // that just appeared (this repo has no prior
                      // convention for this exact case, confirmed by
                      // audit -- introduced here rather than left silent).
                      // Applied on a plain wrapping <div>, not SurfaceCard
                      // itself (no prop passthrough on that shared
                      // primitive, and this ticket does not modify it).
                      <div role="alert" style={{ marginTop: spacing.lg }}>
                        <SurfaceCard>
                          <FieldError>{entryError.message}</FieldError>
                          <div style={{ display: 'flex', gap: spacing.md, marginTop: spacing.md, flexWrap: 'wrap' }}>
                            {/* This ticket's own section 14: `showEdit` is
                                false only for an expired session (401) --
                                editing activity rows cannot fix that, so
                                offering it there would be a real dead end,
                                not merely a redundant one. */}
                            {entryError.showEdit && (
                              <SecondaryButton onClick={() => setPhase('ENTRY')} ariaLabel="Edit activities">
                                Edit activities
                              </SecondaryButton>
                            )}
                            {entryError.actions.includes('CONFIGURE_AVAILABILITY') && (
                              <PrimaryButton onClick={() => { window.location.href = '/?tab=you'; }}>Configure availability</PrimaryButton>
                            )}
                            {entryError.actions.includes('SIGN_IN') && (
                              // This ticket's own section 14 -- `/` is this
                              // app's real, only sign-in surface (its own
                              // LoginScreen, shown to any unauthenticated
                              // visitor), the SAME destination this file's
                              // own "Back to Home" link already uses --
                              // never a claim with no action behind it.
                              <PrimaryButton onClick={() => { window.location.href = '/'; }}>Sign in</PrimaryButton>
                            )}
                            {entryError.actions.includes('RETRY') && (
                              // This ticket's own section 13 -- the ONLY
                              // resubmit action ever rendered during
                              // PREVIEW_ERROR; the bottom "Plan my day" CTA
                              // is hidden below whenever this phase is
                              // active, so a retryable failure never shows
                              // two buttons that do the identical unchanged
                              // resubmission at once.
                              <PrimaryButton onClick={() => void submitPreview()}>Try again</PrimaryButton>
                            )}
                          </div>
                        </SurfaceCard>
                      </div>
                    )}

                    {phase !== 'PREVIEW_ERROR' && (
                      <div style={{ marginTop: spacing.xxl, display: 'flex', justifyContent: 'flex-end' }}>
                        <PrimaryButton onClick={() => void submitPreview()} disabled={!planningDate || !canSubmitPlanDay(rows, planningDate)} loading={phase === 'SUBMITTING'} ariaLabel="Plan my day">
                          Plan my day
                        </PrimaryButton>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Plan My Day UX V2 PR U1 -- a Quick Pick is an ACTION button (this
 * ticket's own section 12: "not radio buttons, toggles, multi-select
 * state"), deliberately NOT `DurationChip` (ui.tsx): that component
 * always sets `aria-pressed`/a persistent "selected" look, which is the
 * correct semantic for a genuine mutually-exclusive choice (Duration,
 * Flexible/Specific time, the Today/Tomorrow horizon) but would
 * misrepresent a button that can be tapped repeatedly to add several
 * independent intents. Visual language still matches this screen's own
 * existing chip styling for consistency -- only the semantics differ.
 */
function QuickPickButton({ pick, disabled, onClick }: { pick: PlanDayQuickPick; disabled: boolean; onClick: () => void }) {
  const icon = quickPickIcon(pick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Add ${pick.label}`}
      style={{
        minHeight: 40,
        padding: '0 14px',
        borderRadius: radius.md,
        border: `1px solid ${colors.borderSubtle}`,
        background: 'rgba(15, 23, 42, 0.6)',
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flex: '1 1 auto',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {pick.label}
    </button>
  );
}

/**
 * Plan My Day UX V2 PR U2 -- the ONE picks-plus-Something-else
 * implementation (this ticket's own section 18: "Reuse the same
 * data/actions" -- never a second picker). Rendered from two places in
 * `PlanDayClient` below: the fresh, pre-`planRevealed` entry state, and
 * the expanded `+ Add another` affordance once a plan already exists.
 * Markup/handlers are byte-identical to U1's own original inline block --
 * only extracted, not changed.
 */
function QuickPicksAndSomethingElse({
  disabled,
  onQuickPick,
  onSomethingElse,
}: {
  disabled: boolean;
  onQuickPick: (pick: PlanDayQuickPick) => void;
  onSomethingElse: () => void;
}) {
  return (
    <>
      <p style={{ margin: `${spacing.xs}px 0 ${spacing.sm}px`, fontSize: 12, color: colors.textFaint, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>Quick picks</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs }}>
        {PLAN_DAY_QUICK_PICKS.map((pick) => (
          <QuickPickButton key={pick.label} pick={pick} disabled={disabled} onClick={() => onQuickPick(pick)} />
        ))}
      </div>
      <div style={{ marginTop: spacing.sm }}>
        <TextButton onClick={onSomethingElse} color={colors.info} style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
          + Something else
        </TextButton>
      </div>
    </>
  );
}

function IntentRowCard({
  row,
  index,
  planningDate,
  horizon,
  expanded,
  canRemove,
  disabled,
  onChange,
  onRemove,
  onToggleExpanded,
}: {
  row: PlanDayIntentRow;
  index: number;
  planningDate: string | null;
  horizon: PlanningHorizon | null;
  expanded: boolean;
  canRemove: boolean;
  disabled: boolean;
  onChange: (patch: Partial<PlanDayIntentRow>) => void;
  onRemove: () => void;
  onToggleExpanded: () => void;
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
            // Plan My Day UX V2 PR U1 -- any title edit clears a picker-
            // supplied activityId unconditionally (this ticket's own
            // section 6/21/55: visible text and hidden canonical identity
            // must never silently diverge). A no-op when the row never
            // had one. Never a dynamic client-side reclassification --
            // the existing server-side resolver re-classifies the edited
            // title exactly as it would for any typed row.
            onChange={(e) => onChange({ title: e.target.value, activityId: undefined })}
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

      {!expanded ? (
        <div style={{ marginTop: spacing.sm, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <span style={{ fontSize: 12, color: colors.textFaint }}>{formatIntentRowSummary(row, horizon)}</span>
          <SecondaryButton onClick={onToggleExpanded}>Edit</SecondaryButton>
        </div>
      ) : (
        <>
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
            <DeadlineControl
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

          <div style={{ marginTop: spacing.md, display: 'flex', justifyContent: 'flex-end' }}>
            <SecondaryButton onClick={onToggleExpanded}>Done</SecondaryButton>
          </div>
        </>
      )}
    </SurfaceCard>
  );
}

/**
 * "Deadline" (this ticket's own section 28, renamed from "Due by" --
 * presentation only, `PlanDayDeadlineChoice`/`resolveDeadline` are
 * byte-unchanged) -- progressive disclosure, collapsed by default
 * (`NO_DEADLINE`), never a permanent full date picker per row.
 * Deliberately never worded as if it were a clock time (a row's
 * `important`/deadline facts are always rendered in a visually SEPARATE
 * control from "At a specific time" above, so the two intent facts
 * -- urgency vs. scheduling constraint -- are never presented as one
 * choice).
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
function DeadlineControl({
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
        + Deadline
      </TextButton>
    );
  }

  return (
    <div>
      <FieldLabel>Deadline</FieldLabel>
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
