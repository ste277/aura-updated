import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';
import type { PersonalizedTask } from '../../../packages/recommendation/src/personalizedTasks';

/**
 * Home Recommendation Hierarchy V1 -- "Aura Suggests" answers "given the
 * shape of my actual day, what would be useful to know or prepare for?",
 * distinct from "Good Right Now" ("what can I actually do right now?").
 *
 * Root cause this rewrite fixes (see the PR's own completion report for the
 * full audit): the previous caution-window tier picked an activity straight
 * from `personalizedTasks` with NO dedup check against Good Right Now --
 * unlike the generic fallback tier below it, which already deduped
 * correctly by canonical activityId. Whenever the caution-window branch
 * fired (i.e. during Rahu Kalam/Yama -- common, not an edge case), it could
 * and did surface the exact same canonical activity Good Right Now was
 * already showing (e.g. "Process Optimization & Docs" in both).
 *
 * The fix is architectural, not just an added exclusion check: only ONE
 * tier (ACTIVITY_FALLBACK) is still allowed to recommend a catalog activity
 * at all. Every other tier is agenda/context guidance derived from
 * DailyAgenda -- structurally incapable of duplicating a Good Right Now
 * activity, because it never chooses one. `CAUTION_CONTEXT` in particular
 * no longer picks a "low-stakes task"; it now says something about the
 * window/day itself (mirroring the brief's own worked example: "Keep this
 * morning light... your first planned activity is not until noon"), using
 * only already-computed window/agenda facts.
 *
 * This is presentation/selection logic only: no new scoring engine, no new
 * astrology, no new time-of-day math beyond what the caller already has.
 */

export type AuraSuggestionType =
  | 'PREPARE_FOR_PLAN'
  | 'PREPARE_FOR_MOMENT'
  | 'COORDINATION'
  | 'OPEN_GAP'
  | 'CAUTION_CONTEXT'
  | 'ACTIVITY_FALLBACK';

export interface AuraSuggestion {
  type: AuraSuggestionType;
  title: string;
  description: string;
  icon: string;
  /** Present for PREPARE_FOR_PLAN / PREPARE_FOR_MOMENT / COORDINATION --
   * the primary action opens this agenda item via the existing
   * onOpenAgendaItem routing (the same one Your Day's own rows use), never
   * a log-activity modal. */
  agendaItem?: DailyAgendaItem;
  /** Present only for ACTIVITY_FALLBACK -- the canonical catalog id behind
   * this suggestion, so the primary action can log it via the existing
   * log-activity pipeline. Never present on any other type: most Aura
   * Suggestions aren't about an activity at all (brief section 6). */
  activityId?: string;
  /** Absent entirely for CAUTION_CONTEXT -- brief section 7: "no action
   * required". Every other type has one. */
  actionLabel?: string;
  secondaryLabel?: string;
}

function isCautionWindow(windowName: string): boolean {
  const clean = windowName.toUpperCase();
  return clean.includes('RAHU') || clean.includes('YAMA');
}

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function agendaItemDisplayTitle(item: DailyAgendaItem): string {
  return item.type === 'MOMENT' && item.participantDisplayName ? `${item.title} with ${item.participantDisplayName}` : item.title;
}

export function deriveAuraSuggestion(input: {
  agenda?: DailyAgenda | null;
  activeWindowName: string;
  /** Already-formatted end time of the CURRENT window (e.g. "9:04 AM"),
   * reused verbatim for CAUTION_CONTEXT's day-framing -- never recomputed,
   * same string HomeDashboard already shows elsewhere (currentWindow.endTime). */
  currentWindowEndTime?: string;
  /** Already-ranked catalog tasks for the current window (existing
   * getPersonalizedTasks output) -- never recomputed here. Consulted only
   * by the ACTIVITY_FALLBACK tier. */
  personalizedTasks: PersonalizedTask[];
  /** Canonical activityIds already visible in Good Right Now this render. */
  goodRightNowActivityIds: Set<string>;
  /** stripCountdownWrapper(remainingText) from the caller -- e.g. "2h 30m"
   * or '' -- used only for ACTIVITY_FALLBACK's situating phrase, exactly as
   * the pre-existing logic did. */
  timeLeftBeforeNextShift: string;
}): AuraSuggestion | null {
  const { agenda, activeWindowName, currentWindowEndTime, personalizedTasks, goodRightNowActivityIds, timeLeftBeforeNextShift } = input;
  const nextItem = agenda?.nextItem;
  const nextItemActive = nextItem && nextItem.status !== 'STARTING_SOON' && nextItem.status !== 'CURRENT' ? nextItem : undefined;

  // PREPARE_FOR_MOMENT / COORDINATION -- a next Moment always takes
  // priority, caution window or not: it involves another person who has
  // already responded (or is waiting on the owner), which is more time-
  // sensitive than generic day-caution framing. STARTING_SOON/CURRENT are
  // excluded (the reminder card / "Right Now" panel's own concern -- avoid
  // simultaneous cards all claiming to be "next").
  if (nextItemActive?.type === 'MOMENT') {
    const time = formatClock(nextItemActive.startAt);
    const displayTitle = agendaItemDisplayTitle(nextItemActive);
    if (nextItemActive.status === 'WAITING') {
      return {
        type: 'COORDINATION',
        title: 'Still waiting on a response',
        description: `${displayTitle} at ${time} hasn't been confirmed yet.`,
        icon: nextItemActive.icon || '✨',
        actionLabel: 'View',
        secondaryLabel: 'View full day timeline',
        agendaItem: nextItemActive,
      };
    }
    // CONFIRMED -- the only other Moment status that reaches here.
    return {
      type: 'PREPARE_FOR_MOMENT',
      title: `${displayTitle} is at ${time}`,
      description: `${nextItemActive.participantDisplayName ? `${nextItemActive.participantDisplayName} is confirmed. ` : ''}You have a clear stretch beforehand.`,
      icon: nextItemActive.icon || '✨',
      actionLabel: 'View',
      secondaryLabel: 'View full day timeline',
      agendaItem: nextItemActive,
    };
  }

  // CAUTION_CONTEXT -- day/window framing, never an activity pick (the bug
  // this rewrite fixes). Takes priority over a plain next-Plan "prepare"
  // framing during a caution window (section 12's worked example: "Keep
  // this morning light... your first planned activity is not until noon"
  // is the preferred framing over "Prepare for Learning" when both apply),
  // referencing the next Plan by name when one exists.
  if (isCautionWindow(activeWindowName)) {
    const nextPlan = nextItemActive?.type === 'PLAN' ? nextItemActive : undefined;
    const agendaClause = nextPlan
      ? `Your first plan is ${agendaItemDisplayTitle(nextPlan)} at ${formatClock(nextPlan.startAt)}. `
      : "Nothing is on your agenda yet. ";
    const windowClause = currentWindowEndTime
      ? `This caution window ends at ${currentWindowEndTime}, so there's no need to force anything important right now.`
      : "There's no need to force anything important right now.";
    return {
      type: 'CAUTION_CONTEXT',
      title: 'Keep this window light',
      description: `${agendaClause}${windowClause}`,
      icon: '🛡️',
      // Brief section 7: "no action required" -- actionLabel intentionally omitted.
    };
  }

  // PREPARE_FOR_PLAN -- a next Plan, outside a caution window.
  if (nextItemActive?.type === 'PLAN') {
    const time = formatClock(nextItemActive.startAt);
    const displayTitle = agendaItemDisplayTitle(nextItemActive);
    return {
      type: 'PREPARE_FOR_PLAN',
      title: `Prepare for ${displayTitle}`,
      description: `You have some time before ${displayTitle} at ${time}.`,
      icon: nextItemActive.icon || '✨',
      actionLabel: 'View',
      secondaryLabel: 'View full day timeline',
      agendaItem: nextItemActive,
    };
  }

  // OPEN_GAP -- nothing left ahead on today's agenda, but there WAS a day
  // (something planned, current, or already completed) -- a genuinely
  // meaningful gap, described using only the existing agenda, never
  // auto-filled with another activity suggestion.
  if (!nextItemActive && (agenda?.items.length ?? 0) > 0) {
    return {
      type: 'OPEN_GAP',
      title: 'Open time ahead',
      description: "Nothing else is on your agenda right now -- a good stretch of open time.",
      icon: '🌤️',
      actionLabel: 'Add something',
      secondaryLabel: 'View full day timeline',
    };
  }

  // ACTIVITY_FALLBACK -- the ONLY tier allowed to recommend a catalog
  // activity, and only the first one Good Right Now isn't already showing
  // (canonical activityId dedup, never fuzzy title matching).
  const genericTask = personalizedTasks.find((task) => !goodRightNowActivityIds.has(task.id));
  if (genericTask) {
    const description = timeLeftBeforeNextShift
      ? `You have about ${timeLeftBeforeNextShift} before the next shift, making this a good time to ${genericTask.title.toLowerCase()}.`
      : genericTask.description;
    return {
      type: 'ACTIVITY_FALLBACK',
      title: genericTask.title,
      description,
      icon: genericTask.icon || '✨',
      activityId: genericTask.id,
      actionLabel: 'Do it now',
      secondaryLabel: 'More options',
    };
  }

  // Nothing additive to say -- hide entirely rather than duplicate Good
  // Right Now.
  return null;
}
