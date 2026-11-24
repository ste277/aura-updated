'use client';

import React from 'react';
import { colors, spacing, typography } from './theme';
import { TextButton } from './ui';
import { goalActivityRhythmHref } from '../lib/rhythmPreferencesDraft';
import { formatNextOccurrenceLabel, formatPausedRhythmLabel, type HomePausedGoalRhythm } from '../lib/homeGoalRhythmSuggestions';

/**
 * AURA-MR2 -- Home's paused-rhythm lines, shown under "Your rhythm this week".
 * A paused rhythm is displayed as paused and is never offered as a
 * suggestion; an already-confirmed session (a real plan) is still shown, and
 * labelled Confirmed.
 */
export function PausedRhythmsNote({ pausedRhythms, timezone }: { pausedRhythms: readonly HomePausedGoalRhythm[]; timezone: string }) {
  return (
    <div style={{ marginTop: spacing.sm }}>
      {pausedRhythms.map((paused) => (
        <div key={paused.goalActivityId} style={{ ...typography.caption, color: colors.textMuted, marginTop: 2 }}>
          {formatPausedRhythmLabel(paused)}
          {paused.nextOccurrence ? ` — ${formatNextOccurrenceLabel(paused.nextOccurrence, timezone)}` : ''}{' '}
          {/* AURA-MR3 -- Resume (and every other rhythm setting) lives on the goal activity. */}
          <TextButton onClick={() => { window.location.href = goalActivityRhythmHref(paused.goalId, paused.goalActivityId); }} style={{ minHeight: 44, padding: '0 4px', fontSize: 12 }}>
            Resume or edit
          </TextButton>
        </div>
      ))}
      <div style={{ ...typography.caption, color: colors.textMuted, marginTop: 2 }}>Paused rhythms aren&rsquo;t suggested. Sessions already planned stay as they are.</div>
    </div>
  );
}
