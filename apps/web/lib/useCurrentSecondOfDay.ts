'use client';

import { useEffect, useState } from 'react';
import { getSecondOfDayInTimezone } from './timezone';

/** Current second-of-day (0-86399) in the given timezone, ticking every second. */
export function useCurrentSecondOfDay(timezone: string): number {
  const [second, setSecond] = useState(() => getSecondOfDayInTimezone(timezone, new Date()));

  useEffect(() => {
    setSecond(getSecondOfDayInTimezone(timezone, new Date()));
    const id = setInterval(() => {
      setSecond(getSecondOfDayInTimezone(timezone, new Date()));
    }, 1_000);
    return () => clearInterval(id);
  }, [timezone]);

  return second;
}
