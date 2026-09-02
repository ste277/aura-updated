import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';

/**
 * Home Compactness + Flexible Day Story V1 (brief section 4/5/6/7/8) --
 * Home must NOT render the entire day's agenda unconditionally
 * (YourDayTimeline.tsx used to `agenda.items.map(...)` with no cap at all).
 * This is a pure selection over the already-built DailyAgenda -- no new
 * fetch, no new derivation of status/timing, just which of the
 * already-computed rows are worth showing on Home.
 *
 * Selection (brief section 4): up to 2 most recent PAST items (COMPLETED
 * or MISSED), the next upcoming item, and an optional second upcoming
 * item, capped at MAX_COMPACT_ROWS total. A MISSED item is included in
 * that "recent past" bucket on equal footing with a COMPLETED one --
 * missedPlanRegression.spec.ts already establishes an existing, deliberate
 * guarantee that a MISSED item stays calmly visible on Home, never
 * silently disappearing -- but it is NEVER merged into the grouped
 * checkmark presentation (groupAdjacentByFormattedTime below, and the
 * component that calls it) that's reserved for genuine completions, so it
 * can never read as an accomplishment (brief section 5: "never
 * accidentally elevate MISSED activities into the compact completed list
 * as accomplishments" -- "distinct from completed", not "hidden").
 */

export const MAX_COMPACT_ROWS = 4;
const MAX_RECENT_PAST = 2;
const MAX_UPCOMING = 2;

export interface CompactAgendaSelection {
  /** Most-recent-first past items (COMPLETED/MISSED), then chronological
   * upcoming item(s) -- matches the brief's own worked example ordering. */
  rows: DailyAgendaItem[];
  /** Every agenda item NOT included in `rows` -- brief section 8's
   * "lightweight summary" count. */
  hiddenCount: number;
}

export function selectCompactAgendaRows(agenda: DailyAgenda | null | undefined): CompactAgendaSelection {
  if (!agenda || agenda.items.length === 0) return { rows: [], hiddenCount: 0 };

  const pastDesc = agenda.items
    .filter((item) => item.status === 'COMPLETED' || item.status === 'MISSED')
    .slice()
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())
    .slice(0, MAX_RECENT_PAST);

  // agenda.items is already chronologically sorted (dailyAgenda.ts), so a
  // plain filter preserves ascending order -- no re-sort needed.
  const upcoming = agenda.items.filter((item) => item.status !== 'COMPLETED' && item.status !== 'MISSED');

  const selectedUpcoming: DailyAgendaItem[] = [];
  if (upcoming[0]) selectedUpcoming.push(upcoming[0]);
  if (pastDesc.length + selectedUpcoming.length < MAX_COMPACT_ROWS && upcoming[1]) {
    selectedUpcoming.push(upcoming[1]);
  }
  // Defensive cap -- the two branches above already keep this within
  // MAX_COMPACT_ROWS by construction (2 + up to 2), but a future tweak to
  // MAX_RECENT_PAST/MAX_UPCOMING should never silently blow the budget.
  const rows = [...pastDesc, ...selectedUpcoming].slice(0, MAX_COMPACT_ROWS);

  return { rows, hiddenCount: agenda.items.length - rows.length };
}

/**
 * Brief section 9 -- audited: identical displayed timestamps across
 * multiple completed items are a legitimate real-precision artifact of
 * minute-only display formatting (see completion report), not a
 * persistence bug. This groups adjacent rows sharing the same FORMATTED
 * (minute-precision) time so the UI can render one time header over
 * several checkmarks instead of implying a sequence of separately-timed
 * events that didn't actually happen. Pure presentation grouping only --
 * never reorders items, never touches the underlying timestamps.
 */
export interface TimeGroupedRow {
  timeLabel: string;
  items: DailyAgendaItem[];
}

export function groupAdjacentByFormattedTime(items: DailyAgendaItem[], formatTime: (item: DailyAgendaItem) => string): TimeGroupedRow[] {
  const groups: TimeGroupedRow[] = [];
  for (const item of items) {
    const timeLabel = formatTime(item);
    const last = groups[groups.length - 1];
    if (last && last.timeLabel === timeLabel) {
      last.items.push(item);
    } else {
      groups.push({ timeLabel, items: [item] });
    }
  }
  return groups;
}

export { MAX_UPCOMING };
