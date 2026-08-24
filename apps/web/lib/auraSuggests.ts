import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';
import type { PersonalizedTask } from '../../../packages/recommendation/src/personalizedTasks';

/**
 * Product Journey / E2E Hardening V1 (brief section 14-17) -- "Aura
 * Suggests" answers "given my day, what would be helpful next?", distinct
 * from "Good Right Now" ("what can I actually do right now?"). Previously
 * this card was sourced purely from the current-window catalog ranking
 * (getPersonalizedTasks), the SAME pool Good Right Now already draws from
 * -- the two could (and did) surface the identical canonical activity.
 *
 * This is presentation/selection logic only: no new scoring engine, no new
 * astrology. It reuses the already-computed DailyAgenda.nextItem (My Day
 * V1) for agenda-aware guidance, the existing caution-window rule
 * (unchanged), and the existing personalizedTasks ranking for the generic
 * fallback -- deduped against Good Right Now by canonical activityId
 * (never fuzzy title matching, per brief section 17). Returns null when
 * nothing additive remains to say; the card is hidden entirely rather than
 * duplicating Good Right Now.
 */

export interface AuraSuggestion {
  title: string;
  description: string;
  icon: string;
  actionLabel: string;
  secondaryLabel: string;
  planId?: string;
  /** When present, the primary action opens this agenda item (the existing
   * onOpenAgendaItem routing) instead of the log-activity modal --
   * PREPARE/CONFIRMED/WAITING suggestions describe something already on
   * the agenda, not something to log right now. */
  agendaItem?: DailyAgendaItem;
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
  /** Already-ranked catalog tasks for the current window (existing
   * getPersonalizedTasks output) -- never recomputed here. */
  personalizedTasks: PersonalizedTask[];
  /** Canonical activityIds already visible in Good Right Now this render
   * (brief section 17 dedup). */
  goodRightNowActivityIds: Set<string>;
  /** stripCountdownWrapper(remainingText) from the caller -- e.g. "2h 30m"
   * or '' -- used only for the generic tier's situating phrase, exactly as
   * the pre-existing logic did. */
  timeLeftBeforeNextShift: string;
}): AuraSuggestion | null {
  const { agenda, activeWindowName, personalizedTasks, goodRightNowActivityIds, timeLeftBeforeNextShift } = input;
  const nextItem = agenda?.nextItem;

  // Tier 1 (brief section 16, priorities 1-2): the next agenda item, when
  // it's genuinely informative and not already owned by another Home
  // surface -- STARTING_SOON is the reminder card's own moment, CURRENT is
  // already the hero "Right Now" panel's concern (brief section 19: avoid
  // simultaneous cards all claiming to be "next").
  if (nextItem && nextItem.status !== 'STARTING_SOON' && nextItem.status !== 'CURRENT') {
    const time = formatClock(nextItem.startAt);
    const displayTitle = agendaItemDisplayTitle(nextItem);

    if (nextItem.status === 'CONFIRMED') {
      return {
        title: `${displayTitle} confirmed`,
        description: `Your ${displayTitle} is confirmed for ${time}.`,
        icon: nextItem.icon || '✨',
        actionLabel: 'View',
        secondaryLabel: 'View full day timeline',
        agendaItem: nextItem,
      };
    }
    if (nextItem.status === 'WAITING') {
      return {
        title: `${displayTitle} awaiting response`,
        description: `${displayTitle} at ${time} is still waiting on a response.`,
        icon: nextItem.icon || '✨',
        actionLabel: 'View',
        secondaryLabel: 'View full day timeline',
        agendaItem: nextItem,
      };
    }
    if (nextItem.status === 'UPCOMING') {
      return {
        title: `Prepare for ${displayTitle}`,
        description: `Prepare for ${displayTitle} at ${time}.`,
        icon: nextItem.icon || '✨',
        actionLabel: 'View',
        secondaryLabel: 'View full day timeline',
        agendaItem: nextItem,
      };
    }
  }

  // Tier 2 (brief section 16, priority 3): adjustment/rescheduling
  // guidance -- the pre-existing caution-window rule, reused verbatim, not
  // reinvented.
  if (isCautionWindow(activeWindowName)) {
    const lightTask = personalizedTasks.find((task) => task.significance === 'LOW') ?? personalizedTasks[0];
    if (lightTask) {
      return {
        title: lightTask.title,
        description: `This is a caution window, so Aura is keeping the suggestion low-stakes. ${lightTask.description}`,
        icon: lightTask.icon || '✨',
        actionLabel: 'Do lightly',
        secondaryLabel: 'Find better time',
      };
    }
  }

  // Tier 3 (brief section 16, priority 5 / section 17): a generic
  // current-window suggestion, but ONLY the first one Good Right Now isn't
  // already showing -- walks the existing ranking rather than inventing a
  // second one.
  const genericTask = personalizedTasks.find((task) => !goodRightNowActivityIds.has(task.id));
  if (genericTask) {
    const description = timeLeftBeforeNextShift
      ? `You have about ${timeLeftBeforeNextShift} before the next shift, making this a good time to ${genericTask.title.toLowerCase()}.`
      : genericTask.description;
    return {
      title: genericTask.title,
      description,
      icon: genericTask.icon || '✨',
      actionLabel: 'Do it now',
      secondaryLabel: 'More options',
    };
  }

  // Nothing additive to say -- hide entirely rather than duplicate Good
  // Right Now (brief section 16: "preferable to duplication").
  return null;
}
