'use client';

import { useState } from 'react';
import type { SolarWindowType } from '../../../packages/panchang/src/windows';

export interface HabitData {
  id: string;
  title: string;
  category: string;
  targetWindowType: string;
  currentStreak: number;
  longestStreak: number;
}

interface HabitsSectionProps {
  habits: HabitData[];
  onCreate: (input: { title: string; category: string; targetWindowType: string }) => Promise<void>;
  onLog: (habitId: string) => Promise<void>;
  onArchive: (habitId: string) => Promise<void>;
  todayLoggedHabitIds: Set<string>;
}

const CATEGORY_OPTIONS = ['WORKOUT', 'MEAL', 'MICRO_BREAK', 'FOCUS', 'REST'];
const WINDOW_OPTIONS: SolarWindowType[] = ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL'];

export function HabitsSection({ habits, onCreate, onLog, onArchive, todayLoggedHabitIds }: HabitsSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]);
  const [targetWindowType, setTargetWindowType] = useState<SolarWindowType>('NEUTRAL');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    await onCreate({ title: title.trim(), category, targetWindowType });
    setSaving(false);
    setTitle('');
    setShowForm(false);
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span
          style={{
            fontFamily: 'var(--as-font-mono)',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--as-text-muted)',
          }}
        >
          Your habits
        </span>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          style={{ fontSize: 11, color: 'var(--as-gulika)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {showForm ? 'Cancel' : '+ Add custom habit'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--as-surface-raised)',
            padding: 10,
            borderRadius: 8,
            border: '1px solid var(--as-border)',
            marginBottom: 12,
          }}
        >
          <input
            required
            placeholder="Habit name (e.g. Journal)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={formInputStyle}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={formInputStyle}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={targetWindowType}
              onChange={(e) => setTargetWindowType(e.target.value as SolarWindowType)}
              style={formInputStyle}
            >
              {WINDOW_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            style={{ ...formInputStyle, cursor: 'pointer', background: 'var(--as-abhijit-dim, #1f4d34)', color: 'var(--as-abhijit, #4ade80)' }}
          >
            {saving ? 'Saving...' : 'Create habit'}
          </button>
        </form>
      )}

      {habits.length === 0 && !showForm && (
        <div style={{ fontSize: 13, color: 'var(--as-text-muted)' }}>
          No custom habits yet — the 3 suggested cards above cover the basics, or add your own.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {habits.map((h) => {
          const loggedToday = todayLoggedHabitIds.has(h.id);
          return (
            <div
              key={h.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--as-surface-raised)',
                border: '1px solid var(--as-border)',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              <div>
                <div style={{ fontFamily: 'var(--as-font-body)', fontSize: 14, color: 'var(--as-text)' }}>{h.title}</div>
                <div style={{ fontFamily: 'var(--as-font-mono)', fontSize: 11, color: 'var(--as-text-muted)' }}>
                  {h.currentStreak > 0 ? `🔥 ${h.currentStreak} day streak` : 'no streak yet'}
                  {h.longestStreak > h.currentStreak ? ` · best ${h.longestStreak}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => onLog(h.id)}
                  disabled={loggedToday}
                  style={{
                    fontSize: 12,
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--as-border)',
                    background: loggedToday ? 'var(--as-abhijit-dim, #1f4d34)' : 'transparent',
                    color: loggedToday ? 'var(--as-abhijit, #4ade80)' : 'var(--as-text)',
                    cursor: loggedToday ? 'default' : 'pointer',
                  }}
                >
                  {loggedToday ? 'Done today' : 'Log'}
                </button>
                <button
                  type="button"
                  onClick={() => onArchive(h.id)}
                  style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: 'none', background: 'none', color: 'var(--as-text-muted)', cursor: 'pointer' }}
                  title="Archive this habit"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const formInputStyle: React.CSSProperties = {
  fontFamily: 'var(--as-font-body)',
  fontSize: 13,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--as-border)',
  background: 'var(--as-surface)',
  color: 'var(--as-text)',
  flex: 1,
};
