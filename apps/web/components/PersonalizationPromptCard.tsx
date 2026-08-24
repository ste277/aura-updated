'use client';

import React, { useEffect, useRef, useState } from 'react';
import { USER_PRIORITY_GROUPS, UserPriorityGroup } from '../lib/dayBuilder';
import { trackEvent } from '../lib/trackEvent';
import { colors, spacing, radius, typography } from './theme';
import { PrimaryButton, TextButton, ActivityChip } from './ui';

/**
 * Personalization Foundation V1 -- the one-time "What matters most
 * lately?" nudge (brief section 5). Deliberately NOT a questionnaire:
 * one screen, multi-select (max 3), Save or Maybe later. Once configured
 * (dayBuilderPriorities non-empty) or explicitly dismissed
 * (dayBuilderPrioritiesPromptDismissed), this renders nothing at all --
 * never shown "prominently every day" (brief section 5). Editing later
 * always remains available under You -> Day Builder (DayBuilderSettings.tsx).
 */

const MAX_PRIORITIES = 3;

export function PersonalizationPromptCard({
  dayBuilderEnabled,
  dayBuilderPriorities,
  dayBuilderPrioritiesPromptDismissed,
  onChange,
}: {
  dayBuilderEnabled: boolean;
  dayBuilderPriorities: string[];
  dayBuilderPrioritiesPromptDismissed: boolean;
  onChange: (next: Partial<{ dayBuilderPriorities: string[]; dayBuilderPrioritiesPromptDismissed: boolean }>) => void;
}) {
  const [selected, setSelected] = useState<Set<UserPriorityGroup>>(new Set());
  const [saving, setSaving] = useState(false);
  const viewedTracked = useRef(false);

  const shouldShow = dayBuilderEnabled && dayBuilderPriorities.length === 0 && !dayBuilderPrioritiesPromptDismissed;

  useEffect(() => {
    if (shouldShow && !viewedTracked.current) {
      trackEvent('PERSONALIZATION_PROMPT_VIEWED', {});
      viewedTracked.current = true;
    }
  }, [shouldShow]);

  if (!shouldShow) return null;

  const toggle = (id: UserPriorityGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PRIORITIES) next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    const priorities = Array.from(selected);
    trackEvent('PERSONALIZATION_PREFERENCES_SAVED', { metadata: { priorityCount: priorities.length, hasPriorityPerson: false } });
    onChange({ dayBuilderPriorities: priorities, dayBuilderPrioritiesPromptDismissed: true });
  };

  const handleMaybeLater = () => {
    onChange({ dayBuilderPrioritiesPromptDismissed: true });
  };

  return (
    <section style={{ background: colors.surfaceSubtle, border: `1px solid ${colors.borderSubtle}`, borderRadius: radius.lg, padding: spacing.lg }}>
      <div style={{ ...typography.bodyStrong }}>What matters most lately?</div>
      <p style={{ ...typography.caption, color: colors.textFaint, marginTop: 4, lineHeight: 1.4 }}>
        Pick up to 3 — Aura will lean toward these when suggesting what to make room for.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
        {USER_PRIORITY_GROUPS.map((g) => (
          <ActivityChip key={g.id} label={g.label} icon={g.icon} selected={selected.has(g.id)} onClick={() => toggle(g.id)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' }}>
        <PrimaryButton onClick={handleSave} disabled={saving || selected.size === 0}>
          {saving ? 'Saving…' : 'Save preferences'}
        </PrimaryButton>
        <TextButton onClick={handleMaybeLater} color={colors.textMuted}>
          Maybe later
        </TextButton>
      </div>
    </section>
  );
}
