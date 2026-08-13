/**
 * MVP action-card lookup.
 * Deterministic table: SolarWindowType -> 3 action cards.
 * No LLM call, no persona branching (STANDARD only) — per the MVP scope cut.
 * Includes flexible fallback parsing for string key variations.
 */

import type { SolarWindowType } from '../../panchang/src/windows';
import { FULL_ACTIVITY_CATALOG, normalizeWindowType } from './personalizedTasks';
import type { ActivityCategory } from './personalizedTasks';

export interface ActionCard {
  id: string;
  category: ActivityCategory;
  title: string;
  description: string; // Updated from reasoning for direct UI mapping
  reasoning: string;   // Retained for backward compatibility
  icon?: string;
  activityId?: string;
  significance?: 'LOW' | 'MEDIUM' | 'HIGH';
  requiresFreshStart?: boolean;
  aliases?: string[];
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
    },
    {
      id: 'brahma-focus',
      category: 'FOCUS',
      title: 'Distraction-free planning block',
      description: 'Quiet hours before sunrise are well suited to deep, uninterrupted thinking.',
      reasoning: 'Quiet hours before sunrise are well suited to deep, uninterrupted thinking.',
      icon: '✍️',
    },
    {
      id: 'brahma-hydrate',
      category: 'MICRO_BREAK',
      title: 'Hydrate before the day starts',
      description: 'A simple, low-effort way to start the daily streak.',
      reasoning: 'A simple, low-effort way to start the daily streak.',
      icon: '💧',
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
    },
    {
      id: 'abhijit-meal',
      category: 'MEAL',
      title: 'Main meal of the day',
      description: 'Solar noon aligns with peak digestive capacity.',
      reasoning: 'Solar noon aligns with peak digestive capacity.',
      icon: '🍲',
    },
    {
      id: 'abhijit-focus',
      category: 'FOCUS',
      title: 'Tackle your hardest task',
      description: 'Highest-leverage window for demanding cognitive work.',
      reasoning: 'Highest-leverage window for demanding cognitive work.',
      icon: '⚡',
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
    },
    {
      id: 'rahu-break',
      category: 'MICRO_BREAK',
      title: 'Step away and reset',
      description: 'Short break rather than pushing through friction.',
      reasoning: 'Short break rather than pushing through friction.',
      icon: '☕',
    },
    {
      id: 'rahu-hydrate',
      category: 'MICRO_BREAK',
      title: 'Water / tea refill',
      description: 'Keep momentum with something low-stakes.',
      reasoning: 'Keep momentum with something low-stakes.',
      icon: '🫖',
    },
  ],
  GULIKA: [
    {
      id: 'gulika-cardio',
      category: 'WORKOUT',
      title: 'Steady cardio or a walk',
      description: 'Good window for compounding, lower-intensity conditioning.',
      reasoning: 'Good window for compounding, lower-intensity conditioning.',
      icon: '🚶',
    },
    {
      id: 'gulika-skill',
      category: 'FOCUS',
      title: 'Skill-building or learning session',
      description: 'Traditionally associated with steady, compounding growth.',
      reasoning: 'Traditionally associated with steady, compounding growth.',
      icon: '📚',
    },
    {
      id: 'gulika-social',
      category: 'MICRO_BREAK',
      title: 'Social check-in or coffee break',
      description: 'Good window to step out and reconnect before the day winds down.',
      reasoning: 'Good window to step out and reconnect before the day winds down.',
      icon: '💬',
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
    },
    {
      id: 'yama-lightmeal',
      category: 'MEAL',
      title: 'Light snack if needed',
      description: 'Keep it light rather than a full meal in this window.',
      reasoning: 'Keep it light rather than a full meal in this window.',
      icon: '🍏',
    },
    {
      id: 'yama-break',
      category: 'MICRO_BREAK',
      title: 'Stretch and reset',
      description: 'Low-effort reset to bridge into the next window.',
      reasoning: 'Low-effort reset to bridge into the next window.',
      icon: '🧘',
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
    },
    {
      id: 'neutral-break',
      category: 'MICRO_BREAK',
      title: 'Short walk or stretch',
      description: 'Good default to keep the ultradian rhythm on track.',
      reasoning: 'Good default to keep the ultradian rhythm on track.',
      icon: '🚶',
    },
    {
      id: 'neutral-hydrate',
      category: 'MICRO_BREAK',
      title: 'Hydration check',
      description: 'Simple, always-available action to log.',
      reasoning: 'Simple, always-available action to log.',
      icon: '💧',
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
 * Profile-backed discovery for the Planner and future activity picker.
 * This answers "what could I do in this window?" without making the window
 * the source of truth for task timing.
 */
export function getActivityDiscoveryCards(window: string, limit = 6): ActionCard[] {
  const windowType = normalizeWindowType(window);
  return FULL_ACTIVITY_CATALOG
    .map((activity) => {
      const preferred = activity.recommendedWindowTypes.includes(windowType);
      const acceptable = activity.acceptableWindowTypes.includes(windowType);
      const avoided = activity.avoidWindowTypes.includes(windowType);
      const score = preferred ? 100 : acceptable ? 65 : avoided && !activity.allowDuringAvoidWindow ? -100 : 35;
      return { activity, score };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.activity.title.localeCompare(b.activity.title))
    .slice(0, limit)
    .map(({ activity }) => ({
      id: `activity-${activity.id}`,
      activityId: activity.id,
      category: activity.category,
      title: activity.title,
      description: activity.description,
      reasoning: activity.description,
      icon: activity.icon,
      significance: activity.significance,
      requiresFreshStart: activity.requiresFreshStart,
      aliases: activity.aliases,
    }));
}
