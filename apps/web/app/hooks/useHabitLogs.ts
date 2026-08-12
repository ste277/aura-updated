import { useEffect, useState, useCallback } from 'react';

export interface LoggedEntryItem {
  id: string;
  activityTitle: string;
  activeWindow: string;
  loggedAt: Date;
  logMinuteOfDay: number;
  notes?: string | null;
}

export function useHabitLogs() {
  const [logs, setLogs] = useState<LoggedEntryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/habit-logs');
      if (res.ok) {
        const data = await res.json();
        const formatted = data.map((item: any) => ({
          id: item.id,
          activityTitle: item.activityTitle,
          activeWindow: item.activeWindow,
          loggedAt: new Date(item.logTimestamp),
          logMinuteOfDay: item.logMinuteOfDay,
          notes: item.notes,
        }));
        setLogs(formatted);
      }
    } catch (err) {
      console.error('Failed to load habit logs from DB:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const addLog = async (input: {
    activityTitle: string;
    activeWindow: string;
    logMinuteOfDay: number;
    logTimestamp?: Date;
    notes?: string;
  }) => {
    try {
      const res = await fetch('/api/habit-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (res.ok) {
        const newEntry = await res.json();
        const formattedEntry: LoggedEntryItem = {
          id: newEntry.id,
          activityTitle: newEntry.activityTitle,
          activeWindow: newEntry.activeWindow,
          loggedAt: new Date(newEntry.logTimestamp),
          logMinuteOfDay: newEntry.logMinuteOfDay,
          notes: newEntry.notes,
        };
        setLogs((prev) => [formattedEntry, ...prev]);
        return formattedEntry;
      }
    } catch (err) {
      console.error('Failed to save habit log to DB:', err);
      throw err;
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { logs, loading, refetch: fetchLogs, addLog };
}