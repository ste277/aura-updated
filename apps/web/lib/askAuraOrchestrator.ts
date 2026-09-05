/**
 * Ask Aura Orchestration V1 -- the ONLY place a ParsedAskAuraRequest turns
 * into a real answer. Architecture rule (brief section 6): every branch
 * below calls an EXISTING domain entry point (runTimingSearch,
 * findEverydaySharedTiming, handleMuhurthamSearchBody/
 * handleSharedMuhurthamSearchBody, getPanchangForDate, getActionCards) and
 * only adapts its output into presentation text/cards -- nothing here
 * re-scores, re-ranks, or recomputes Panchang/Muhurta/Aura Fit.
 *
 * This module is the I/O boundary (DB lookups for SavedPeople, the
 * session-resolved DailyAssistantContext) that packages/recommendation/src/
 * askAuraIntent.ts's pure parser deliberately stays free of.
 */

import {
  AskAuraIntent,
  AskAuraScope,
  AskFollowUpKind,
  AskHorizonPhrase,
  AskPanchangField,
  ParsedAskAuraRequest,
  parseFollowUpChange,
} from '../../../packages/recommendation/src/askAuraIntent';
import { DailyAssistantContext, localDateForContext, profileFromActivity, resolveHorizonDayOffsets } from '../../../packages/recommendation/src/dailyAssistant';
import { labelForRawScore, nearbyCheckInstants, runTimingSearch, TimingCandidate, TimingSearchRequest, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { evaluateEverydaySharedCandidate, findEverydaySharedTiming } from '../../../packages/recommendation/src/everydayTimingFit';
import { getActionCards } from '../../../packages/recommendation/src/actionCards';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { handleMuhurthamSearchBody, handleSharedMuhurthamSearchBody } from './muhurthamSearchRequest';
import { evaluateMuhurthamCandidateAt, isSupportedMuhurthamActivity, MuhurthamCandidateCheckOutcome, MuhurthamDateCandidate, MuhurthamSearchResult } from '../../../packages/recommendation/src/muhurthamFinder';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import { getPanchangForDate } from '../../../packages/panchang/src/panchangDay';
import { localDateTimeToUTC } from '../../../packages/panchang/src/localDate';
import { natalContextFromBirthDetails } from './natalContext';
import { listSavedPeople, SavedPerson } from './db';
import { CITY_OPTIONS, CityOption } from './cities';
import { resolveTzOffsetMinutes } from './timezone';

// ============================================================
// Structured response model (brief section 17).
// ============================================================

export type AskAuraCardType = 'ACTIVITY_OPTIONS' | 'TIMING_RESULT' | 'PANCHANG_SUMMARY' | 'MUHURTHAM_RESULTS' | 'CLARIFICATION';

export interface AskAuraCard {
  type: AskAuraCardType;
  [key: string]: unknown;
}

export type AskAuraActionType = 'PLAN_THIS' | 'CREATE_MOMENT' | 'OPEN_PLAN' | 'OPEN_TIMELINE' | 'OPEN_PANCHANG' | 'OPEN_MUHURTHAM';

export interface AskAuraAction {
  type: AskAuraActionType;
  label: string;
  /** Only for PLAN_THIS/CREATE_MOMENT -- the exact fields the existing
   * Plan/AuraMoment creation pipelines already accept (brief section 24/25:
   * "Reuse existing Plan pipeline" / "Reuse existing AuraMoment creation" --
   * never a new Ask-specific save endpoint). */
  planPayload?: {
    title: string;
    activityType: string;
    icon?: string | null;
    plannedStartAt: string;
    plannedEndAt: string;
    durationMinutes: number;
    windowType: string;
    windowLabel?: string;
    matchLabel?: string;
    recommendation?: string;
  };
  momentPayload?: {
    activityId: string;
    startAt: string;
    endAt: string;
    savedPersonId?: string;
  };
  activityId?: string;
}

export interface AskAuraResponse {
  intent: AskAuraIntent;
  message: string;
  cards?: AskAuraCard[];
  actions?: AskAuraAction[];
  /** Carried back to the client and echoed on the NEXT request so a
   * follow-up ("What about morning?", "Why?") can resolve without the
   * server re-deriving conversational state (brief section 15: "a small
   * structured conversation context", never raw chat history as product
   * state). */
  context?: ParsedAskAuraRequest;
}

export interface AskAuraOrchestratorDeps {
  userId: string;
  context: DailyAssistantContext;
  /** The client's own current Panchang window (the SAME value Home computes
   * and already sends today, page.tsx's activeType) -- GOOD_RIGHT_NOW reuses
   * it directly rather than recomputing Panchang windows a second time here
   * (brief section 7: "same source of truth as Home Good Right Now"). */
  activeWindow: string;
  /** Ask Aura Event Location V1 -- the resolved CityOption for THIS
   * request's explicit "in <location>" phrase (parsed.locationQuery),
   * already resolved server-side (resolveEventLocationQuery below) by the
   * caller (route.ts) BEFORE orchestration -- undefined when no location
   * phrase was stated, or when one was stated but did not resolve against
   * CITY_OPTIONS. Only ever consulted by the ceremonial (Muhurtham)
   * handlers below; every everyday handler ignores this field entirely
   * (brief section 2: V1 Event Location is ceremonial-only). */
  eventLocation?: CityOption;
}

/**
 * Ask Aura Event Location V1 -- resolves a free-text "in <location>"
 * capture (askAuraIntent.ts's extractLocationQuery(), never resolved by
 * the parser itself -- that file stays I/O-free) against the SAME curated
 * CITY_OPTIONS list Muhurtham Finder's own location picker already uses
 * (brief section 3/11) -- no geocoding, no second city database, no new
 * EventLocation domain type.
 *
 * findCity() (cities.ts) itself is an exact, case-sensitive `===` match --
 * correct for the picker's own dropdown, which always supplies an exact
 * CITY_OPTIONS.cityName string, but wrong for natural chat text ("in
 * chennai" must resolve the same as "in Chennai"). The smallest safe fix
 * is added HERE, at the Ask Aura boundary, rather than loosening findCity/
 * CITY_OPTIONS globally (brief section 11/38): case-insensitive matching,
 * plus matching against the city name with any ", <Country>" suffix
 * stripped, so a natural "in New York" resolves CITY_OPTIONS' own "New
 * York, USA" entry the same way the picker's UI label already reads to a
 * user. CITY_OPTIONS itself is never modified or duplicated.
 */
function normalizeCityKey(name: string): string {
  return name.split(',')[0].trim().toLowerCase();
}

export function resolveEventLocationQuery(query: string): CityOption | undefined {
  const key = normalizeCityKey(query);
  if (!key) return undefined;
  return CITY_OPTIONS.find((c) => normalizeCityKey(c.cityName) === key);
}

// ============================================================
// Horizon phrase -> real calendar range (brief section 22). The ONLY date
// math in this feature -- reuses localDateForContext/
// resolveHorizonDayOffsets from dailyAssistant.ts, the exact functions the
// real engines already use for "today"/"this weekend", rather than
// reimplementing timezone-aware date arithmetic here.
// ============================================================

function formatLocalDate(date: Date, dayOffset = 0): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate() + dayOffset;
  const shifted = new Date(Date.UTC(y, m, d));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export function resolveHorizonToDateRange(
  phrase: AskHorizonPhrase | undefined,
  customDate: string | undefined,
  context: DailyAssistantContext
): { start: string; end: string } {
  const local = localDateForContext(context);

  if (phrase === 'CUSTOM_DATE' && customDate) return { start: customDate, end: customDate };
  if (phrase === 'TOMORROW') return { start: formatLocalDate(local, 1), end: formatLocalDate(local, 1) };
  if (phrase === 'THIS_WEEKEND') {
    const offsets = resolveHorizonDayOffsets('WEEKEND', context);
    return { start: formatLocalDate(local, Math.min(...offsets)), end: formatLocalDate(local, Math.max(...offsets)) };
  }
  if (phrase === 'NEXT_WEEKEND') {
    const offsets = resolveHorizonDayOffsets('WEEKEND', context).map((o) => o + 7);
    return { start: formatLocalDate(local, Math.min(...offsets)), end: formatLocalDate(local, Math.max(...offsets)) };
  }
  if (phrase === 'THIS_WEEK' || phrase === 'NEXT_7_DAYS') {
    return { start: formatLocalDate(local, 0), end: formatLocalDate(local, 7) };
  }
  if (phrase === 'NEXT_MONTH') {
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    const firstOfNextMonth = new Date(Date.UTC(y, m + 1, 1));
    const lastOfNextMonth = new Date(Date.UTC(y, m + 2, 0));
    return {
      start: `${firstOfNextMonth.getUTCFullYear()}-${String(firstOfNextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`,
      end: `${lastOfNextMonth.getUTCFullYear()}-${String(lastOfNextMonth.getUTCMonth() + 1).padStart(2, '0')}-${String(lastOfNextMonth.getUTCDate()).padStart(2, '0')}`,
    };
  }
  // NOW / TODAY / UNSPECIFIED all default to today-only.
  return { start: formatLocalDate(local, 0), end: formatLocalDate(local, 0) };
}

function mapTimePreference(pref: ParsedAskAuraRequest['timePreference']): TimingTimePreference {
  return (pref as TimingTimePreference | undefined) ?? 'ANY';
}

function resolveDuration(activityId: string | undefined, requested: number | undefined): number {
  if (requested) return Math.min(360, Math.max(15, requested));
  const activity = activityId ? FULL_ACTIVITY_CATALOG.find((a) => a.id === activityId) : undefined;
  // The SAME default every other duration-less flow in this app uses
  // (PlanWithAuraView's own picker default) -- never a new Ask-specific
  // default table (brief section 21).
  return activity?.defaultDurationMinutes ?? 30;
}

// ============================================================
// TIMING_CHECK candidate-instant resolution (Ask Aura Exact Clock-Time
// CHECK V1) -- shared by BOTH handleTimingCheck() (generic) and
// handleMuhurthamTimingCheck() (ceremonial, PR #65) so the two paths can
// never independently drift on how a candidate instant is derived.
//
// Two cases:
//  - parsed.exactTime set (a genuine, VALID clock time the parser found --
//    "10 AM" -> "10:00"): resolve the target LOCAL calendar date (today/
//    tomorrow/ISO custom date -- parseHorizonPhrase already refuses to set
//    exactTime unless horizonPhrase names a single concrete date, never a
//    multi-day range), combine with the parsed HH:mm in the Timing/Event
//    Location's OWN timezone, and convert via localDateTimeToUTC() -- the
//    SAME canonical, DST-aware, Intl-timezone-database-driven utility
//    every other local-date+time conversion in this app already uses,
//    never a second hand-rolled UTC-offset calculation. Ask Aura's own
//    Event Location support remains deferred (brief section 28), so this
//    always uses the caller's Timing Location -- never Birth timezone.
//  - No exactTime: UNCHANGED existing behavior (this PR does not touch
//    it) -- "now" uses the literal current instant; any other horizon
//    falls back to a fixed 'T12:00:00.000Z' (UTC noon) placeholder on that
//    date, a known, documented limitation left for a later PR.
// ============================================================

function resolveTimingCheckCandidateStart(parsed: ParsedAskAuraRequest, context: DailyAssistantContext): string {
  if (parsed.exactTime) {
    const targetDate = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, context).start;
    return localDateTimeToUTC(targetDate, parsed.exactTime, context.timezone).toISOString();
  }
  return parsed.horizonPhrase === 'NOW' || !parsed.horizonPhrase
    ? context.now.toISOString()
    : resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, context).start + 'T12:00:00.000Z';
}

// ============================================================
// SavedPerson resolution by name (brief section 10) -- ownership-scoped via
// listSavedPeople(userId) (never a client-supplied savedPersonId trusted
// from free text), case-insensitive substring match, explicit ambiguous/
// not-found handling. Never reveals the full People list in an error.
// ============================================================

export type PersonResolution =
  | { status: 'RESOLVED'; person: SavedPerson }
  | { status: 'AMBIGUOUS'; matches: SavedPerson[] }
  | { status: 'NOT_FOUND' };

export async function resolvePersonByName(userId: string, nameQuery: string): Promise<PersonResolution> {
  const people = await listSavedPeople(userId);
  const normalized = nameQuery.trim().toLowerCase();
  const matches = people.filter((p) => p.name.trim().toLowerCase() === normalized);
  if (matches.length === 1) return { status: 'RESOLVED', person: matches[0] };
  if (matches.length > 1) return { status: 'AMBIGUOUS', matches };

  const partial = people.filter((p) => p.name.trim().toLowerCase().includes(normalized));
  if (partial.length === 1) return { status: 'RESOLVED', person: partial[0] };
  if (partial.length > 1) return { status: 'AMBIGUOUS', matches: partial };
  return { status: 'NOT_FOUND' };
}

// ============================================================
// Panchang term glossary (brief section 12) -- a small PRESENTATION-layer
// knowledge map only. No Panchang calculation logic here; this never
// computes anything, it only explains vocabulary that PANCHANG_QUERY/the
// rest of the app already surfaces.
// ============================================================

const PANCHANG_GLOSSARY: Record<string, string> = {
  'rahu kalam': 'A daily caution period ruled by Rahu. Traditionally better for routine, low-stakes tasks than important new starts.',
  'yamagandam': 'A daily caution period ruled by Yama. Like Rahu Kalam, better for routine work than major decisions.',
  'yama gandam': 'A daily caution period ruled by Yama. Like Rahu Kalam, better for routine work than major decisions.',
  'gulika kalam': 'A steady, workable daily period -- neither especially auspicious nor a caution window.',
  'gulika': 'A steady, workable daily period -- neither especially auspicious nor a caution window.',
  'abhijit muhurta': "The day's peak window, centered on solar noon -- traditionally the most favorable time for important work.",
  'abhijit': "The day's peak window, centered on solar noon -- traditionally the most favorable time for important work.",
  'brahma muhurta': 'The quiet period before sunrise -- traditionally favored for reflection, meditation, and a fresh start.',
  'brahma': 'The quiet period before sunrise -- traditionally favored for reflection, meditation, and a fresh start.',
  'tithi': 'The lunar day -- one of 30 phases of the Moon relative to the Sun, used to judge a day’s general quality.',
  'nakshatra': "The Moon's lunar mansion for the day (one of 27) -- a traditional signal for what the day supports.",
  'yoga': 'A luni-solar combination (one of 27) used alongside Tithi and Nakshatra to judge a day’s quality.',
  'karana': 'A half-Tithi division used for finer-grained daily timing guidance.',
  'vara': 'The weekday, as used in Panchang calculations.',
  'muhurta': 'An auspicious, specifically-chosen window of time for an important activity.',
  'muhurtham': 'An auspicious, specifically-chosen window of time for an important activity.',
  'panchang': 'The traditional Vedic calendar system Aura uses to time your day -- Tithi, Nakshatra, Yoga, Karana, and Vara.',
  'panchanga': 'The traditional Vedic calendar system Aura uses to time your day -- Tithi, Nakshatra, Yoga, Karana, and Vara.',
};

const NAKSHATRA_NOTE = 'One of the 27 lunar mansions the Moon passes through -- used to judge the day’s general quality and, for a birth chart, personal timing affinities.';
const NAKSHATRA_NAMES = new Set([
  'ashwini', 'bharani', 'krittika', 'rohini', 'mrigashira', 'ardra', 'punarvasu', 'pushya', 'ashlesha',
  'magha', 'purva phalguni', 'uttara phalguni', 'hasta', 'chitra', 'swati', 'vishakha', 'anuradha', 'jyeshtha',
  'mula', 'purva ashadha', 'uttara ashadha', 'shravana', 'dhanishta', 'shatabhisha', 'purva bhadrapada', 'uttara bhadrapada', 'revati',
]);

function explainTerm(term: string): string {
  if (PANCHANG_GLOSSARY[term]) return PANCHANG_GLOSSARY[term];
  if (NAKSHATRA_NAMES.has(term)) return `${term.charAt(0).toUpperCase()}${term.slice(1)} is a Nakshatra (lunar mansion). ${NAKSHATRA_NOTE}`;
  return "I don't have an explanation for that term yet.";
}

// ============================================================
// TIMING_RESULT card + message builders -- shared by CHECK/FIND/COMPARE so
// the presentation shape is identical everywhere a TimingCandidate is shown.
// ============================================================

function formatClock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
}

function candidateCard(candidate: TimingCandidate, timezone: string) {
  return {
    start: candidate.start,
    end: candidate.end,
    startLabel: formatClock(candidate.start, timezone),
    endLabel: formatClock(candidate.end, timezone),
    score: candidate.score,
    label: candidate.label,
    windowLabel: candidate.metadata.windowLabel,
    reasons: candidate.reasons.map((r) => formatMuhurtaReason(r)),
  };
}

function planPayloadFromCandidate(candidate: TimingCandidate, activityTitle: string, icon: string | null | undefined): AskAuraAction['planPayload'] {
  return {
    title: activityTitle,
    activityType: activityTitle,
    icon,
    plannedStartAt: candidate.start,
    plannedEndAt: candidate.end,
    durationMinutes: Math.round((new Date(candidate.end).getTime() - new Date(candidate.start).getTime()) / 60000),
    windowType: candidate.metadata.windowType,
    windowLabel: candidate.metadata.windowLabel,
    matchLabel: candidate.label === 'EXCELLENT' || candidate.label === 'VERY_GOOD' ? 'Best Match' : 'Good Match',
    recommendation: candidate.reasons[0] ? formatMuhurtaReason(candidate.reasons[0]) : undefined,
  };
}

// ============================================================
// The orchestrator entry point.
// ============================================================

export async function orchestrateAskAura(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  if (parsed.followUp === 'WHY') return handleWhy(parsed);
  if (parsed.followUp === 'OTHER_TIMES') return handleOtherTimes(parsed, deps);
  if (parsed.followUp === 'PLAN_IT') return handlePlanIt(parsed);

  if (parsed.confidence === 'LOW' || parsed.intent === 'UNKNOWN') {
    return {
      intent: 'UNKNOWN',
      message: "I'm not sure what you'd like to time. What would help?",
      cards: [{ type: 'CLARIFICATION', options: ['Find a time', 'Check a time', 'Ask about Panchang'] }],
      context: parsed,
    };
  }

  switch (parsed.intent) {
    case 'GOOD_RIGHT_NOW':
      return handleGoodRightNow(parsed, deps);
    case 'TIMING_CHECK':
      // Ask Aura Ceremonial TIMING_CHECK Capability Redirect V1 -- the same
      // capability-driven redirect TIMING_FIND already has (below), now also
      // applied to CHECK: a Muhurtham-eligible activity must be checked
      // through the canonical single-candidate Muhurtham evaluator, never
      // generic Timing Search alone. Fixes the Natural CHECK Phrasing audit's
      // top finding -- without this, "Is tomorrow good for marriage?" (FIND,
      // already redirected) and "Should I get married tomorrow?" (CHECK, NOT
      // redirected before this PR) could give contradictory answers for the
      // same instant, since generic Timing Search has no awareness of
      // ceremonial hard eligibility (authoritative avoid Tithi/Nakshatra/
      // Yoga/Karana, prohibited periods, planetary combustion). Deliberately
      // NOT `parsed.activityId === 'marriage'` -- same capability check,
      // same reasoning as the TIMING_FIND redirect below.
      if (parsed.activityId && isSupportedMuhurthamActivity(parsed.activityId)) {
        const locationGate = eventLocationGate(parsed, deps);
        if (locationGate) return locationGate;
        return handleMuhurthamTimingCheck(parsed, deps);
      }
      return handleTimingCheck(parsed, deps);
    case 'TIMING_FIND':
      // Ask Aura Marriage Muhurtham Routing V1 -- capability-driven
      // redirect: ANY resolved activity that is canonically Muhurtham-
      // eligible (isSupportedMuhurthamActivity, the same capability check
      // the parser's own MUHURTHAM_SEARCH branch already uses) executes
      // through the canonical Muhurtham path, never plain Timing Search --
      // deliberately NOT `parsed.activityId === 'marriage'`, so this covers
      // every present and future Muhurtham-eligible activity (griha-pravesh,
      // start-journey, financial-decision, business-start, etc.) the same
      // way. The parser is free to keep labeling this TIMING_FIND (brief:
      // "execution correctness matters more than intent-label
      // normalization") -- only EXECUTION is redirected here.
      if (parsed.activityId && isSupportedMuhurthamActivity(parsed.activityId)) {
        const locationGate = eventLocationGate(parsed, deps);
        if (locationGate) return locationGate;
        return handleMuhurthamSearch(parsed, deps);
      }
      return handleTimingFind(parsed, deps);
    case 'TIMING_COMPARE':
      return handleTimingCompare(parsed, deps);
    case 'PANCHANG_QUERY':
      return handlePanchangQuery(parsed, deps);
    case 'PANCHANG_EXPLAIN':
      return handlePanchangExplain(parsed);
    case 'MUHURTHAM_SEARCH': {
      const locationGate = eventLocationGate(parsed, deps);
      if (locationGate) return locationGate;
      return handleMuhurthamSearch(parsed, deps);
    }
    case 'PLAN_OPEN':
      return handlePlanOpen(parsed);
    default:
      return {
        intent: 'UNKNOWN',
        message: "I'm not sure what you'd like to time. What would help?",
        cards: [{ type: 'CLARIFICATION', options: ['Find a time', 'Check a time', 'Ask about Panchang'] }],
        context: parsed,
      };
  }
}

// ---- Event Location fail-closed gate (Ask Aura Event Location V1,
// brief section 13/14) ---------------------------------------------------

/**
 * An explicit "in <location>" phrase that did NOT resolve against
 * CITY_OPTIONS must never silently execute using the caller's own Timing
 * Location as though the stated location had succeeded -- e.g. "Should I
 * get married in Atlantis next Friday?" must return a clarification, never
 * a Muhurtham result computed against the caller's own Timing Location.
 * Only called from the three ceremonial dispatch points in
 * orchestrateAskAura (Muhurtham FIND/CHECK/search) -- V1's Event Location
 * support is ceremonial-only (brief section 1/2), so an unresolved "in X"
 * on an everyday activity is never routed through this gate at all, and
 * simply has no effect (handleTimingFind/handleTimingCheck never read
 * parsed.locationQuery or deps.eventLocation).
 */
function eventLocationGate(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): AskAuraResponse | null {
  if (!parsed.locationQuery || deps.eventLocation) return null;
  return {
    intent: parsed.intent,
    message: `I couldn't match "${parsed.locationQuery}" to a supported event location. Try one of the available cities, or set the event location in Muhurtham Finder.`,
    cards: [{ type: 'CLARIFICATION', options: [] }],
    context: parsed,
  };
}

// ---- GOOD_RIGHT_NOW (brief section 7) --------------------------------

function handleGoodRightNow(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): AskAuraResponse {
  // The SAME base table Home's own selectGoodRightNowCards() starts from
  // (getActionCards) -- never a second ranking function. The "already
  // logged today" swap Home additionally applies is not replicated here in
  // V1 (Ask has no loggedActivitiesToday in scope); see completion report.
  const cards = getActionCards(deps.activeWindow).slice(0, 3);
  return {
    intent: 'GOOD_RIGHT_NOW',
    message: 'Good choices right now:',
    cards: [{ type: 'ACTIVITY_OPTIONS', windowLabel: deps.activeWindow, options: cards }],
    actions: [{ type: 'OPEN_TIMELINE', label: 'See all activities' }],
    context: parsed,
  };
}

// ---- TIMING_CHECK (brief section 8) ----------------------------------

async function handleTimingCheck(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  const durationMinutes = resolveDuration(parsed.activityId, parsed.durationMinutes);
  const candidateStart = resolveTimingCheckCandidateStart(parsed, deps.context);

  // SHARED scope with a resolved person -> everyday shared timing (Ask
  // Aura Scope-Aware Everyday TIMING_CHECK V1), mirroring handleTimingFind's
  // own SHARED branch exactly -- same SavedPerson resolution, same
  // RESOLVED/AMBIGUOUS/NOT_FOUND handling, never a silent owner-only
  // fallback (PR #68's fail-closed invariant already guarantees scope ===
  // 'SHARED' never reaches here at all without a personNameQuery).
  if (parsed.scope === 'SHARED' && parsed.personNameQuery) {
    return handleEverydaySharedTimingCheck(parsed, deps, durationMinutes, candidateStart);
  }

  const request: TimingSearchRequest = {
    mode: 'CHECK',
    activityId: parsed.activityId,
    taskTitle: parsed.activityId ? undefined : parsed.taskTitle,
    durationMinutes,
    candidateStart,
    context: deps.context,
  };
  const result = runTimingSearch(request);
  const requested = result.requestedCandidate!;
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  const activityTitle = activity?.title ?? parsed.taskTitle ?? 'this';

  const canGo = requested.label !== 'CAUTION';
  const message = canGo ? 'You can.' : "I'd hold off for now.";

  return {
    intent: 'TIMING_CHECK',
    message,
    cards: [
      {
        type: 'TIMING_RESULT',
        activityTitle,
        requested: candidateCard(requested, deps.context.timezone),
        betterNearby: result.betterNearby ? candidateCard(result.betterNearby, deps.context.timezone) : undefined,
      },
    ],
    actions: [
      { type: 'PLAN_THIS', label: 'Plan this', planPayload: planPayloadFromCandidate(result.betterNearby ?? requested, activityTitle, activity?.icon) },
      { type: 'OPEN_PLAN', label: 'Plan better time', activityId: parsed.activityId },
    ],
    context: { ...parsed, activityId: activity?.id ?? parsed.activityId, taskTitle: activity ? undefined : parsed.taskTitle },
  };
}

// ---- TIMING_CHECK, everyday SHARED (Ask Aura Scope-Aware Everyday
// TIMING_CHECK V1) -----------------------------------------------------

/**
 * The exact requested instant, evaluated for BOTH the owner and the
 * resolved partner and blended via the SAME methodology
 * findEverydaySharedTiming()/evaluateEverydaySharedCandidate() already
 * establish for everyday SHARED FIND -- never a second scoring formula.
 * The candidate instant itself is never moved: `candidateStart` (already
 * resolved by the caller, identical to the GENERAL/PERSONAL path above) is
 * evaluated once for the primary result, and nearbyCheckInstants() supplies
 * the SAME nearby-scan instants runCheck()'s own betterNearby search would
 * use, compared here by sharedScore instead of the owner-only score, so a
 * time that's better for the owner alone but worse for the partner cannot
 * win (brief section 17).
 */
async function handleEverydaySharedTimingCheck(
  parsed: ParsedAskAuraRequest,
  deps: AskAuraOrchestratorDeps,
  durationMinutes: number,
  candidateStart: string
): Promise<AskAuraResponse> {
  const resolution = await resolvePersonByName(deps.userId, parsed.personNameQuery!);
  if (resolution.status === 'NOT_FOUND') {
    return {
      intent: 'TIMING_CHECK',
      message: `I couldn't find anyone named "${parsed.personNameQuery}" in your People list.`,
      cards: [{ type: 'CLARIFICATION', options: ['Add this person', 'Try General instead'] }],
      context: parsed,
    };
  }
  if (resolution.status === 'AMBIGUOUS') {
    return {
      intent: 'TIMING_CHECK',
      message: `You have more than one "${parsed.personNameQuery}" saved. Who did you mean?`,
      cards: [{ type: 'CLARIFICATION', options: resolution.matches.map((m) => m.name) }],
      context: parsed,
    };
  }
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  if (!activity) {
    // SAME wording handleTimingFind's own SHARED branch already uses for
    // an unresolved-catalog activity -- an unresolved free-text taskTitle
    // never gets a shared evaluation, same as it never gets an
    // auraFitScore/personalization signal at all in the GENERAL/PERSONAL
    // path (brief section 22).
    return {
      intent: 'TIMING_CHECK',
      message: "I don't have that activity in my catalog yet.",
      cards: [{ type: 'CLARIFICATION', options: ['Find a time', 'Check a time'] }],
      context: parsed,
    };
  }

  const person = resolution.person;
  const partnerContext = natalContextFromBirthDetails(
    person.birthDate.toISOString().slice(0, 10),
    person.birthTime,
    person.birthTimezone
  );

  const profile = profileFromActivity(activity);
  const activityTitle = activity.title;
  // personalContext stripped, matching findEverydaySharedTiming's own
  // generalContext convention exactly -- the CLEAN baseline the owner/
  // partner deltas are computed against, never the owner-personalized
  // context deps.context already carries (that owner personalization is
  // applied inside evaluateEverydaySharedCandidate itself, via `context`
  // below, not baked into this baseline).
  const generalContext: DailyAssistantContext = { ...deps.context, personalContext: undefined };

  const evaluateSharedAt = (startIso: string) => {
    const generalResult = runTimingSearch({
      mode: 'CHECK',
      activityId: activity.id,
      durationMinutes,
      candidateStart: startIso,
      context: generalContext,
    });
    return evaluateEverydaySharedCandidate({
      profile,
      generalCandidate: generalResult.requestedCandidate!,
      durationMinutes,
      context: deps.context,
      partnerContext,
    });
  };

  const requested = evaluateSharedAt(candidateStart);

  let betterNearby: ReturnType<typeof evaluateSharedAt> | undefined;
  for (const nearbyIso of nearbyCheckInstants(candidateStart, durationMinutes, deps.context)) {
    const candidate = evaluateSharedAt(nearbyIso);
    if (!betterNearby || candidate.sharedScore > betterNearby.sharedScore) betterNearby = candidate;
  }
  // Same "strictly better" half-point margin runCheck() itself uses.
  if (betterNearby && betterNearby.sharedScore < requested.sharedScore + 0.5) betterNearby = undefined;

  // A synthetic TimingCandidate representing the BLENDED shared result --
  // reuses every base (Panchang-derived) field from the clean general
  // candidate (start/end/metadata/reasons/conflicts) untouched, overriding
  // only score/label with the shared-blended values, so candidateCard()/
  // planPayloadFromCandidate() (unchanged, shared with every other TIMING_
  // RESULT card) can render it exactly like any other TimingCandidate.
  // Reasons stay general/base-only (never a fabricated owner-/partner-
  // specific reason string) -- the SAME convention findEverydaySharedTiming
  // already established (brief section 19: "preserve that convention").
  const toSharedTimingCandidate = (shared: ReturnType<typeof evaluateSharedAt>): TimingCandidate => ({
    ...shared.generalCandidate,
    score: shared.sharedScore,
    label: labelForRawScore(shared.sharedScore * 10),
  });

  const requestedCard = toSharedTimingCandidate(requested);
  const betterNearbyCard = betterNearby ? toSharedTimingCandidate(betterNearby) : undefined;

  const canGo = requestedCard.label !== 'CAUTION';
  // Distinct, conservative SHARED wording -- "works for both of you", never
  // "compatible"/"relationship"/"auspicious" (brief section 20/27: this is
  // timing suitability, never relationship or couple compatibility).
  const message = canGo ? 'That works well for both of you.' : "I'd hold off -- this time doesn't work as well for both of you.";

  return {
    intent: 'TIMING_CHECK',
    message,
    cards: [
      {
        type: 'TIMING_RESULT',
        activityTitle,
        scope: 'SHARED',
        personName: person.name,
        requested: candidateCard(requestedCard, deps.context.timezone),
        betterNearby: betterNearbyCard ? candidateCard(betterNearbyCard, deps.context.timezone) : undefined,
      },
    ],
    actions: [
      { type: 'PLAN_THIS', label: 'Plan this', planPayload: planPayloadFromCandidate(betterNearbyCard ?? requestedCard, activityTitle, activity.icon) },
      { type: 'OPEN_PLAN', label: 'Plan better time', activityId: activity.id },
    ],
    context: { ...parsed, activityId: activity.id, taskTitle: undefined },
  };
}

// ---- TIMING_CHECK, ceremonial (Ask Aura Ceremonial TIMING_CHECK Capability
// Redirect V1) -------------------------------------------------------------

/**
 * Ask Aura Event Location V1 -- mirrors the existing muhurtham-search
 * route's own effectiveLocation-first construction (brief section 16):
 * when a valid Event Location was resolved for this request, a FRESH
 * context is built with its latitude/longitude/timezone/tzOffsetMinutes,
 * leaving `now` and `personalContext` untouched (personalContext is built
 * exclusively from the owner's BIRTH profile in route.ts, independent of
 * location -- this never rebuilds it, so Event Location can never
 * influence Janma Nakshatra/Tara Bala, structurally, by construction).
 * Absent Event Location -> the caller's own context, byte-identical to
 * before this PR (brief section 25: omitted-location control).
 */
function buildEffectiveContext(deps: AskAuraOrchestratorDeps): DailyAssistantContext {
  if (!deps.eventLocation) return deps.context;
  return {
    ...deps.context,
    latitude: deps.eventLocation.latitude,
    longitude: deps.eventLocation.longitude,
    timezone: deps.eventLocation.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(deps.eventLocation.timezone, deps.context.now),
  };
}

/**
 * The single-candidate counterpart to handleMuhurthamSearch() -- same
 * GENERAL/PERSONAL/SHARED dispatch and SavedPerson resolution, but checking
 * ONE caller-supplied instant (never a date-range search) via
 * evaluateMuhurthamCandidateAt(). candidateStart is derived EXACTLY the same
 * way handleTimingCheck() already derives it (the "now" vs horizon-derived-
 * noon-UTC logic is untouched by this PR -- clock-time parsing is a later
 * PR's scope) so the only thing this changes is WHICH canonical evaluator
 * scores that instant for a Muhurtham-eligible activity.
 */
async function handleMuhurthamTimingCheck(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  if (!parsed.activityId) {
    return {
      intent: 'TIMING_CHECK',
      message: 'What are you checking?',
      cards: [{ type: 'CLARIFICATION', options: [] }],
      context: parsed,
    };
  }
  const durationMinutes = resolveDuration(parsed.activityId, parsed.durationMinutes);
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  const activityTitle = activity?.title ?? parsed.taskTitle ?? 'this';
  const effectiveContext = buildEffectiveContext(deps);

  const candidateStart = resolveTimingCheckCandidateStart(parsed, effectiveContext);
  const start = new Date(candidateStart);

  if (parsed.scope === 'SHARED' && parsed.personNameQuery) {
    const resolution = await resolvePersonByName(deps.userId, parsed.personNameQuery);
    if (resolution.status !== 'RESOLVED') {
      return {
        intent: 'TIMING_CHECK',
        message: resolution.status === 'NOT_FOUND' ? `I couldn't find anyone named "${parsed.personNameQuery}" in your People list.` : `You have more than one "${parsed.personNameQuery}" saved. Who did you mean?`,
        cards: resolution.status === 'AMBIGUOUS' ? [{ type: 'CLARIFICATION', options: resolution.matches.map((m) => m.name) }] : undefined,
        context: parsed,
      };
    }
    const person = resolution.person;
    const partnerContext = natalContextFromBirthDetails(
      person.birthDate.toISOString().slice(0, 10),
      person.birthTime,
      person.birthTimezone
    );
    const outcome = evaluateMuhurthamCandidateAt({
      activityId: parsed.activityId,
      start,
      durationMinutes,
      scope: 'SHARED',
      context: effectiveContext,
      partner: { savedPersonId: person.id, name: person.name, context: partnerContext },
    });
    return buildMuhurthamCheckResponse(activityTitle, activity, outcome, effectiveContext.timezone, parsed, deps.eventLocation);
  }

  const scope = parsed.scope === 'PERSONAL' ? 'PERSONAL' : 'GENERAL';
  const outcome = evaluateMuhurthamCandidateAt({ activityId: parsed.activityId, start, durationMinutes, scope, context: effectiveContext });
  return buildMuhurthamCheckResponse(activityTitle, activity, outcome, effectiveContext.timezone, parsed, deps.eventLocation);
}

/** CHECK-shaped response, never FIND/search wording -- "This is a strong
 * time for X" / "I'd avoid this time for X", never "Best dates for X:".
 * The requested instant is always the primary (and only) candidate shown --
 * no ceremonial nearby-search is performed here (brief: "primary rule --
 * requested instant must remain primary"; a broader alternative search, if
 * ever added, is a later PR's scope, mirroring how generic CHECK's own
 * betterNearby is a separate, explicit feature this function does not
 * replicate). */
function buildMuhurthamCheckResponse(
  activityTitle: string,
  activity: { icon: string } | undefined,
  outcome: MuhurthamCandidateCheckOutcome,
  timezone: string,
  parsed: ParsedAskAuraRequest,
  eventLocation?: CityOption
): AskAuraResponse {
  if (outcome.status === 'PERSONAL_PROFILE_INCOMPLETE') {
    return { intent: 'TIMING_CHECK', message: 'Add your complete birth details to get a personalized answer.', context: parsed };
  }
  if (outcome.status === 'USER_PROFILE_INCOMPLETE') {
    return { intent: 'TIMING_CHECK', message: 'Add your complete birth details to get a shared answer.', context: parsed };
  }
  if (outcome.status === 'SAVED_PERSON_PROFILE_INCOMPLETE') {
    return { intent: 'TIMING_CHECK', message: 'Add complete birth details for this person to get a shared answer.', context: parsed };
  }

  const locationSuffix = eventLocation ? ` in ${eventLocation.cityName}` : '';
  const message = outcome.eligible ? `This is a strong time for ${activityTitle}${locationSuffix}.` : `I'd avoid this time for ${activityTitle}${locationSuffix}.`;
  // Ask Aura Event Location V1, action safety (brief section 31): PR A does
  // not thread eventLocation through AskAuraAction.planPayload, so a
  // "Plan this" save here would silently drop the location and persist
  // the same clock time under the caller's own Timing Location/timezone
  // instead -- a knowingly incorrect save. Suppressed until PR B extends
  // the save payloads; "Open Muhurtham Finder" (which already supports
  // Event Location natively) remains available.
  const actions: AskAuraAction[] = eventLocation
    ? [{ type: 'OPEN_MUHURTHAM', label: 'Open Muhurtham Finder', activityId: outcome.activity.id }]
    : [
        { type: 'PLAN_THIS', label: 'Plan this', planPayload: planPayloadFromCandidate(outcome.window, activityTitle, activity?.icon) },
        { type: 'OPEN_MUHURTHAM', label: 'Open Muhurtham Finder', activityId: outcome.activity.id },
      ];
  return {
    intent: 'TIMING_CHECK',
    message,
    cards: [
      {
        type: 'TIMING_RESULT',
        activityTitle,
        ...(eventLocation ? { eventLocation: { cityName: eventLocation.cityName, timezone: eventLocation.timezone } } : {}),
        requested: candidateCard(outcome.window, timezone),
      },
    ],
    actions,
    context: { ...parsed, activityId: outcome.activity.id, taskTitle: undefined },
  };
}

// ---- TIMING_FIND (brief section 9) -----------------------------------

async function handleTimingFind(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  const durationMinutes = resolveDuration(parsed.activityId, parsed.durationMinutes);
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  const activityTitle = activity?.title ?? parsed.taskTitle ?? 'this';

  // SHARED scope with a resolved person -> everyday shared timing (brief
  // section 10), NOT plain Timing Search.
  if (parsed.scope === 'SHARED' && parsed.personNameQuery) {
    const resolution = await resolvePersonByName(deps.userId, parsed.personNameQuery);
    if (resolution.status === 'NOT_FOUND') {
      return {
        intent: 'TIMING_FIND',
        message: `I couldn't find anyone named "${parsed.personNameQuery}" in your People list.`,
        cards: [{ type: 'CLARIFICATION', options: ['Add this person', 'Try General instead'] }],
        context: parsed,
      };
    }
    if (resolution.status === 'AMBIGUOUS') {
      return {
        intent: 'TIMING_FIND',
        message: `You have more than one "${parsed.personNameQuery}" saved. Who did you mean?`,
        cards: [{ type: 'CLARIFICATION', options: resolution.matches.map((m) => m.name) }],
        context: parsed,
      };
    }
    if (!activity) {
      return {
        intent: 'TIMING_FIND',
        message: "I don't have that activity in my catalog yet.",
        cards: [{ type: 'CLARIFICATION', options: ['Find a time', 'Check a time'] }],
        context: parsed,
      };
    }
    const person = resolution.person;
    const partnerContext = natalContextFromBirthDetails(
      person.birthDate.toISOString().slice(0, 10),
      person.birthTime,
      person.birthTimezone
    );
    const dateRange = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, deps.context);
    const outcome = findEverydaySharedTiming({
      activityId: activity.id,
      durationMinutes,
      dateRange,
      timePreference: mapTimePreference(parsed.timePreference),
      context: deps.context,
      partnerContext,
    });
    if (outcome.status === 'UNSUPPORTED_ACTIVITY') {
      return {
        intent: 'TIMING_FIND',
        message: "I don't have that activity in my catalog yet.",
        context: parsed,
      };
    }
    const best = outcome.candidates[0];
    return {
      intent: 'TIMING_FIND',
      message: best ? `Best for you both: ${formatClock(best.generalCandidate.start, deps.context.timezone)}.` : "I couldn't find a strong shared time in that range.",
      cards: [
        {
          type: 'TIMING_RESULT',
          activityTitle,
          scope: 'SHARED',
          personName: person.name,
          results: outcome.candidates.slice(0, 3).map((c) => ({ ...candidateCard(c.generalCandidate, deps.context.timezone), sharedScore: c.sharedScore, rating: c.rating })),
        },
      ],
      actions: best
        ? [{ type: 'CREATE_MOMENT', label: 'Make this a Moment', momentPayload: { activityId: activity.id, startAt: best.generalCandidate.start, endAt: best.generalCandidate.end, savedPersonId: person.id } }]
        : [],
      context: { ...parsed, activityId: activity.id, taskTitle: undefined },
    };
  }

  const dateRange = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, deps.context);
  const request: TimingSearchRequest = {
    mode: 'FIND',
    activityId: parsed.activityId,
    taskTitle: parsed.activityId ? undefined : parsed.taskTitle,
    durationMinutes,
    dateRange,
    timePreference: mapTimePreference(parsed.timePreference),
    context: deps.context,
    limit: 3,
  };
  const result = runTimingSearch(request);
  const best = result.candidates[0];

  return {
    intent: 'TIMING_FIND',
    message: best ? `I'd choose ${formatClock(best.start, deps.context.timezone)}.` : "I couldn't find a strong time in that range.",
    cards: best
      ? [{ type: 'TIMING_RESULT', activityTitle, best: candidateCard(best, deps.context.timezone), others: result.candidates.slice(1).map((c) => candidateCard(c, deps.context.timezone)) }]
      : [],
    actions: best ? [{ type: 'PLAN_THIS', label: 'Plan this', planPayload: planPayloadFromCandidate(best, activityTitle, activity?.icon) }] : [],
    context: { ...parsed, activityId: activity?.id ?? parsed.activityId, taskTitle: activity ? undefined : parsed.taskTitle },
  };
}

// ---- TIMING_COMPARE ----------------------------------------------------

async function handleTimingCompare(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  // Ask Aura's free-text parser cannot itself enumerate the 2+ explicit
  // instants COMPARE requires (brief: candidateStarts, not a phrase) --
  // routes to Plan's own Compare mode rather than guessing candidates.
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  return {
    intent: 'TIMING_COMPARE',
    message: 'Open Compare in Plan to pick the exact times you want to weigh against each other.',
    actions: [{ type: 'OPEN_PLAN', label: 'Compare times', activityId: activity?.id }],
    context: parsed,
  };
}

// ---- PANCHANG_QUERY (brief section 11) -------------------------------

function handlePanchangQuery(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): AskAuraResponse {
  const dateRange = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, deps.context);
  const day = getPanchangForDate({ localDate: dateRange.start, latitude: deps.context.latitude, longitude: deps.context.longitude, timezone: deps.context.timezone });
  const field: AskPanchangField = parsed.panchangField ?? 'FULL';

  if (field === 'FULL') {
    return {
      intent: 'PANCHANG_QUERY',
      message: `${dateRange.start === formatLocalDate(localDateForContext(deps.context)) ? "Today's" : 'That day’s'} Panchang:`,
      cards: [{ type: 'PANCHANG_SUMMARY', date: day.date, panchanga: day.panchanga, windows: day.windows }],
      actions: [{ type: 'OPEN_PANCHANG', label: 'Open Panchang Calendar' }],
      context: parsed,
    };
  }

  if (field === 'NAKSHATRA' || field === 'TITHI' || field === 'YOGA' || field === 'KARANA' || field === 'VARA') {
    const valueMap: Record<string, string> = {
      NAKSHATRA: day.panchanga.nakshatra.name,
      TITHI: day.panchanga.tithi.name,
      YOGA: day.panchanga.yoga.name,
      KARANA: day.panchanga.karana.name,
      VARA: day.panchanga.vara,
    };
    return {
      intent: 'PANCHANG_QUERY',
      message: `${field.charAt(0)}${field.slice(1).toLowerCase()}: ${valueMap[field]}.`,
      context: parsed,
    };
  }

  // A specific window (Rahu Kalam / Yama / Gulika / Abhijit / Brahma).
  const window = day.windows.find((w) => w.type === field);
  if (!window) {
    return { intent: 'PANCHANG_QUERY', message: "I couldn't find that window for that day.", context: parsed };
  }
  return {
    intent: 'PANCHANG_QUERY',
    message: `${window.label}: ${formatClock(window.start, deps.context.timezone)} – ${formatClock(window.end, deps.context.timezone)}.`,
    context: parsed,
  };
}

// ---- PANCHANG_EXPLAIN (brief section 12) -----------------------------

function handlePanchangExplain(parsed: ParsedAskAuraRequest): AskAuraResponse {
  const term = parsed.explainTerm ?? '';
  return {
    intent: 'PANCHANG_EXPLAIN',
    message: explainTerm(term),
    context: parsed,
  };
}

// ---- MUHURTHAM_SEARCH (brief section 13) ------------------------------

async function handleMuhurthamSearch(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  if (!parsed.activityId) {
    return {
      intent: 'MUHURTHAM_SEARCH',
      message: 'What are you planning?',
      cards: [{ type: 'CLARIFICATION', options: [] }],
      context: parsed,
    };
  }
  const effectiveContext = buildEffectiveContext(deps);
  const dateRange = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, effectiveContext);
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);

  if (parsed.scope === 'SHARED' && parsed.personNameQuery) {
    const resolution = await resolvePersonByName(deps.userId, parsed.personNameQuery);
    if (resolution.status !== 'RESOLVED') {
      return {
        intent: 'MUHURTHAM_SEARCH',
        message: resolution.status === 'NOT_FOUND' ? `I couldn't find anyone named "${parsed.personNameQuery}" in your People list.` : `You have more than one "${parsed.personNameQuery}" saved. Who did you mean?`,
        cards: resolution.status === 'AMBIGUOUS' ? [{ type: 'CLARIFICATION', options: resolution.matches.map((m) => m.name) }] : undefined,
        context: parsed,
      };
    }
    const person = resolution.person;
    const partnerContext = natalContextFromBirthDetails(
      person.birthDate.toISOString().slice(0, 10),
      person.birthTime,
      person.birthTimezone
    );
    const outcome = handleSharedMuhurthamSearchBody(
      { activityId: parsed.activityId, scope: 'SHARED', dateRange, durationMinutes: parsed.durationMinutes, savedPersonId: person.id },
      effectiveContext,
      { savedPersonId: person.id, name: person.name, context: partnerContext }
    );
    if (!outcome.ok) return { intent: 'MUHURTHAM_SEARCH', message: outcome.error, context: parsed };
    if ('status' in outcome.result && outcome.result.status !== 'OK') {
      return { intent: 'MUHURTHAM_SEARCH', message: 'Add complete birth details to get shared Muhurtham dates.', context: parsed };
    }
    const sharedDates = 'dates' in outcome.result ? outcome.result.dates : [];
    // MuhurthamSharedDateCandidate has the same date/rating/bestWindow/
    // reasons shape as MuhurthamDateCandidate, just under `sharedScore`
    // instead of `score` (it also carries per-person breakdowns the
    // Ask response doesn't surface) -- mapped here rather than widening
    // buildMuhurthamResponse's own type for one caller.
    const dates = sharedDates.map((d) => ({ ...d, score: d.sharedScore }));
    return buildMuhurthamResponse(activity?.title ?? parsed.activityId, dates, effectiveContext.timezone, parsed, deps.eventLocation);
  }

  const scope = parsed.scope === 'PERSONAL' ? 'PERSONAL' : 'GENERAL';
  const outcome = handleMuhurthamSearchBody({ activityId: parsed.activityId, scope, dateRange, durationMinutes: parsed.durationMinutes }, effectiveContext);
  if (!outcome.ok) return { intent: 'MUHURTHAM_SEARCH', message: outcome.error, context: parsed };
  const result = outcome.result as MuhurthamSearchResult;
  const dates = 'dates' in result ? result.dates : [];
  return buildMuhurthamResponse(activity?.title ?? parsed.activityId, dates, effectiveContext.timezone, parsed, deps.eventLocation);
}

/** GENERAL's MuhurthamDateCandidate and SHARED's MuhurthamSharedDateCandidate
 * share this exact shape (date/rating/score/bestWindow/reasons) -- the only
 * fields this response actually renders -- so this accepts either via a
 * minimal structural type rather than forcing SHARED's richer per-person
 * breakdown through GENERAL's own narrower rating enum. */
interface MuhurthamResultLike {
  date: string;
  rating: string;
  score: number;
  bestWindow: { start: string; end: string };
  reasons: import('../../../packages/muhurta/src/activityOntology').MuhurtaReason[];
}

function buildMuhurthamResponse(
  activityTitle: string,
  dates: MuhurthamResultLike[],
  timezone: string,
  parsed: ParsedAskAuraRequest,
  eventLocation?: CityOption
): AskAuraResponse {
  const locationSuffix = eventLocation ? ` in ${eventLocation.cityName}` : '';
  if (dates.length === 0) {
    return {
      intent: 'MUHURTHAM_SEARCH',
      message: `I couldn't find a strong Muhurtham for ${activityTitle}${locationSuffix} in that range.`,
      actions: [{ type: 'OPEN_MUHURTHAM', label: 'Open Muhurtham Finder', activityId: parsed.activityId }],
      context: parsed,
    };
  }
  return {
    intent: 'MUHURTHAM_SEARCH',
    message: `Best dates for ${activityTitle}${locationSuffix}:`,
    cards: [
      {
        type: 'MUHURTHAM_RESULTS',
        activityTitle,
        ...(eventLocation ? { eventLocation: { cityName: eventLocation.cityName, timezone: eventLocation.timezone } } : {}),
        dates: dates.slice(0, 3).map((d) => ({
          date: d.date,
          rating: d.rating,
          score: d.score,
          startLabel: formatClock(d.bestWindow.start, timezone),
          endLabel: formatClock(d.bestWindow.end, timezone),
          reasons: d.reasons.map((r) => formatMuhurtaReason(r)),
        })),
      },
    ],
    actions: [{ type: 'OPEN_MUHURTHAM', label: 'Open Muhurtham Finder', activityId: parsed.activityId }],
    context: parsed,
  };
}

// ---- PLAN_OPEN (brief section 5/26) -----------------------------------

function handlePlanOpen(parsed: ParsedAskAuraRequest): AskAuraResponse {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  return {
    intent: 'PLAN_OPEN',
    message: activity ? `Want me to find a time for ${activity.title}?` : 'Want me to help plan this?',
    actions: [{ type: 'OPEN_PLAN', label: 'Open in Plan', activityId: parsed.activityId }],
    context: parsed,
  };
}

// ---- Follow-ups (brief section 15/16) ---------------------------------

function handleWhy(parsed: ParsedAskAuraRequest): AskAuraResponse {
  // "Why?" expands reasons already present in the previous turn's own
  // context -- never a recomputed/invented explanation (brief section 39).
  return {
    intent: parsed.intent,
    message: 'Here’s why: see the reasons on the last result above.',
    context: parsed,
  };
}

async function handleOtherTimes(parsed: ParsedAskAuraRequest, deps: AskAuraOrchestratorDeps): Promise<AskAuraResponse> {
  if (parsed.intent === 'TIMING_FIND') return handleTimingFind(parsed, deps);
  if (parsed.intent === 'MUHURTHAM_SEARCH') return handleMuhurthamSearch(parsed, deps);
  return { intent: parsed.intent, message: 'There are no other times to show for this.', context: parsed };
}

function handlePlanIt(parsed: ParsedAskAuraRequest): AskAuraResponse {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === parsed.activityId);
  return {
    intent: parsed.intent,
    message: 'Use "Plan this" on the result above to save it.',
    actions: activity ? [{ type: 'OPEN_PLAN', label: 'Open in Plan', activityId: activity.id }] : [],
    context: parsed,
  };
}

export { parseFollowUpChange };
export type { AskFollowUpKind, AskAuraScope };
