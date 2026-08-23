import type { AuraMoment, AuraMomentAlternativePreference } from './db';
import type { AuraReminder } from './auraReminders';

/**
 * Aura Updates V1 -- an in-app-only representation of "recipient activity
 * the owner hasn't acted on yet". Deliberately DERIVED, not stored: brief
 * section 3 asks to audit whether a generic notifications table is needed,
 * and it isn't -- every field below already lives on AuraMoment (plus the
 * one new `ownerSeenResponseAt` timestamp migration 0018 added). This file
 * is the single place that turns a list of AuraMoment rows into what the
 * owner sees as "updates" -- Home, the You badge, and GET /api/aura-updates
 * all call the same function so they can never disagree.
 */

export type AuraUpdateType = 'MOMENT_ACCEPTED' | 'MOMENT_ANOTHER_TIME';

export interface AuraUpdate {
  /** The moment's own publicToken -- stable, unique, and already the
   * external identifier every other Aura Moment route keys off. There is
   * exactly one "current" update per moment (its latest response), so this
   * needs no separate id space. */
  id: string;
  type: AuraUpdateType;
  momentToken: string;
  activityTitle: string;
  /** Safe display name only (brief section 16) -- never natal/SavedPerson
   * internal data. Absent for a GENERAL/PERSONAL moment with no named
   * recipient. */
  recipientDisplayName?: string;
  eventStartAt: string; // ISO
  /** Only ever present for MOMENT_ANOTHER_TIME. */
  preference?: AuraMomentAlternativePreference;
  occurredAt: string; // ISO -- the response's own respondedAt
  /**
   * Section 14: "keep unread and actionable separate." An ANOTHER_TIME
   * update requires action until a replacement has been suggested (brief
   * section 13) -- once a successor AuraMoment exists, THIS update is
   * resolved even if the owner never explicitly marked it seen. ACCEPTED
   * never requires action; it's a confirmation, not a task.
   */
  requiresAction: boolean;
  /** Independent of requiresAction -- "has the owner looked at this
   * response at all yet", derived by comparing ownerSeenResponseAt to
   * respondedAt (never a bare stored boolean, so a later re-response is
   * automatically unread again with no extra write anywhere). */
  unread: boolean;
}

export interface AuraUpdatesSummary {
  unreadCount: number;
  updates: AuraUpdate[];
}

/** GET /api/aura-updates' actual response shape (Aura Reminders V1, brief
 * section 26) -- an ADDITIVE extension of AuraUpdatesSummary: `updates` and
 * the moment-response half of `unreadCount` are unchanged, `upcoming` is
 * new (reminders whose window is currently active, most imminent first --
 * see deriveAuraReminders in lib/auraReminders.ts). `unreadCount` here also
 * folds in `upcoming.length` (brief section 18/19: an active reminder
 * counts toward the Bell badge for as long as its window stays active). */
export interface AuraUpdatesResponse {
  unreadCount: number;
  updates: AuraUpdate[];
  upcoming: AuraReminder[];
}

/** Section 5's "reasonable recent limit" for what the API returns in
 * `updates` (Home shows far fewer -- see homeMomentCards() below). The DB
 * query itself (listRecentRespondedAuraMomentsForOwner) is capped higher so
 * unreadCount stays accurate even when more responses exist than the
 * display list shows. */
const API_UPDATE_DISPLAY_LIMIT = 20;

function toAuraUpdate(moment: AuraMoment, hasSuccessor: boolean): AuraUpdate {
  const type: AuraUpdateType = moment.responseState === 'ACCEPTED' ? 'MOMENT_ACCEPTED' : 'MOMENT_ANOTHER_TIME';
  return {
    id: moment.publicToken,
    type,
    momentToken: moment.publicToken,
    activityTitle: moment.activityTitle,
    recipientDisplayName: moment.sharedPersonDisplayName ?? undefined,
    eventStartAt: moment.startAt.toISOString(),
    preference: type === 'MOMENT_ANOTHER_TIME' ? moment.responsePreference ?? undefined : undefined,
    occurredAt: moment.respondedAt!.toISOString(),
    requiresAction: type === 'MOMENT_ANOTHER_TIME' && !hasSuccessor,
    unread: !moment.ownerSeenResponseAt || moment.ownerSeenResponseAt.getTime() < moment.respondedAt!.getTime(),
  };
}

/**
 * `moments` must already be scoped to ONE owner and to ACTIVE moments that
 * have a response (see listRecentRespondedAuraMomentsForOwner) -- this
 * function does no further ownership/status filtering itself, it only
 * shapes and ranks. Priority (brief section 8): requiresAction first (an
 * ANOTHER_TIME nobody has followed up on yet), then most-recent first
 * within each bucket.
 */
export function summarizeAuraUpdates(moments: AuraMoment[], momentIdsWithSuccessor: Set<string>): AuraUpdatesSummary {
  const all = moments
    .filter((m) => m.responseState !== null && m.respondedAt !== null)
    .map((m) => toAuraUpdate(m, momentIdsWithSuccessor.has(m.id)))
    .sort((a, b) => {
      if (a.requiresAction !== b.requiresAction) return a.requiresAction ? -1 : 1;
      return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    });

  const unreadCount = all.filter((u) => u.unread).length;
  return { unreadCount, updates: all.slice(0, API_UPDATE_DISPLAY_LIMIT) };
}
