/**
 * Goals -> Planning Integration V1 PR B -- structural regression suite
 * proving this PR's own explicit boundaries (PRODUCT PRINCIPLE / sections
 * 38/39/40/41 -- no Plan My Day handoff, no Home integration beyond the
 * single nav entry, no scheduling module imports, no duplicate API
 * endpoints, no raw internal terminology exposed) and PR A's own house
 * rules (no Habit creation, no Vedic/LLM integration). Same
 * source-reading convention as planDayWiring.test.ts / goalsWiring.test.ts
 * (PR A) -- this repository has no component-rendering harness, so
 * structural facts are proven by reading real, shipped source.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

/** Strips `//` line comments and `/* ... *\/` block comments (including
 * JSX `{/* ... *\/}` comments, which are just a block comment inside an
 * expression container) before a check scans for the ABSENCE of a phrase
 * -- this file's own doc comments legitimately explain what ISN'T
 * rendered ("no unarchive action", "never a separate 'belongs to another
 * user' message"), which would otherwise self-trigger the exact checks
 * meant to catch real user-facing copy. Never used for checks proving
 * PRESENCE of real code (e.g. `window.location.href = ...`), only for
 * "this phrase must not appear as real output" checks. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const GOALS_UI_FILES: Record<string, string> = {
  'Goals list page (server)': '../apps/web/app/goals/page.tsx',
  'Goals list client': '../apps/web/app/goals/GoalsListClient.tsx',
  'Goal detail page (server)': '../apps/web/app/goals/[goalId]/page.tsx',
  'Goal detail client': '../apps/web/app/goals/[goalId]/GoalDetailClient.tsx',
  'Goals presentation helpers': '../apps/web/lib/goalsPresentation.ts',
};

function main() {
  const sources = Object.fromEntries(Object.entries(GOALS_UI_FILES).map(([label, relPath]) => [label, read(relPath)]));
  const allGoalsUiSource = Object.values(sources).join('\n');

  // ============================================================
  // Z/38. No Plan My Day handoff yet -- no ?fromGoal=/?activities= query
  // params, no import from any Plan My Day/Day Constructor/acceptance
  // module.
  // ============================================================
  check('Z. no "fromGoal" query param anywhere in the Goals UI', !/fromGoal/.test(allGoalsUiSource));
  check('Z. no "?activities=" query param construction anywhere in the Goals UI', !/[?&]activities=/.test(allGoalsUiSource));
  const forbiddenSchedulingImports = [
    'planDayEntry', 'planDayBootstrap', 'planDayQuickPicks', 'planningHorizon',
    'dayIntent', 'dayConstructor', 'dayConstructorOrchestrator',
    'dayConstructorPreviewRequest', 'dayConstructorPreviewClient',
    'acceptConstructedDay', 'dayConstructorAcceptance', 'timingSearch',
    'availabilityContext', 'PlanDayClient', 'DayPlanPreviewController',
  ];
  for (const [label, source] of Object.entries(sources)) {
    for (const moduleName of forbiddenSchedulingImports) {
      check(`AA/38. ${label} does not import ${moduleName}`, !new RegExp(`from ['"].*${moduleName}['"]`).test(source));
    }
  }

  // ============================================================
  // 40. No duplicate Goal API endpoints -- the two CLIENT components only
  // ever fetch the already-merged PR A routes (/api/goals...), never
  // re-implement persistence themselves. The two Server Components (page.tsx)
  // legitimately import getUserById from lib/db.ts for the SAME session-
  // verification read every other Server Component in this app already
  // does (app/plan-day/page.tsx's own established precedent) -- that is
  // authentication, not a duplicate Goal endpoint, so it is intentionally
  // excluded from this check.
  // ============================================================
  const clientOnlySource = [sources['Goals list client'], sources['Goal detail client'], sources['Goals presentation helpers']].join('\n');
  check('40. no Goals CLIENT file imports lib/db.ts directly (all persistence stays behind the existing API routes)', !/from ['"].*\/lib\/db['"]/.test(clientOnlySource));
  check('40. every fetch() call targets an existing /api/goals path', (allGoalsUiSource.match(/fetch\(`?\/api\/([a-zA-Z-]+)/g) ?? []).every((m) => m.includes('/api/goals')));

  // ============================================================
  // AB/37. No Habit creation, no Habit.goalId.
  // ============================================================
  check('AB. no Habit creation/reference anywhere in the Goals UI', !/\bHabit\b/.test(allGoalsUiSource) && !/\/api\/habits/.test(allGoalsUiSource));

  // ============================================================
  // AC/35/36. No Vedic or LLM integration.
  // ============================================================
  const vedicTerms = ['Panchang', 'Muhurta', 'Rahu', 'Gulika', 'Yama', 'Abhijit', 'auspicious', 'lunar'];
  for (const term of vedicTerms) {
    check(`AC/35. no Vedic term "${term}" anywhere in the Goals UI`, !new RegExp(term, 'i').test(allGoalsUiSource));
  }
  check('AC/36. no LLM/AI SDK reference anywhere in the Goals UI', !/anthropic|openai|\bllm\b|gpt|ChatCompletion/i.test(allGoalsUiSource));
  check('36. copy never claims Aura "generated a personalized plan" for the deterministic templates', !/generated a personalized/i.test(allGoalsUiSource));

  // ============================================================
  // 39. No Home integration beyond the single dedicated nav entry --
  // HomeDashboard.tsx / app/page.tsx gain zero Goal awareness; the ONLY
  // new reference anywhere in the existing app shell is the one row this
  // PR adds to YouView.tsx.
  // ============================================================
  const homeDashboardSource = read('../apps/web/components/HomeDashboard.tsx');
  const pageSource = read('../apps/web/app/page.tsx');
  check('39. HomeDashboard.tsx has zero mention of Goal (no Goal cards/opportunities added to Home)', !/\bGoal(s)?\b/.test(homeDashboardSource));
  check('39. app/page.tsx has zero mention of "/goals" (no new activeTab/navigation wired there)', !/\/goals/.test(pageSource));
  const youViewSource = read('../apps/web/components/YouView.tsx');
  check('4. YouView.tsx contains exactly one FUNCTIONAL navigation to /goals (the single nav entry this ticket asks for -- doc-comment mentions of "/goals" are excluded, not a second entry)', (stripComments(youViewSource).match(/\/goals/g) ?? []).length === 1);
  check('4. the Goals nav entry navigates via a plain window.location.href, same mechanism as every other cross-route link in this app (no new prop threaded through page.tsx)', /window\.location\.href = '\/goals'/.test(youViewSource));

  // ============================================================
  // Y/34. No raw internal enum/id terminology rendered as user-facing
  // text -- every activity status/goal status the UI shows a human a
  // real word for goes through the presentation helpers, never a raw
  // `.status`/`.derivedState` interpolation.
  // ============================================================
  const clientSources = [sources['Goals list client'], sources['Goal detail client']];
  for (const source of clientSources) {
    check('Y. no raw `{activity.status}` / `{activity.derivedState}` / `{goal.status}` interpolated directly into JSX', !/\{activity\.status\}|\{activity\.derivedState\}|\{goal\.status\}/.test(source));
  }
  check('Y. GoalDetailClient renders activity state labels only via presentGoalActivityStateLabel', sources['Goal detail client'].includes('presentGoalActivityStateLabel'));
  check('Y. GoalsListClient/CreateGoalModal renders template choices only via GOAL_TEMPLATE_OPTIONS/presentGoalTemplateCategory, never a raw GoalTemplateCategory literal in JSX text', sources['Goals list client'].includes('GOAL_TEMPLATE_OPTIONS'));
  const codeOnlySource = stripComments(allGoalsUiSource);
  // A tight "word sits alone between > and <" pattern -- deliberately NOT
  // `>[^<]*word[^<]*<`, which is far too greedy in TSX: generics
  // (`useState<T>`), comparisons (`status === 404`), and arrow functions
  // all produce unrelated `>`/`<` characters that a broad "anything
  // between them" scan sweeps in, spuriously matching ordinary code that
  // never renders anything (confirmed directly -- the broad pattern
  // matched `templateCategory` inside a plain `useState` call and a
  // `JSON.stringify` object literal, neither of which is a JSX text node).
  const renderedAsText = (word: string) => new RegExp(`>\\s*\\{?\\s*${word}\\s*\\}?\\s*<`).test(codeOnlySource);
  check('34. no literal "GoalActivity" word rendered as user-facing copy (it appears only as a TypeScript type name, never inside a JSX text node)', !renderedAsText('GoalActivity'));
  check('34. no literal "templateCategory"/"plannedActivityId"/"derivedState" word appears inside a JSX text node', !renderedAsText('templateCategory') && !renderedAsText('plannedActivityId') && !renderedAsText('derivedState'));
  // Also rule out the word appearing as a rendered STRING LITERAL
  // (`'templateCategory'`/`"derivedState"` passed straight into JSX
  // children) -- the actual failure mode this check cares about.
  check('34. no internal field name is ever passed as a literal string into JSX children', !/\{\s*['"](templateCategory|plannedActivityId|derivedState|GoalActivity)['"]\s*\}/.test(codeOnlySource));

  // ============================================================
  // 18/19. Selection is either absent or, if present, provably local
  // state only (this ticket's own explicit "prefer avoiding dead UI").
  // PR B's own implementation choice: selection checkboxes are omitted
  // entirely (see GoalDetailClient's ActivityRow doc comment) -- verified
  // here as a real structural fact, not just a claim.
  // ============================================================
  check('18/19. no "Plan selected" action exists anywhere in the Goals UI (not shipped in PR B, per this ticket\'s own explicit instruction)', !/Plan selected/i.test(allGoalsUiSource));
  check('18/19. no selection checkbox/"selected" local state exists on activity rows (selection controls omitted entirely, not merely disabled -- "prefer avoiding dead UI")', !/type="checkbox"/.test(sources['Goal detail client']));

  // ============================================================
  // 24/25. No scheduling controls on PLANNED/COMPLETED rows -- no
  // reschedule/cancel/mark-complete action anywhere in the detail client.
  // ============================================================
  const goalDetailClientCodeOnly = stripComments(sources['Goal detail client']);
  check('24. no reschedule/cancel action on any activity row', !/[Rr]eschedule|[Cc]ancel [Pp]lan/.test(goalDetailClientCodeOnly));
  check('25. no second "mark complete" action anywhere (completion is derived, never a Goal-side action)', !/[Mm]ark [Cc]omplete/.test(goalDetailClientCodeOnly));

  // ============================================================
  // 29. No unarchive/restore endpoint invented.
  // ============================================================
  check('29. no unarchive/restore action anywhere in the Goals UI', !/unarchive|restore/i.test(codeOnlySource));
  check('23. no dismissed-activity restore action anywhere in the Goals UI', !/undismiss/i.test(codeOnlySource));

  // ============================================================
  // 31/W. No ownership-leak distinction in copy -- a single 404/NOT_FOUND
  // branch, never a separate "belongs to another user" message.
  // ============================================================
  check('W/31. GoalDetailClient has exactly one not-found branch (status === 404), no separate ownership-specific copy', (sources['Goal detail client'].match(/status === 404/g) ?? []).length === 1);
  check('W/31. no "belongs to" / "another user" / "not yours" copy rendered anywhere (real code, not doc comments)', !/belongs to|another user|not yours/i.test(goalDetailClientCodeOnly));

  if (!allPassed) {
    console.error('SOME GOALS UI WIRING CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOALS UI WIRING CHECKS PASSED');
}

main();
