'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { colors, spacing, typography } from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, EmptyState, FieldLabel, TextInput, DurationChip, FieldError } from './ui';

/**
 * Explicit Duration Preferences Controls + Consumption V1 -- the "You →
 * Preferred durations" panel. Self-contained: owns its own GET on mount,
 * list state, add/edit view mode, and mutation pending/error state. Not
 * pushed into the User object (preferences aren't a user-row field) --
 * matches this repo's PeopleView.tsx pattern (a real per-row CRUD list),
 * not YouView's DayBuilderSettings/ReminderSettings pattern (a single
 * toggle whose state lives on the User object and is owned by the
 * parent).
 *
 * PRODUCT TRUTHFULNESS (architecture audit, merge-critical): this panel
 * ships in the SAME PR that wires Day Builder to actually consume these
 * rows (apps/web/lib/dayBuilderOrchestrator.ts's durationMinutesFor). A
 * value saved here really does change what Aura plans on the next Day
 * Builder request -- this panel must never ship ahead of that wiring.
 *
 * DISPLAY CONTRACT: only ever shows a real, explicitly-saved
 * preferredDurationMinutes under the label "Preferred duration." Never
 * displays a behavioral/static fallback value as though the user had
 * saved it (see architecture audit item 30/33/36) -- an activity with no
 * saved row simply doesn't appear in this list.
 */

interface ActivityPreferenceRow {
  activityId: string;
  preferredDurationMinutes: number;
}

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 360;

type ViewMode = { kind: 'LIST' } | { kind: 'ADD' } | { kind: 'EDIT'; activityId: string };

function activityTitle(activityId: string): string {
  return FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId)?.title ?? activityId;
}

function activityIcon(activityId: string): string | undefined {
  return FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId)?.icon;
}

export function ActivityDurationPreferences() {
  const [mode, setMode] = useState<ViewMode>({ kind: 'LIST' });
  const [preferences, setPreferences] = useState<ActivityPreferenceRow[] | null>(null);
  const [error, setError] = useState('');

  const loadPreferences = async () => {
    setError('');
    try {
      const res = await fetch('/api/activity-preferences');
      if (!res.ok) throw new Error('Unable to load your preferred durations.');
      setPreferences(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your preferred durations.');
      setPreferences([]);
    }
  };

  useEffect(() => {
    loadPreferences();
  }, []);

  // Presentation-only: the API returns activityId order, but the human
  // reads by title (architecture audit item 45/86).
  const sortedPreferences = useMemo(
    () => (preferences ?? []).slice().sort((a, b) => activityTitle(a.activityId).localeCompare(activityTitle(b.activityId))),
    [preferences]
  );
  const configuredIds = useMemo(() => new Set((preferences ?? []).map((p) => p.activityId)), [preferences]);

  const handleSaved = (row: ActivityPreferenceRow) => {
    setPreferences((current) => [...(current ?? []).filter((p) => p.activityId !== row.activityId), row]);
    setMode({ kind: 'LIST' });
  };

  const handleCleared = (activityId: string) => {
    setPreferences((current) => (current ?? []).filter((p) => p.activityId !== activityId));
    setMode({ kind: 'LIST' });
  };

  if (mode.kind === 'ADD') {
    return <ActivityDurationForm mode="ADD" excludeIds={configuredIds} onSaved={handleSaved} onCancel={() => setMode({ kind: 'LIST' })} />;
  }

  if (mode.kind === 'EDIT') {
    const existing = (preferences ?? []).find((p) => p.activityId === mode.activityId);
    if (existing) {
      return (
        <ActivityDurationForm
          mode="EDIT"
          activityId={mode.activityId}
          initialDuration={existing.preferredDurationMinutes}
          excludeIds={configuredIds}
          onSaved={handleSaved}
          onCleared={handleCleared}
          onCancel={() => setMode({ kind: 'LIST' })}
        />
      );
    }
  }

  return (
    <SurfaceCard>
      <p style={{ ...typography.body, marginTop: 0, marginBottom: spacing.md, color: colors.textSecondary }}>
        Choose how long you usually want Aura to use when planning your day.
      </p>

      {error && <div style={{ color: colors.danger, fontSize: 12, marginBottom: spacing.sm }}>{error}</div>}

      {preferences === null ? (
        <div style={{ fontSize: 12, color: colors.textFaint }}>Loading…</div>
      ) : sortedPreferences.length === 0 ? (
        <EmptyState title="You're using Aura's duration suggestions." action={<PrimaryButton onClick={() => setMode({ kind: 'ADD' })}>+ Add preference</PrimaryButton>} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sortedPreferences.map((pref) => (
            <div
              key={pref.activityId}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: '10px 0', borderBottom: `1px solid ${colors.borderSubtle}` }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: colors.textPrimary }}>
                  {activityIcon(pref.activityId) ? `${activityIcon(pref.activityId)} ` : ''}
                  {activityTitle(pref.activityId)}
                </div>
                <div style={{ fontSize: 12, color: colors.textFaint, marginTop: 2 }}>Preferred duration: {pref.preferredDurationMinutes} min</div>
              </div>
              <SecondaryButton onClick={() => setMode({ kind: 'EDIT', activityId: pref.activityId })} style={{ minHeight: 34, padding: '0 12px' }} ariaLabel={`Edit preferred duration for ${activityTitle(pref.activityId)}`}>
                Edit
              </SecondaryButton>
            </div>
          ))}
          <PrimaryButton onClick={() => setMode({ kind: 'ADD' })} style={{ width: '100%', marginTop: spacing.sm }}>
            + Add preference
          </PrimaryButton>
        </div>
      )}
    </SurfaceCard>
  );
}

function ActivityDurationForm({
  mode,
  activityId: initialActivityId,
  initialDuration,
  excludeIds,
  onSaved,
  onCleared,
  onCancel,
}: {
  mode: 'ADD' | 'EDIT';
  activityId?: string;
  initialDuration?: number;
  excludeIds: Set<string>;
  onSaved: (row: ActivityPreferenceRow) => void;
  onCleared?: (activityId: string) => void;
  onCancel: () => void;
}) {
  const [activityId, setActivityId] = useState(initialActivityId ?? '');
  const [filter, setFilter] = useState('');
  const initialIsCustom = initialDuration !== undefined && !DURATION_PRESETS.includes(initialDuration);
  const [usingCustom, setUsingCustom] = useState(initialIsCustom);
  const [preset, setPreset] = useState<number | ''>(initialIsCustom ? '' : initialDuration ?? '');
  const [customDuration, setCustomDuration] = useState(initialIsCustom ? String(initialDuration) : '');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');

  const availableActivities = useMemo(() => {
    const lowerFilter = filter.trim().toLowerCase();
    return FULL_ACTIVITY_CATALOG.filter((a) => (mode === 'ADD' ? !excludeIds.has(a.id) : a.id === activityId))
      .filter((a) => !lowerFilter || a.title.toLowerCase().includes(lowerFilter))
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [filter, excludeIds, mode, activityId]);

  const resolvedDuration = usingCustom ? Number(customDuration) : preset;
  const durationValid = typeof resolvedDuration === 'number' && Number.isInteger(resolvedDuration) && resolvedDuration >= MIN_DURATION_MINUTES && resolvedDuration <= MAX_DURATION_MINUTES;
  const canSave = Boolean(activityId) && durationValid && !saving && !clearing;

  const handleSave = async () => {
    if (!canSave || typeof resolvedDuration !== 'number') return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/activity-preferences/${activityId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredDurationMinutes: resolvedDuration }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to save this preference.');
      }
      onSaved(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this preference.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!activityId || !onCleared) return;
    setClearing(true);
    setError('');
    try {
      const res = await fetch(`/api/activity-preferences/${activityId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Unable to clear this preference.');
      onCleared(activityId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to clear this preference.');
      setClearing(false);
    }
  };

  return (
    <SurfaceCard>
      <div style={typography.sectionEyebrow}>{mode === 'ADD' ? 'Add preference' : 'Edit preferred duration'}</div>

      {mode === 'ADD' && (
        <div style={{ marginTop: spacing.md }}>
          <FieldLabel htmlFor="activity-duration-filter">Activity</FieldLabel>
          <TextInput id="activity-duration-filter" type="text" placeholder="Search activities…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: spacing.sm, maxHeight: 220, overflowY: 'auto' }}>
            {availableActivities.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-pressed={activityId === a.id}
                onClick={() => setActivityId(a.id)}
                style={{
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${activityId === a.id ? colors.accentBorder : 'transparent'}`,
                  background: activityId === a.id ? colors.positiveSoft : 'transparent',
                  color: activityId === a.id ? colors.positive : colors.textSecondary,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {a.icon} {a.title}
              </button>
            ))}
            {availableActivities.length === 0 && <div style={{ fontSize: 12, color: colors.textFaint, padding: '8px 0' }}>No matching activities.</div>}
          </div>
        </div>
      )}

      {mode === 'EDIT' && activityId && (
        <div style={{ marginTop: spacing.md, fontSize: 14, fontWeight: 800, color: colors.textPrimary }}>
          {activityIcon(activityId) ? `${activityIcon(activityId)} ` : ''}
          {activityTitle(activityId)}
        </div>
      )}

      <div style={{ marginTop: spacing.lg }}>
        <FieldLabel>Preferred duration</FieldLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
          {DURATION_PRESETS.map((option) => (
            <DurationChip
              key={option}
              label={`${option} min`}
              selected={!usingCustom && preset === option}
              onClick={() => {
                setUsingCustom(false);
                setPreset(option);
              }}
            />
          ))}
          <DurationChip label="Custom" selected={usingCustom} onClick={() => setUsingCustom(true)} />
        </div>
        {usingCustom && (
          <div style={{ marginTop: spacing.sm }}>
            <FieldLabel htmlFor="activity-duration-custom">Custom duration (minutes)</FieldLabel>
            <TextInput
              id="activity-duration-custom"
              type="number"
              inputMode="numeric"
              min={MIN_DURATION_MINUTES}
              max={MAX_DURATION_MINUTES}
              step={1}
              placeholder="15–360"
              value={customDuration}
              onChange={(e) => setCustomDuration(e.target.value)}
            />
            {customDuration !== '' && !durationValid && <FieldError>Enter a whole number of minutes between 15 and 360.</FieldError>}
          </div>
        )}
      </div>

      {error && <FieldError>{error}</FieldError>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm, marginTop: spacing.lg }}>
        <PrimaryButton onClick={handleSave} disabled={!canSave} loading={saving} style={{ width: '100%' }}>
          Save
        </PrimaryButton>
        {mode === 'EDIT' && onCleared && (
          <SecondaryButton onClick={handleClear} disabled={saving || clearing} style={{ width: '100%' }}>
            {clearing ? 'Removing…' : 'Use Aura suggestion'}
          </SecondaryButton>
        )}
        <SecondaryButton onClick={onCancel} disabled={saving || clearing} style={{ width: '100%' }}>
          Cancel
        </SecondaryButton>
      </div>
      {mode === 'EDIT' && (
        <div style={{ fontSize: 11, color: colors.textFaint, marginTop: spacing.sm, lineHeight: 1.4 }}>
          &ldquo;Use Aura suggestion&rdquo; removes your saved duration and lets Aura choose using your current patterns and activity defaults.
        </div>
      )}
    </SurfaceCard>
  );
}
