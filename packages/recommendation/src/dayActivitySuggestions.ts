/**
 * "Good for this day" -- a small set of broad activity categories, each
 * represented by one existing catalog activity, evaluated across the
 * selected date's own computed windows using the existing Aura Fit engine
 * (evaluateActivityFit/labelForScore) UNCHANGED. No new scoring formula:
 * this file only picks which representative activity stands for each broad
 * category and takes the best of the day's already-calculated windows for
 * it -- both are presentation/aggregation choices, not scoring changes.
 */

import type { PanchangDay } from '../../panchang/src/panchangDay';
import { evaluateActivityFit, PersonalMuhurtaContext } from './auraFitEngine';
import { FULL_ACTIVITY_CATALOG } from './personalizedTasks';

export interface DayActivityCategory {
  icon: string;
  label: string;
  activityId: string;
  /** The best Aura Fit score for this category across the day's windows
   * (0-100, same scale as evaluateActivityFit's own score -- not rescaled
   * or reinterpreted). */
  score: number;
}

/** One representative catalog activity per broad category shown in "Good for
 * this day". Deliberately a small, fixed, hand-picked set (not derived from
 * the whole catalog) so the section stays scannable -- matches the brief's
 * example (Important work / Learning / Journey / Social). Finance is
 * included as a 5th since the catalog already has an equally well-defined
 * representative for it. */
const DAY_CATEGORY_ACTIVITIES: Array<{ icon: string; label: string; activityId: string }> = [
  { icon: '💼', label: 'Important work', activityId: 'deep-work' },
  { icon: '📚', label: 'Learning', activityId: 'learning' },
  { icon: '🚗', label: 'Journey', activityId: 'start-journey' },
  { icon: '❤️', label: 'Social', activityId: 'dating' },
  { icon: '💰', label: 'Finance', activityId: 'financial-decision' },
];

/** Score threshold matching evaluateActivityFit's own labelForScore()
 * boundary for 'BEST' (see auraFitEngine.ts, labelForScore: score >= 80 ->
 * 'BEST', >= 90 -> 'EXCEPTIONAL') -- reused, not reinvented, so "good for
 * this day" means exactly what the existing Aura Fit label already means,
 * nothing new. */
const GOOD_FOR_DAY_MIN_SCORE = 80;
const MAX_CATEGORIES_SHOWN = 4;

/**
 * For each representative activity, evaluates it (via the existing,
 * untouched evaluateActivityFit) at every one of the day's own computed
 * windows and keeps the best score -- "how good is the best moment today
 * for this category," not a new day-level formula. Returns only categories
 * whose best score reaches the existing BEST/EXCEPTIONAL threshold,
 * highest-scoring first, capped to keep the section scannable. Returns an
 * empty array (render nothing) if no category clears the bar for this day.
 */
export function getGoodForDayCategories(panchangDay: PanchangDay, personalContext?: PersonalMuhurtaContext): DayActivityCategory[] {
  const results: DayActivityCategory[] = [];

  for (const category of DAY_CATEGORY_ACTIVITIES) {
    const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === category.activityId);
    if (!activity) continue;

    let bestScore = -Infinity;
    for (const window of panchangDay.windows) {
      const fit = evaluateActivityFit({
        activity,
        date: new Date(window.start),
        windowType: window.type,
        personalContext,
      });
      if (fit.score > bestScore) bestScore = fit.score;
    }
    if (bestScore >= GOOD_FOR_DAY_MIN_SCORE) {
      results.push({ icon: category.icon, label: category.label, activityId: category.activityId, score: bestScore });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, MAX_CATEGORIES_SHOWN);
}
