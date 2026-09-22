'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, DestructiveButton, TextButton, IconButton, TextInput, FieldLabel, FieldError } from './ui';
import {
  WEEKDAY_LABELS,
  createEmptyWeekDraft,
  hydrateWeekDraft,
  addPeriod,
  removePeriod,
  updatePeriodTime,
  copyMondayToWeekdays,
  validateWeekDraft,
  flattenWeekDraft,
  formatWeekdaySummary,
  type WeekAvailabilityDraft,
} from '../lib/availabilitySettings';
import type { Weekday } from '../lib/availabilityContext';

/**
 * Availability Settings V1 -- PR H2. The "You → Availability" panel.
 * Self-contained: owns its own GET on mount, local editable draft state,
 * and Save/Reset mutation state -- matches ActivityDurationPreferences.tsx's
 * own established pattern (self-contained GET-on-mount panel), not
 * DayBuilderSettings/ReminderSettings's own (a single toggle whose state
 * lives on the parent's User object).
 *
 * PRODUCT LANGUAGE (this ticket's own section 3): "Availability" is the
 * only heading used here -- a work-schedule-flavored term is deliberately
 * avoided, since Aura plans a whole life, not only work.
 *
 * UNCONFIGURED vs CONFIGURED_EMPTY (this ticket's own section 6/7):
 * `configured === false` renders a genuinely empty week (never an
 * inferred Mon-Fri 9-5) with no special "unconfigured" banner needed --
 * an empty week already reads correctly either way, and the very first
 * Save the user performs is what sets `configured = true` server-side.
 *
 * Availability Settings UX V2 PR A -- PRESENTATION ONLY (this ticket's
 * own section 2/4). Every weekday now renders as a compact collapsed
 * summary ("Monday · 9:00 AM – 5:00 PM · Edit") by default; the always-
 * expanded administrative form (a visible "MONDAY PERIOD 1 START TIME"
 * label per input, for every period of every weekday, unconditionally)
 * is gone. `expandedWeekdays` (below) is the ONLY new state -- it is
 * UI-only, never touches the request body, `draft`, or persistence, and
 * several weekdays may be expanded simultaneously (no accordion
 * semantics forced, this ticket's own section 13). Every other piece of
 * this file -- GET/PUT/DELETE, `draft`/`dirty`/`canSave`, add/remove/
 * copy/validate/flatten -- is byte-for-byte the same architecture as
 * before; only what gets RENDERED for a given weekday changed.
 */

type LoadState = { kind: 'LOADING' } | { kind: 'ERROR'; message: string } | { kind: 'READY'; configured: boolean; timezone: string; savedPeriodsKey: string };

export function AvailabilitySettings() {
  const [load, setLoad] = useState<LoadState>({ kind: 'LOADING' });
  const [draft, setDraft] = useState<WeekAvailabilityDraft>(createEmptyWeekDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Availability Settings UX V2 PR A (this ticket's own section 13) --
  // which weekdays currently show their full period editor. Presentation
  // ONLY: never read by canSave/dirty/flatten, never sent to the server.
  const [expandedWeekdays, setExpandedWeekdays] = useState<ReadonlySet<Weekday>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/users/availability-preferences');
        if (!res.ok) throw new Error('Unable to load your availability.');
        const body = await res.json();
        const periods = Array.isArray(body.periods) ? body.periods : [];
        setDraft(body.configured ? hydrateWeekDraft(periods) : createEmptyWeekDraft());
        setLoad({ kind: 'READY', configured: !!body.configured, timezone: body.timezone, savedPeriodsKey: JSON.stringify(periods) });
      } catch (err) {
        setLoad({ kind: 'ERROR', message: err instanceof Error ? err.message : 'Unable to load your availability.' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flattened = useMemo(() => flattenWeekDraft(draft), [draft]);
  const validation = useMemo(() => validateWeekDraft(draft), [draft]);
  const dirty = load.kind === 'READY' && JSON.stringify(flattened) !== load.savedPeriodsKey;

  const canSave = load.kind === 'READY' && dirty && validation.ok && !saving;

  function toggleWeekdayExpanded(weekday: Weekday) {
    setExpandedWeekdays((current) => {
      const next = new Set(current);
      if (next.has(weekday)) next.delete(weekday);
      else next.add(weekday);
      return next;
    });
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const res = await fetch('/api/users/availability-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periods: flattened }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Unable to save your availability.');
      }
      const body = await res.json();
      setLoad({ kind: 'READY', configured: true, timezone: load.kind === 'READY' ? load.timezone : '', savedPeriodsKey: JSON.stringify(body.periods ?? flattened) });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to save your availability.');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetConfirmed() {
    setResetting(true);
    setSaveError('');
    try {
      const res = await fetch('/api/users/availability-preferences', { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to reset your availability.');
      setDraft(createEmptyWeekDraft());
      setLoad((current) => (current.kind === 'READY' ? { ...current, configured: false, savedPeriodsKey: JSON.stringify([]) } : current));
      setResetConfirming(false);
      setSaved(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to reset your availability.');
    } finally {
      setResetting(false);
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
      <p style={{ ...typography.body, marginTop: 0, marginBottom: spacing.xs, color: colors.textSecondary }}>When can Aura usually plan things for you?</p>
      {load.kind === 'READY' && <p style={{ fontSize: 12, color: colors.textFaint, marginTop: 0, marginBottom: spacing.md }}>Times use your timezone: {load.timezone}</p>}
      {load.kind === 'ERROR' && <FieldError>{load.message}</FieldError>}

      {/* Availability Settings UX V2 PR A (this ticket's own section 36)
       * -- a load error never renders alongside a misleadingly-editable
       * empty week; there is nothing valid to edit or save until a real
       * GET succeeds. */}
      {load.kind === 'READY' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
            {draft.map((day) => (
              <WeekdayRow
                key={day.weekday}
                weekday={day.weekday}
                periods={day.periods}
                disabled={saving || resetting}
                expanded={expandedWeekdays.has(day.weekday)}
                showCopy={day.weekday === 1 && day.periods.length > 0}
                onToggleExpanded={() => toggleWeekdayExpanded(day.weekday)}
                onAdd={() => setDraft((current) => addPeriod(current, day.weekday))}
                onRemove={(periodId) => setDraft((current) => removePeriod(current, day.weekday, periodId))}
                onChangeTime={(periodId, field, value) => setDraft((current) => updatePeriodTime(current, day.weekday, periodId, field, value))}
                onCopyToWeekdays={() => setDraft((current) => copyMondayToWeekdays(current))}
              />
            ))}
          </div>

          {!validation.ok && <FieldError>{validation.error}</FieldError>}
          {saveError && <FieldError>{saveError}</FieldError>}

          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg }}>
            <PrimaryButton onClick={handleSave} disabled={!canSave} ariaLabel="Save availability">
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
            {saved && !dirty && <span style={{ fontSize: 12, color: colors.positive }}>Saved</span>}
          </div>

          {load.configured && (
            <div style={{ marginTop: spacing.xl, paddingTop: spacing.md, borderTop: `1px solid ${colors.borderSubtle}` }}>
              {!resetConfirming ? (
                <TextButton onClick={() => setResetConfirming(true)} color={colors.textMuted}>
                  Reset availability
                </TextButton>
              ) : (
                <div>
                  <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 0, marginBottom: spacing.sm, lineHeight: 1.5 }}>
                    Aura will stop using this weekly availability schedule and return to its default planning behavior.
                  </p>
                  <div style={{ display: 'flex', gap: spacing.sm }}>
                    <DestructiveButton onClick={handleResetConfirmed} disabled={resetting}>
                      {resetting ? 'Resetting…' : 'Reset availability'}
                    </DestructiveButton>
                    <SecondaryButton onClick={() => setResetConfirming(false)} disabled={resetting}>
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

function WeekdayRow({
  weekday,
  periods,
  disabled,
  expanded,
  showCopy,
  onToggleExpanded,
  onAdd,
  onRemove,
  onChangeTime,
  onCopyToWeekdays,
}: {
  weekday: Weekday;
  periods: WeekAvailabilityDraft[number]['periods'];
  disabled: boolean;
  expanded: boolean;
  showCopy: boolean;
  onToggleExpanded: () => void;
  onAdd: () => void;
  onRemove: (periodId: string) => void;
  onChangeTime: (periodId: string, field: 'startTime' | 'endTime', value: string) => void;
  onCopyToWeekdays: () => void;
}) {
  const label = WEEKDAY_LABELS[weekday];

  // Availability Settings UX V2 PR A (this ticket's own section 7/10) --
  // the collapsed default: weekday name, a plain-language summary
  // ("Not available" or "9:00 AM – 5:00 PM"), and an explicit Edit
  // affordance. Never a bare tappable row with no visible control (this
  // ticket's own section 10).
  if (!expanded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: colors.textPrimary }}>{label}</div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{formatWeekdaySummary(periods)}</div>
        </div>
        <SecondaryButton onClick={onToggleExpanded} disabled={disabled} ariaLabel={`Edit ${label} availability`}>
          Edit
        </SecondaryButton>
      </div>
    );
  }

  // Availability Settings UX V2 PR A (this ticket's own section 11/19/21)
  // -- the expanded editor. Every implementation-facing visible label
  // ("MONDAY PERIOD 1 START TIME") is gone; each time input keeps the
  // SAME accessible name as before via a visually-hidden FieldLabel
  // (this ticket's own section 20), and a plain "→" separates start from
  // end so a period reads as one range, not two unrelated fields.
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 800, color: colors.textPrimary, marginBottom: spacing.xs }}>{label}</div>
      {periods.length === 0 ? (
        <div style={{ fontSize: 12, color: colors.textFaint, marginBottom: spacing.xs }}>Not available</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs, marginBottom: spacing.xs }}>
          {periods.map((period, index) => {
            const startId = `availability-${weekday}-${period.id}-start`;
            const endId = `availability-${weekday}-${period.id}-end`;
            return (
              <div key={period.id} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                <FieldLabel htmlFor={startId} visuallyHidden>{`${label} period ${index + 1} start time`}</FieldLabel>
                <TextInput id={startId} type="time" value={period.startTime} onChange={(e) => onChangeTime(period.id, 'startTime', e.target.value)} disabled={disabled} style={{ width: 120 }} />
                <span aria-hidden="true" style={{ color: colors.textFaint }}>→</span>
                <FieldLabel htmlFor={endId} visuallyHidden>{`${label} period ${index + 1} end time`}</FieldLabel>
                <TextInput id={endId} type="time" value={period.endTime} onChange={(e) => onChangeTime(period.id, 'endTime', e.target.value)} disabled={disabled} style={{ width: 120 }} />
                <IconButton ariaLabel={`Remove ${label} period ${index + 1}`} onClick={() => onRemove(period.id)} style={{ width: 36, height: 36 }}>
                  ✕
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextButton onClick={onAdd} color={colors.info} style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
          {periods.length === 0 ? '+ Add period' : '+ Add another period'}
        </TextButton>
        {showCopy && (
          <TextButton onClick={onCopyToWeekdays} color={colors.textMuted} style={{ opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
            Copy to weekdays
          </TextButton>
        )}
        <SecondaryButton onClick={onToggleExpanded} disabled={disabled} ariaLabel={`Done editing ${label} availability`} style={{ marginLeft: 'auto' }}>
          Done
        </SecondaryButton>
      </div>
    </div>
  );
}
