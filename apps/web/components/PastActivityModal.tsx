'use client';

import React, { useMemo, useRef, useState } from 'react';
import { colors, radius, spacing, typography } from './theme';
import { ModalShell, useModalA11y, PrimaryButton, SecondaryButton, ActivityChip, FieldLabel, FieldHint, TextInput, TextAreaInput, SelectInput } from './ui';

interface PastActivityModalProps {
  isOpen?: boolean;
  initialDate?: Date;
  selectedDate?: Date;
  recentActivities?: string[];
  userLocation?: { latitude: number; longitude: number; timezone: string };
  onClose: () => void;
  onConfirmLog?: (
    activityTitle: string,
    notes?: string,
    customTimestamp?: Date,
    overrideWindowType?: string,
    durationMinutes?: number,
    logSource?: 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION',
    activitySignificance?: 'LOW' | 'MEDIUM' | 'HIGH'
  ) => Promise<void>;
  onSuccess?: () => void;
}

const SIGNIFICANCE_OPTIONS: Array<{ value: 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH'; label: string }> = [
  { value: 'AUTO', label: 'Auto' },
  { value: 'LOW', label: 'Light' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High impact' },
];

const QUICK_TIME_OFFSETS: Array<{ label: string; offset: number }> = [
  { label: 'Now', offset: 0 },
  { label: '15m ago', offset: 15 },
  { label: '30m ago', offset: 30 },
];

export function PastActivityModal({
  isOpen = true,
  initialDate,
  selectedDate,
  recentActivities = [],
  onClose,
  onConfirmLog,
  onSuccess,
}: PastActivityModalProps) {
  const [selectedChip, setSelectedChip] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [activitySignificance, setActivitySignificance] = useState<'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH'>('AUTO');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const activityInputRef = useRef<HTMLInputElement | null>(null);

  const [logTime, setLogTime] = useState(() => {
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
  });

  const [submitting, setSubmitting] = useState(false);
  const baseDate = selectedDate || initialDate || new Date();

  useModalA11y({ isOpen, onClose, dialogRef, initialFocusRef: activityInputRef });

  const activeSuggestions = useMemo(() => {
    const common = ['Deep Work', 'Exercise', 'Meeting', 'Break', 'Reading', 'Family Time'];
    return [...new Set([...recentActivities, ...common])].slice(0, 6);
  }, [recentActivities]);

  const isFutureTimestamp = useMemo(() => {
    const [hours, minutes] = logTime.split(':').map(Number);
    const target = new Date(baseDate);
    target.setHours(hours || 0, minutes || 0, 0, 0);
    return target.getTime() > Date.now();
  }, [baseDate, logTime]);

  if (!isOpen) return null;

  const activeTitle = customTitle.trim() || selectedChip;

  const handleChipSelect = (title: string) => {
    if (selectedChip === title && !customTitle) {
      setSelectedChip('');
    } else {
      setSelectedChip(title);
      setCustomTitle('');
    }
  };

  const handleQuickTimeOffset = (minutesOffset: number) => {
    const d = new Date();
    if (minutesOffset !== 0) {
      d.setMinutes(d.getMinutes() - minutesOffset);
    }
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    setLogTime(`${hrs}:${mins}`);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTitle || submitting || isFutureTimestamp) return;

    setSubmitting(true);

    try {
      const [hours, minutes] = logTime.split(':').map(Number);
      const targetTimestamp = new Date(baseDate);
      targetTimestamp.setHours(hours || 12, minutes || 0, 0, 0);
      const cleanNotes = notes.trim();
      const explicitSignificance = activitySignificance === 'AUTO' ? undefined : activitySignificance;

      if (onConfirmLog) {
        await onConfirmLog(activeTitle, cleanNotes, targetTimestamp, undefined, durationMinutes, 'MANUAL', explicitSignificance);
      } else {
        // Insights Correctness + Historical Integrity V1 -- activeWindow is
        // no longer sent here at all: POST /api/habit-logs now always
        // computes it server-side from logTimestamp + the owner's own
        // Timing Location (apps/web/lib/historicalActivityWindow.ts),
        // never trusting a client-supplied value. This block only runs
        // when the caller omits onConfirmLog (not the case in the current
        // app -- CalendarViewSection.tsx always wires onConfirmLog to
        // page.tsx's handleLogActivity), kept as a defensive fallback.
        const res = await fetch('/api/habit-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activityTitle: activeTitle,
            logMinuteOfDay: (hours || 12) * 60 + (minutes || 0),
            logTimestamp: targetTimestamp.toISOString(),
            durationMinutes,
            notes: cleanNotes,
            activitySignificance: explicitSignificance,
          }),
        });

        if (!res.ok) throw new Error('Failed to save log');
      }

      setCustomTitle('');
      setSelectedChip('');
      setNotes('');
      setActivitySignificance('AUTO');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving activity log:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const dateFormatted = baseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <ModalShell
      dialogRef={dialogRef}
      labelledBy="quick-log-title"
      describedBy="quick-log-date"
      title="Quick Log"
      description={dateFormatted}
      onClose={onClose}
      maxWidth={400}
    >
      <form onSubmit={handleSubmit}>
        {/* When -- quick offsets + a native time input */}
        <div style={{ marginBottom: spacing.xl }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <FieldLabel>When?</FieldLabel>
            <div style={{ display: 'flex', gap: spacing.xs }}>
              {QUICK_TIME_OFFSETS.map(({ label, offset }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleQuickTimeOffset(offset)}
                  style={{
                    background: colors.surfaceSubtle,
                    border: `1px solid ${colors.borderSubtle}`,
                    borderRadius: radius.sm,
                    color: colors.textMuted,
                    fontSize: 11,
                    padding: '4px 9px',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <TextInput
            type="time"
            value={logTime}
            onChange={(e) => setLogTime(e.target.value)}
            hasError={isFutureTimestamp}
            style={{ fontSize: 15, fontWeight: 700, colorScheme: 'dark' }}
          />

          {isFutureTimestamp && <FieldHint>Cannot log activities for a future time.</FieldHint>}
        </div>

        {/* Duration */}
        <div style={{ marginBottom: spacing.xl }}>
          <FieldLabel>Duration</FieldLabel>
          <SelectInput value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))}>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
            <option value={90}>90 minutes</option>
          </SelectInput>
        </div>

        {/* Window -- significance (impact) */}
        <div style={{ marginBottom: spacing.xl }}>
          <FieldLabel>Significance</FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
            {SIGNIFICANCE_OPTIONS.map((option) => (
              <ActivityChip
                key={option.value}
                label={option.label}
                onClick={() => setActivitySignificance(option.value)}
                selected={activitySignificance === option.value}
              />
            ))}
          </div>
          <FieldHint>Auto lets Aura infer impact from the activity title.</FieldHint>
        </div>

        {/* Activity */}
        <div style={{ marginBottom: spacing.xl }}>
          <FieldLabel>Recent &amp; common</FieldLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
            {activeSuggestions.map((suggestion) => {
              const isSelected = selectedChip === suggestion && !customTitle;
              return (
                <ActivityChip key={suggestion} label={suggestion} onClick={() => handleChipSelect(suggestion)} selected={isSelected} />
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: spacing.xl }}>
          <FieldLabel htmlFor="quick-log-activity">What did you do?</FieldLabel>
          <TextInput
            id="quick-log-activity"
            ref={activityInputRef}
            type="text"
            value={customTitle}
            onChange={(e) => {
              setCustomTitle(e.target.value);
              if (e.target.value) setSelectedChip('');
            }}
            placeholder="e.g., Code Review, Family Time"
            active={Boolean(customTitle)}
          />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: spacing.xxl }}>
          <FieldLabel htmlFor="quick-log-notes">Notes</FieldLabel>
          <TextAreaInput
            id="quick-log-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional context, outcome, or reflection"
            rows={3}
            active={Boolean(notes.trim())}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm }}>
          <SecondaryButton onClick={onClose} style={{ background: 'transparent', borderColor: colors.borderDefault, color: colors.textMuted }}>
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={submitting || !activeTitle || isFutureTimestamp} loading={submitting}>
            {isFutureTimestamp
              ? 'Cannot log future time'
              : activeTitle
              ? `Save "${activeTitle.length > 14 ? activeTitle.slice(0, 14) + '...' : activeTitle}"`
              : 'Save activity'}
          </PrimaryButton>
        </div>
      </form>
    </ModalShell>
  );
}

export default PastActivityModal;
