'use client';

import React from 'react';
import { SegmentedControl } from './ui';

/**
 * The [Calendar][Muhurtham] toggle (brief section 12/39) shared by
 * PanchangCalendarView and MuhurthamFinderView, so both entry points render
 * an identical control rather than two near-duplicate ones. Aura UI
 * Experience V2: now a thin wrapper around the ONE shared SegmentedControl
 * primitive (components/ui.tsx) instead of its own bespoke pill styling --
 * same prop API as before, so neither call site needed to change.
 */
export function ExploreModeToggle({ active, onSelectCalendar, onSelectMuhurtham }: { active: 'calendar' | 'muhurtham'; onSelectCalendar?: () => void; onSelectMuhurtham?: () => void }) {
  return (
    <SegmentedControl
      options={[
        { value: 'calendar' as const, label: <>📅 Calendar</> },
        { value: 'muhurtham' as const, label: <>🔎 Muhurtham</> },
      ]}
      value={active}
      onChange={(next) => (next === 'calendar' ? onSelectCalendar?.() : onSelectMuhurtham?.())}
    />
  );
}
