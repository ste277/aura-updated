'use client';

/**
 * AURA-MP-4 (62025) -- "Keep in touch" on a person's page: their
 * Relationship Rhythms (ordinary weekly Life Rhythms linked to this person).
 *
 * Nothing is created until the user fills the form and taps Save: the goal
 * is either a NEW visible goal whose (editable) title they can see, or an
 * existing active goal they pick. Edit / pause / resume / remove use the
 * existing Life Rhythm routes; Aura then proposes times for the rhythm
 * through the existing weekly suggestions, which the user still confirms.
 * Wording is factual: no scores, streaks or "you haven't".
 */
import React, { useEffect, useState } from 'react';
import { colors, spacing, typography } from './theme';
import * as theme from './theme';
import { SurfaceCard, PrimaryButton, SecondaryButton, TextButton, DestructiveButton, FieldLabel, FieldHint, TextInput, SelectInput } from './ui';
import {
  RELATIONSHIP_RHYTHM_CHOICES,
  RELATIONSHIP_RHYTHM_TARGETS,
  defaultRelationshipGoalTitle,
  relationshipRhythmCadence,
  relationshipRhythmChoice,
  type RelationshipRhythmChoice,
} from '../lib/myPeopleRhythms';

export interface PersonRhythmRow {
  id: string;
  goalId: string;
  goalTitle: string | null;
  title: string;
  targetPerWeek: number | null;
  paused: boolean;
}

async function send(method: 'POST' | 'PATCH', url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Something went wrong. Nothing was changed.');
  }
  return res.json().catch(() => null);
}

export function KeepInTouchSection({ personId, personName }: { personId: string; personName: string }) {
  const [rows, setRows] = useState<PersonRhythmRow[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/people/${personId}/rhythms`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [personId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const act = async (row: PersonRhythmRow, what: 'PAUSE' | 'RESUME' | 'REMOVE') => {
    setError('');
    setBusy(row.id);
    try {
      if (what === 'REMOVE') await send('POST', `/api/goals/${row.goalId}/activities/${row.id}/dismiss`, { savedPersonId: personId });
      // savedPersonId: the person this was done for -- if they were removed
      // meanwhile, the server refuses (409) instead of resuming a paused rhythm.
      else await send('PATCH', `/api/goals/${row.goalId}/activities/${row.id}/rhythm`, { paused: what === 'PAUSE', savedPersonId: personId });
      setConfirmingRemove(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Nothing was changed.');
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <SurfaceCard>
      <div style={typography.sectionEyebrow}>Keep in touch</div>
      {rows !== null && rows.length === 0 && !adding && (
        <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: spacing.sm, lineHeight: 1.6 }}>
          Set up something you&apos;d like to do with {personName} regularly, such as a weekly call. Aura suggests times that fit your week; you choose.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md, marginTop: spacing.sm }}>
        {(rows ?? []).map((r) =>
          editingId === r.id ? (
            <EditRhythmForm key={r.id} row={r} personId={personId} onDone={() => { setEditingId(null); reload(); }} onCancel={() => setEditingId(null)} />
          ) : (
            <div key={r.id} data-testid="person-rhythm" style={{ display: 'flex', gap: spacing.md, alignItems: 'flex-start' }}>
              <span aria-hidden style={{ fontSize: 20, lineHeight: '24px' }}>🔁</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: colors.textPrimary, overflowWrap: 'anywhere' }}>{r.title}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  {relationshipRhythmCadence(r.targetPerWeek)}{r.paused ? ' · Paused' : ''}
                </div>
                {r.goalTitle && <div style={{ fontSize: 12, color: colors.textFaint, marginTop: 2, overflowWrap: 'anywhere' }}>Goal: {r.goalTitle}</div>}
                {confirmingRemove === r.id ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: colors.textSecondary }}>Stop this rhythm? Plans already made stay as they are.</span>
                    <DestructiveButton disabled={busy === r.id} onClick={() => act(r, 'REMOVE')}>Yes, remove</DestructiveButton>
                    <SecondaryButton onClick={() => setConfirmingRemove(null)}>Keep</SecondaryButton>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.xs }}>
                    <TextButton onClick={() => { setConfirmingRemove(null); setEditingId(r.id); }}>Edit</TextButton>
                    <TextButton disabled={busy === r.id} onClick={() => act(r, r.paused ? 'RESUME' : 'PAUSE')}>{r.paused ? 'Resume' : 'Pause'}</TextButton>
                    <TextButton onClick={() => setConfirmingRemove(r.id)}>Remove</TextButton>
                  </div>
                )}
              </div>
            </div>
          )
        )}
      </div>
      {adding && <NewRhythmForm personId={personId} personName={personName} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
      {!adding && rows !== null && (
        <SecondaryButton onClick={() => { setEditingId(null); setAdding(true); }} style={{ marginTop: spacing.md, width: '100%' }}>
          + Keep in touch with {personName}
        </SecondaryButton>
      )}
      {error && <div style={{ ...theme.errorBoxStyle, marginTop: spacing.sm }}>{error}</div>}
    </SurfaceCard>
  );
}

function TargetSelect({ id, value, onChange }: { id: string; value: number; onChange: (n: number) => void }) {
  return (
    <SelectInput id={id} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
      {RELATIONSHIP_RHYTHM_TARGETS.map((n) => <option key={n} value={n}>{relationshipRhythmCadence(n)}</option>)}
    </SelectInput>
  );
}

function NewRhythmForm({ personId, personName, onDone, onCancel }: { personId: string; personName: string; onDone: () => void; onCancel: () => void }) {
  const [choice, setChoice] = useState<RelationshipRhythmChoice>('CALL');
  const [title, setTitle] = useState(relationshipRhythmChoice('CALL')!.titleFor(personName));
  const [titleTouched, setTitleTouched] = useState(false);
  const [target, setTarget] = useState(1);
  const [goalMode, setGoalMode] = useState<'NEW' | 'EXISTING'>('NEW');
  const [goalTitle, setGoalTitle] = useState(defaultRelationshipGoalTitle(personName));
  const [goals, setGoals] = useState<Array<{ id: string; title: string }>>([]);
  const [goalId, setGoalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/goals')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => { if (!cancelled && Array.isArray(data)) setGoals(data.map((g: any) => ({ id: g.id, title: g.title }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const pick = (next: RelationshipRhythmChoice) => {
    setChoice(next);
    if (!titleTouched) setTitle(relationshipRhythmChoice(next)!.titleFor(personName));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('Give this rhythm a name.'); return; }
    if (goalMode === 'NEW' && !goalTitle.trim()) { setError('Give the goal a name.'); return; }
    if (goalMode === 'EXISTING' && !goalId) { setError('Choose a goal.'); return; }
    setSaving(true);
    try {
      await send('POST', `/api/people/${personId}/rhythms`, {
        choice,
        title: title.trim(),
        targetPerWeek: target,
        goal: goalMode === 'NEW' ? { kind: 'NEW', title: goalTitle.trim() } : { kind: 'EXISTING', goalId },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Nothing was changed.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} data-testid="person-rhythm-form" style={{ ...theme.cellStyle, display: 'flex', flexDirection: 'column', gap: spacing.md, padding: spacing.md, marginTop: spacing.md }}>
      <div>
        <FieldLabel htmlFor="rhythm-choice">What would you like to do?</FieldLabel>
        <SelectInput id="rhythm-choice" value={choice} onChange={(e) => pick(e.target.value as RelationshipRhythmChoice)}>
          {RELATIONSHIP_RHYTHM_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </SelectInput>
      </div>
      <div>
        <FieldLabel htmlFor="rhythm-title">Name</FieldLabel>
        <TextInput id="rhythm-title" value={title} maxLength={200} onChange={(e) => { setTitleTouched(true); setTitle(e.target.value); }} />
      </div>
      <div>
        <FieldLabel htmlFor="rhythm-target">How often?</FieldLabel>
        <TargetSelect id="rhythm-target" value={target} onChange={setTarget} />
      </div>
      <div>
        <FieldLabel htmlFor="rhythm-goal-mode">Goal</FieldLabel>
        <SelectInput id="rhythm-goal-mode" value={goalMode} onChange={(e) => setGoalMode(e.target.value as 'NEW' | 'EXISTING')}>
          <option value="NEW">Create a new goal</option>
          {goals.length > 0 && <option value="EXISTING">Add to one of my goals</option>}
        </SelectInput>
        {goalMode === 'NEW' ? (
          <div style={{ marginTop: spacing.sm }}>
            <FieldLabel htmlFor="rhythm-goal-title">Goal name</FieldLabel>
            <TextInput id="rhythm-goal-title" value={goalTitle} maxLength={200} onChange={(e) => setGoalTitle(e.target.value)} />
            <FieldHint>This goal appears in your Goals, where you can rename or archive it.</FieldHint>
          </div>
        ) : (
          <div style={{ marginTop: spacing.sm }}>
            <FieldLabel htmlFor="rhythm-goal-id">Which goal?</FieldLabel>
            <SelectInput id="rhythm-goal-id" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">Choose a goal…</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </SelectInput>
          </div>
        )}
      </div>
      <FieldHint>Aura suggests times from your own calendar, rhythm and Panchang. Check that they work for {personName} too.</FieldHint>
      {error && <div style={theme.errorBoxStyle}>{error}</div>}
      <div style={{ display: 'flex', gap: spacing.sm }}>
        <SecondaryButton type="button" onClick={onCancel} style={{ flex: 1 }}>Cancel</SecondaryButton>
        <PrimaryButton type="submit" disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
      </div>
    </form>
  );
}

function EditRhythmForm({ row, personId, onDone, onCancel }: { row: PersonRhythmRow; personId: string; onDone: () => void; onCancel: () => void }) {
  const [target, setTarget] = useState(row.targetPerWeek ?? 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (target === row.targetPerWeek) { onDone(); return; }
    setSaving(true);
    setError('');
    try {
      await send('PATCH', `/api/goals/${row.goalId}/activities/${row.id}/rhythm`, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: target }, savedPersonId: personId });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Nothing was changed.');
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} data-testid="person-rhythm-edit" style={{ ...theme.cellStyle, display: 'flex', flexDirection: 'column', gap: spacing.md, padding: spacing.md }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: colors.textPrimary, overflowWrap: 'anywhere' }}>{row.title}</div>
      <div>
        <FieldLabel htmlFor={`rhythm-edit-${row.id}`}>How often?</FieldLabel>
        <TargetSelect id={`rhythm-edit-${row.id}`} value={target} onChange={setTarget} />
        <FieldHint>Preferred days and times can be changed in Goals.</FieldHint>
      </div>
      {error && <div style={theme.errorBoxStyle}>{error}</div>}
      <div style={{ display: 'flex', gap: spacing.sm }}>
        <SecondaryButton type="button" onClick={onCancel} style={{ flex: 1 }}>Cancel</SecondaryButton>
        <PrimaryButton type="submit" disabled={saving} style={{ flex: 1 }}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
      </div>
    </form>
  );
}
