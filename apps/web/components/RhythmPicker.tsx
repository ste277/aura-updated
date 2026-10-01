'use client';

import React, { useState } from 'react';
import { spacing } from './theme';
import { FieldLabel, TextInput, FieldError, SegmentedControl } from './ui';

/**
 * Goals V2 Rhythm R5 -- the one user-facing Rhythm input mechanism (this
 * ticket's own section 5): natural language, never implementation
 * vocabulary (N_PER_WEEK/Rhythm policy/recurrence rule never appear in
 * copy). "Once" is NOT a persisted Rhythm kind (this ticket's own section
 * 6) -- it is simply the UI's own label for { kind: 'NONE' }. Shared
 * between the Create Goal template flow (CreateGoalModal), manual Add
 * activity, and the Goal Detail per-row edit affordance -- one mechanism,
 * never a separately-built one for each entry point (this ticket's own
 * section 9).
 */

export type RhythmPickerValue = { kind: 'NONE' } | { kind: 'N_PER_WEEK'; targetPerWeek: number };
type RhythmPreset = 'ONCE' | '2' | '3' | '5' | 'CUSTOM';

export function presetForRhythmValue(value: RhythmPickerValue): RhythmPreset {
  if (value.kind === 'NONE') return 'ONCE';
  if (value.targetPerWeek === 2) return '2';
  if (value.targetPerWeek === 3) return '3';
  if (value.targetPerWeek === 5) return '5';
  return 'CUSTOM';
}

export function parseCustomRhythmText(text: string): RhythmPickerValue | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  // This ticket's own section 19/44 -- never coerce. 2.5/0/-3/"three" are
  // all rejected outright, never rounded/clamped/guessed.
  if (!Number.isInteger(n) || n <= 0) return null;
  return { kind: 'N_PER_WEEK', targetPerWeek: n };
}

/**
 * Controlled picker: "Once" / 3 fixed weekly presets / "Custom" (this
 * ticket's own section 45 -- presets are shortcuts, never semantic
 * defaults; Custom accepts any positive integer, no UI-imposed maximum).
 * `onChange` receives `null` whenever the current selection does not
 * resolve to a valid value (Custom with empty/invalid text) so the caller
 * can disable its own Save/Add action -- this picker never silently falls
 * back to NONE after the user has explicitly chosen weekly mode (section
 * 44).
 */
export function RhythmPicker({
  value,
  onChange,
  idPrefix,
  hideLabel,
}: {
  value: RhythmPickerValue;
  onChange: (value: RhythmPickerValue | null) => void;
  idPrefix: string;
  /** Keeps the label in the accessibility tree (still read by a screen
   * reader) but visually hidden -- for a list of several pickers that
   * already sit under one shared visible group heading (Create Goal's own
   * per-template-activity list), so "How often would help?" is not
   * repeated on screen once per row. */
  hideLabel?: boolean;
}) {
  const [preset, setPreset] = useState<RhythmPreset>(presetForRhythmValue(value));
  const [customText, setCustomText] = useState<string>(value.kind === 'N_PER_WEEK' && presetForRhythmValue(value) === 'CUSTOM' ? String(value.targetPerWeek) : '');

  const applyPreset = (next: RhythmPreset) => {
    setPreset(next);
    if (next === 'ONCE') onChange({ kind: 'NONE' });
    else if (next === 'CUSTOM') onChange(parseCustomRhythmText(customText));
    else onChange({ kind: 'N_PER_WEEK', targetPerWeek: Number(next) });
  };

  const customInvalid = preset === 'CUSTOM' && parseCustomRhythmText(customText) === null;

  return (
    <div>
      <FieldLabel htmlFor={`${idPrefix}-rhythm`} visuallyHidden={hideLabel}>
        How often would help?
      </FieldLabel>
      <div id={`${idPrefix}-rhythm`}>
        <SegmentedControl<RhythmPreset>
          options={[
            { value: 'ONCE', label: 'Once' },
            { value: '2', label: '2× a week' },
            { value: '3', label: '3× a week' },
            { value: '5', label: '5× a week' },
            { value: 'CUSTOM', label: 'Custom' },
          ]}
          value={preset}
          onChange={applyPreset}
        />
      </div>
      {preset === 'CUSTOM' && (
        <div style={{ marginTop: spacing.sm }}>
          <FieldLabel htmlFor={`${idPrefix}-rhythm-custom`} visuallyHidden>
            Times per week
          </FieldLabel>
          <TextInput
            id={`${idPrefix}-rhythm-custom`}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={customText}
            onChange={(e) => {
              setCustomText(e.target.value);
              onChange(parseCustomRhythmText(e.target.value));
            }}
            placeholder="times a week"
            hasError={customInvalid}
          />
          {customInvalid && <FieldError>Enter a whole number greater than 0.</FieldError>}
        </div>
      )}
    </div>
  );
}
