'use client';

import React, { useEffect, useState } from 'react';
import { INTENTION_GROUPS, DailyIntentionGroupId } from '../lib/dailyIntentions';
import { USER_PRIORITY_GROUPS, UserPriorityGroup } from '../lib/dayBuilder';
import { trackEvent } from '../lib/trackEvent';

/**
 * Intentional Day Builder V1 (brief section 6/35) -- the minimal preference
 * surface: a single master toggle plus which real taxonomy groups are
 * muted from proactive suggestions. Same toggle-switch visual pattern as
 * ReminderSettings, reused rather than reinvented. LIFE is excluded from
 * the checklist -- it isn't a first-level Day Builder candidate group
 * either (see dailyIntentions.ts's own note: not surfaced as a broad
 * choice in V1), so there's nothing for muting it to actually do.
 *
 * Personalization Foundation V1 adds two more, both editable here (brief
 * section 5: "Preferences must also be editable under: You -> Planning"):
 * explicit priorities (max 3) and an optional "make more time for" person
 * list, reusing the user's own already-saved People (no new person model).
 */

const DISPLAY_GROUPS = INTENTION_GROUPS.filter((g) => g.id !== 'LIFE');
const MAX_PRIORITIES = 3;
const MAX_PRIORITY_PEOPLE = 3;

interface PersonOption {
  id: string;
  name: string;
}

export function DayBuilderSettings({
  enabled,
  mutedGroups,
  priorities,
  priorityPersonIds,
  onChange,
}: {
  enabled: boolean;
  mutedGroups: string[];
  priorities: string[];
  priorityPersonIds: string[];
  onChange: (
    next: Partial<{
      dayBuilderEnabled: boolean;
      dayBuilderMutedGroups: string[];
      dayBuilderPriorities: string[];
      dayBuilderPriorityPersonIds: string[];
    }>
  ) => void;
}) {
  const mutedSet = new Set(mutedGroups);
  const prioritySet = new Set(priorities);
  const priorityPersonSet = new Set(priorityPersonIds);
  const [people, setPeople] = useState<PersonOption[] | null>(null);

  useEffect(() => {
    if (!enabled || people !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/people');
        const data = await res.json().catch(() => []);
        if (!cancelled) setPeople(res.ok && Array.isArray(data) ? data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })) : []);
      } catch {
        if (!cancelled) setPeople([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, people]);

  const toggleGroup = (id: DailyIntentionGroupId) => {
    const next = new Set(mutedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ dayBuilderMutedGroups: Array.from(next) });
  };

  const togglePriority = (id: UserPriorityGroup) => {
    const next = new Set(prioritySet);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < MAX_PRIORITIES) {
      next.add(id);
    } else {
      return;
    }
    const nextArray = Array.from(next);
    trackEvent('PERSONALIZATION_PREFERENCES_UPDATED', { metadata: { priorityCount: nextArray.length, hasPriorityPerson: priorityPersonSet.size > 0 } });
    onChange({ dayBuilderPriorities: nextArray });
  };

  const togglePriorityPerson = (id: string) => {
    const next = new Set(priorityPersonSet);
    if (next.has(id)) {
      next.delete(id);
    } else if (next.size < MAX_PRIORITY_PEOPLE) {
      next.add(id);
    } else {
      return;
    }
    const nextArray = Array.from(next);
    trackEvent('PERSONALIZATION_PREFERENCES_UPDATED', { metadata: { priorityCount: prioritySet.size, hasPriorityPerson: nextArray.length > 0 } });
    onChange({ dayBuilderPriorityPersonIds: nextArray });
  };

  return (
    <div
      style={{
        background: 'rgba(30, 41, 59, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 14,
        padding: 16,
        marginBottom: 10,
      }}
    >
      <span style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.05em', fontWeight: 600 }}>
        Day Builder
      </span>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '6px 0 12px', lineHeight: 1.4 }}>
        Aura can suggest up to 3 meaningful things for today, each with a real time already found -- only when your day genuinely has room.
      </p>

      <button
        type="button"
        onClick={() => onChange({ dayBuilderEnabled: !enabled })}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minHeight: 32, width: '100%' }}
      >
        <div>
          <div style={{ fontSize: 13, color: '#e2e8f0' }}>Suggest what to make room for</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>Shown on Home, in your Daily Story</div>
        </div>
        <div style={{ width: 40, height: 22, borderRadius: 11, flexShrink: 0, background: enabled ? '#1f4d34' : 'rgba(255,255,255,0.08)', border: `1px solid ${enabled ? '#4ade80' : 'rgba(255,255,255,0.15)'}`, position: 'relative', transition: 'background 0.15s' }}>
          <div style={{ position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: enabled ? '#4ade80' : '#94a3b8', transition: 'left 0.15s' }} />
        </div>
      </button>

      {enabled && (
        <>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>What matters most lately (up to 3)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {USER_PRIORITY_GROUPS.map((group) => {
                const active = prioritySet.has(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => togglePriority(group.id)}
                    aria-pressed={active}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: `1px solid ${active ? 'rgba(74, 222, 128, 0.4)' : 'rgba(255, 255, 255, 0.14)'}`,
                      background: active ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                      color: active ? '#4ade80' : '#cbd5e1',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <span>{group.icon}</span>
                    <span>{group.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {people && people.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Make more time for (optional)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {people.map((person) => {
                  const active = priorityPersonSet.has(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => togglePriorityPerson(person.id)}
                      aria-pressed={active}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        border: `1px solid ${active ? 'rgba(74, 222, 128, 0.4)' : 'rgba(255, 255, 255, 0.14)'}`,
                        background: active ? 'rgba(74, 222, 128, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                        color: active ? '#4ade80' : '#cbd5e1',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>Never suggest</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DISPLAY_GROUPS.map((group) => {
                const muted = mutedSet.has(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-pressed={muted}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: `1px solid ${muted ? 'rgba(251, 113, 133, 0.4)' : 'rgba(255, 255, 255, 0.14)'}`,
                      background: muted ? 'rgba(251, 113, 133, 0.1)' : 'rgba(255, 255, 255, 0.04)',
                      color: muted ? '#fb7185' : '#cbd5e1',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    <span>{group.icon}</span>
                    <span style={{ textDecoration: muted ? 'line-through' : 'none' }}>{group.broadLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
