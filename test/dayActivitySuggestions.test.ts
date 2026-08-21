import { getGoodForDayCategories } from '../packages/recommendation/src/dayActivitySuggestions';
import { getPanchangForDate } from '../packages/panchang/src/panchangDay';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiDay = getPanchangForDate({ localDate: '2026-07-28', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
const categories = getGoodForDayCategories(chennaiDay);

check('getGoodForDayCategories does not throw and returns an array', Array.isArray(categories));
check('Returns at most 4 categories (scannable cap)', categories.length <= 4);
check('Every returned category has a non-empty icon/label/activityId', categories.every((c) => c.icon.length > 0 && c.label.length > 0 && c.activityId.length > 0));
check('Categories are sorted by score descending', categories.every((c, i) => i === 0 || categories[i - 1].score >= c.score));
check('Every returned score meets the existing Aura Fit BEST threshold (>= 80)', categories.every((c) => c.score >= 80));

// Cross-check: each returned category's score matches calling
// evaluateActivityFit() directly (the existing, unmodified engine) at the
// best of the day's windows -- proves no new/second scoring formula exists.
for (const category of categories) {
  const activity = findActivityIntent(category.label === 'Important work' ? 'deep work' : category.activityId.replace(/-/g, ' '));
  if (!activity) continue;
  const directBest = Math.max(...chennaiDay.windows.map((w) => evaluateActivityFit({ activity, date: new Date(w.start), windowType: w.type }).score));
  check(`"${category.label}" score matches evaluateActivityFit()'s own best-of-day score (no new formula)`, category.score === directBest);
}

console.log(allPassed ? '\nALL DAY ACTIVITY SUGGESTIONS CHECKS PASSED' : '\nSOME DAY ACTIVITY SUGGESTIONS CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
