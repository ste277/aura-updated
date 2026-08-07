/**
 * MVP action-card lookup.
 * Deterministic table: SolarWindowType -> 3 action cards.
 * No LLM call, no persona branching (STANDARD only) — per the MVP scope cut.
 * This is intentionally boring and easy to extend later.
 */

import type { SolarWindowType } from '../../panchang/src/windows';

export interface ActionCard {
  id: string;
  category: 'WORKOUT' | 'MEAL' | 'MICRO_BREAK' | 'FOCUS' | 'REST';
  title: string;
  reasoning: string;
}

const ACTION_CARDS: Record<SolarWindowType, ActionCard[]> = {
  BRAHMA: [
    {
      id: 'brahma-mobility',
      category: 'WORKOUT',
      title: 'Light mobility or breathwork',
      reasoning: 'Pre-dawn window favors low-strain movement and mental clarity over intensity.',
    },
    {
      id: 'brahma-focus',
      category: 'FOCUS',
      title: 'Distraction-free planning block',
      reasoning: 'Quiet hours before sunrise are well suited to deep, uninterrupted thinking.',
    },
    {
      id: 'brahma-hydrate',
      category: 'MICRO_BREAK',
      title: 'Hydrate before the day starts',
      reasoning: 'A simple, low-effort way to start the daily streak.',
    },
  ],
  ABHIJIT: [
    {
      id: 'abhijit-workout',
      category: 'WORKOUT',
      title: 'Heavy lifting or a hard training session',
      reasoning: 'Peak solar window — best alignment for maximum physical output.',
    },
    {
      id: 'abhijit-meal',
      category: 'MEAL',
      title: 'Main meal of the day',
      reasoning: 'Solar noon aligns with peak digestive capacity.',
    },
    {
      id: 'abhijit-focus',
      category: 'FOCUS',
      title: 'Tackle your hardest task',
      reasoning: 'Highest-leverage window for demanding cognitive work.',
    },
  ],
  RAHU_KALAM: [
    {
      id: 'rahu-rest',
      category: 'REST',
      title: 'Active rest, no high-stakes decisions',
      reasoning: 'Traditionally a high-friction window — good for low-risk, routine tasks only.',
    },
    {
      id: 'rahu-break',
      category: 'MICRO_BREAK',
      title: 'Step away and reset',
      reasoning: 'Short break rather than pushing through friction.',
    },
    {
      id: 'rahu-hydrate',
      category: 'MICRO_BREAK',
      title: 'Water / tea refill',
      reasoning: 'Keep momentum with something low-stakes.',
    },
  ],
  GULIKA: [
    {
      id: 'gulika-cardio',
      category: 'WORKOUT',
      title: 'Steady cardio or a walk',
      reasoning: 'Good window for compounding, lower-intensity conditioning.',
    },
    {
      id: 'gulika-skill',
      category: 'FOCUS',
      title: 'Skill-building or learning session',
      reasoning: 'Traditionally associated with steady, compounding growth.',
    },
    {
      id: 'gulika-social',
      category: 'MICRO_BREAK',
      title: 'Social check-in or coffee break',
      reasoning: 'Good window to step out and reconnect before the day winds down.',
    },
  ],
  YAMA: [
    {
      id: 'yama-rest',
      category: 'REST',
      title: 'Restraint — avoid starting new commitments',
      reasoning: 'Traditionally a caution window; better for wrapping up than starting.',
    },
    {
      id: 'yama-lightmeal',
      category: 'MEAL',
      title: 'Light snack if needed',
      reasoning: 'Keep it light rather than a full meal in this window.',
    },
    {
      id: 'yama-break',
      category: 'MICRO_BREAK',
      title: 'Stretch and reset',
      reasoning: 'Low-effort reset to bridge into the next window.',
    },
  ],
  NEUTRAL: [
    {
      id: 'neutral-focus',
      category: 'FOCUS',
      title: 'Regular work block',
      reasoning: 'No special solar window active right now — business as usual.',
    },
    {
      id: 'neutral-break',
      category: 'MICRO_BREAK',
      title: 'Short walk or stretch',
      reasoning: 'Good default to keep the ultradian rhythm on track.',
    },
    {
      id: 'neutral-hydrate',
      category: 'MICRO_BREAK',
      title: 'Hydration check',
      reasoning: 'Simple, always-available action to log.',
    },
  ],
};

/** The core "tap arc -> get 3 cards" lookup. O(1), no I/O. */
export function getActionCards(window: SolarWindowType): ActionCard[] {
  return ACTION_CARDS[window];
}
