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
import { DailyAssistantContext, localDateForContext, resolveHorizonDayOffsets } from '../../../packages/recommendation/src/dailyAssistant';
import { runTimingSearch, TimingCandidate, TimingSearchRequest, TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { findEverydaySharedTiming } from '../../../packages/recommendation/src/everydayTimingFit';
import { getActionCards } from '../../../packages/recommendation/src/actionCards';
import { FULL_ACTIVITY_CATALOG } from '../../../packages/recommendation/src/personalizedTasks';
import { handleMuhurthamSearchBody, handleSharedMuhurthamSearchBody } from './muhurthamSearchRequest';
import { isSupportedMuhurthamActivity, MuhurthamDateCandidate, MuhurthamSearchResult } from '../../../packages/recommendation/src/muhurthamFinder';
import { formatMuhurtaReason } from '../../../packages/muhurta/src/muhurtaReasonFormat';
import { getPanchangForDate } from '../../../packages/panchang/src/panchangDay';
import { natalContextFromBirthDetails } from './natalContext';
import { listSavedPeople, SavedPerson } from './db';

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
        return handleMuhurthamSearch(parsed, deps);
      }
      return handleTimingFind(parsed, deps);
    case 'TIMING_COMPARE':
      return handleTimingCompare(parsed, deps);
    case 'PANCHANG_QUERY':
      return handlePanchangQuery(parsed, deps);
    case 'PANCHANG_EXPLAIN':
      return handlePanchangExplain(parsed);
    case 'MUHURTHAM_SEARCH':
      return handleMuhurthamSearch(parsed, deps);
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
  const candidateStart = parsed.horizonPhrase === 'NOW' || !parsed.horizonPhrase
    ? deps.context.now.toISOString()
    : resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, deps.context).start + 'T12:00:00.000Z';

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
  const dateRange = resolveHorizonToDateRange(parsed.horizonPhrase, parsed.customDate, deps.context);
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
      deps.context,
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
    return buildMuhurthamResponse(activity?.title ?? parsed.activityId, dates, deps.context.timezone, parsed);
  }

  const scope = parsed.scope === 'PERSONAL' ? 'PERSONAL' : 'GENERAL';
  const outcome = handleMuhurthamSearchBody({ activityId: parsed.activityId, scope, dateRange, durationMinutes: parsed.durationMinutes }, deps.context);
  if (!outcome.ok) return { intent: 'MUHURTHAM_SEARCH', message: outcome.error, context: parsed };
  const result = outcome.result as MuhurthamSearchResult;
  const dates = 'dates' in result ? result.dates : [];
  return buildMuhurthamResponse(activity?.title ?? parsed.activityId, dates, deps.context.timezone, parsed);
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

function buildMuhurthamResponse(activityTitle: string, dates: MuhurthamResultLike[], timezone: string, parsed: ParsedAskAuraRequest): AskAuraResponse {
  if (dates.length === 0) {
    return {
      intent: 'MUHURTHAM_SEARCH',
      message: `I couldn't find a strong Muhurtham for ${activityTitle} in that range.`,
      actions: [{ type: 'OPEN_MUHURTHAM', label: 'Open Muhurtham Finder', activityId: parsed.activityId }],
      context: parsed,
    };
  }
  return {
    intent: 'MUHURTHAM_SEARCH',
    message: `Best dates for ${activityTitle}:`,
    cards: [
      {
        type: 'MUHURTHAM_RESULTS',
        activityTitle,
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
