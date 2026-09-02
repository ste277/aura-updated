import type { DailyAgenda } from './dailyAgenda';
import { resolveDailyStoryPhase } from './dailyStory';
import { User, listSavedPeople, listDayBuilderDismissals } from './db';
import { resolveTzOffsetMinutes, getMinuteOfDayInTimezone } from './timezone';
import { buildPersonalMuhurtaContextForUser, natalContextFromBirthDetails } from './natalContext';
import { DailyAssistantContext } from '../../../packages/recommendation/src/dailyAssistant';
import { runTimingSearch } from '../../../packages/recommendation/src/timingSearch';
import { findEverydaySharedTiming } from '../../../packages/recommendation/src/everydayTimingFit';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';
import {
  buildDayProfile,
  buildDailyPriorityCoverage,
  coveredIntentionGroupIds,
  selectIntentionCandidates,
  candidateFitsOpenings,
  dismissalKey,
  resolvePrioritizedIntentionGroups,
  PEOPLE_GROUP_RELATIONSHIP_TYPES,
  IntentionalDaySuggestion,
  UserPriorityGroup,
  AgendaOpening,
} from './dayBuilder';
import type { DailyIntentionGroupId } from './dailyIntentions';

/**
 * Intentional Day Builder V1 -- the I/O orchestrator behind
 * GET /api/my-day/suggestions (brief section 37/41's "route/orchestrator
 * should do I/O, domain functions should derive" split, same architecture
 * as myDayOrchestrator.ts). Owns the one bounded extra read
 * (listSavedPeople) and the calls into the EXISTING canonical timing
 * engines -- runTimingSearch()/findEverydaySharedTiming() are called
 * in-process here, never via a self-HTTP round trip, so this stays cheap
 * enough to live behind its own endpoint separate from the fast-rendering
 * GET /api/my-day (brief section 37).
 *
 * This is deliberately NOT a new timing or recommendation engine (the
 * brief's own primary directive): dayBuilder.ts decides WHAT to consider
 * and WHETHER a returned time fits the day; this function's only real job
 * is calling the two existing search entry points and discarding anything
 * that doesn't fit -- it never computes or adjusts a score or a time itself.
 */

const MAX_CANDIDATE_ATTEMPTS = 5;
/** Brief section 18/19 -- the UI only ever DISPLAYS up to 3 at once. This
 * function itself returns every candidate that resolved a real time (up to
 * MAX_CANDIDATE_ATTEMPTS), so the client has a small reserve pool for the
 * lightweight "Another idea" swap (brief section 24) without a second
 * network round trip or a second timing search. */
/** Over-fetch from the canonical engines so candidateFitsOpenings() has a
 * real pool to filter from, rather than just accepting/rejecting the
 * single best-ranked slot. Still capped small -- this is the ONLY place
 * more than a handful of candidates are ever requested, and only for the
 * few intention candidates selectIntentionCandidates() already narrowed to. */
const SEARCH_LIMIT_PER_CANDIDATE = 5;
/** Home Compactness + Flexible Day Story V1 (brief section 24/47) -- how
 * many of the already-ranked, already-openings-filtered candidates each
 * suggestion keeps for the client to choose between. The UI defaults to
 * showing 2 with an "Other times" reveal for the 3rd (brief section 24) --
 * this constant is the DATA cap, not the display default, so the UI can
 * make that presentation call without a second round trip. */
const MAX_DISPLAY_CANDIDATES = 3;
/** Brief section 25 -- "do not show uselessly similar options": a light,
 * NON-rescoring presentation filter (never adjusts score or discards the
 * higher-ranked of two candidates from a scoring standpoint -- it simply
 * skips a later, already-lower-ranked candidate that lands too close in
 * clock time to one already kept, same spirit as
 * selectDiversePlanningOptions' own spacing rule in dailyAssistant.ts,
 * applied here only because SHARED's own ranking (everydayTimingFit.ts)
 * does not reapply that engine-level spacing after re-scoring by
 * sharedScore -- see the completion report). */
const MIN_DISPLAY_CANDIDATE_SPACING_MINUTES = 45;

function durationMinutesFor(activityId: string): number {
  const definition = getActivityDefinition(activityId);
  return definition?.experience.defaultDurationMinutes ?? definition?.experience.suggestedDurations?.[0] ?? 45;
}

/** Brief section 24/25 -- from an already-ranked candidate list, keep up to
 * `MAX_DISPLAY_CANDIDATES` that both fit an agenda opening AND aren't
 * clock-time-redundant with one already kept. Preserves the engine's own
 * ranking order (candidates[0] stays the default-selected, highest-ranked
 * slot); never reorders, rescales, or drops the top candidate to make room
 * for a "more diverse" lower one. */
function pickDiverseFittingCandidates<T extends { start: string; end: string }>(
  pool: T[],
  openings: AgendaOpening[],
  timezone: string,
  localDate: string
): T[] {
  const kept: T[] = [];
  for (const candidate of pool) {
    if (kept.length >= MAX_DISPLAY_CANDIDATES) break;
    if (!candidateFitsOpenings(candidate, openings, timezone, localDate)) continue;
    const startMinute = getMinuteOfDayInTimezone(timezone, new Date(candidate.start));
    const tooClose = kept.some((k) => Math.abs(getMinuteOfDayInTimezone(timezone, new Date(k.start)) - startMinute) < MIN_DISPLAY_CANDIDATE_SPACING_MINUTES);
    if (tooClose) continue;
    kept.push(candidate);
  }
  return kept;
}

function formatUTCDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function buildIntentionalDaySuggestions(input: {
  user: User;
  agenda: DailyAgenda;
  minuteOfDay: number;
  now: Date;
}): Promise<IntentionalDaySuggestion[]> {
  const { user, agenda, minuteOfDay, now } = input;

  // Brief section 6 -- a muted/disabled user gets nothing computed at all,
  // not just nothing rendered (never spend the search budget on a
  // suggestion the user has already said they don't want).
  if (!user.dayBuilderEnabled) return [];
  // Brief section 27/33/34 -- NIGHT defers entirely to Daily Reflection /
  // Tomorrow Preview, which already own "what's next" at that phase. Not
  // just hidden in the UI: nothing is computed, so there's no wasted search.
  if (resolveDailyStoryPhase(minuteOfDay) === 'NIGHT') return [];

  const dayProfile = buildDayProfile(agenda, minuteOfDay);
  const mutedGroups = new Set(user.dayBuilderMutedGroups as DailyIntentionGroupId[]);
  // Personalization Foundation V1 (brief section 3/6) -- ordering only,
  // computed BEFORE and entirely separately from mutedGroups above;
  // selectIntentionCandidates() applies mutedGroups' exclusion identically
  // regardless of priority, so a muted group can never be "un-muted" by
  // also being a priority (brief section 6's own explicit ordering:
  // dismissed -> muted -> priorities -> diversity -> timing engine).
  const prioritizedGroupIds = resolvePrioritizedIntentionGroups(user.dayBuilderPriorities as UserPriorityGroup[]);
  // Personalized Daily Story V2 (brief section 6) -- "diversity, not
  // exclusion": a prioritized group already COVERED today (real agenda
  // content, not inferred) is deprioritized in ordering, never excluded or
  // muted. Cheap, pure, and computed from the SAME agenda already in hand
  // -- not a second read, not a duplicated derivation (buildDailyStory's
  // own personalization uses this identical function via myDayOrchestrator.ts).
  const coverage = buildDailyPriorityCoverage(agenda, user.dayBuilderPriorities as UserPriorityGroup[]);
  const coveredGroupIds = coveredIntentionGroupIds(coverage);
  const intentionCandidates = selectIntentionCandidates(dayProfile, mutedGroups, MAX_CANDIDATE_ATTEMPTS, prioritizedGroupIds, coveredGroupIds);
  // Brief section 13 -- zero is a valid, successful result. Skip every
  // downstream read/search entirely rather than computing anything further.
  if (intentionCandidates.length === 0) return [];

  const [savedPeople, dismissals] = await Promise.all([
    listSavedPeople(user.id),
    listDayBuilderDismissals(user.id, agenda.localDate),
  ]);
  // "Not today" (brief: dismiss support) -- a per-(activityId, personId)
  // identity, NOT a groupId mute, and bounded to TODAY's localDate only
  // (see migration 0026's own doc comment for why rollover needs no
  // cleanup). Checked per-attempt below, never at candidate SELECTION time
  // -- selectIntentionCandidates() has no person context yet, so filtering
  // there would incorrectly block a people-oriented activity's SHARED
  // resolution against a person the no-person identity was never about.
  const dismissedKeys = new Set(dismissals.map((d) => dismissalKey(d.activityId, d.personId)));

  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };

  const suggestions: IntentionalDaySuggestion[] = [];

  for (const candidate of intentionCandidates) {
    const activityId = candidate.activity.activityId;
    if (!activityId) continue;
    const durationMinutes = durationMinutesFor(activityId);

    let resolved: IntentionalDaySuggestion['candidate'] | null = null;

    // Brief section 9/21 -- a people-oriented suggestion only ever resolves
    // a SHARED candidate against a REAL, already-saved SavedPerson (their
    // own already-stored, already-required birth data -- never invented).
    // No SavedPerson of the right relationship type simply means no SHARED
    // attempt; it still falls through to a SOLO search below, so "Coffee /
    // tea" can still be proposed and added even with no one saved to invite.
    if (candidate.isPeopleOriented) {
      const relationshipTypes = PEOPLE_GROUP_RELATIONSHIP_TYPES[candidate.groupId] ?? [];
      const eligiblePeople = savedPeople.filter((p) => relationshipTypes.includes(p.relationshipType));
      // "Make more time for" (brief section 4) -- when more than one
      // eligible person exists for this group, prefer one the user
      // explicitly flagged. Never compatibility scoring: just WHICH
      // already-eligible person gets picked when there's a genuine choice
      // -- the person still has to independently resolve a real fitting
      // time below, same as anyone else.
      const person = eligiblePeople.find((p) => user.dayBuilderPriorityPersonIds.includes(p.id)) ?? eligiblePeople[0];
      // "Not today" against THIS exact person -- a different (undismissed)
      // person, or no person at all, remains a genuinely different
      // suggestion and is never blocked by this.
      if (person && !dismissedKeys.has(dismissalKey(activityId, person.id))) {
        const partnerContext = natalContextFromBirthDetails(formatUTCDateString(person.birthDate), person.birthTime, person.birthTimezone);
        const outcome = findEverydaySharedTiming({
          activityId,
          durationMinutes,
          horizon: 'TODAY',
          limit: SEARCH_LIMIT_PER_CANDIDATE,
          context,
          partnerContext,
        });
        if (outcome.status === 'OK') {
          // candidateFitsOpenings expects {start, end} -- EverydaySharedCandidate
          // itself carries both directly (mirrors generalCandidate's own
          // start/end), so the fit check runs against the shared candidate,
          // not a nested lookup.
          const fits = pickDiverseFittingCandidates(outcome.candidates, dayProfile.openings, agenda.timezone, agenda.localDate);
          if (fits.length > 0) {
            resolved = { kind: 'SHARED', candidates: fits, person: { id: person.id, name: person.name, relationshipType: person.relationshipType } };
          }
        }
      }
    }

    // "Not today" against the no-person identity (brief: also covers a
    // non-people-oriented candidate, whose identity is always no-person).
    if (!resolved && !dismissedKeys.has(dismissalKey(activityId, ''))) {
      const result = runTimingSearch({ mode: 'FIND', activityId, durationMinutes, horizon: 'TODAY', limit: SEARCH_LIMIT_PER_CANDIDATE, context });
      const fits = pickDiverseFittingCandidates(result.candidates, dayProfile.openings, agenda.timezone, agenda.localDate);
      if (fits.length > 0) resolved = { kind: 'SOLO', candidates: fits };
    }

    // Brief section 14 -- never invent a time. No fitting candidate today
    // means this intention is silently dropped, not downgraded to a
    // name-only suggestion.
    if (!resolved) continue;

    suggestions.push({
      id: `${candidate.groupId}:${activityId}`,
      groupId: candidate.groupId,
      activityId,
      label: candidate.activity.label,
      icon: candidate.activity.icon,
      durationMinutes,
      reason: candidate.reason,
      candidate: resolved,
    });
  }

  return suggestions;
}
