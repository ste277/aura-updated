'use client';

import { useEffect, useState } from 'react';
import { getMinuteOfDayInTimezone } from './timezone';

/** Current minute-of-day (0-1439) *in the given timezone*, re-computed every 30s.
 * Deliberately not based on the browser's own local clock — see lib/timezone.ts. */
export function useCurrentMinuteOfDay(timezone: string): number {
  const [minute, setMinute] = useState(() => getMinuteOfDayInTimezone(timezone, new Date()));

  useEffect(() => {
    setMinute(getMinuteOfDayInTimezone(timezone, new Date())); // recompute immediately on timezone change
    const id = setInterval(() => {
      setMinute(getMinuteOfDayInTimezone(timezone, new Date()));
    }, 30_000);
    return () => clearInterval(id);
  }, [timezone]);

  return minute;
}
