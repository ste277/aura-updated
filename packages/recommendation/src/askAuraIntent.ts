/**
 * Ask Aura Orchestration V1 -- the canonical intent contract + deterministic
 * parser. This module is PURE (no I/O, no Date.now(), no DB) so it can be
 * unit-tested with fixed inputs; the caller supplies `now` explicitly.
 *
 * Architecture rule (brief section 6): this file only classifies text into
 * structured fields. It never scores timing, never touches Panchang/Muhurta
 * math, and never resolves a SavedPerson (that needs a DB lookup + ownership
 * check, which belongs in apps/web/lib/askAuraOrchestrator.ts). Activity
 * resolution reuses findActivityIntent() from personalizedTasks.ts -- the
 * exact same catalog-alias lookup Timing Search's own classifyTask() uses --
 * so this can never diverge from what "workout" or "coding" already resolve
 * to everywhere else in the app.
 */

import { findActivityIntent } from './personalizedTasks';
import { isSupportedMuhurthamActivity } from './muhurthamFinder';

export type AskAuraIntent =
  | 'GOOD_RIGHT_NOW'
  | 'TIMING_FIND'
  | 'TIMING_CHECK'
  | 'TIMING_COMPARE'
  | 'PANCHANG_QUERY'
  | 'PANCHANG_EXPLAIN'
  | 'MUHURTHAM_SEARCH'
  | 'PLAN_OPEN'
  | 'UNKNOWN';

export type AskAuraScope = 'GENERAL' | 'PERSONAL' | 'SHARED';

/** Phrase-level date bucket -- NOT a calendar computation. Turning this into
 * an actual {start,end} range happens in the orchestrator, which has a real
 * DailyAssistantContext (timezone-aware "today") to compute from -- this
 * parser never does its own date math. */
export type AskHorizonPhrase =
  | 'NOW'
  | 'TODAY'
  | 'TOMORROW'
  | 'THIS_WEEKEND'
  | 'NEXT_WEEKEND'
  | 'THIS_WEEK'
  | 'NEXT_7_DAYS'
  | 'NEXT_MONTH'
  | 'CUSTOM_DATE'
  | 'UNSPECIFIED';

export type AskTimePreference = 'ANY' | 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

/** What a PANCHANG_QUERY is actually asking for -- "only answer the
 * requested detail" (brief section 11), never a full Panchang dump. */
export type AskPanchangField = 'FULL' | 'RAHU_KALAM' | 'YAMA' | 'GULIKA' | 'ABHIJIT' | 'BRAHMA' | 'NAKSHATRA' | 'TITHI' | 'YOGA' | 'KARANA' | 'VARA';

export type AskFollowUpKind = 'WHY' | 'OTHER_TIMES' | 'PLAN_IT' | 'REPEAT_WITH_CHANGES';

export interface ParsedAskAuraRequest {
  intent: AskAuraIntent;
  /** LOW means "do not act on this" -- the orchestrator returns a
   * CLARIFICATION response instead of guessing (brief section 19). */
  confidence: 'HIGH' | 'LOW';

  activityId?: string;
  /** Free text, only set when no catalog activity resolved (brief section
   * 4: never invent a second activity catalog -- this is handed to the
   * SAME classifyTask() fallback Timing Search itself uses when it can't
   * resolve an activityId either). */
  taskTitle?: string;

  durationMinutes?: number;

  horizonPhrase?: AskHorizonPhrase;
  /** Only set when horizonPhrase === 'CUSTOM_DATE'. */
  customDate?: string;

  timePreference?: AskTimePreference;

  scope?: AskAuraScope;
  /** Raw name text extracted from the prompt (e.g. "Anna") -- resolved
   * against the owner's own SavedPeople list server-side; this parser
   * never sees or touches SavedPerson data. */
  personNameQuery?: string;

  panchangField?: AskPanchangField;
  /** For PANCHANG_EXPLAIN -- the raw term text (e.g. "Rohini"), looked up
   * against a small presentation-layer glossary in the orchestrator. */
  explainTerm?: string;

  followUp?: AskFollowUpKind;
}

// ============================================================
// Activity resolution (brief section 4) -- reuses findActivityIntent()
// verbatim, never a second alias table.
// ============================================================

function resolveActivity(text: string): { activityId?: string; taskTitle?: string } {
  const activity = findActivityIntent(text);
  if (activity) return { activityId: activity.id };
  return { taskTitle: text.trim() || undefined };
}

// ============================================================
// Duration (brief section 21) -- extraction only; the actual default (when
// none is stated) comes from the catalog activity's own
// defaultDurationMinutes, resolved by the orchestrator, never invented here.
// ============================================================

function parseDurationMinutes(text: string): number | undefined {
  // "an hour" / "a hour" -- no leading digit, so checked before the
  // digit-anchored patterns below.
  if (/\b(an?)\s+hour\b/i.test(text) && !/\d\s*hours?/i.test(text)) return 60;

  const hourMinuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:(\d+)\s*(?:minutes?|mins?))?/i);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const extraMinutes = hourMinuteMatch[2] ? Number(hourMinuteMatch[2]) : 0;
    return Math.round(hours * 60 + extraMinutes);
  }
  const minuteMatch = text.match(/(\d+)\s*(?:minutes?|mins?)/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  return undefined;
}

// ============================================================
// Time preference (brief section 23) -- the exact same closed vocabulary
// TimingTimePreference already defines (ANY/MORNING/AFTERNOON/EVENING/
// NIGHT); no second range invented here, this only produces the enum tag.
// ============================================================

function parseTimePreference(text: string): AskTimePreference | undefined {
  if (/\bmorning\b/.test(text)) return 'MORNING';
  if (/\bafternoon\b/.test(text)) return 'AFTERNOON';
  if (/\b(evening)\b/.test(text)) return 'EVENING';
  if (/\bnight\b/.test(text)) return 'NIGHT';
  return undefined;
}

// ============================================================
// Horizon phrase (brief section 22).
// ============================================================

function parseHorizonPhrase(text: string): { horizonPhrase?: AskHorizonPhrase; customDate?: string } {
  const isoDateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDateMatch) return { horizonPhrase: 'CUSTOM_DATE', customDate: isoDateMatch[1] };

  if (/\bnext weekend\b/.test(text)) return { horizonPhrase: 'NEXT_WEEKEND' };
  if (/\bthis weekend\b|\bweekend\b/.test(text)) return { horizonPhrase: 'THIS_WEEKEND' };
  if (/\bnext (7|seven) days\b/.test(text)) return { horizonPhrase: 'NEXT_7_DAYS' };
  if (/\bnext month\b/.test(text)) return { horizonPhrase: 'NEXT_MONTH' };
  if (/\bnext week\b/.test(text)) return { horizonPhrase: 'NEXT_7_DAYS' }; // see completion report: no separate ISO-week boundary implementation in V1
  if (/\bthis week\b/.test(text)) return { horizonPhrase: 'THIS_WEEK' };
  if (/\btomorrow\b/.test(text)) return { horizonPhrase: 'TOMORROW' };
  if (/\b(right now|now)\b/.test(text)) return { horizonPhrase: 'NOW' };
  if (/\btoday\b|\btonight\b/.test(text)) return { horizonPhrase: 'TODAY' };

  return { horizonPhrase: undefined };
}

// ============================================================
// Scope (brief section 14).
// ============================================================

function parseScope(text: string): { scope?: AskAuraScope; personNameQuery?: string } {
  if (/\bfor us\b|\btogether\b/.test(text)) return { scope: 'SHARED' };
  if (/\bfor me\b/.test(text)) return { scope: 'PERSONAL' };

  // "with Anna" / "with Anna and me" -- capture the name only; resolving it
  // against the owner's own SavedPeople list happens server-side.
  // Deliberately a SINGLE word -- most real names in this app's own examples
  // are one first name ("Anna"), and a greedy two-word capture risks
  // swallowing a following stopword ("with Anna this weekend" -> "anna
  // this"). A two-word name is out of scope for V1's deterministic parser.
  const withMatch = text.match(/\bwith ([a-z][a-z'\-]*)\b/i);
  if (withMatch) {
    const name = withMatch[1].trim();
    // "with someone" / "with anyone" / "with a friend" are NOT names -- treat
    // as an unresolved SHARED request (the orchestrator asks who, rather
    // than trying to look up the literal word "someone").
    if (/^(someone|anyone|a friend|my partner|my wife|my husband|them|him|her)$/i.test(name)) {
      return { scope: 'SHARED' };
    }
    return { scope: 'SHARED', personNameQuery: name };
  }

  return {};
}

// ============================================================
// Panchang term glossary keys (brief section 12) -- just enough to detect
// "what is <term>" as an EXPLAIN intent vs a QUERY; the actual explanation
// text lives in the orchestrator's small presentation-layer knowledge map.
// ============================================================

const PANCHANG_EXPLAIN_TERMS = [
  'rohini', 'ashwini', 'bharani', 'krittika', 'mrigashira', 'ardra', 'punarvasu', 'pushya', 'ashlesha',
  'magha', 'purva phalguni', 'uttara phalguni', 'hasta', 'chitra', 'swati', 'vishakha', 'anuradha', 'jyeshtha',
  'mula', 'purva ashadha', 'uttara ashadha', 'shravana', 'dhanishta', 'shatabhisha', 'purva bhadrapada',
  'uttara bhadrapada', 'revati',
  'rahu kalam', 'yamagandam', 'yama gandam', 'gulika kalam', 'gulika', 'abhijit muhurta', 'abhijit',
  'brahma muhurta', 'brahma',
  'tithi', 'nakshatra', 'yoga', 'karana', 'vara', 'muhurta', 'muhurtham', 'panchang', 'panchanga',
];

function matchPanchangField(text: string): AskPanchangField | undefined {
  if (/rahu\s*kalam/.test(text)) return 'RAHU_KALAM';
  if (/yama\s*gandam|\byama\b/.test(text)) return 'YAMA';
  if (/gulika/.test(text)) return 'GULIKA';
  if (/abhijit/.test(text)) return 'ABHIJIT';
  if (/brahma/.test(text)) return 'BRAHMA';
  if (/nakshatra/.test(text)) return 'NAKSHATRA';
  if (/\btithi\b/.test(text)) return 'TITHI';
  if (/\byoga\b/.test(text)) return 'YOGA';
  if (/\bkarana\b/.test(text)) return 'KARANA';
  if (/\bvara\b|\bweekday\b/.test(text)) return 'VARA';
  return undefined;
}

// ============================================================
// Follow-up detection (brief section 15/16) -- deterministic short-phrase
// matching only, never free conversation.
// ============================================================

function detectFollowUp(text: string): AskFollowUpKind | undefined {
  if (/^why\??$/.test(text) || /^why (is that|not)\??$/.test(text)) return 'WHY';
  if (/\bother times?\b|\bother options?\b|\balternatives?\b|\bwhat else\b/.test(text)) return 'OTHER_TIMES';
  if (/^plan it\.?$/.test(text) || /^plan this\.?$/.test(text)) return 'PLAN_IT';
  return undefined;
}

// ============================================================
// Intent classification (brief section 5) -- precedence, documented in
// order. A LOW-confidence UNKNOWN never fabricates an activity/intent.
// ============================================================

const GOOD_RIGHT_NOW_RE = /\b(what should i do|what can i do)\b.*\b(now|right now)?\b|^what should i do\??$|^what can i do( right now)?\??$|\bwhat's good (to do )?right now\b/;
const CHECK_VERB_RE = /\b(can i|should i|is it (ok|okay|good|fine) to|is now (a )?good time|is this a good time)\b/;
const FIND_VERB_RE = /\bwhen should i\b|\bwhen('s| is) (the )?best time\b|\bbest time (for|to)\b|\bwhen can i\b|\bfind (a|the best) time\b/;
const COMPARE_VERB_RE = /\bwhich is better\b|\bcompare\b.*\btimes?\b|\b(this|that) time or\b/;
const MUHURTHAM_SEARCH_RE = /\bgood dates?\b|\bauspicious (date|time|day)s?\b|\bfavorable dates?\b|\bmuhurtham\b|\bmuhurta\b(?!\s*bala)/;
const PANCHANG_QUERY_RE = /\bwhen is\b|\bwhat('s| is) (today|tomorrow)'?s? panchang\b|\bwhat('s| is) (today|tomorrow)'?s? (nakshatra|tithi|yoga|karana|vara)\b|\brahu kalam\b|\byamagandam\b|\bgulika kalam\b/;

export interface AskAuraParseContext {
  now: Date;
  /** The prior turn's parsed request, if this looks like a follow-up
   * (brief section 15) -- used to fill in unstated fields (activity,
   * date, scope) rather than re-asking. */
  previous?: ParsedAskAuraRequest;
}

export function parseAskAuraRequest(rawText: string, context: AskAuraParseContext): ParsedAskAuraRequest {
  const text = rawText.trim().toLowerCase();
  if (!text) return { intent: 'UNKNOWN', confidence: 'LOW' };

  const followUp = detectFollowUp(text);
  if (followUp && context.previous) {
    return applyFollowUp(followUp, text, context.previous);
  }

  const { horizonPhrase, customDate } = parseHorizonPhrase(text);
  const timePreference = parseTimePreference(text);
  const durationMinutes = parseDurationMinutes(text);
  const { scope, personNameQuery } = parseScope(text);

  // 1. Panchang explanation -- "what is X" / "what does X mean" where X is
  // a recognized term. Checked BEFORE Panchang query so "What is Rohini?"
  // never falls into the "when is..." query bucket.
  const explainMatch = text.match(/^what (?:is|does)\s+([a-z\s]+?)\s*(?:mean)?\??$/);
  if (explainMatch) {
    const candidate = explainMatch[1].trim();
    const knownTerm = PANCHANG_EXPLAIN_TERMS.find((term) => candidate === term || candidate.includes(term));
    if (knownTerm) {
      return { intent: 'PANCHANG_EXPLAIN', confidence: 'HIGH', explainTerm: knownTerm };
    }
  }

  // 2. Panchang query -- "when is Rahu Kalam tomorrow", "what's today's
  // nakshatra". Checked before activity-based intents so a Panchang-window
  // NAME (Rahu Kalam, Gulika) is never misread as an activity.
  if (PANCHANG_QUERY_RE.test(text)) {
    return {
      intent: 'PANCHANG_QUERY',
      confidence: 'HIGH',
      panchangField: matchPanchangField(text) ?? 'FULL',
      horizonPhrase: horizonPhrase ?? 'TODAY',
      customDate,
    };
  }

  // 3. Muhurtham search -- only when the resolved activity is actually
  // Muhurtham-eligible (brief section 13: "Do not route casual activities
  // through Muhurtham Finder" -- this is the section 37 regression test).
  if (MUHURTHAM_SEARCH_RE.test(text)) {
    const resolved = resolveActivity(text);
    if (resolved.activityId && isSupportedMuhurthamActivity(resolved.activityId)) {
      return {
        intent: 'MUHURTHAM_SEARCH',
        confidence: 'HIGH',
        activityId: resolved.activityId,
        scope: scope ?? 'GENERAL',
        personNameQuery,
        horizonPhrase: horizonPhrase ?? 'NEXT_MONTH',
        customDate,
      };
    }
    // "Good dates for coffee" -- the search-y phrasing matched, but coffee
    // isn't Muhurtham-eligible. Fall through to ordinary timing intents
    // below (brief section 37's explicit regression case) rather than
    // returning MUHURTHAM_SEARCH for a casual activity.
  }

  // 4. Good Right Now -- no activity mentioned, asking what to do now.
  if (GOOD_RIGHT_NOW_RE.test(text) && !FIND_VERB_RE.test(text)) {
    return { intent: 'GOOD_RIGHT_NOW', confidence: 'HIGH' };
  }

  // 5. Timing Compare.
  if (COMPARE_VERB_RE.test(text)) {
    const resolved = resolveActivity(text);
    return {
      intent: 'TIMING_COMPARE',
      confidence: resolved.activityId || resolved.taskTitle ? 'HIGH' : 'LOW',
      ...resolved,
      durationMinutes,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
    };
  }

  // 6. Timing Find -- "When should I work out tomorrow?" / "Best time for
  // a date this weekend" (activity + find-phrasing, or activity + an
  // explicit horizon/time-preference even without a "when should I" verb).
  // Checked BEFORE Check: FIND_VERB_RE's "when should i" would otherwise
  // never be reached, since CHECK_VERB_RE's bare "should i" is a substring
  // of it -- "when" is what disambiguates the two, so the more specific
  // (FIND) match must win first.
  if (FIND_VERB_RE.test(text) || ((horizonPhrase || timePreference) && (personNameQuery || scope))) {
    const resolved = resolveActivity(text);
    if (!resolved.activityId && !resolved.taskTitle) {
      return { intent: 'UNKNOWN', confidence: 'LOW' };
    }
    return {
      intent: 'TIMING_FIND',
      confidence: 'HIGH',
      ...resolved,
      durationMinutes,
      horizonPhrase: horizonPhrase ?? 'TODAY',
      customDate,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
    };
  }

  // 7. Timing Check -- "Can I work out now?" (activity + check-phrasing).
  if (CHECK_VERB_RE.test(text)) {
    const resolved = resolveActivity(text);
    if (!resolved.activityId && !resolved.taskTitle) {
      return { intent: 'UNKNOWN', confidence: 'LOW' };
    }
    return {
      intent: 'TIMING_CHECK',
      confidence: 'HIGH',
      ...resolved,
      durationMinutes,
      horizonPhrase: horizonPhrase ?? 'NOW',
      customDate,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
    };
  }

  // 8. An activity + an explicit horizon/duration/timePreference signal
  // (no recognizable find/check verb at all) -- e.g. "Workout tomorrow
  // morning" or "deep work tomorrow morning for 60 minutes". Checked
  // BEFORE the bare-short-phrase PLAN_OPEN fallback below, so a real
  // timing signal always wins over the "just an activity name" default.
  const bareActivity = findActivityIntent(text);
  if (bareActivity && (horizonPhrase || timePreference || durationMinutes)) {
    return {
      intent: 'TIMING_FIND',
      confidence: 'HIGH',
      activityId: bareActivity.id,
      durationMinutes,
      horizonPhrase: horizonPhrase ?? 'TODAY',
      customDate,
      timePreference,
      scope: scope ?? 'GENERAL',
      personNameQuery,
    };
  }

  // 9. A bare recognized activity with no intent verb or timing signal at
  // all -- "Workout" -- defaults to opening Plan with the activity
  // pre-filled (brief section 5: "default to activity selection / planning
  // assistance, not an arbitrary Panchang explanation"), never a guessed
  // timing search.
  if (bareActivity && text.split(/\s+/).length <= 4) {
    return { intent: 'PLAN_OPEN', confidence: 'HIGH', activityId: bareActivity.id };
  }

  return { intent: 'UNKNOWN', confidence: 'LOW' };
}

/** Follow-up turns (brief section 15/16) -- reuse the previous turn's
 * activity/date/scope, only changing what this turn actually stated. "Why?"
 * and "Other times?" carry NO new fields at all (the orchestrator re-uses
 * its own last computed result); "What about morning?" changes just
 * timePreference; "What about tomorrow?" changes just the horizon. */
function applyFollowUp(kind: AskFollowUpKind, text: string, previous: ParsedAskAuraRequest): ParsedAskAuraRequest {
  if (kind === 'WHY' || kind === 'OTHER_TIMES' || kind === 'PLAN_IT') {
    return { ...previous, followUp: kind };
  }

  // REPEAT_WITH_CHANGES is never returned by detectFollowUp() directly;
  // reaching here only happens if a caller wants generic "same activity,
  // new date/preference" reuse -- kept for parseFollowUpChange() below.
  return { ...previous, followUp: kind };
}

/** "What about morning?" / "What about tomorrow?" / "What about Anna?" --
 * short phrases that change exactly one field of the previous request
 * (brief section 16). Not auto-detected inside parseAskAuraRequest's own
 * followUp branch above (those are content-free acknowledgements); this is
 * called by the orchestrator when detectFollowUp() found nothing but the
 * text still looks like a minimal delta on the previous turn. */
export function parseFollowUpChange(rawText: string, previous: ParsedAskAuraRequest): ParsedAskAuraRequest | null {
  const text = rawText.trim().toLowerCase();
  const whatAboutMatch = text.match(/^what about (.+?)\??$/) || text.match(/^and (.+?)\??$/);
  if (!whatAboutMatch) return null;

  const delta = whatAboutMatch[1].trim();
  const timePreference = parseTimePreference(delta);
  if (timePreference) return { ...previous, timePreference, followUp: 'REPEAT_WITH_CHANGES' };

  const { horizonPhrase, customDate } = parseHorizonPhrase(delta);
  if (horizonPhrase) return { ...previous, horizonPhrase, customDate, followUp: 'REPEAT_WITH_CHANGES' };

  const { scope, personNameQuery } = parseScope(`with ${delta}`);
  if (personNameQuery) return { ...previous, scope, personNameQuery, followUp: 'REPEAT_WITH_CHANGES' };

  return null;
}
