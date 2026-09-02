import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';

/**
 * Home Recommendation Hierarchy V1 (+ amendment) -- three Home surfaces,
 * three non-overlapping questions:
 *
 *   GOOD RIGHT NOW           "What can I do right now?"
 *   AURA SUGGESTS            "What should I know about / how should I
 *                             navigate the day I've already built?"
 *   INTENTIONAL DAY BUILDER  "What should I intentionally add to my day?"
 *                             (not built yet -- this file must not compete
 *                             with it once it exists)
 *
 * Aura Suggests is therefore NOT a generic activity recommender. It never
 * picks a catalog activity, never scores one, and never routes to the
 * log-activity flow. It only interprets DailyAgenda (a next Plan/Moment, a
 * gap, a caution window) -- every branch below either opens an existing
 * agenda item or says something about the day/window itself. Returns null
 * when nothing additive remains to say; the card is hidden entirely rather
 * than duplicating Good Right Now or acting as a second "what should I do"
 * engine. Zero Aura Suggests is correct, expected behavior, not a fallback
 * state to avoid.
 *
 * History: this file originally had a sixth tier, ACTIVITY_FALLBACK, that
 * picked a personalizedTasks() candidate not already shown in Good Right
 * Now. Canonical-id dedup made it impossible to show the EXACT SAME
 * activity as Good Right Now, but the two surfaces could still both
 * recommend "an activity appropriate right now" -- overlapping product
 * semantics even without a literal duplicate. Removed outright (brief
 * amendment section 1): no other caller existed, so there was nothing to
 * preserve. getPersonalizedTasks() itself is untouched in
 * personalizedTasks.ts -- only this file's use of it as a generic fallback
 * is gone.
 */

export type AuraSuggestionType = 'PREPARE_FOR_PLAN' | 'PREPARE_FOR_MOMENT' | 'COORDINATION' | 'OPEN_GAP' | 'CAUTION_CONTEXT';

export interface AuraSuggestion {
  type: AuraSuggestionType;
  title: string;
  description: string;
  icon: string;
  /** Present for PREPARE_FOR_PLAN / PREPARE_FOR_MOMENT / COORDINATION --
   * the primary action opens this agenda item via the existing
   * onOpenAgendaItem routing (the same one Your Day's own rows use). */
  agendaItem?: DailyAgendaItem;
  /** Absent entirely for CAUTION_CONTEXT -- brief section 4/7: "no action
   * required", never a generic activity attached just to give the card an
   * action. Every other type has one. */
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
}): AuraSuggestion | null {
  const { agenda, activeWindowName, currentWindowEndTime } = input;
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

  // CAUTION_CONTEXT -- day/window framing, never an activity pick. Takes
  // priority over a plain next-Plan "prepare" framing during a caution
  // window (section 12's worked example: "Keep this morning light... your
  // first planned activity is not until noon" is the preferred framing
  // over "Prepare for Learning" when both apply), referencing the next
  // Plan by name when one exists. Useful even with a fully empty agenda --
  // it interprets the current timing context, it doesn't need a Plan to
  // anchor to.
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
      // Brief section 4/7: "no action required" -- actionLabel intentionally omitted.
    };
  }

  // PREPARE_FOR_PLAN -- a next Plan, outside a caution window. Home
  // Compactness + Flexible Day Story V1 (brief section 15) -- the copy
  // interprets the gap ("some breathing room") rather than just restating
  // the agenda fact Your Day's own row already shows; the time itself
  // stays (genuinely useful context for "how much room"), it just isn't
  // the WHOLE sentence anymore.
  if (nextItemActive?.type === 'PLAN') {
    const time = formatClock(nextItemActive.startAt);
    const displayTitle = agendaItemDisplayTitle(nextItemActive);
    return {
      type: 'PREPARE_FOR_PLAN',
      title: `Some room before ${displayTitle}`,
      description: `${displayTitle} is at ${time}. Nothing else needs your attention until then.`,
      icon: nextItemActive.icon || '✨',
      actionLabel: 'View',
      secondaryLabel: 'View full day timeline',
      agendaItem: nextItemActive,
    };
  }

  // OPEN_GAP -- nothing left ahead on today's agenda, but there WAS a day
  // (something planned, current, or already completed). Interprets the gap
  // using only the existing agenda -- never a disguised activity fallback
  // (brief amendment section 3): no catalog activity is named or
  // suggested here. When the most recent past/current item is known,
  // reference it by name ("Your day is open after Learning") rather than a
  // bare generic message -- that's the Intentional Day Builder's future
  // job to fill, not this card's.
  const items = agenda?.items ?? [];
  if (!nextItemActive && items.length > 0) {
    const lastItem = items[items.length - 1];
    const lastTitle = agendaItemDisplayTitle(lastItem);
    return {
      type: 'OPEN_GAP',
      title: 'Open time ahead',
      description: `Your day is open after ${lastTitle}. Nothing else is on your agenda right now.`,
      icon: '🌤️',
      actionLabel: 'Add something',
      secondaryLabel: 'View full day timeline',
    };
  }

  // Nothing additive to say -- hide entirely. A genuinely empty,
  // non-caution day with no agenda context is the expected null case
  // (brief amendment section 5): Good Right Now still owns "what can I do
  // right now" on its own, without a second card echoing it.
  return null;
}
