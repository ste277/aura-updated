import type { AuraUpdate } from './auraUpdates';
import type { AuraReminder } from './auraReminders';
import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';

/**
 * My Day V1 (brief section 31) -- "derive one next meaningful item," in the
 * exact priority order specified, reusing states that already exist
 * elsewhere rather than computing a new score:
 *   1. an actionable Moment coordination issue (topMomentUpdate -- already
 *      computed by page.tsx from GET /api/aura-updates)
 *   2. an active Starting Soon reminder (startingSoonReminder -- same call)
 *   3. the next agenda item (DailyAgenda.nextItem -- GET /api/my-day)
 *   4. a next useful timing opportunity (left to the existing Aura Suggests/
 *      Next Best Moment cards, which already cover this -- this function
 *      only reports "nothing at tiers 1-3", callers fall through to those
 *      existing cards rather than this function inventing a fourth source)
 *
 * Deliberately pure and synchronous: no new fetch, no new DB read. Lives
 * client-side (not inside GET /api/my-day) so it can combine data from BOTH
 * the existing /api/aura-updates response and the new /api/my-day response
 * without either route re-deriving the other's already-computed state.
 */

export type NextMeaningfulThing =
  | { tier: 1; kind: 'MOMENT_UPDATE'; update: AuraUpdate }
  | { tier: 2; kind: 'STARTING_SOON'; reminder: AuraReminder }
  | { tier: 3; kind: 'AGENDA_ITEM'; item: DailyAgendaItem }
  | null;

export function deriveNextMeaningfulThing(input: {
  topMomentUpdate?: AuraUpdate | null;
  startingSoonReminder?: AuraReminder | null;
  agenda?: DailyAgenda | null;
}): NextMeaningfulThing {
  if (input.topMomentUpdate) return { tier: 1, kind: 'MOMENT_UPDATE', update: input.topMomentUpdate };
  if (input.startingSoonReminder) return { tier: 2, kind: 'STARTING_SOON', reminder: input.startingSoonReminder };
  if (input.agenda?.nextItem) return { tier: 3, kind: 'AGENDA_ITEM', item: input.agenda.nextItem };
  return null;
}
