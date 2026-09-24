'use client';

import React, { useRef, useState } from 'react';
import type { ConstructDayPreview } from '../lib/dayConstructorOrchestrator';
import { acceptConstructedDay, type PersistedPlanSummary, type GoalActivityLink, type CaptureLink } from '../lib/acceptConstructedDay';
import { classifyAcceptanceUiState, resolveClientRequestId, computePreviewIdentityKey, shouldSubmitAcceptance, hasSubmittableProposal, type ClientRequestIdCache, type DayPlanAcceptanceUiState } from '../lib/dayPlanAcceptancePresentation';
import { DayPlanPreview } from './DayPlanPreview';

/**
 * Day Constructor V1 -- PR E3. The OWNING controller for a reviewed
 * `ConstructDayPreview`'s confirmation/save lifecycle (this ticket's own
 * section 21). `DayPlanPreview` itself stays a plain presentational
 * component (PR D, unmodified in spirit -- only extended with the
 * optional `actionState`/`onRetry`/`onReviewAgain` props this controller
 * drives); this file owns everything PR D deliberately left inert:
 *
 *   - the acceptance-level `clientRequestId`'s own lifecycle
 *   - the actual `POST /api/day-constructor/accept` network call
 *   - loading/result state
 *   - double-submission guarding
 *   - retry (same id) vs. review-again (fresh preview) semantics
 *
 * CORE INVARIANT (this ticket's own section 1): the UI requests the
 * change; the server decides whether the reviewed change is still safe.
 * This file never reconstructs the proposal, never re-runs timing
 * search, never reaches any other plan-creation route, and never
 * persists anything itself -- `acceptConstructedDay` (acceptConstructedDay.ts)
 * is the only network call this file ever makes.
 *
 * No live mount point exists yet for this experience (confirmed by
 * audit: no route anywhere calls `orchestrateConstructDay`, and
 * `DayPlanPreview` itself had zero existing callers before this PR) --
 * this component is deliberately self-contained and reusable, exposing
 * `onSaved`/`onDiscard`/`onRefreshRequested` for whichever future
 * experience actually produces a preview to show. Wiring THAT entry
 * point is out of this PR's own scope (this ticket's own section 32: "No
 * Home IA redesign").
 */
export interface DayPlanPreviewControllerProps {
  preview: ConstructDayPreview;
  onDiscard?: () => void;
  /** Fires after a genuine SAVED or an ALREADY_ACCEPTED replay (this
   * ticket's own section 12: identical UI treatment) -- the owning
   * experience's own hook to refresh whatever Plan-backed view it shows
   * next (this repository's own established convention, e.g.
   * `DayBuilderCard`'s own `onCreated`/`refreshAfterCreate` -- never a
   * `router.refresh()`, which nothing in this codebase currently uses). */
  onSaved?: (plans: PersistedPlanSummary[]) => void;
  /** Fires when the reviewed proposal is no longer safe to save
   * (REJECTED or IDEMPOTENCY_CONFLICT) and the user asks to see an
   * updated one ("Review again"). This file never reconstructs the day
   * itself (this ticket's own section 20) -- the owning experience is
   * responsible for calling the existing Day Constructor orchestration
   * entry point and handing this controller a NEW preview. */
  onRefreshRequested?: () => void;
  /** Goals -> Planning Integration V1 PR C -- an opaque pass-through to
   * `acceptConstructedDay`'s own optional third argument (this ticket's
   * own section 20/26). This controller does not compute/inspect this
   * array itself -- it never knows which rows carry Goal provenance,
   * matching its own established boundary of "never reconstructs the
   * proposal." The owning experience (PlanDayClient.tsx) is the only
   * place that has both `rows` and `preview` in scope to build it. */
  goalActivityLinks?: readonly GoalActivityLink[];
  /** Quick Capture V1 PR B -- same opaque pass-through, for Capture provenance. */
  captureLinks?: readonly CaptureLink[];
}

export function DayPlanPreviewController({ preview, onDiscard, onSaved, onRefreshRequested, goalActivityLinks, captureLinks }: DayPlanPreviewControllerProps) {
  const [actionState, setActionState] = useState<DayPlanAcceptanceUiState>({ kind: 'IDLE' });
  // Preview IDENTITY, not object reference (pre-commit review hardening --
  // see dayPlanAcceptancePresentation.ts's own doc comment on
  // `computePreviewIdentityKey` for the full rationale/field selection).
  // A deep-equal preview rebuilt as a new object (e.g. a retry that
  // happens to re-run the same orchestration) resolves to the SAME
  // identity key, so it reuses the same `clientRequestId` and keeps
  // whatever result state is already showing -- only an ACCEPTANCE-
  // RELEVANT change (a different window, a moved/retitled/re-typed item,
  // an added/removed item) counts as "genuinely new."
  const identityKey = computePreviewIdentityKey(preview);
  // Derived-during-render cache (React's own documented pattern for
  // adjusting state from a changed input without an extra Effect-driven
  // render) -- `resolveClientRequestId` is the pure decision; this ref
  // only holds its own last result.
  const requestIdCacheRef = useRef<ClientRequestIdCache | null>(null);
  requestIdCacheRef.current = resolveClientRequestId(requestIdCacheRef.current, identityKey, () => crypto.randomUUID());
  const clientRequestId = requestIdCacheRef.current.clientRequestId;
  // A genuinely new identity also resets any STALE/FAILED/SAVED state left
  // over from a previous proposal -- never shows "Your day is planned"
  // (or a stale rejection message) for a proposal the user hasn't acted
  // on yet.
  const lastIdentityKeyRef = useRef(identityKey);
  if (lastIdentityKeyRef.current !== identityKey) {
    lastIdentityKeyRef.current = identityKey;
    if (actionState.kind !== 'IDLE') setActionState({ kind: 'IDLE' });
  }

  const submit = async () => {
    if (!shouldSubmitAcceptance(actionState)) return; // double-submit guard (this ticket's own section 9) -- ignored, not queued.
    if (!hasSubmittableProposal(preview)) return; // this ticket's own section 23 -- zero proposed items never POSTs, defense-in-depth alongside DayPlanPreview's own disabled Continue button.
    setActionState({ kind: 'SAVING' });
    const result = await acceptConstructedDay(preview, clientRequestId, goalActivityLinks, captureLinks);
    const nextState = classifyAcceptanceUiState(result);
    setActionState(nextState);
    if (nextState.kind === 'SAVED') {
      const plans = result.status === 'SAVED' || result.status === 'ALREADY_ACCEPTED' ? result.plans : [];
      onSaved?.(plans);
    }
  };

  return (
    <DayPlanPreview
      preview={preview}
      onContinue={submit}
      onDiscard={onDiscard}
      actionState={actionState}
      onRetry={submit}
      onReviewAgain={onRefreshRequested}
    />
  );
}
