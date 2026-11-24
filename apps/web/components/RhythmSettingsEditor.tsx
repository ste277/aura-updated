'use client';

import React, { useRef, useState } from 'react';
import { colors, spacing, typography } from './theme';
import { PrimaryButton, SecondaryButton, TextButton, FieldLabel, FieldHint, FieldError, TextInput, DurationChip } from './ui';
import { RhythmPicker } from './RhythmPicker';
import type { RhythmTimeOfDay } from '../lib/goalActivityRhythmPreferences';
import {
  RHYTHM_DURATION_PRESETS,
  RHYTHM_TIME_OF_DAY_OPTIONS,
  RHYTHM_WEEKDAY_CHIPS,
  buildRhythmSettingsPatch,
  draftFromSaved,
  formatRhythmPreferencesSummary,
  toggleRhythmWeekday,
  validateRhythmSettingsDraft,
  type RhythmSettingsDraft,
  type SavedRhythmSettings,
} from '../lib/rhythmPreferencesDraft';

/**
 * AURA-MR3 -- My Rhythm settings for ONE existing goal activity: weekly
 * frequency, the optional MR1 preferences (preferred days, time of day,
 * session length) and pause/resume.
 *
 * Every write goes to the one existing endpoint,
 * PATCH /api/goals/:goalId/activities/:goalActivityId/rhythm, which
 * re-validates everything (MR1). Nothing here schedules, books or changes a
 * plan: confirmed plans are untouched by preference edits and by
 * pause/resume (MR2 S16/S25).
 *
 * Progressive disclosure: frequency is always visible; days/time/length sit
 * behind "Add days, time or length" until the user opens them or one is
 * already saved -- someone who only wants "3× a week" never sees them.
 */

type TimeChoice = 'ANY' | RhythmTimeOfDay;

const chipRowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: spacing.xs };
// One row of seven on a 320px phone: equal columns, full 44px height.
const weekdayGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4, marginTop: spacing.xs };

function WeekdayChip({ label, longLabel, selected, onToggle, disabled }: { label: string; longLabel: string; selected: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={longLabel}
      style={{
        minWidth: 0,
        minHeight: 44,
        padding: 0,
        borderRadius: 10,
        border: `1px solid ${selected ? colors.accentBorder : colors.borderSubtle}`,
        background: selected ? colors.positiveSoft : 'rgba(15, 23, 42, 0.6)',
        color: selected ? colors.positive : colors.textSecondary,
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function RhythmSettingsEditor({
  goalId,
  goalActivityId,
  saved,
  paused,
  onSaved,
}: {
  goalId: string;
  goalActivityId: string;
  saved: SavedRhythmSettings;
  paused: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RhythmSettingsDraft>(() => draftFromSaved(saved));
  const [showPreferences, setShowPreferences] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);
  // A ref, not just state: two clicks inside the same tick would both see
  // `saving === false` before React re-renders the disabled button.
  const inFlight = useRef(false);

  const endpoint = `/api/goals/${goalId}/activities/${goalActivityId}/rhythm`;
  const isWeekly = saved.frequency.kind === 'N_PER_WEEK';
  const summary = isWeekly ? formatRhythmPreferencesSummary(saved.preferences) : null;

  const send = async (body: object): Promise<string | null> => {
    try {
      const res = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) return null;
      const data = await res.json().catch(() => null);
      return typeof data?.error === 'string' ? data.error : 'Could not save this. Try again.';
    } catch {
      return 'Could not reach Aura. Check your connection and try again.';
    }
  };

  const startEditing = () => {
    const fresh = draftFromSaved(saved);
    setDraft(fresh);
    setShowPreferences(fresh.preferredWeekdays.length > 0 || fresh.preferredTimeOfDay !== null || fresh.durationText !== '');
    setCustomDuration(fresh.durationText !== '' && !RHYTHM_DURATION_PRESETS.includes(Number(fresh.durationText)));
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    if (saving) return;
    setDraft(draftFromSaved(saved));
    setError(null);
    setEditing(false);
  };

  const validation = validateRhythmSettingsDraft(draft, saved);
  const patch = buildRhythmSettingsPatch(draft, saved);

  const save = async () => {
    if (inFlight.current || patch === null) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    const failure = await send(patch);
    inFlight.current = false;
    setSaving(false);
    if (failure) {
      // The draft is kept so the user can fix it or retry.
      setError(failure);
      return;
    }
    setEditing(false);
    onSaved();
  };

  const togglePause = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPauseBusy(true);
    setPauseError(null);
    const failure = await send({ paused: !paused });
    inFlight.current = false;
    setPauseBusy(false);
    if (failure) {
      setPauseError(failure);
      return;
    }
    setConfirmingPause(false);
    onSaved();
  };

  const pauseButton = isWeekly && (
    <TextButton
      onClick={paused ? togglePause : () => { setPauseError(null); setConfirmingPause(true); }}
      disabled={pauseBusy || confirmingPause}
      color={paused ? colors.positive : colors.textMuted}
      style={{ minHeight: 44 }}
    >
      {pauseBusy && paused ? 'Resuming…' : paused ? 'Resume rhythm' : 'Pause rhythm'}
    </TextButton>
  );

  if (!editing) {
    return (
      <div>
        {summary && <div style={{ ...typography.meta, color: colors.textSecondary }}>{summary}</div>}
        <div style={{ display: 'flex', gap: spacing.lg, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextButton onClick={startEditing} color={colors.info} style={{ minHeight: 44 }}>
            {isWeekly ? 'Edit rhythm' : 'Set weekly frequency'}
          </TextButton>
          {pauseButton}
        </div>
        {confirmingPause && !paused && (
          <div role="group" aria-label="Pause this rhythm?" style={{ marginTop: spacing.xs }}>
            <div style={{ ...typography.caption, color: colors.textSecondary }}>
              Pausing stops new suggestions for this rhythm. Sessions you&rsquo;ve already planned and your preferences stay as they are.
            </div>
            <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' }}>
              <SecondaryButton onClick={togglePause} disabled={pauseBusy} style={{ minHeight: 44 }}>
                {pauseBusy ? 'Pausing…' : 'Pause'}
              </SecondaryButton>
              <TextButton onClick={() => setConfirmingPause(false)} disabled={pauseBusy} color={colors.textMuted} style={{ minHeight: 44, padding: '0 8px' }}>
                Keep active
              </TextButton>
            </div>
          </div>
        )}
        {pauseError && (
          <div role="alert" style={{ marginTop: spacing.xs }}>
            <FieldError>{pauseError}</FieldError>
          </div>
        )}
      </div>
    );
  }

  const weeklyDraft = draft.frequency?.kind === 'N_PER_WEEK';
  const timeChoice: TimeChoice = draft.preferredTimeOfDay ?? 'ANY';
  const durationPreset = draft.durationText === '' ? 'DEFAULT' : customDuration ? 'CUSTOM' : draft.durationText;
  const idPrefix = `rhythm-${goalActivityId}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.xs }}>
      <RhythmPicker value={saved.frequency} onChange={(frequency) => setDraft((d) => ({ ...d, frequency }))} idPrefix={idPrefix} />

      {weeklyDraft && !showPreferences && (
        <TextButton onClick={() => setShowPreferences(true)} color={colors.info} style={{ minHeight: 44, alignSelf: 'flex-start' }}>
          Add days, time or length (optional)
        </TextButton>
      )}

      {weeklyDraft && showPreferences && (
        <>
          <div role="group" aria-labelledby={`${idPrefix}-days-label`}>
            <div id={`${idPrefix}-days-label`} style={{ ...typography.meta, color: colors.textSecondary, fontWeight: 800 }}>
              Preferred days
            </div>
            <div style={weekdayGridStyle}>
              {RHYTHM_WEEKDAY_CHIPS.map((chip) => (
                <WeekdayChip
                  key={chip.value}
                  label={chip.short}
                  longLabel={chip.long}
                  selected={draft.preferredWeekdays.includes(chip.value)}
                  onToggle={() => setDraft((d) => ({ ...d, preferredWeekdays: toggleRhythmWeekday(d.preferredWeekdays, chip.value) }))}
                  disabled={saving}
                />
              ))}
            </div>
            {draft.preferredWeekdays.length > 0 && (
              <TextButton onClick={() => setDraft((d) => ({ ...d, preferredWeekdays: [] }))} color={colors.textMuted} style={{ minHeight: 44 }}>
                Any day
              </TextButton>
            )}
          </div>

          <div>
            <div style={{ ...typography.meta, color: colors.textSecondary, fontWeight: 800, marginBottom: spacing.xs }}>Preferred time</div>
            <div role="group" aria-label="Preferred time" style={chipRowStyle}>
              {([{ value: 'ANY', label: 'Any time' }, ...RHYTHM_TIME_OF_DAY_OPTIONS] as Array<{ value: TimeChoice; label: string }>).map((option) => (
                <DurationChip
                  key={option.value}
                  label={option.label}
                  selected={timeChoice === option.value}
                  onClick={() => { if (!saving) setDraft((d) => ({ ...d, preferredTimeOfDay: option.value === 'ANY' ? null : option.value })); }}
                />
              ))}
            </div>
            {draft.preferredTimeOfDay && (
              <FieldHint>{RHYTHM_TIME_OF_DAY_OPTIONS.find((o) => o.value === draft.preferredTimeOfDay)?.hint}. If no good time fits, Aura offers the best time that day and says so.</FieldHint>
            )}
          </div>

          <div>
            <div style={{ ...typography.meta, color: colors.textSecondary, fontWeight: 800 }}>Session length</div>
            <div style={chipRowStyle}>
              <DurationChip label="Default" selected={durationPreset === 'DEFAULT'} onClick={() => { setCustomDuration(false); setDraft((d) => ({ ...d, durationText: '' })); }} />
              {RHYTHM_DURATION_PRESETS.map((minutes) => (
                <DurationChip key={minutes} label={`${minutes} min`} selected={durationPreset === String(minutes)} onClick={() => { setCustomDuration(false); setDraft((d) => ({ ...d, durationText: String(minutes) })); }} />
              ))}
              <DurationChip label="Other" selected={durationPreset === 'CUSTOM'} onClick={() => setCustomDuration(true)} />
            </div>
            {customDuration && (
              <div style={{ marginTop: spacing.sm }}>
                <FieldLabel htmlFor={`${idPrefix}-duration`}>Minutes per session</FieldLabel>
                <TextInput
                  id={`${idPrefix}-duration`}
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={360}
                  step={1}
                  value={draft.durationText}
                  onChange={(e) => setDraft((d) => ({ ...d, durationText: e.target.value }))}
                  placeholder="e.g. 40"
                />
              </div>
            )}
          </div>
        </>
      )}

      {validation.notes.map((note) => (
        <div key={note} style={{ ...typography.caption, color: colors.textMuted }}>{note}</div>
      ))}
      {validation.errors.map((message) => (
        <div key={message} role="alert">
          <FieldError>{message}</FieldError>
        </div>
      ))}
      {error && (
        <div role="alert">
          <FieldError>{error}</FieldError>
        </div>
      )}

      <div style={{ display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
        <PrimaryButton onClick={save} disabled={patch === null} loading={saving}>
          Save changes
        </PrimaryButton>
        <SecondaryButton onClick={cancel} disabled={saving} style={{ minHeight: 44 }}>
          Cancel
        </SecondaryButton>
      </div>
    </div>
  );
}
