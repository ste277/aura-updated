'use client';

import React, { useState } from 'react';
import { colors, spacing, typography } from './theme';
import * as theme from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, TextButton, DestructiveButton, FieldLabel, FieldHint, TextInput, SelectInput } from './ui';
import {
  KIND_ICON,
  KIND_NAME,
  MONTHS,
  OCCASION_LIMIT_PER_PERSON,
  REMINDER_CHOICES,
  REMINDER_DEFAULT,
  birthdayFromChartDate,
  buildOccasionCreatePayload,
  buildOccasionEditPayload,
  describeDaysUntil,
  formatCivilDay,
  formatSavedDay,
  nextLine,
  occasionTitle,
  occasionToValues,
  reminderLabel,
  turningText,
  validateOccasionValues,
  type OccasionFormValues,
  type OccasionKind,
  type OccasionRow,
  type UpcomingRow,
} from '../lib/myPeopleOccasionUi';

/**
 * AURA-MP-2 (62016) -- special days (birthdays, anniversaries, other dates)
 * for the My People screens. UI only: it calls the MP-1 occasion API
 * unchanged. Field contract and pure helpers: lib/myPeopleOccasionUi.ts.
 */

export { KIND_ICON, birthdayFromChartDate, formatSavedDay, nextLine, occasionTitle };
export type { OccasionRow, UpcomingRow };

async function send(method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Something went wrong. Nothing was changed.');
  }
}

/* ------------------------------------------------------------------ */
/* Coming up (My People overview)                                       */
/* ------------------------------------------------------------------ */

export function ComingUpList({ items, onOpenPerson }: { items: UpcomingRow[]; onOpenPerson: (personId: string) => void }) {
  // Hidden when empty (design 5.2): never a "nothing coming up" message.
  if (items.length === 0) return null;
  return (
    <section aria-label="Coming up" data-testid="my-people-coming-up">
      <div style={typography.sectionEyebrow}>Coming up</div>
      <SurfaceCard padding={0} style={{ overflow: 'hidden', marginTop: spacing.sm }}>
        {items.map((item, i) => {
          const turning = turningText(item.kind, item.turning);
          return (
            <button
              key={item.occasionId}
              type="button"
              data-testid="coming-up-item"
              onClick={() => onOpenPerson(item.personId)}
              style={{ ...rowButtonStyle, borderTop: i === 0 ? 'none' : `1px solid ${colors.borderSubtle}` }}
            >
              <span aria-hidden style={{ fontSize: 20, lineHeight: '24px' }}>{KIND_ICON[item.kind]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: colors.textPrimary }}>{occasionTitle(item.kind, item.label, item.personName)}</span>
                <span style={{ display: 'block', fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  {nextLine(item)}{turning ? ` · ${turning}` : ''}
                </span>
              </span>
              {item.surfaced && (
                <span title="Reminder" aria-label="Reminder" style={{ fontSize: 12, fontWeight: 800, color: colors.relationship, whiteSpace: 'nowrap' }}>
                  {item.daysUntil === 0 ? 'Today' : 'Soon'}
                </span>
              )}
            </button>
          );
        })}
      </SurfaceCard>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Special days (person detail)                                         */
/* ------------------------------------------------------------------ */

export function SpecialDaysSection({
  personId,
  personName,
  occasions,
  chartBirthDate,
  currentYear,
  onChanged,
}: {
  personId: string;
  personName: string;
  occasions: OccasionRow[];
  chartBirthDate: string | null;
  currentYear: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ kind: 'NEW' } | { kind: 'EDIT'; occasion: OccasionRow } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [error, setError] = useState('');
  const hasBirthday = occasions.some((o) => o.kind === 'BIRTHDAY');
  const sorted = [...occasions].sort((a, b) => (a.next?.daysUntil ?? 9999) - (b.next?.daysUntil ?? 9999));

  const remove = async (occasionId: string) => {
    setError('');
    try {
      await send('DELETE', `/api/people/${personId}/occasions/${occasionId}`);
      setConfirmingDelete(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this special day.');
    }
  };

  return (
    <SurfaceCard>
      <div style={typography.sectionEyebrow}>Special days</div>
      {sorted.length === 0 && !editing && (
        <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 1.6 }}>
          Add {personName}&apos;s birthday or another date that matters, and it will show up here when it&apos;s coming up.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
        {sorted.map((o) =>
          editing?.kind === 'EDIT' && editing.occasion.id === o.id ? (
            <OccasionForm
              key={o.id}
              personId={personId}
              original={o}
              allowBirthday
              chartBirthDate={chartBirthDate}
              currentYear={currentYear}
              onDone={() => { setEditing(null); onChanged(); }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div key={o.id} data-testid="special-day" style={{ display: 'flex', gap: spacing.md, alignItems: 'flex-start' }}>
              <span aria-hidden style={{ fontSize: 20, lineHeight: '24px' }}>{KIND_ICON[o.kind]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: colors.textPrimary }}>
                  {o.kind === 'OTHER' ? o.label : KIND_NAME[o.kind]} · {formatSavedDay(o.month, o.day, o.year)}
                </div>
                {o.next && (
                  <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                    {nextLine(o.next)}{turningText(o.kind, o.next.turning) ? ` · ${turningText(o.kind, o.next.turning)}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 12, color: colors.textFaint, marginTop: 2 }}>{reminderLabel(o.remindDaysBefore)}</div>
                {confirmingDelete === o.id ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: colors.textSecondary }}>Remove this special day?</span>
                    <DestructiveButton onClick={() => remove(o.id)}>Yes, remove day</DestructiveButton>
                    <SecondaryButton onClick={() => setConfirmingDelete(null)}>Keep</SecondaryButton>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: spacing.lg, marginTop: spacing.xs }}>
                    <TextButton onClick={() => { setConfirmingDelete(null); setEditing({ kind: 'EDIT', occasion: o }); }}>Edit day</TextButton>
                    <TextButton onClick={() => setConfirmingDelete(o.id)}>Remove day</TextButton>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>
      {editing?.kind === 'NEW' && (
        <div style={{ marginTop: spacing.md }}>
          <OccasionForm
            personId={personId}
            allowBirthday={!hasBirthday}
            chartBirthDate={chartBirthDate}
            currentYear={currentYear}
            onDone={() => { setEditing(null); onChanged(); }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}
      {!editing && occasions.length < OCCASION_LIMIT_PER_PERSON && (
        <SecondaryButton onClick={() => { setConfirmingDelete(null); setEditing({ kind: 'NEW' }); }} style={{ marginTop: spacing.md, width: '100%' }}>
          + Add a special day
        </SecondaryButton>
      )}
      {error && <div style={{ ...theme.errorBoxStyle, marginTop: spacing.sm }}>{error}</div>}
    </SurfaceCard>
  );
}

function OccasionForm({
  personId,
  original,
  allowBirthday,
  chartBirthDate,
  currentYear,
  onDone,
  onCancel,
}: {
  personId: string;
  original?: OccasionRow;
  allowBirthday: boolean;
  chartBirthDate: string | null;
  currentYear: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const initial: OccasionFormValues = original
    ? occasionToValues(original)
    : { kind: allowBirthday ? 'BIRTHDAY' : 'ANNIVERSARY', label: '', month: '', day: '', year: '', reminder: String(REMINDER_DEFAULT) };
  const [values, setValues] = useState<OccasionFormValues>(initial);
  const [reminderTouched, setReminderTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<OccasionFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const chartDay = birthdayFromChartDate(chartBirthDate);
  // A saved reminder outside the three choices is kept and shown, never replaced.
  const reminderChoices = REMINDER_CHOICES.some((c) => c.value === values.reminder)
    ? REMINDER_CHOICES
    : [...REMINDER_CHOICES, { value: values.reminder, days: Number(values.reminder), label: reminderLabel(Number(values.reminder)).replace('Reminder ', '') }];
  const prefix = original ? `occasion-${original.id}` : 'occasion-new';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const payload = original ? buildOccasionEditPayload(original, values, currentYear) : buildOccasionCreatePayload(values, currentYear, reminderTouched);
    if (!payload.ok) { setError(payload.error); return; }
    if (!payload.body) { onDone(); return; }
    setSaving(true);
    try {
      if (original) await send('PATCH', `/api/people/${personId}/occasions/${original.id}`, payload.body);
      else await send('POST', `/api/people/${personId}/occasions`, payload.body);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this special day.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="occasion-form" style={{ ...theme.cellStyle, display: 'flex', flexDirection: 'column', gap: spacing.md, padding: spacing.md }}>
      {!original && (
        <div>
          <FieldLabel htmlFor={`${prefix}-kind`}>What kind of day?</FieldLabel>
          <SelectInput id={`${prefix}-kind`} value={values.kind} onChange={(e) => set({ kind: e.target.value as OccasionKind })}>
            {allowBirthday && <option value="BIRTHDAY">🎂 Birthday</option>}
            <option value="ANNIVERSARY">💍 Anniversary</option>
            <option value="OTHER">📅 Another important date</option>
          </SelectInput>
        </div>
      )}
      {values.kind === 'OTHER' && (
        <div>
          <FieldLabel htmlFor={`${prefix}-label`}>Name of the day</FieldLabel>
          <TextInput id={`${prefix}-label`} type="text" maxLength={60} value={values.label} placeholder="Graduation" onChange={(e) => set({ label: e.target.value })} />
        </div>
      )}
      {values.kind === 'BIRTHDAY' && chartDay && (
        <TextButton
          onClick={() => set({ day: String(chartDay.day), month: String(chartDay.month), year: String(chartDay.year) })}
        >
          Use the birth date from chart details ({formatSavedDay(chartDay.month, chartDay.day, chartDay.year)})
        </TextButton>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: spacing.sm }}>
        <div>
          <FieldLabel htmlFor={`${prefix}-day`}>Day</FieldLabel>
          <SelectInput id={`${prefix}-day`} value={values.day} onChange={(e) => set({ day: e.target.value })}>
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
          </SelectInput>
        </div>
        <div>
          <FieldLabel htmlFor={`${prefix}-month`}>Month</FieldLabel>
          <SelectInput id={`${prefix}-month`} value={values.month} onChange={(e) => set({ month: e.target.value })}>
            <option value="">Month</option>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </SelectInput>
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-year`}>Year (optional)</FieldLabel>
        <TextInput id={`${prefix}-year`} type="text" inputMode="numeric" maxLength={4} value={values.year} placeholder="Leave empty if you're not sure" onChange={(e) => set({ year: e.target.value.replace(/[^0-9]/g, '') })} />
        {values.month === '2' && values.day === '29' && <FieldHint>In years without 29 February, Aura marks it on 28 February.</FieldHint>}
      </div>
      <div>
        <FieldLabel htmlFor={`${prefix}-reminder`}>Remind me in Aura</FieldLabel>
        <SelectInput id={`${prefix}-reminder`} value={values.reminder} onChange={(e) => { setReminderTouched(true); set({ reminder: e.target.value }); }}>
          {reminderChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </SelectInput>
        <FieldHint>Shown in My People only. Aura doesn&apos;t send notifications for special days.</FieldHint>
      </div>
      <div style={{ display: 'flex', gap: spacing.sm }}>
        <PrimaryButton type="submit" disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save day'}</PrimaryButton>
        <SecondaryButton onClick={onCancel} style={{ flex: 1 }}>Cancel</SecondaryButton>
      </div>
      {error && <div style={theme.errorBoxStyle} role="alert">{error}</div>}
    </form>
  );
}

const rowButtonStyle: React.CSSProperties = {
  display: 'flex',
  gap: spacing.md,
  alignItems: 'flex-start',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  padding: `${spacing.md}px ${spacing.lg}px`,
  cursor: 'pointer',
  color: 'inherit',
  font: 'inherit',
};
