import type { PlannedActivity, AuraMoment, HabitLogRow } from './db';
import { formatActivityDuration } from './activityDuration';
import { findActivityIntent } from '../../../packages/recommendation/src/personalizedTasks';

/**
 * My Day V1 -- the presentation-layer daily agenda (brief section 2/3).
 * Pure derivation only: no DB access, no scoring, no astrology. Combines
 * already-fetched, already-bounded rows (PlannedActivity/AuraMoment/
 * HabitLogRow for the local day) into one chronological list. Naming
 * follows this repo's existing conventions (PlannedActivity, not "Plan";
 * HabitLog, not "ActivityLog") rather than the brief's own sketch verbatim.
 */

export type DailyAgendaItemType = 'PLAN' | 'MOMENT' | 'COMPLETED_ACTIVITY';

export type DailyAgendaItemStatus = 'UPCOMING' | 'STARTING_SOON' | 'CURRENT' | 'COMPLETED' | 'WAITING' | 'CONFIRMED' | 'MISSED';

export interface DailyAgendaItem {
  id: string;
  type: DailyAgendaItemType;
  title: string;
  icon?: string | null;
  startAt: string;
  endAt?: string;
  status: DailyAgendaItemStatus;
  /** Only meaningful for MOMENT items (brief section 5) -- the recipient's
   * display name as the OWNER already safely sees it elsewhere (Aura
   * Updates, the Moment's own owner-facing fields). Never a SavedPerson id,
   * never birth/natal data. */
  participantDisplayName?: string;
  durationMinutes?: number;
  windowType?: string | null;
  /** HABIT_LOG items have no dedicated permalink today -- honest about
   * that rather than pointing at a Plan id that doesn't apply. */
  target: { type: 'PLAN' | 'MOMENT' | 'HABIT_LOG'; id: string };
}

export interface DailyAgenda {
  localDate: string;
  timezone: string;
  items: DailyAgendaItem[];
  currentItem?: DailyAgendaItem;
  nextItem?: DailyAgendaItem;
  completedCount: number;
  plannedCount: number;
}

/** Presentational-only "about to start" heuristic for an agenda item's
 * chronological visual treatment (brief section 8: "starting soon: subtle
 * emphasis"). Deliberately NOT the same thing as reminder eligibility --
 * that stays deriveAuraReminders()'s exclusive concern (brief section 32/
 * 55); this never feeds a reminder or notification decision. */
const STARTING_SOON_WINDOW_MS = 30 * 60 * 1000;

/** Brief section 3 (Daily Reflection & Tomorrow Preview V1): a Plan whose
 * window has elapsed is NOT automatically "completed" -- completion is
 * decided exclusively by plan.status === 'LOGGED' (a real HabitLog exists).
 * An elapsed, unlogged Plan is 'MISSED': still a truthful fact ("this
 * didn't happen"), never invented success. */
function timeBasedStatus(startAt: Date, endAt: Date | undefined, now: Date): DailyAgendaItemStatus {
  if (endAt && endAt.getTime() < now.getTime()) return 'MISSED';
  if (now.getTime() >= startAt.getTime() && (!endAt || now.getTime() <= endAt.getTime())) return 'CURRENT';
  if (startAt.getTime() - now.getTime() <= STARTING_SOON_WINDOW_MS) return 'STARTING_SOON';
  return 'UPCOMING';
}

/** Home Compactness + Flexible Day Story V1 (brief section 10) -- audit
 * found the real source of stray internal text like "focus"/"workout"
 * rendering where an icon glyph belongs: `planIconForTitle()`
 * (PlanWithAuraView.tsx) returns an internal `PlanIcon` CATEGORY id
 * ('focus'/'workout'/'study'/'heart'/'meditate'/'meeting'/'journey') meant
 * only for that component's own local icon lookup -- never an emoji --
 * but `saveUpcomingPlanFromCandidate()` (the canonical creation path Day
 * Builder's Add and every Timing Search "Use this time" call through)
 * stores that raw category string verbatim as `Plan.icon`. Sanitized once
 * here, at the single point every consumer of DailyAgendaItem.icon reads
 * from (Your Day's own marker, Aura Suggests' icon, any future consumer),
 * rather than patched separately in each render site. A genuine emoji is
 * never plain ASCII letters, so this is a general, forward-compatible
 * guard, not a hardcoded list of the known category ids -- and it never
 * touches how `Plan.icon` itself is stored (a separate, PlanWithAuraView-
 * owned concern out of this brief's scope, brief section 63). */
function sanitizedIcon(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return /^[a-zA-Z]+$/.test(icon) ? null : icon;
}

function planToAgendaItem(plan: PlannedActivity, now: Date): DailyAgendaItem {
  const status: DailyAgendaItemStatus = plan.status === 'LOGGED' ? 'COMPLETED' : timeBasedStatus(plan.plannedStartAt, plan.plannedEndAt, now);
  return {
    id: `plan:${plan.id}`,
    type: 'PLAN',
    title: plan.title,
    icon: sanitizedIcon(plan.icon),
    startAt: plan.plannedStartAt.toISOString(),
    endAt: plan.plannedEndAt.toISOString(),
    status,
    durationMinutes: plan.durationMinutes,
    windowType: plan.windowType,
    target: { type: 'PLAN', id: plan.id },
  };
}

/** Brief section 5's exact inclusion rules -- reuses the moment's own
 * existing lifecycle fields (status/responseState), never a second
 * lifecycle model. `hasSuccessor` comes from the caller (the same
 * listMomentIdsWithSuccessorForOwner() lookup deriveAuraReminders already
 * uses), not recomputed here. */
function momentToAgendaItem(moment: AuraMoment, hasSuccessor: boolean, now: Date): DailyAgendaItem | null {
  // ANOTHER_TIME is never a valid upcoming agenda event, whether or not a
  // successor exists yet -- the existing Aura Update owns "prefers another
  // time" messaging (brief section 5/33), and a superseded original is
  // excluded outright (its successor, if any, is its own separate row that
  // will surface normally if its own startAt falls in this day's range).
  if (moment.responseState === 'ANOTHER_TIME') return null;
  if (hasSuccessor) return null;

  const startAt = moment.startAt;
  const endAt = moment.endAt;
  let status: DailyAgendaItemStatus;
  if (endAt.getTime() < now.getTime()) {
    status = 'COMPLETED';
  } else if (moment.responseState === null) {
    status = 'WAITING';
  } else {
    // ACCEPTED and not yet over -- "Confirmed" is more meaningful to the
    // owner than a generic upcoming/starting-soon/current ladder for a
    // coordinated event (brief section 5's own "Confirmed" example).
    status = 'CONFIRMED';
  }

  return {
    id: `moment:${moment.id}`,
    type: 'MOMENT',
    title: moment.activityTitle,
    icon: moment.activityIcon,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    status,
    participantDisplayName: moment.sharedPersonDisplayName ?? undefined,
    // The public token, not the internal id -- the owner views their own
    // Moment through the same public /moment/[token] link everything else
    // (Aura Updates' "View", reminders) already uses. Not a privacy
    // concern: this is the owner's own agenda, and they already have
    // access to this token via Share/Copy elsewhere.
    target: { type: 'MOMENT', id: moment.publicToken },
  };
}

function habitLogToAgendaItem(log: HabitLogRow): DailyAgendaItem {
  const icon = findActivityIntent(log.activityTitle)?.icon ?? null;
  const loggedAt = log.logTimestamp.toISOString();
  return {
    id: `log:${log.id}`,
    type: 'COMPLETED_ACTIVITY',
    title: log.activityTitle,
    icon,
    startAt: loggedAt,
    status: 'COMPLETED',
    // Brief section 7: reuse formatActivityDuration() so an INSTANT (0-
    // minute) log reads "Completed", never "0 min" -- this only stores the
    // raw minutes; the "Completed" text itself is a display concern of the
    // component that renders DailyAgendaItem, same convention as every
    // other formatActivityDuration() call site in the app.
    durationMinutes: log.durationMinutes,
    target: { type: 'HABIT_LOG', id: log.id },
  };
}

export interface BuildDailyAgendaInput {
  now: Date;
  localDate: string;
  timezone: string;
  plans: PlannedActivity[];
  moments: AuraMoment[];
  momentIdsWithSuccessor: Set<string>;
  habitLogs: HabitLogRow[];
  /** Brief section 6: a Plan that already has a linked AuraMoment (via the
   * existing plannedActivityId dedup relationship) renders as ONE item,
   * preferring the richer Moment representation -- exact id match only, no
   * fuzzy title/time matching. */
  linkedPlanIdsWithMoment?: Set<string>;
}

export function buildDailyAgenda(input: BuildDailyAgendaInput): DailyAgenda {
  const { now, localDate, timezone, plans, moments, momentIdsWithSuccessor, habitLogs } = input;
  const linkedPlanIds = input.linkedPlanIdsWithMoment ?? new Set(moments.filter((m) => m.plannedActivityId).map((m) => m.plannedActivityId as string));

  const items: DailyAgendaItem[] = [];

  for (const plan of plans) {
    if (plan.status === 'CANCELLED') continue;
    // Brief section 6 dedup -- prefer the Moment, skip the plain Plan item.
    if (linkedPlanIds.has(plan.id)) continue;
    items.push(planToAgendaItem(plan, now));
  }

  for (const moment of moments) {
    const item = momentToAgendaItem(moment, momentIdsWithSuccessor.has(moment.id), now);
    if (item) items.push(item);
  }

  for (const log of habitLogs) {
    // A logged Plan already appears above (status COMPLETED, from the Plan
    // row itself, which carries its own richer scheduling fields) --
    // logPlannedActivity() links plan.habitLogId, so skip that HabitLog row
    // here rather than double-counting the same real-world activity.
    if (plans.some((p) => p.habitLogId === log.id)) continue;
    items.push(habitLogToAgendaItem(log));
  }

  items.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  const currentItem = items.find((item) => item.status === 'CURRENT');
  const nextItem = items.find((item) => item.status === 'UPCOMING' || item.status === 'STARTING_SOON' || item.status === 'WAITING' || item.status === 'CONFIRMED');

  return {
    localDate,
    timezone,
    items,
    currentItem,
    nextItem,
    completedCount: items.filter((item) => item.status === 'COMPLETED').length,
    plannedCount: items.filter((item) => item.type !== 'COMPLETED_ACTIVITY').length,
  };
}
