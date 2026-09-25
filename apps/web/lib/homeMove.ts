/**
 * Daily Experience V1 PR D3 -- Home Move: an ACCESS POINT to the existing Move
 * lifecycle (POST /api/plans/[planId]/move -> movePlannedActivity, D2), never a
 * second scheduling implementation. Home picks an EXACT destination time; the
 * server owns conflicts, lifecycle state, linked Moments, the DB-clock future
 * check, and the source-continuity repoint. Nothing here touches Captures,
 * Goals, HabitLogs or plan timestamps. Pure/injectable so it is testable
 * without a component harness (same pattern as homeCompletion).
 */
import { planToAgendaItem, type DailyAgenda, type DailyAgendaItem } from './dailyAgenda';
import type { PlannedActivity } from './db';
import type { HomeTimelineItem } from './homeTimelineTypes';
import { addDaysToDateStr, getDatePartsInTimezone, getMinuteOfDayInTimezone, resolveLocalDateTime } from './timezone';

// ---------------------------------------------------------------------------
// Destination selection (Today / Tomorrow + a minute-precision time)
// ---------------------------------------------------------------------------

export type MoveDay = 'TODAY' | 'TOMORROW';

export interface MoveSelection {
  day: MoveDay;
  /** "HH:MM" -- minute precision only; the picker never exposes seconds. */
  time: string;
}

const QUARTER_MS = 15 * 60_000;
const DEFAULT_LEAD_MS = 30 * 60_000;

/** "YYYY-MM-DD" of the chosen day in the Home timezone (canonical timezone utilities only). */
export function moveDayDate(day: MoveDay, now: Date, timezone: string): string {
  const today = getDatePartsInTimezone(timezone, now).dateStr;
  return day === 'TODAY' ? today : addDaysToDateStr(today, 1);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Quarter-hour steps searched for a default: 24 steps = 6 hours, enough for the longest known ambiguity (a 2-hour DST shift repeats a wall-time span that lasts 4 real hours) with margin. */
export const DEFAULT_MOVE_SEARCH_STEPS = 24;

/**
 * A sensible, NON-committed default: the next quarter hour at least 30 minutes
 * from now, in the Home timezone -- Today, or Tomorrow when that instant has
 * already rolled into the next local date.
 *
 * INVARIANT: a default is returned ONLY if the strict resolver says its wall
 * time exists exactly once (status OK). A candidate whose wall time is repeated
 * or missing because the clocks change is skipped, and the search advances by
 * quarter hours up to `maxSteps` (bounded). If no unique wall time is found in
 * that bound it returns null -- never the last candidate, never an ambiguous or
 * invalid one -- and the picker starts empty so the user must choose. The bound
 * is a search limit, not a claim about how long DST changes can be.
 */
export function defaultMoveSelection(now: Date, timezone: string, maxSteps: number = DEFAULT_MOVE_SEARCH_STEPS): MoveSelection | null {
  const today = getDatePartsInTimezone(timezone, now).dateStr;
  const first = Math.ceil((now.getTime() + DEFAULT_LEAD_MS) / QUARTER_MS) * QUARTER_MS;
  for (let step = 0; step < maxSteps; step++) {
    const candidate = new Date(first + step * QUARTER_MS);
    const minuteOfDay = getMinuteOfDayInTimezone(timezone, candidate);
    const date = getDatePartsInTimezone(timezone, candidate).dateStr;
    const time = `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
    if (resolveLocalDateTime(date, time, timezone).status === 'OK') return { day: date === today ? 'TODAY' : 'TOMORROW', time };
  }
  return null;
}

export type MoveDestinationRejection = 'INVALID' | 'PAST' | 'SAME' | 'NONEXISTENT' | 'AMBIGUOUS';
export type MoveDestination = { ok: true; newStartAt: string } | { ok: false; reason: MoveDestinationRejection };

/**
 * Local selection -> absolute instant via the canonical strict resolver
 * (resolveLocalDateTime; no new timezone math). The instant returned is the
 * one whose wall time in the Home timezone is EXACTLY the selection: a wall
 * time that does not exist (spring-forward gap) or occurs twice (fall-back
 * overlap) is refused rather than silently corrected or guessed. Also rejects
 * only what is obviously wrong before a request (invalid value, not in the
 * future, identical to the current start). Conflicts, lifecycle state, linked
 * Moments and the DB-clock future check stay with the server; touching a
 * blocker's end is NOT rejected here.
 */
export function resolveMoveDestination(selection: MoveSelection, currentStartIso: string, now: Date, timezone: string): MoveDestination {
  const match = /^(\d{2}):(\d{2})$/.exec(selection.time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { ok: false, reason: 'INVALID' };
  const resolved = resolveLocalDateTime(moveDayDate(selection.day, now, timezone), selection.time, timezone);
  if (resolved.status === 'NONEXISTENT') return { ok: false, reason: 'NONEXISTENT' };
  if (resolved.status === 'AMBIGUOUS') return { ok: false, reason: 'AMBIGUOUS' };
  if (resolved.status !== 'OK' || !Number.isFinite(resolved.instant.getTime())) return { ok: false, reason: 'INVALID' };
  const start = resolved.instant;
  if (start.getTime() <= now.getTime()) return { ok: false, reason: 'PAST' };
  if (start.getTime() === Date.parse(currentStartIso)) return { ok: false, reason: 'SAME' };
  return { ok: true, newStartAt: start.toISOString() };
}

export function moveDestinationMessage(reason: MoveDestinationRejection): string {
  switch (reason) {
    case 'INVALID':
      return 'Choose a valid time.';
    case 'PAST':
      return 'Choose a time later than now.';
    case 'NONEXISTENT':
      return "That local time doesn't exist because the clocks change. Choose another time.";
    case 'AMBIGUOUS':
      return 'That time occurs twice because the clocks change. Choose another time.';
    case 'SAME':
      return 'Choose a different time than the current one.';
  }
}

/** "3:30 PM" in the Home timezone, for the confirm label. */
export function formatMoveTime(newStartAt: string, timezone: string): string {
  return new Date(newStartAt).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

export type MoveFailureCode = 'CONFLICT' | 'HAS_LINKED_MOMENT' | 'INVALID_STATE' | 'ALREADY_MOVED' | 'INVALID_DESTINATION' | 'FAILED';

export type MoveOutcome = { status: 'MOVED'; successor: PlannedActivity } | { status: MoveFailureCode };

const KNOWN_CODES = new Set<string>(['CONFLICT', 'HAS_LINKED_MOMENT', 'INVALID_STATE', 'ALREADY_MOVED', 'INVALID_DESTINATION']);

/**
 * A success is ONLY a 2xx whose body truthfully reports the original as MOVED
 * and a NEW UPCOMING successor with usable times. Anything else -- a 401, a
 * 5xx, an unparseable or half-shaped 200 -- is FAILED (never a fabricated
 * move). Known 4xx `code`s keep their identity so Home can say what happened.
 */
export function parseMoveResponse(planId: string, ok: boolean, body: unknown): MoveOutcome {
  const b = (body && typeof body === 'object' ? body : null) as { from?: any; plan?: any; code?: unknown } | null;
  if (!ok) return { status: typeof b?.code === 'string' && KNOWN_CODES.has(b.code) ? (b.code as MoveFailureCode) : 'FAILED' };
  const from = b?.from;
  const plan = b?.plan;
  const validSuccessor =
    from && from.id === planId && from.status === 'MOVED' &&
    plan && typeof plan.id === 'string' && plan.id !== planId && plan.status === 'UPCOMING' &&
    typeof plan.title === 'string' && Number.isFinite(Date.parse(plan.plannedStartAt)) && Number.isFinite(Date.parse(plan.plannedEndAt)) && typeof plan.durationMinutes === 'number';
  if (!validSuccessor) return { status: 'FAILED' };
  return { status: 'MOVED', successor: { ...plan, plannedStartAt: new Date(plan.plannedStartAt), plannedEndAt: new Date(plan.plannedEndAt) } as PlannedActivity };
}

export function moveFailureMessage(code: MoveFailureCode): string {
  switch (code) {
    case 'CONFLICT':
      return 'That time conflicts with another plan. Choose another time.';
    case 'HAS_LINKED_MOMENT':
      return 'This plan is shared with someone. Reschedule it from the shared moment.';
    case 'INVALID_STATE':
    case 'ALREADY_MOVED':
      return 'This plan was just changed. Updating your day…';
    case 'INVALID_DESTINATION':
      return 'Choose a time later than now.';
    case 'FAILED':
      return "Couldn't move that. Try again.";
  }
}

// ---------------------------------------------------------------------------
// Confirmed-move projection
// ---------------------------------------------------------------------------

const NEXT_STATUSES = new Set(['UPCOMING', 'STARTING_SOON', 'WAITING', 'CONFIRMED']);

/**
 * Overlays SERVER-CONFIRMED moves onto the agenda Home already holds, so the
 * visible day is right even if the follow-up refresh fails, is slow, or returns
 * stale data: the original A becomes MOVED (resolved, never active/imminent)
 * and the successor B appears at its new time -- but only when B lands on this
 * agenda's local day (a move to tomorrow simply removes A from today). B is
 * skipped when an authoritative refresh already delivered it (no duplicate).
 * current/next/planned counts are recomputed with the agenda's own rules.
 */
export function applyConfirmedSuccessors<T extends DailyAgenda | null | undefined>(agenda: T, successors: ReadonlyMap<string, PlannedActivity>, now: Date): T {
  if (!agenda || successors.size === 0) return agenda;
  const items: DailyAgendaItem[] = agenda.items.map((item) => {
    const id = item.type === 'PLAN' && item.id.startsWith('plan:') ? item.id.slice('plan:'.length) : null;
    return id !== null && successors.has(id) && item.status !== 'MOVED' ? { ...item, status: 'MOVED' } : item;
  });
  for (const successor of successors.values()) {
    if (items.some((item) => item.id === `plan:${successor.id}`)) continue;
    if (getDatePartsInTimezone(agenda.timezone, successor.plannedStartAt).dateStr !== agenda.localDate) continue;
    items.push(planToAgendaItem(successor, now));
  }
  items.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  return {
    ...agenda,
    items,
    currentItem: items.find((item) => item.status === 'CURRENT'),
    nextItem: items.find((item) => NEXT_STATUSES.has(item.status)),
    completedCount: items.filter((item) => item.status === 'COMPLETED').length,
    plannedCount: items.filter((item) => item.type !== 'COMPLETED_ACTIVITY' && item.status !== 'SKIPPED' && item.status !== 'MOVED').length,
  } as T;
}

/**
 * Live-day presentation choice (D3): a MOVED original is history, not part of
 * the day still ahead, so Home's live Timeline hides it (the successor shows at
 * its new time). The authoritative read model keeps it for a future Day Review.
 */
export function hideMovedTimelineItems(timeline: HomeTimelineItem[]): HomeTimelineItem[] {
  return timeline.some((item) => item.metadata?.agendaStatus === 'MOVED') ? timeline.filter((item) => item.metadata?.agendaStatus !== 'MOVED') : timeline;
}
