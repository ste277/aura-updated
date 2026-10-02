/**
 * Goals V2 Candidate B1 -- pure tests for matchGoalTemplateCategory
 * (apps/web/lib/goals.ts): deterministic free-text Goal outcome ->
 * existing GoalTemplateCategory | null. No DB, no network, no React.
 *
 * B1 does not create activities, does not persist anything, and does not
 * touch Goal creation UI -- this file only proves the pure matching
 * function and its structural guarantees (category completeness, and
 * that the matcher's own vocabulary never leaks GOAL_TEMPLATES-owned
 * data such as activity titles/activityId/completion/Rhythm).
 */
import {
  matchGoalTemplateCategory,
  GOAL_TEMPLATE_CATEGORIES,
  GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES,
  GOAL_TEMPLATES,
} from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Positive matches -- one per category, covering canonical phrase, case
// variation, whitespace variation, and embedding in a longer sentence.
// ============================================================

check('GET_FITTER: canonical phrase', matchGoalTemplateCategory('I want to get fitter') === 'GET_FITTER');
check('GET_FITTER: case-insensitive', matchGoalTemplateCategory('GET FITTER') === 'GET_FITTER');
check('GET_FITTER: collapsed/irregular whitespace', matchGoalTemplateCategory('  get   fitter  ') === 'GET_FITTER');
check('GET_FITTER: embedded in a longer natural sentence', matchGoalTemplateCategory('My goal is to get fitter this year.') === 'GET_FITTER');
check('GET_FITTER: "I really want to get fitter this year" (ticket example)', matchGoalTemplateCategory('I really want to get fitter this year') === 'GET_FITTER');
check('GET_FITTER: alternate phrase "get fit"', matchGoalTemplateCategory('I want to get fit') === 'GET_FITTER');
check('GET_FITTER: alternate phrase "exercise regularly"', matchGoalTemplateCategory('I want to exercise regularly') === 'GET_FITTER');

check('MEDITATE_REGULARLY: canonical phrase', matchGoalTemplateCategory('I want to meditate regularly') === 'MEDITATE_REGULARLY');
check('MEDITATE_REGULARLY: case-insensitive', matchGoalTemplateCategory('MEDITATE REGULARLY') === 'MEDITATE_REGULARLY');
check('MEDITATE_REGULARLY: whitespace variation', matchGoalTemplateCategory('  meditate    regularly  ') === 'MEDITATE_REGULARLY');
check('MEDITATE_REGULARLY: embedded in a longer sentence', matchGoalTemplateCategory('This year I want to meditate regularly every morning.') === 'MEDITATE_REGULARLY');
check('MEDITATE_REGULARLY: alternate phrase "start meditating"', matchGoalTemplateCategory('I want to start meditating') === 'MEDITATE_REGULARLY');
check('MEDITATE_REGULARLY: alternate phrase "build a meditation habit"', matchGoalTemplateCategory('I want to build a meditation habit') === 'MEDITATE_REGULARLY');

check('FINISH_PROJECT: canonical phrase', matchGoalTemplateCategory('I need to finish my project') === 'FINISH_PROJECT');
check('FINISH_PROJECT: case-insensitive', matchGoalTemplateCategory('FINISH MY PROJECT') === 'FINISH_PROJECT');
check('FINISH_PROJECT: whitespace variation', matchGoalTemplateCategory('  finish   my   project  ') === 'FINISH_PROJECT');
check('FINISH_PROJECT: embedded in a longer sentence', matchGoalTemplateCategory('Before the deadline I need to finish my project.') === 'FINISH_PROJECT');
check('FINISH_PROJECT: alternate phrase "complete my project"', matchGoalTemplateCategory('I want to complete my project') === 'FINISH_PROJECT');
check('FINISH_PROJECT: alternate phrase "finish a project" (no possessive)', matchGoalTemplateCategory('I need to finish a project') === 'FINISH_PROJECT');

check('STUDY_CONSISTENTLY: canonical phrase', matchGoalTemplateCategory('I want to study consistently') === 'STUDY_CONSISTENTLY');
check('STUDY_CONSISTENTLY: case-insensitive', matchGoalTemplateCategory('STUDY CONSISTENTLY') === 'STUDY_CONSISTENTLY');
check('STUDY_CONSISTENTLY: whitespace variation', matchGoalTemplateCategory('  study   consistently  ') === 'STUDY_CONSISTENTLY');
check('STUDY_CONSISTENTLY: embedded in a longer sentence', matchGoalTemplateCategory('My goal is to study consistently for the exam.') === 'STUDY_CONSISTENTLY');
check('STUDY_CONSISTENTLY: alternate phrase "study regularly"', matchGoalTemplateCategory('I want to study regularly') === 'STUDY_CONSISTENTLY');
check('STUDY_CONSISTENTLY: alternate phrase "build a study habit"', matchGoalTemplateCategory('I want to build a study habit') === 'STUDY_CONSISTENTLY');

// ============================================================
// Unknown goals -- MUST return null. No forcing an unsupported Goal into
// the "closest" existing category (this ticket's own section 12).
// ============================================================

check('Unknown: "Learn Spanish" -> null (no LANGUAGE_LEARNING category; never forced into STUDY_CONSISTENTLY)', matchGoalTemplateCategory('Learn Spanish') === null);
check('Unknown: "Save for a house" -> null', matchGoalTemplateCategory('Save for a house') === null);
check('Unknown: "Plan our wedding" -> null', matchGoalTemplateCategory('Plan our wedding') === null);
check('Unknown: "Spend more time with my parents" -> null', matchGoalTemplateCategory('Spend more time with my parents') === null);

// ============================================================
// Degenerate input
// ============================================================

check('Empty string -> null', matchGoalTemplateCategory('') === null);
check('Whitespace-only -> null', matchGoalTemplateCategory('   ') === null);
check('Punctuation-only -> null', matchGoalTemplateCategory('!!! ... ???') === null);
check('Random unrelated prose -> null', matchGoalTemplateCategory('The quick brown fox jumps over the lazy dog') === null);

// ============================================================
// Ambiguity -- exactly one matching category wins; zero or more than one
// both resolve to null (this ticket's own section 8 -- no ranking, no
// scoring, no first-match tie-break, no template declaration order).
// ============================================================

check(
  'Ambiguous multi-intent: "I want to get fitter and study consistently" -> null (never silently picks one)',
  matchGoalTemplateCategory('I want to get fitter and study consistently') === null
);
check(
  'Ambiguous multi-intent: "I need to finish my project and meditate regularly" -> null',
  matchGoalTemplateCategory('I need to finish my project and meditate regularly') === null
);
check(
  'Ambiguous multi-intent: three categories in one sentence -> null',
  matchGoalTemplateCategory('I want to get fitter, meditate regularly, and study consistently') === null
);

// ============================================================
// False positives / near-misses -- unrelated lexical containment must
// never accidentally match (this ticket's own section 7/13).
// ============================================================

check(
  'Near-miss: "get fitterish" does not match GET_FITTER (longer unrelated word, not a real word-boundary match)',
  matchGoalTemplateCategory('I want to get fitterish somehow') === null
);
check(
  'Near-miss: a bare fragment of a multi-word phrase does not match on its own (e.g. "study" alone, without "consistently"/"regularly"/"habit")',
  matchGoalTemplateCategory('I enjoy dedicated study time with friends') === null
);
check(
  'Near-miss: "misstudyconsistently" (no real word boundaries at all) does not match STUDY_CONSISTENTLY',
  matchGoalTemplateCategory('misstudyconsistently is not a real goal') === null
);
check(
  'Near-miss: "unfit" / "outfitter" style words containing "fit" fragments do not match GET_FITTER',
  matchGoalTemplateCategory('My new outfitter sells unfit gear') === null
);
check(
  'Near-miss: "project finisher" (words present but not in the matched phrase order/shape) does not match FINISH_PROJECT',
  matchGoalTemplateCategory('I am a great project finisher in general') === null
);

// ============================================================
// Category-completeness guard (this ticket's own section 15) -- every
// current GoalTemplateCategory has explicit matcher vocabulary. The
// `satisfies Record<GoalTemplateCategory, readonly string[]>` contract on
// GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES already makes a missing category a
// TypeScript compile error; this is the runtime half of that guarantee,
// also proving each category's vocabulary is genuinely non-empty and
// genuinely reachable through the public matcher function (not just
// present as dead data).
// ============================================================

check(
  'Category-completeness: every GoalTemplateCategory has a non-empty phrase list',
  GOAL_TEMPLATE_CATEGORIES.every((category) => Array.isArray(GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES[category]) && GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES[category].length > 0)
);
check(
  'Category-completeness: every GoalTemplateCategory has at least one phrase that genuinely resolves back to it through matchGoalTemplateCategory',
  GOAL_TEMPLATE_CATEGORIES.every((category) => GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES[category].some((phrase) => matchGoalTemplateCategory(phrase) === category))
);
check(
  'Category-completeness: the phrase table has exactly the four currently-shipped categories, no silent drift',
  Object.keys(GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES).length === GOAL_TEMPLATE_CATEGORIES.length &&
    GOAL_TEMPLATE_CATEGORIES.every((category) => category in GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES)
);

// ============================================================
// Template-source-of-truth guard (this ticket's own section 16) -- the
// matcher's own vocabulary carries ONLY phrases, never GOAL_TEMPLATES-
// owned data (GoalActivity titles, activityId, completion requirements,
// Rhythm, durations). GOAL_TEMPLATES remains the sole source of truth for
// decomposition once a category is chosen.
// ============================================================

const allTemplateActivityTitles = GOAL_TEMPLATE_CATEGORIES.flatMap((category) => GOAL_TEMPLATES[category].map((activity) => activity.title.toLowerCase()));
const allMatchPhrases = GOAL_TEMPLATE_CATEGORIES.flatMap((category) => GOAL_TEMPLATE_CATEGORY_MATCH_PHRASES[category]);

check(
  'Template-source-of-truth: no matcher phrase is identical to (or contains) a GOAL_TEMPLATES activity title',
  allMatchPhrases.every((phrase) => allTemplateActivityTitles.every((title) => !title.includes(phrase) && !phrase.includes(title)))
);
check('Template-source-of-truth: no matcher phrase contains a digit (no durations/targets leaking into the matcher)', allMatchPhrases.every((phrase) => !/\d/.test(phrase)));

// ============================================================
// Dependency / purity boundary (this ticket's own section 17) -- zero
// DB/pg/Prisma/fetch/server-action/API-route/product-event coupling.
// Confirmed by direct source inspection of apps/web/lib/goals.ts's real
// import statements (doc-comment prose mentioning these names does not
// count).
// ============================================================

{
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../apps/web/lib/goals.ts'), 'utf8');
  const srcNoComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(
    'Purity: goals.ts never imports pg/db.ts/Prisma/fetch/React/next in real code',
    !/from '\.\/db'|from 'pg'|from '@prisma|from 'react'|from 'next|fetch\(/.test(srcNoComments)
  );
  check('Purity: goals.ts never references Date.now() or `new Date()` from matchGoalTemplateCategory\'s own code path', !/matchGoalTemplateCategory[\s\S]{0,600}?(Date\.now\(\)|new Date\()/.test(srcNoComments));
}

// ============================================================
// Zero-write proof (this ticket's own section 17/18) -- matching is pure
// and synchronous; calling it repeatedly with the same input is
// side-effect-free and always returns the identical result.
// ============================================================

check(
  'Zero-write/determinism: calling the matcher twice with the same input returns the identical result both times',
  matchGoalTemplateCategory('I want to get fitter') === matchGoalTemplateCategory('I want to get fitter')
);
check('Zero-write: matchGoalTemplateCategory is synchronous (does not return a Promise)', !((matchGoalTemplateCategory('I want to get fitter') as unknown) instanceof Promise));

if (!allPassed) {
  console.error('SOME GOAL TEMPLATE CATEGORY MATCHING CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL TEMPLATE CATEGORY MATCHING CHECKS PASSED');
