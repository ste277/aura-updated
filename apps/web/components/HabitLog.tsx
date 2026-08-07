'use client';

import { computeStreak } from '../lib/streak';

export interface HabitLogEntry {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
}

interface HabitLogProps {
  entries: HabitLogEntry[];
}

export function HabitLog({ entries }: HabitLogProps) {
  const streak = computeStreak(entries);
  const recent = [...entries]
    .sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime())
    .slice(0, 20);

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--as-font-display)', fontSize: 22, color: 'var(--as-text)' }}>
          {streak}
        </span>
        <span style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, color: 'var(--as-text-muted)' }}>
          day streak
        </span>
      </div>

      {recent.length === 0 ? (
        <div style={{ fontFamily: 'var(--as-font-body)', fontSize: 13, color: 'var(--as-text-muted)' }}>
          Nothing logged yet today.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {recent.map((e) => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--as-font-body)',
                fontSize: 13,
                color: 'var(--as-text-muted)',
                borderBottom: '1px solid var(--as-border)',
                paddingBottom: 6,
              }}
            >
              <span style={{ color: 'var(--as-text)' }}>{e.activityTitle}</span>
              <span style={{ fontFamily: 'var(--as-font-mono)' }}>
                {e.loggedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
