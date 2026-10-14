'use client';

import React, { useEffect, useState } from 'react';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, DestructiveButton, TextButton, TextInput, FieldLabel, FieldError } from './ui';
import { WEEKDAY_LABELS } from '../lib/availabilitySettings';
import type { Weekday } from '../lib/availabilityContext';

/**
 * Daily Rhythm V1 PR DR1 -- Preferences Foundation. The "You → Planning →
 * Daily Rhythm" panel. Self-contained (owns its own GET on mount, local
 * draft state, Save/Clear mutation state), same established pattern as
 * AvailabilitySettings.tsx/ActivityDurationPreferences.tsx -- deliberately
 * NOT a new navigation section, mounted inline in YouView.tsx right after
 * the existing Availability panel (this ticket's own "do not introduce a
 * new navigation section").
 *
 * THIS PANEL CHANGES NO SCHEDULING BEHAVIOR. It only persists a
 * preference -- the day constructor, Find a Time, Home, and Goals are all
 * untouched by this PR (this ticket's own explicit scope boundary).
 *
 * UNCONFIGURED vs CONFIGURED (this ticket's own "preserve existing
 * behavior when preferences are unset" / "do not store default work
 * hours without user confirmation"): both workStart and workEnd null is
 * the only unconfigured state, and the panel never pre-fills a guessed
 * default (e.g. "9:00"-"17:00") into the inputs -- an unconfigured user
 * sees genuinely empty fields and no work days selected, exactly like
 * AvailabilitySettings' own empty-week convention. The very first Save
 * is what sets the preference server-side.
 */

type LoadState =
  | { kind: 'LOADING' }
  | { kind: 'ERROR'; message: string }
  | { kind: 'READY'; configured: boolean; timezone: string; savedKey: string };

interface Draft {
  workStart: string;
  workEnd: string;
  workDays: ReadonlySet<Weekday>;
}

function createEmptyDraft(): Draft {
  return { workStart: '', workEnd: '', workDays: new Set() };
}

function draftKey(draft: Draft): string {
  return JSON.stringify({ workStart: draft.workStart, workEnd: draft.workEnd, workDays: Array.from(draft.workDays).sort((a, b) => a - b) });
}

export function DailyRhythmSettings() {
  const [load, setLoad] = useState<LoadState>({ kind: 'LOADING' });
  const [draft, setDraft] = useState<Draft>(createEmptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [clearConfirming, setClearConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/users/daily-rhythm-preferences');
        if (!res.ok) throw new Error('Unable to load your daily rhythm preferences.');
        const body = await res.json();
        const nextDraft: Draft = body.configured
          ? { workStart: body.workStart ?? '', workEnd: body.workEnd ?? '', workDays: new Set((Array.isArray(body.workDays) ? body.workDays : []) as Weekday[]) }
          : createEmptyDraft();
        setDraft(nextDraft);
        setLoad({ kind: 'READY', configured: !!body.configured, timezone: body.timezone, savedKey: draftKey(nextDraft) });
      } catch (err) {
        setLoad({ kind: 'ERROR', message: err instanceof Error ? err.message : 'Unable to load your daily rhythm preferences.' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = load.kind === 'READY' && draftKey(draft) !== load.savedKey;
  const hasTimes = draft.workStart.trim().length > 0 && draft.workEnd.trim().length > 0;
  // Both-empty is a valid "no change yet" / "about to clear" state --
  // only block Save when exactly one of the two times is filled in (an
  // impossible, corrupt combination, never persisted -- see
  // dailyRhythmPreferences.ts's own "both null is the only unconfigured
  // state" invariant).
  const onlyOneTimeFilled = (draft.workStart.trim().length > 0) !== (draft.workEnd.trim().length > 0);
  const canSave = load.kind === 'READY' && dirty && hasTimes && !onlyOneTimeFilled && !saving;

  function toggleWorkday(day: Weekday) {
    setDraft((current) => {
      const next = new Set(current.workDays);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return { ...current, workDays: next };
    });
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const res = await fetch('/api/users/daily-rhythm-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workStart: draft.workStart, workEnd: draft.workEnd, workDays: Array.from(draft.workDays) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Unable to save your daily rhythm preferences.');
      const savedDraft: Draft = { workStart: body.workStart ?? draft.workStart, workEnd: body.workEnd ?? draft.workEnd, workDays: new Set((body.workDays ?? Array.from(draft.workDays)) as Weekday[]) };
      setDraft(savedDraft);
      setLoad((current) => (current.kind === 'READY' ? { ...current, configured: true, savedKey: draftKey(savedDraft) } : current));
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save your daily rhythm preferences.');
    } finally {
      setSaving(false);
    }
  }

  async function handleClearConfirmed() {
    setClearing(true);
    setSaveError('');
    try {
      const res = await fetch('/api/users/daily-rhythm-preferences', { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to clear your daily rhythm preferences.');
      const emptyDraft = createEmptyDraft();
      setDraft(emptyDraft);
      setLoad((current) => (current.kind === 'READY' ? { ...current, configured: false, savedKey: draftKey(emptyDraft) } : current));
      setClearConfirming(false);
      setSaved(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to clear your daily rhythm preferences.');
    } finally {
      setClearing(false);
    }
  }

  if (load.kind === 'LOADING') {
    return (
      <SurfaceCard>
        <div style={{ fontSize: 12, color: colors.textFaint }}>Loading…</div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <p style={{ ...typography.body, marginTop: 0, marginBottom: spacing.xs, color: colors.textSecondary }}>
        When are you usually working? Aura doesn&rsquo;t use this to plan yet -- it&rsquo;s saved for later.
      </p>
      {load.kind === 'READY' && <p style={{ fontSize: 12, color: colors.textFaint, marginTop: 0, marginBottom: spacing.md }}>Times use your timezone: {load.timezone}</p>}
      {load.kind === 'ERROR' && <FieldError>{load.message}</FieldError>}

      {load.kind === 'READY' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md }}>
            <FieldLabel htmlFor="daily-rhythm-work-start" visuallyHidden>Work start time</FieldLabel>
            <TextInput
              id="daily-rhythm-work-start"
              type="time"
              value={draft.workStart}
              onChange={(e) => setDraft((current) => ({ ...current, workStart: e.target.value }))}
              disabled={saving || clearing}
              style={{ width: 120 }}
            />
            <span aria-hidden="true" style={{ color: colors.textFaint }}>→</span>
            <FieldLabel htmlFor="daily-rhythm-work-end" visuallyHidden>Work end time</FieldLabel>
            <TextInput
              id="daily-rhythm-work-end"
              type="time"
              value={draft.workEnd}
              onChange={(e) => setDraft((current) => ({ ...current, workEnd: e.target.value }))}
              disabled={saving || clearing}
              style={{ width: 120 }}
            />
          </div>

          <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: spacing.xs }}>Work days</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }}>
            {WEEKDAY_LABELS.map((label, weekday) => {
              const selected = draft.workDays.has(weekday as Weekday);
              return (
                <button
                  key={weekday}
                  type="button"
                  onClick={() => toggleWorkday(weekday as Weekday)}
                  disabled={saving || clearing}
                  aria-pressed={selected}
                  aria-label={label}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '6px 10px',
                    minHeight: 36,
                    borderRadius: 999,
                    border: `1px solid ${selected ? colors.info : colors.borderSubtle}`,
                    background: selected ? 'rgba(96, 165, 250, 0.12)' : 'transparent',
                    color: selected ? colors.info : colors.textSecondary,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: saving || clearing ? 'default' : 'pointer',
                    opacity: saving || clearing ? 0.6 : 1,
                  }}
                >
                  {label.slice(0, 3)}
                </button>
              );
            })}
          </div>

          {onlyOneTimeFilled && <FieldError>Set both a start and end time, or clear both.</FieldError>}
          {saveError && <FieldError>{saveError}</FieldError>}

          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg }}>
            <PrimaryButton onClick={handleSave} disabled={!canSave} ariaLabel="Save daily rhythm preferences">
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
            {saved && !dirty && <span style={{ fontSize: 12, color: colors.positive }}>Saved</span>}
          </div>

          {load.configured && (
            <div style={{ marginTop: spacing.xl, paddingTop: spacing.md, borderTop: `1px solid ${colors.borderSubtle}` }}>
              {!clearConfirming ? (
                <TextButton onClick={() => setClearConfirming(true)} color={colors.textMuted}>
                  Clear daily rhythm preferences
                </TextButton>
              ) : (
                <div>
                  <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 0, marginBottom: spacing.sm, lineHeight: 1.5 }}>
                    Aura will forget your work hours and work days.
                  </p>
                  <div style={{ display: 'flex', gap: spacing.sm }}>
                    <DestructiveButton onClick={handleClearConfirmed} disabled={clearing}>
                      {clearing ? 'Clearing…' : 'Clear daily rhythm preferences'}
                    </DestructiveButton>
                    <SecondaryButton onClick={() => setClearConfirming(false)} disabled={clearing}>
                      Cancel
                    </SecondaryButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </SurfaceCard>
  );
}
