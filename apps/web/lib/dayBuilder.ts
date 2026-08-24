import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';
import { getMinuteOfDayInTimezone, getDatePartsInTimezone } from './timezone';
import { INTENTION_GROUPS, DailyIntentionGroupId, DailyIntentionActivity } from './dailyIntentions';
import { findActivityIntent } from '../../../packages/recommendation/src/personalizedTasks';
import type { TimingCandidate } from '../../../packages/recommendation/src/timingSearch';
import type { EverydaySharedCandidate } from '../../../packages/recommendation/src/everydayTimingFit';
import type { SavedPersonRelationshipType } from './db';

/**
 * Intentional Day Builder V1 -- the pure, deterministic domain layer (brief
 * sections 4/5/10/11/12/13/14/16). This is NOT a new timing or scoring
 * engine: it only decides WHAT to consider suggesting and WHETHER a
 * proposed time genuinely fits the day that's already there. The actual
 * time is always found by the existing canonical timing engines
 * (runTimingSearch / findEverydaySharedTiming), called by
 * dayBuilderOrchestrator.ts -- this file never invents a start/end time.
 *
 * "Agenda-as-anchors" (brief section 3): existing Plans/Moments are treated
 * as fixed anchors the day is built around, never as things to compete
 * with or duplicate. deriveAgendaOpenings() below is the whole of that
 * philosophy in code -- it computes what's genuinely free, nothing else.
 */

export interface AgendaOpening {
  /** Minute of the local day, inclusive. Always >= the minuteOfDay this was
   * derived from -- Day Builder only ever looks forward, never backfills a
   * time that's already passed. */
  startMinute: number;
  /** Minute of the local day, exclusive. */
  endMinute: number;
}

/** Below this, no catalog activity's shortest suggested/default duration
 * (10 minutes, e.g. tea-break/task-3) plus a little slack can realistically
 * fit -- not worth carrying forward as a candidate opening. */
const MIN_OPENING_MINUTES = 15;
const MINUTES_PER_DAY = 1440;

/** Brief section 3 -- items that still occupy real time today (anything not
 * already in the past as COMPLETED/MISSED). Only these block an opening;
 * a completed/missed item has no future minutes left to protect. */
function blockingItems(agenda: DailyAgenda): DailyAgendaItem[] {
  return agenda.items.filter((item) => item.status !== 'COMPLETED' && item.status !== 'MISSED' && item.endAt);
}

/** Local minute-of-day range for one agenda item. Returns null for a
 * (rare) item that crosses local midnight -- deliberately not handled:
 * openings only ever cover a single local day, and a cross-midnight block
 * is still protected indirectly (it still occupies presentActivityIds/
 * presentGroupIds for dedup purposes; only the minute-accurate opening math
 * skips it). Documented limitation, not a silent bug. */
function itemMinuteRange(item: DailyAgendaItem, timezone: string): { start: number; end: number } | null {
  if (!item.endAt) return null;
  const start = getMinuteOfDayInTimezone(timezone, new Date(item.startAt));
  const end = getMinuteOfDayInTimezone(timezone, new Date(item.endAt));
  if (end <= start) return null;
  return { start, end };
}

/**
 * Pure interval math: today's [now, end of local day) minus every
 * still-upcoming agenda item's own time block, merged into contiguous free
 * stretches. No astrology, no scoring -- just what's actually free.
 */
export function deriveAgendaOpenings(input: { agenda: DailyAgenda; minuteOfDay: number }): AgendaOpening[] {
  const { agenda, minuteOfDay } = input;
  const covered = new Array(MINUTES_PER_DAY).fill(false);
  for (let m = 0; m < Math.min(minuteOfDay, MINUTES_PER_DAY); m++) covered[m] = true;

  for (const item of blockingItems(agenda)) {
    const range = itemMinuteRange(item, agenda.timezone);
    if (!range) continue;
    for (let m = Math.max(0, range.start); m < Math.min(MINUTES_PER_DAY, range.end); m++) covered[m] = true;
  }

  const openings: AgendaOpening[] = [];
  let curStart = -1;
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    if (!covered[m]) {
      if (curStart === -1) curStart = m;
    } else if (curStart !== -1) {
      if (m - curStart >= MIN_OPENING_MINUTES) openings.push({ startMinute: curStart, endMinute: m });
      curStart = -1;
    }
  }
  if (curStart !== -1 && MINUTES_PER_DAY - curStart >= MIN_OPENING_MINUTES) {
    openings.push({ startMinute: curStart, endMinute: MINUTES_PER_DAY });
  }
  return openings;
}

/** Brief section 14: a resolved timing candidate is only usable if it
 * genuinely lands inside an already-computed opening AND on today's local
 * date (defensive -- the canonical engines are asked for TODAY only, this
 * just confirms rather than trusts blindly). Never adjusts or re-scores
 * the candidate; only accepts or rejects it as-is. */
export function candidateFitsOpenings(
  candidate: { start: string; end: string },
  openings: AgendaOpening[],
  timezone: string,
  localDate: string
): boolean {
  const startDate = getDatePartsInTimezone(timezone, new Date(candidate.start)).dateStr;
  if (startDate !== localDate) return false;
  const start = getMinuteOfDayInTimezone(timezone, new Date(candidate.start));
  const end = getMinuteOfDayInTimezone(timezone, new Date(candidate.end));
  if (end <= start) return false;
  return openings.some((o) => start >= o.startMinute && end <= o.endMinute);
}

export interface DayProfile {
  minuteOfDay: number;
  /** Nothing at all on today's agenda, past or future. */
  isEmpty: boolean;
  /** Brief section 13/29: a day that already has 3+ still-upcoming items is
   * treated as full -- Day Builder proposes nothing rather than crowding it
   * further. Zero suggestions is the correct, expected result here. */
  isBusy: boolean;
  /** No agenda item starts at/after 17:00 local -- same definition
   * dailyStory.ts's own isEveningOpen() already uses, computed
   * independently here since dayBuilder.ts intentionally has no dependency
   * on dailyStory.ts (kept as two separate, independently-testable pure
   * layers). */
  hasEveningOpen: boolean;
  /** Canonical activityIds already on today's agenda (Plan/Moment/logged
   * activity), resolved via the same findActivityIntent() title match
   * habitLogToAgendaItem() already uses for its icon lookup -- exact-id
   * dedup, brief section 12 level 1. */
  presentActivityIds: Set<string>;
  /** Every DailyIntentionGroupId already represented by something on
   * today's agenda (any activity in that group already present) --
   * diversity/semantic dedup, brief section 12 level 2 (a group already
   * "covered" by the real day is not suggested again). */
  presentGroupIds: Set<DailyIntentionGroupId>;
  openings: AgendaOpening[];
  longestOpeningMinutes: number;
}

export function buildDayProfile(agenda: DailyAgenda, minuteOfDay: number): DayProfile {
  const presentActivityIds = new Set<string>();
  for (const item of agenda.items) {
    const resolved = findActivityIntent(item.title);
    if (resolved) presentActivityIds.add(resolved.id);
  }

  const presentGroupIds = new Set<DailyIntentionGroupId>();
  for (const group of INTENTION_GROUPS) {
    if (group.activities.some((a) => a.activityId && presentActivityIds.has(a.activityId))) {
      presentGroupIds.add(group.id);
    }
  }

  const hasEveningOpen = !agenda.items.some((item) => {
    if (item.status === 'COMPLETED' || item.status === 'MISSED') return false;
    return new Date(item.startAt).getHours() >= 17;
  });

  const openings = deriveAgendaOpenings({ agenda, minuteOfDay });
  const longestOpeningMinutes = openings.reduce((max, o) => Math.max(max, o.endMinute - o.startMinute), 0);
  const upcomingCount = agenda.items.filter((i) => i.status !== 'COMPLETED' && i.status !== 'MISSED').length;

  return {
    minuteOfDay,
    isEmpty: agenda.items.length === 0,
    isBusy: upcomingCount >= 3,
    hasEveningOpen,
    presentActivityIds,
    presentGroupIds,
    openings,
    longestOpeningMinutes,
  };
}

/** People-oriented groups -- the ones a real SavedPerson relationship can
 * resolve a SHARED candidate + Invite action for (brief section 21). */
export const PEOPLE_GROUP_IDS: DailyIntentionGroupId[] = ['RELATIONSHIPS', 'FAMILY', 'SOCIAL'];

/** Maps a people-oriented group to the SavedPersonRelationshipType values
 * eligible for it -- e.g. a RELATIONSHIPS suggestion looks for a PARTNER or
 * SPOUSE, never a FRIEND. FAMILY/SOCIAL similarly. Deliberately excludes
 * OTHER from SOCIAL's own explicit list here (OTHER is a genuine catch-all,
 * only used as SOCIAL's fallback in the orchestrator when no FRIEND exists). */
export const PEOPLE_GROUP_RELATIONSHIP_TYPES: Record<string, SavedPersonRelationshipType[]> = {
  RELATIONSHIPS: ['PARTNER', 'SPOUSE'],
  FAMILY: ['FAMILY'],
  SOCIAL: ['FRIEND', 'OTHER'],
};

export interface IntentionCandidate {
  groupId: DailyIntentionGroupId;
  activity: DailyIntentionActivity;
  isPeopleOriented: boolean;
  /** "Why today?" -- template-based, grounded in real DayProfile facts,
   * never LLM-generated prose (brief section 16). */
  reason: string;
}

/** Brief section 16 -- deterministic, template-based reasons grounded only
 * in facts buildDayProfile() already derived (evening open or not, whether
 * anything else is competing for the time). No new signal, no free text. */
function reasonForCandidate(groupId: DailyIntentionGroupId, profile: DayProfile): string {
  const isPeople = PEOPLE_GROUP_IDS.includes(groupId);
  if (isPeople && profile.hasEveningOpen) return 'Your evening is open — a good chance to make room for someone.';
  if (isPeople) return "Nothing else is using this time — a good window to connect with someone.";
  if (groupId === 'WORK') return 'You have a clear stretch open for focused work.';
  if (groupId === 'SELF') return 'Some open time today to do something just for you.';
  return 'Room today to enjoy something, with nothing else competing for the time.';
}

/** Brief section 10/11/13 -- select candidates from the existing taxonomy
 * BEFORE any timing search runs (performance: search is the expensive
 * step, so only a small, already-diverse, already-deduped set is ever
 * handed to it). Returns [] whenever the day genuinely has no room left --
 * zero is a valid, expected result (brief section 13), not a fallback to
 * avoid. */
export function selectIntentionCandidates(
  profile: DayProfile,
  mutedGroups: Set<DailyIntentionGroupId>,
  maxCandidates: number
): IntentionCandidate[] {
  if (profile.isBusy) return [];
  if (profile.openings.length === 0) return [];

  const priorityOrder: DailyIntentionGroupId[] = profile.hasEveningOpen
    ? ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'SELF', 'ENJOYMENT', 'WORK']
    : ['SELF', 'ENJOYMENT', 'WORK', 'RELATIONSHIPS', 'FAMILY', 'SOCIAL'];

  const candidates: IntentionCandidate[] = [];
  // Two-level dedup (brief section 12): level 1 is exact-activityId, tracked
  // globally across every group below (an activityId like 'coffee-tea' that
  // appears in more than one group's list is only ever offered once). Level
  // 2 is "one activity per group" -- a group already chosen doesn't offer a
  // second, near-identical variant of the same kind of intention.
  const seenActivityIds = new Set<string>();

  for (const groupId of priorityOrder) {
    if (candidates.length >= maxCandidates) break;
    if (mutedGroups.has(groupId)) continue;
    // Diversity: a group already represented on today's real agenda isn't
    // genuinely additive to suggest again (brief section 3/11).
    if (profile.presentGroupIds.has(groupId)) continue;

    const group = INTENTION_GROUPS.find((g) => g.id === groupId);
    if (!group) continue;

    for (const activity of group.activities) {
      if (!activity.activityId) continue;
      if (profile.presentActivityIds.has(activity.activityId)) continue;
      if (seenActivityIds.has(activity.activityId)) continue;
      seenActivityIds.add(activity.activityId);
      candidates.push({
        groupId,
        activity,
        isPeopleOriented: PEOPLE_GROUP_IDS.includes(groupId),
        reason: reasonForCandidate(groupId, profile),
      });
      break;
    }
  }

  return candidates;
}

export interface IntentionalDayCandidateSolo {
  kind: 'SOLO';
  solo: TimingCandidate;
}

export interface IntentionalDayCandidateShared {
  kind: 'SHARED';
  shared: EverydaySharedCandidate;
  person: { id: string; name: string; relationshipType: SavedPersonRelationshipType };
}

export type IntentionalDayCandidate = IntentionalDayCandidateSolo | IntentionalDayCandidateShared;

/**
 * Brief section 17 -- the DTO Daily Story's UI renders. Always carries an
 * already-RESOLVED real time (never just an activity name) -- `candidate`
 * is exactly what the canonical timing engine returned, untouched.
 */
export interface IntentionalDaySuggestion {
  id: string;
  groupId: DailyIntentionGroupId;
  activityId: string;
  label: string;
  icon: string;
  durationMinutes: number;
  reason: string;
  candidate: IntentionalDayCandidate;
}

/**
 * Brief section 24 -- pure selection logic for the "Another idea" swap
 * (used by DayBuilderCard.tsx). Given the currently-visible suggestion ids
 * and the full already-resolved set (visible + reserve, exactly what
 * GET /api/my-day/suggestions returned in one response), returns the NEW
 * visible id list with `outgoingId` replaced by the next not-yet-shown
 * suggestion. A pure array recombination -- no fetch, no timing search, no
 * re-scoring: by construction this function cannot perform I/O (its
 * signature is array-in, array-out), so the replacement can only ever be a
 * suggestion the canonical engines already resolved a real time for in
 * that same original response. Never introduces a duplicate activityId
 * (selectIntentionCandidates already guarantees every suggestion in
 * `allSuggestions` has a globally-unique activityId, so any two entries in
 * its output are automatically distinct too). Returns the list with
 * `outgoingId` simply removed (one fewer visible suggestion) when no
 * reserve candidate remains -- the caller's own "Another idea" control
 * disappearing is a direct, reactive consequence of an empty reserve after
 * this call, not a separate branch to get wrong.
 */
export function swapSuggestion(visibleIds: string[], allSuggestions: IntentionalDaySuggestion[], outgoingId: string): string[] {
  const reserve = allSuggestions.filter((s) => !visibleIds.includes(s.id));
  const next = reserve[0];
  const withoutOutgoing = visibleIds.filter((id) => id !== outgoingId);
  return next ? [...withoutOutgoing, next.id] : withoutOutgoing;
}
