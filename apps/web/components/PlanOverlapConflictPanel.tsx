'use client';

/**
 * AURA-HPG5-V2-I2 (R1-04 / R1-05) -- the ONE conflict panel for a save that
 * POST /api/plans refused with 409 PLAN_OVERLAP (overlapPolicy
 * REJECT_ACTIVE_OVERLAP). Shared by the Plan tab's Find a Time and the My Day
 * story card so there is a single conflict-resolution UI, not two.
 *
 * Presentation only. The caller owns the refused payload and decides what
 * "Save anyway" re-sends; this component never saves, retries or changes a
 * time on its own. It names both sides of the conflict -- the proposed save
 * (title, date, start-end) and the existing plan -- and the override button
 * carries the exact proposed time.
 */
import React, { type CSSProperties, type Ref } from 'react';
import type { PlanOverlapProposedPresentation } from '../lib/schedulingEligibilityPresentation';
import { SecondaryButton } from './ui';

export interface PlanOverlapConflictPanelProps {
  /** Unique per mounted panel (DOM ids for aria-labelledby/-describedby). */
  idPrefix: string;
  presentation: PlanOverlapProposedPresentation;
  headingRef?: Ref<HTMLDivElement>;
  onChooseAnotherTime: () => void;
  /** Omitted -> no override offered (e.g. a surface that routes elsewhere). */
  onSaveAnyway?: () => void;
  /** True while ANY save is in flight: the override is disabled. */
  saveDisabled: boolean;
  /** True while THIS panel's override is the save in flight. */
  saving: boolean;
  chooseAnotherTimeLabel?: string;
  testId?: string;
}

const buttonBase: CSSProperties = { minHeight: 44, padding: '0 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, maxWidth: '100%', whiteSpace: 'normal', textAlign: 'center' };

export function PlanOverlapConflictPanel({ idPrefix, presentation, headingRef, onChooseAnotherTime, onSaveAnyway, saveDisabled, saving, chooseAnotherTimeLabel = 'Choose another time', testId = 'plan-overlap-conflict' }: PlanOverlapConflictPanelProps) {
  const headingId = `${idPrefix}-heading`;
  const detailId = `${idPrefix}-detail`;
  return (
    <div role="alert" aria-labelledby={headingId} aria-describedby={detailId} data-testid={testId} style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(251,191,36,0.45)', background: 'rgba(251,191,36,0.08)', boxSizing: 'border-box', maxWidth: '100%', overflowWrap: 'anywhere' }}>
      <div id={headingId} ref={headingRef} tabIndex={-1} style={{ color: '#fbbf24', fontSize: 14, fontWeight: 700, outline: 'none' }}>
        {presentation.headline}
      </div>
      <div id={detailId} style={{ color: '#dbe7f4', fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>
        <div data-testid={`${testId}-proposed`}>{presentation.proposedLine}</div>
        <div data-testid={`${testId}-existing`} style={{ marginTop: 2 }}>{presentation.conflictLine}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <SecondaryButton onClick={onChooseAnotherTime} style={{ minHeight: 44 }}>
          {chooseAnotherTimeLabel}
        </SecondaryButton>
        {onSaveAnyway && (
          <button
            type="button"
            onClick={onSaveAnyway}
            disabled={saveDisabled}
            aria-label={presentation.saveAnywayLabel}
            style={{ ...buttonBase, border: '1px solid rgba(251,191,36,0.55)', background: 'transparent', color: '#fbbf24', cursor: saveDisabled ? 'default' : 'pointer', opacity: saveDisabled ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : presentation.saveAnywayText}
          </button>
        )}
      </div>
    </div>
  );
}
