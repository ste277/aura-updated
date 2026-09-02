import type { DailyAgenda, DailyAgendaItem } from './dailyAgenda';
import { DailyIntentionGroupId } from './dailyIntentions';
import { buildDailyReflection } from './dailyReflection';
import type { UserPriorityGroup, DailyPriorityCoverage } from './dayBuilder';
import { getMinuteOfDayInTimezone } from './timezone';

/**
 * My Day V1 -- the narrative layer (brief section 9). Pure, deterministic,
 * no LLM, not persisted. Reads ONLY the already-derived DailyAgenda (item
 * counts/times/status) -- no astrology, no new scoring. Deliberately does
 * NOT thread Panchang window quality into the prose for V1 (see the
 * completion report's "limitations" section for why) -- narrative reacts to
 * what's on the agenda, not to window favorability, which keeps this
 * function trivially pure/testable and avoids a second "what does this
 * window mean" narrative competing with the existing Right Now card.
 */

export type DailyStoryPhase = 'MORNING' | 'MIDDAY' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export interface DailyStoryPrompt {
  question: string;
}

export interface DailyIntentionSuggestion {
  groupId: DailyIntentionGroupId;
  label: string;
  icon: string;
}

export interface DailyStoryAction {
  label: string;
  action: 'PLAN_TOMORROW' | 'OPEN_ITEM' | 'START_INTENTION';
  itemId?: string;
}

export interface DailyStory {
  phase: DailyStoryPhase;
  headline: string;
  narrative: string;
  primaryPrompt?: DailyStoryPrompt;
  suggestedIntentions: DailyIntentionSuggestion[];
  nextMeaningfulThing?: DailyStoryAction;
  completedHighlights?: DailyAgendaItem[];
}

/** Personalized Daily Story V2 -- what buildDailyStory() may safely
 * consume beyond the agenda itself (brief section 3): explicit
 * UserPriorityGroups, their DailyPriorityCoverage (already-derived from
 * the SAME agenda by dayBuilder.ts's buildDailyPriorityCoverage --
 * dailyStory.ts never recomputes it), and whether a priority person has an
 * eligible Moment today. Deliberately NOT inferred behavioral data (brief
 * section 3: "do NOT consume inferred behavioral preferences yet"). */
export interface DailyStoryPriorityPersonMoment {
  /** The owner-facing display name only (brief section 8) -- never a
   * SavedPerson id, matching AuraMoment's own sharedPersonDisplayName
   * field this is sourced from. */
  personName: string;
  itemTitle: string;
}

export interface DailyStoryPersonalizationInput {
  priorities: UserPriorityGroup[];
  coverage: DailyPriorityCoverage[];
  priorityPersonMoment?: DailyStoryPriorityPersonMoment;
}

/** Brief section 10 -- no existing shared daypart model to reuse (confirmed
 * by audit: the only prior "time of day" concept is HomeDashboard's own
 * inline 3-tier `greeting()`, which stays as-is for the page header; this is
 * a deliberately finer-grained 5-tier model for narrative purposes only,
 * not a redefinition of greeting()). Boundaries exactly as specified. */
export function resolveDailyStoryPhase(minuteOfDay: number): DailyStoryPhase {
  const hour = Math.floor(minuteOfDay / 60);
  if (hour >= 5 && hour < 12) return 'MORNING';
  if (hour >= 12 && hour < 14) return 'MIDDAY';
  if (hour >= 14 && hour < 17) return 'AFTERNOON';
  if (hour >= 17 && hour < 21) return 'EVENING';
  return 'NIGHT';
}

function formatClock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

/** Bug fix (Home Compactness follow-up -- "your evening is open" shown
 * even with several evening activities already added): every "is this
 * item in the evening?" check below used to read `.getHours()` directly
 * off the Date object, which reflects the SERVER PROCESS's own local
 * timezone (UTC in production), not the user's configured
 * `agenda.timezone` -- a 6pm IST item is 12:30pm UTC, whose .getHours()
 * is 12, never >=17. Local dev/test runs on an IST machine coincidentally
 * matched, hiding this in every prior test run. */
function hourInTimezone(iso: string, timezone: string): number {
  return Math.floor(getMinuteOfDayInTimezone(timezone, new Date(iso)) / 60);
}

function plannedItems(agenda: DailyAgenda): DailyAgendaItem[] {
  return agenda.items.filter((item) => item.type !== 'COMPLETED_ACTIVITY');
}

function upcomingPlannedItems(agenda: DailyAgenda): DailyAgendaItem[] {
  // MISSED is a past-tense fact, same as COMPLETED -- neither belongs in
  // "what's ahead" narrative counts (Daily Reflection & Tomorrow Preview
  // V1, brief section 3).
  return plannedItems(agenda).filter((item) => item.status !== 'COMPLETED' && item.status !== 'MISSED');
}

function isEveningOpen(agenda: DailyAgenda): boolean {
  return !plannedItems(agenda).some((item) => {
    const hour = hourInTimezone(item.startAt, agenda.timezone);
    return hour >= 17;
  });
}

const EVENING_INTENTIONS: DailyIntentionSuggestion[] = [
  { groupId: 'RELATIONSHIPS', label: 'Partner time', icon: '❤️' },
  { groupId: 'FAMILY', label: 'Family', icon: '👨‍👩‍👧' },
  { groupId: 'SOCIAL', label: 'Friends', icon: '👥' },
  { groupId: 'ENJOYMENT', label: 'Something relaxing', icon: '🎬' },
];

const WELL_SPENT_PROMPT: DailyStoryPrompt = { question: 'What would make today feel well spent?' };
const MAKE_ROOM_PROMPT: DailyStoryPrompt = { question: 'Make room for something else?' };

/** Personalized Daily Story V2 (brief section 4) -- human, narrative-safe
 * phrasing per priority, never the internal UserPriorityGroup name itself.
 * "covered" text describes something already on the agenda; "open" text
 * invites toward it. Deliberately plain nouns/phrases, never a claim about
 * the user's behavior or feelings (brief: no "you love/always/usually..."). */
const PRIORITY_NARRATIVE_LABEL: Record<UserPriorityGroup, { covered: string; open: string }> = {
  RELATIONSHIPS: { covered: 'time with someone important', open: 'time with someone who matters' },
  WORK: { covered: 'focused work', open: 'focused work' },
  WELLBEING: { covered: 'something for your wellbeing', open: 'something for yourself' },
  PERSONAL_GROWTH: { covered: 'some learning', open: 'room to learn something' },
  ENJOYMENT: { covered: 'something enjoyable', open: 'something enjoyable' },
  ROUTINE: { covered: 'the everyday things', open: 'room for the everyday things' },
};

function joinNaturally(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** Same "3+ upcoming items is a full day" threshold dayBuilder.ts's own
 * DayProfile.isBusy uses (buildDayProfile) -- kept as a small, independent
 * constant here rather than importing that whole (heavier, opening-math-
 * computing) function just for one boolean; the semantic stays identical
 * by construction (same upcomingPlannedItems() count, same threshold). */
const BUSY_UPCOMING_ITEM_THRESHOLD = 3;

/**
 * Personalized Daily Story V2 (brief section 4) -- deterministic,
 * template-based narrative composed ONLY from real DailyPriorityCoverage
 * facts (never "you love/always/usually..." -- nothing here is inferred
 * from behavior, only from what's actually on today's agenda right now).
 * Returns null whenever the user has no priorities configured, so
 * buildDailyStory's existing phase-based headline/narrative runs
 * completely unchanged (brief section 12: "no preferences: preserve
 * existing behavior").
 */
function composePersonalizedNarrative(personalization: DailyStoryPersonalizationInput, isBusy: boolean): { headline: string; narrative: string } | null {
  const { priorities, coverage, priorityPersonMoment } = personalization;
  if (priorities.length === 0) return null;

  const covered = coverage.filter((c) => c.state === 'COVERED');
  const open = coverage.filter((c) => c.state === 'OPEN');
  const coveredLabels = covered.map((c) => PRIORITY_NARRATIVE_LABEL[c.priorityGroup].covered);
  const openLabels = open.map((c) => PRIORITY_NARRATIVE_LABEL[c.priorityGroup].open);

  // Brief section 8 -- the most specific, most human framing takes
  // precedence: a priority person already has real time on the agenda.
  if (priorityPersonMoment) {
    const openClause = open.length > 0 ? ', with some open space beforehand' : '';
    return {
      headline: "You've made room for what matters",
      narrative: `You already have time with ${priorityPersonMoment.personName} later today${openClause}.`,
    };
  }

  if (isBusy) {
    return covered.length > 0
      ? { headline: 'A full day ahead', narrative: `You've already made room for ${joinNaturally(coveredLabels)} today.` }
      : { headline: 'A full day ahead', narrative: 'Your day already has a lot in it.' };
  }

  if (covered.length === priorities.length) {
    return { headline: 'A balanced day ahead', narrative: `You've made room for ${joinNaturally(coveredLabels)} today.` };
  }
  if (covered.length === 0) {
    return { headline: 'A mostly open day', narrative: `There's plenty of room to shape today around ${joinNaturally(openLabels)}.` };
  }
  return {
    headline: 'Your day has structure',
    narrative: `You've made room for ${joinNaturally(coveredLabels)}, but there's still room for ${joinNaturally(openLabels)}.`,
  };
}

function buildMorningStory(agenda: DailyAgenda): { headline: string; narrative: string; primaryPrompt?: DailyStoryPrompt; suggestedIntentions: DailyIntentionSuggestion[] } {
  const upcoming = upcomingPlannedItems(agenda);
  if (upcoming.length === 0) {
    return {
      headline: 'Good morning',
      narrative: 'Your day is mostly open.',
      primaryPrompt: WELL_SPENT_PROMPT,
      suggestedIntentions: [],
    };
  }
  if (upcoming.length === 1) {
    const first = upcoming[0];
    // Recipient Conversion V1 Hardening (brief section 15) -- a
    // newly-converted user with exactly one saved Plan (typically an
    // evening one, e.g. a Date Night saved via guest conversion) should
    // still see My Day as useful, not empty: acknowledge the plan warmly
    // and point out the rest of the day is still theirs.
    if (hourInTimezone(first.startAt, agenda.timezone) >= 17) {
      return {
        headline: 'Good morning',
        narrative: `Your evening has something to look forward to. ${first.title} at ${formatClock(first.startAt, agenda.timezone)}. You still have room earlier in the day.`,
        primaryPrompt: WELL_SPENT_PROMPT,
        suggestedIntentions: [],
      };
    }
    return {
      headline: 'Good morning',
      narrative: `You have one thing planned today. ${first.title} at ${formatClock(first.startAt, agenda.timezone)}.`,
      primaryPrompt: isEveningOpen(agenda) ? MAKE_ROOM_PROMPT : undefined,
      suggestedIntentions: [],
    };
  }
  if (upcoming.length === 2) {
    const first = upcoming[0];
    const eveningOpen = isEveningOpen(agenda);
    return {
      headline: 'Good morning',
      narrative: `You have two things planned today. Your first is ${first.title} at ${formatClock(first.startAt, agenda.timezone)}${eveningOpen ? ', and your evening is still open' : ''}.`,
      primaryPrompt: eveningOpen ? MAKE_ROOM_PROMPT : undefined,
      suggestedIntentions: [],
    };
  }
  return {
    headline: 'A fuller day ahead',
    narrative: `You already have ${upcoming.length} things planned today.`,
    suggestedIntentions: [],
  };
}

function buildMiddayOrAfternoonStory(agenda: DailyAgenda, phase: 'MIDDAY' | 'AFTERNOON'): { headline: string; narrative: string; primaryPrompt?: DailyStoryPrompt; suggestedIntentions: DailyIntentionSuggestion[] } {
  const upcoming = upcomingPlannedItems(agenda);
  const recentlyCompleted = plannedItems(agenda)
    .filter((item) => item.status === 'COMPLETED')
    .sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime())[0];

  if (recentlyCompleted && upcoming.length === 0) {
    return {
      headline: `✓ ${recentlyCompleted.title} completed`,
      narrative: `Nice — that's done. The ${phase === 'MIDDAY' ? 'rest of your day' : 'afternoon'} is fairly open.`,
      primaryPrompt: MAKE_ROOM_PROMPT,
      suggestedIntentions: [],
    };
  }
  if (recentlyCompleted && upcoming.length > 0) {
    const next = upcoming[0];
    return {
      headline: `✓ ${recentlyCompleted.title} completed`,
      narrative: `Nice — that's done. Next up is ${next.title} at ${formatClock(next.startAt, agenda.timezone)}.`,
      suggestedIntentions: [],
    };
  }
  if (upcoming.length > 0) {
    const next = upcoming[0];
    return {
      headline: phase === 'MIDDAY' ? 'The rest of your day' : 'This afternoon',
      narrative: `You have one more plan ${phase === 'MIDDAY' ? 'today' : 'this afternoon'}. ${next.title} starts at ${formatClock(next.startAt, agenda.timezone)}.`,
      suggestedIntentions: [],
    };
  }
  return {
    headline: phase === 'MIDDAY' ? 'Your day is open' : 'Your afternoon is open',
    narrative: 'Nothing is planned right now.',
    primaryPrompt: WELL_SPENT_PROMPT,
    suggestedIntentions: [],
  };
}

function buildEveningStory(agenda: DailyAgenda): { headline: string; narrative: string; primaryPrompt?: DailyStoryPrompt; suggestedIntentions: DailyIntentionSuggestion[] } {
  const eveningOpen = isEveningOpen(agenda);
  const completedToday = agenda.items.filter((item) => item.status === 'COMPLETED').length;

  if (eveningOpen) {
    return {
      headline: 'Your evening is open',
      narrative: completedToday > 0 ? "You've taken care of the important work. Maybe make some room for life outside work." : 'Maybe make some room for something outside work.',
      suggestedIntentions: EVENING_INTENTIONS,
    };
  }
  const eveningItem = upcomingPlannedItems(agenda).find((item) => hourInTimezone(item.startAt, agenda.timezone) >= 17);
  return {
    headline: eveningItem ? eveningItem.title : 'Your evening',
    narrative: eveningItem ? `${eveningItem.title} ${eveningItem.status === 'CONFIRMED' ? 'is confirmed for' : 'starts at'} ${formatClock(eveningItem.startAt, agenda.timezone)}.` : 'Your evening is taking shape.',
    suggestedIntentions: [],
  };
}

/** Daily Reflection & Tomorrow Preview V1 (brief section 6) -- the NIGHT
 * headline/narrative now reuses buildDailyReflection()'s own breakdown
 * (completed Plans + logged activities + meaningful Moments) instead of a
 * second, narrower "COMPLETED || CONFIRMED" filter, so the two never drift.
 * MISSED items are deliberately never counted or named here -- calm, no
 * invented guilt (brief section 3/13). */
function buildNightStory(agenda: DailyAgenda): { headline: string; narrative: string; completedHighlights: DailyAgendaItem[]; nextMeaningfulThing?: DailyStoryAction } {
  const reflection = buildDailyReflection(agenda);
  const highlights = [...reflection.completed, ...reflection.loggedActivities, ...reflection.meaningfulMoments].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
  if (highlights.length === 0) {
    return {
      headline: 'Your day',
      narrative: reflection.summary,
      completedHighlights: [],
      nextMeaningfulThing: { label: 'Plan tomorrow →', action: 'PLAN_TOMORROW' },
    };
  }
  return {
    headline: 'Your day',
    narrative: `${reflection.summary} Tomorrow is another day.`,
    completedHighlights: highlights,
    nextMeaningfulThing: { label: 'Plan tomorrow →', action: 'PLAN_TOMORROW' },
  };
}

/**
 * Personalized Daily Story V2 -- `personalization` is entirely optional
 * and additive (brief section 12: no preferences means unchanged
 * behavior). When present, it overrides ONLY the phase builder's own
 * headline/narrative for MORNING/MIDDAY/AFTERNOON/EVENING -- primaryPrompt
 * and suggestedIntentions (the existing manual-intention-flow affordances
 * inside MyDayStoryCard) are left exactly as each phase already computes
 * them. NIGHT is deliberately never personalized here: buildNightStory's
 * own reflection-based narrative already states completed/missed facts
 * plainly (brief section 11's own "factually only" rule), and the brief
 * gives no NIGHT example to extend it by.
 */
export function buildDailyStory(agenda: DailyAgenda, minuteOfDay: number, personalization?: DailyStoryPersonalizationInput): DailyStory {
  const phase = resolveDailyStoryPhase(minuteOfDay);

  if (phase === 'NIGHT') {
    const night = buildNightStory(agenda);
    return { phase, headline: night.headline, narrative: night.narrative, suggestedIntentions: [], completedHighlights: night.completedHighlights, nextMeaningfulThing: night.nextMeaningfulThing };
  }

  const isBusy = upcomingPlannedItems(agenda).length >= BUSY_UPCOMING_ITEM_THRESHOLD;
  const personalized = personalization ? composePersonalizedNarrative(personalization, isBusy) : null;

  if (phase === 'EVENING') {
    const evening = buildEveningStory(agenda);
    return {
      phase,
      headline: personalized?.headline ?? evening.headline,
      narrative: personalized?.narrative ?? evening.narrative,
      primaryPrompt: evening.primaryPrompt,
      suggestedIntentions: evening.suggestedIntentions,
    };
  }
  if (phase === 'MIDDAY' || phase === 'AFTERNOON') {
    const rest = buildMiddayOrAfternoonStory(agenda, phase);
    return {
      phase,
      headline: personalized?.headline ?? rest.headline,
      narrative: personalized?.narrative ?? rest.narrative,
      primaryPrompt: rest.primaryPrompt,
      suggestedIntentions: rest.suggestedIntentions,
    };
  }
  const morning = buildMorningStory(agenda);
  return {
    phase,
    headline: personalized?.headline ?? morning.headline,
    narrative: personalized?.narrative ?? morning.narrative,
    primaryPrompt: morning.primaryPrompt,
    suggestedIntentions: morning.suggestedIntentions,
  };
}
