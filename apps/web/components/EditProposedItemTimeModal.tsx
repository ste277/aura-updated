'use client';

import React, { useRef, useState } from 'react';
import type { ConstructionWindow } from '../lib/dayIntent';
import type { ProposedItem } from '../lib/dayConstructor';
import { getDatePartsInTimezone, getMinuteOfDayInTimezone, localDateTimeToUTC } from '../lib/timezone';
import { updatePreviewItemTime, type UpdatedPreviewItem } from '../lib/dayConstructorPreviewItemClient';
import { presentPreviewItemUpdateFailure, readAcceptanceToken } from '../lib/dayPlanPreviewItemEditing';
import { spacing } from './theme';
import { ModalShell, useModalA11y, PrimaryButton, SecondaryButton, FieldLabel, FieldHint, FieldError, TextInput } from './ui';

/**
 * Plan My Day -- single-item time editing, the TAP-TIME interaction
 * itself.
 *
 * Owns nothing beyond its own form (date/time inputs, saving/error
 * state) and the ONE network call (`updatePreviewItemTime`, PR #280's
 * `preview-item` endpoint, completely unmodified by this file). Never
 * reaches the acceptance endpoint, never persists anything, never
 * recomputes the whole preview -- `onApply` hands the server's own
 * freshly re-signed item back to `DayPlanPreviewController`, which is the
 * one place that actually replaces it inside `preview` (this file never
 * touches `preview.constructedDay.proposedItems` itself).
 *
 * Reuses the SAME local-wall-time <-> UTC conversion the Plan tab's own
 * "Choose My Own Time" already uses (`localDateTimeToUTC`,
 * PlanWithAuraView.tsx) -- not a second convention -- and the existing
 * `ModalShell`/`useModalA11y` primitives (ui.tsx) rather than hand-rolling
 * a third overlay/focus-trap implementation.
 */
export interface EditProposedItemTimeModalProps {
  item: ProposedItem;
  window: ConstructionWindow;
  timezone: string;
  onApply: (updatedItem: UpdatedPreviewItem) => void;
  onClose: () => void;
}

function minuteOfDayToTimeInputValue(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function EditProposedItemTimeModal({ item, window, timezone, onApply, onClose }: EditProposedItemTimeModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [date, setDate] = useState(() => getDatePartsInTimezone(timezone, item.start).dateStr);
  const [time, setTime] = useState(() => minuteOfDayToTimeInputValue(getMinuteOfDayInTimezone(timezone, item.start)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useModalA11y({ isOpen: true, onClose, dialogRef, initialFocusRef: dateInputRef });

  const originalToken = readAcceptanceToken(item);

  async function handleSave() {
    if (!date || !time || saving) return; // double-submit guard, mirrors shouldSubmitAcceptance's own convention.
    if (!originalToken) {
      // Can only happen if this item somehow reached the modal without a
      // signed token at all (never true through the real preview flow,
      // which signs every proposed item) -- fail closed rather than
      // sending a request the server would reject anyway.
      setError('This item can no longer be edited here. Review again.');
      return;
    }
    setSaving(true);
    setError(null);
    const candidateStart = localDateTimeToUTC(date, time, timezone);
    const result = await updatePreviewItemTime(window, item, originalToken, candidateStart);
    setSaving(false);
    if (result.status === 'UPDATED') {
      onApply(result.item);
      return;
    }
    setError(presentPreviewItemUpdateFailure(result));
  }

  return (
    <ModalShell dialogRef={dialogRef} labelledBy="edit-proposed-item-time-title" title={`Change the time for "${item.title}"`} onClose={saving ? undefined : onClose} maxWidth={360}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm }}>
        <div>
          <FieldLabel htmlFor="edit-item-date">Date</FieldLabel>
          <TextInput ref={dateInputRef} id="edit-item-date" type="date" value={date} disabled={saving} onChange={(event) => { setDate(event.target.value); setError(null); }} />
        </div>
        <div>
          <FieldLabel htmlFor="edit-item-time">Start time</FieldLabel>
          <TextInput id="edit-item-time" type="time" value={time} disabled={saving} onChange={(event) => { setTime(event.target.value); setError(null); }} />
        </div>
      </div>
      <FieldHint>Aura re-checks this time for conflicts before applying it -- nothing is saved to your day yet.</FieldHint>
      {error && <FieldError>{error}</FieldError>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg }}>
        <SecondaryButton onClick={onClose} disabled={saving}>
          Cancel
        </SecondaryButton>
        <PrimaryButton onClick={handleSave} disabled={!date || !time || saving} loading={saving}>
          {saving ? 'Checking…' : 'Use this time'}
        </PrimaryButton>
      </div>
    </ModalShell>
  );
}
