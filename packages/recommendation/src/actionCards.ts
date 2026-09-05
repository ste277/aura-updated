/**
 * MVP action-card lookup.
 * Deterministic table: SolarWindowType -> 3 action cards.
 * No LLM call, no persona branching (STANDARD only) — per the MVP scope cut.
 * Includes flexible fallback parsing for string key variations.
 */

import type { SolarWindowType } from '../../panchang/src/windows';
import { FULL_ACTIVITY_CATALOG, normalizeWindowType } from './personalizedTasks';
import type { ActivityCategory } from './personalizedTasks';
import { evaluateActivityFit, AuraFitEvaluation, PersonalMuhurtaContext } from './auraFitEngine';

export interface ActionCard {
  id: string;
  category: ActivityCategory;
  title: string;
  description: string; // Updated from reasoning for direct UI mapping
  reasoning?: string;   // Retained for backward compatibility
  icon?: string;
  /** Good Right Now Actions V1 -- links this window-flavor card to a real
   * canonical catalog activity (including task-1..7, which ARE full
   * ActivityDefinition entries even though they're not momentEligible) so
   * Home can resolve immediateAction/duration from ActivityDefinition
   * instead of the card's own display copy. Omitted only for the two cards
   * with no existing catalog counterpart (a generic "meal" concept doesn't
   * exist) -- see immediateAction below for those. */
  activityId?: string;
  /** Only meaningful when activityId is absent -- the catalog is the
   * source of truth (brief section 3) whenever a real activityId exists;
   * this is strictly a fallback for the handful of cards with no catalog
   * counterpart to link to. */
  immediateAction?: 'LOG_NOW' | 'START_NOW';
  significance?: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresFreshStart?: boolean;
  aliases?: string[];
  fit?: 'BEST' | 'GOOD' | 'USABLE' | 'CAUTION';
  fitScore?: number;
}

const ACTION_CARDS: Record<SolarWindowType, ActionCard[]> = {
  BRAHMA: [
    {
      id: 'brahma-mobility',
      category: 'WORKOUT',
      title: 'Light mobility or breathwork',
      description: 'Pre-dawn window favors low-strain movement and mental clarity over intensity.',
      reasoning: 'Pre-dawn window favors low-strain movement and mental clarity over intensity.',
      icon: '🧘',
      activityId: 'task-3', // "Breathwork & Strategic Visioning" -- START_NOW
    },
    {
      id: 'brahma-focus',
      category: 'FOCUS',
      title: 'Distraction-free planning block',
      description: 'Quiet hours before sunrise are well suited to deep, uninterrupted thinking.',
      reasoning: 'Quiet hours before sunrise are well suited to deep, uninterrupted thinking.',
      icon: '✍️',
      activityId: 'deep-work', // BOTH
    },
    {
      id: 'brahma-hydrate',
      category: 'MICRO_BREAK',
      title: 'Hydrate before the day starts',
      description: 'A simple, low-effort way to start the daily streak.',
      reasoning: 'A simple, low-effort way to start the daily streak.',
      icon: '💧',
      activityId: 'task-6', // "Active Rest & Hydration Check" -- LOG_NOW
    },
  ],
  ABHIJIT: [
    {
      id: 'abhijit-workout',
      category: 'WORKOUT',
      title: 'Heavy lifting or a hard training session',
      description: 'Peak solar window — best alignment for maximum physical output.',
      reasoning: 'Peak solar window — best alignment for maximum physical output.',
      icon: '🏋️',
      activityId: 'workout', // BOTH
    },
    {
      id: 'abhijit-meal',
      category: 'MEAL',
      title: 'Main meal of the day',
      description: 'Solar noon aligns with peak digestive capacity.',
      reasoning: 'Solar noon aligns with peak digestive capacity.',
      icon: '🍲',
      // No generic solo "meal" activity exists in the catalog and adding
      // one solely for this card's action semantics isn't warranted --
      // logging that you ate is inherently instantaneous either way.
      immediateAction: 'LOG_NOW',
    },
    {
      id: 'abhijit-focus',
      category: 'FOCUS',
      title: 'Tackle your hardest task',
      description: 'Highest-leverage window for demanding cognitive work.',
      reasoning: 'Highest-leverage window for demanding cognitive work.',
      icon: '⚡',
      activityId: 'deep-work', // BOTH
    },
  ],
  RAHU_KALAM: [
    {
      id: 'rahu-rest',
      category: 'REST',
      title: 'Active rest, no high-stakes decisions',
      description: 'Traditionally a high-friction window — good for low-risk, routine tasks only.',
      reasoning: 'Traditionally a high-friction window — good for low-risk, routine tasks only.',
      icon: '🛡️',
      activityId: 'task-6', // "Active Rest & Hydration Check" -- LOG_NOW
    },
    {
      id: 'rahu-break',
      category: 'MICRO_BREAK',
      title: 'Step away and reset',
      description: 'Short break rather than pushing through friction.',
      reasoning: 'Short break rather than pushing through friction.',
      icon: '☕',
      activityId: 'tea-break', // LOG_NOW
    },
    {
      id: 'rahu-hydrate',
      category: 'MICRO_BREAK',
      title: 'Water / tea refill',
      description: 'Keep momentum with something low-stakes.',
      reasoning: 'Keep momentum with something low-stakes.',
      icon: '🫖',
      activityId: 'tea-break', // LOG_NOW
    },
  ],
  // Inauspicious Period Precedence Fix V1: copy revised to "usable/suitable"
  // framing rather than "good window" -- these activities remain practical
  // during Gulika, but Gulika itself is not the reason to prefer them (see
  // capabilitiesForWindow/evaluateSolarWindowReason in this same PR for the
  // matching scoring-layer correction).
  GULIKA: [
    {
      id: 'gulika-cardio',
      category: 'WORKOUT',
      title: 'Steady cardio or a walk',
      description: 'Suitable for steady, lower-intensity conditioning.',
      reasoning: 'Suitable for steady, lower-intensity conditioning.',
      icon: '🚶',
      activityId: 'workout', // BOTH
    },
    {
      id: 'gulika-skill',
      category: 'FOCUS',
      title: 'Skill-building or learning session',
      description: 'Suitable for steady, low-pressure practice.',
      reasoning: 'Suitable for steady, low-pressure practice.',
      icon: '📚',
      activityId: 'learning', // BOTH
    },
    {
      id: 'gulika-social',
      category: 'MICRO_BREAK',
      title: 'Social check-in or coffee break',
      description: 'A practical moment to step out and reconnect.',
      reasoning: 'A practical moment to step out and reconnect.',
      icon: '💬',
      activityId: 'tea-break', // LOG_NOW
    },
  ],
  YAMA: [
    {
      id: 'yama-rest',
      category: 'REST',
      title: 'Restraint — avoid starting new commitments',
      description: 'Traditionally a caution window; better for wrapping up than starting.',
      reasoning: 'Traditionally a caution window; better for wrapping up than starting.',
      icon: '🐢',
      activityId: 'task-6', // "Active Rest & Hydration Check" -- LOG_NOW
    },
    {
      id: 'yama-lightmeal',
      category: 'MEAL',
      title: 'Light snack if needed',
      description: 'Keep it light rather than a full meal in this window.',
      reasoning: 'Keep it light rather than a full meal in this window.',
      icon: '🍏',
      // Same reasoning as abhijit-meal above -- no catalog counterpart.
      immediateAction: 'LOG_NOW',
    },
    {
      id: 'yama-break',
      category: 'MICRO_BREAK',
      title: 'Stretch and reset',
      description: 'Low-effort reset to bridge into the next window.',
      reasoning: 'Low-effort reset to bridge into the next window.',
      icon: '🧘',
      activityId: 'task-7', // "Light Stretch & Mobility" -- START_NOW
    },
  ],
  NEUTRAL: [
    {
      id: 'neutral-focus',
      category: 'FOCUS',
      title: 'Regular work block',
      description: 'No special solar window active right now — business as usual.',
      reasoning: 'No special solar window active right now — business as usual.',
      icon: '🎯',
      activityId: 'deep-work', // BOTH
    },
    {
      id: 'neutral-break',
      category: 'MICRO_BREAK',
      title: 'Short walk or stretch',
      description: 'Good default to keep the ultradian rhythm on track.',
      reasoning: 'Good default to keep the ultradian rhythm on track.',
      icon: '🚶',
      activityId: 'task-7', // "Light Stretch & Mobility" -- START_NOW
    },
    {
      id: 'neutral-hydrate',
      category: 'MICRO_BREAK',
      title: 'Hydration check',
      description: 'Simple, always-available action to log.',
      reasoning: 'Simple, always-available action to log.',
      icon: '💧',
      activityId: 'task-6', // "Active Rest & Hydration Check" -- LOG_NOW
    },
  ],
};

/** The core "tap arc -> get 3 cards" lookup. Safe against unexpected string formats. */
export function getActionCards(window: string): ActionCard[] {
  if (!window) return ACTION_CARDS.NEUTRAL;

  const clean = normalizeWindowType(window);

  if (clean === 'RAHU_KALAM') return ACTION_CARDS.RAHU_KALAM;
  if (clean === 'BRAHMA') return ACTION_CARDS.BRAHMA;
  if (clean === 'ABHIJIT') return ACTION_CARDS.ABHIJIT;
  if (clean === 'GULIKA') return ACTION_CARDS.GULIKA;
  if (clean === 'YAMA') return ACTION_CARDS.YAMA;

  return ACTION_CARDS[clean as SolarWindowType] || ACTION_CARDS.NEUTRAL;
}

/**
 * Home Good Right Now Personalization V1 -- combines evaluateActivityFit's
 * two independently-generated summaries into one compact card description,
 * truthfully reflecting whatever actually influenced the score (brief
 * section 13/14: "Do not silently change a recommendation for personal
 * reasons while showing only a generic explanation"). Never invents new
 * astrology copy -- both halves are exactly the text the canonical
 * evaluator already generates.
 *
 * No personalSummary (no personalContext supplied, or the owner's profile
 * is incomplete -- evaluatePersonalMuhurtaFit's own neutral-default path)
 * -> fit.summary byte-for-byte, unchanged from before this PR.
 */
export function buildActivityDiscoveryDescription(fit: Pick<AuraFitEvaluation, 'summary' | 'personalSummary'>): string {
  if (!fit.personalSummary) return fit.summary;
  return `${fit.summary} ${fit.personalSummary}`;
}

/**
 * Profile-backed discovery for the Planner and future activity picker.
 * This answers "what could I do in this window?" without making the window
 * the source of truth for task timing.
 *
 * Home Good Right Now Personalization V1 -- `personalContext` is passed
 * straight through to evaluateActivityFit() (auraFitEngine.ts), the exact
 * same optional parameter Ask Aura everyday CHECK/FIND, Day Builder, and
 * ordinary Plan Timing Search already supply via
 * buildPersonalMuhurtaContextForUser() -- no new scoring model, no new
 * weights. Omitted (undefined) preserves this function's exact prior
 * behavior byte-for-byte, since evaluateActivityFit/evaluatePersonalMuhurtaFit
 * already treat a missing personalContext as their existing neutral-default
 * case.
 *
 * Ask Aura GOOD_RIGHT_NOW Personalized Hybrid V1 -- `date` is optional and
 * defaults to `new Date()`, preserving Home's own existing call sites
 * (which omit it) byte-for-byte. A server-side caller with its own already-
 * resolved canonical request instant (Ask Aura's `deps.context.now`) should
 * pass it explicitly so the WHOLE response is computed against one single
 * instant, rather than this function silently taking a second, independent
 * wall-clock reading of its own.
 */
export function getActivityDiscoveryCards(window: string, limit = 6, personalContext?: PersonalMuhurtaContext, date: Date = new Date()): ActionCard[] {
  const windowType = normalizeWindowType(window);
  return FULL_ACTIVITY_CATALOG
    .map((activity) => {
      const fit = evaluateActivityFit({ activity, date, windowType, personalContext });
      const blocked = activity.avoidWindowTypes.includes(windowType) && !activity.allowDuringAvoidWindow && fit.score < 55;
      return { activity, fit, blocked };
    })
    .filter(({ blocked, fit }) => !blocked && fit.label !== 'AVOID')
    .sort((a, b) => b.fit.score - a.fit.score || a.activity.title.localeCompare(b.activity.title))
    .slice(0, limit)
    .map(({ activity, fit }) => ({
      id: `activity-${activity.id}`,
      activityId: activity.id,
      category: activity.category,
      title: activity.title,
      description: buildActivityDiscoveryDescription(fit),
      icon: activity.icon,
      significance: activity.significance,
      requiresFreshStart: activity.requiresFreshStart,
      aliases: activity.aliases,
      fit: fit.score >= 85 ? 'BEST' : fit.score >= 70 ? 'GOOD' : fit.score >= 55 ? 'USABLE' : 'CAUTION',
      fitScore: fit.score,
    }));
}
