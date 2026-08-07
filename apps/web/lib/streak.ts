export interface StreakableEntry {
  loggedAt: Date;
}

/** Consecutive-day streak counting back from today, based on distinct log dates. */
export function computeStreak(entries: StreakableEntry[]): number {
  const days = new Set(entries.map((e) => e.loggedAt.toDateString()));
  let streak = 0;
  const cursor = new Date();
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
