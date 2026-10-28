// AURA HPG1 -- Preserve Activity Identity in Home -> Plan.
//
// Real unit tests (not source-text regex) against the actual exported
// resolvePrefillActivity(), the function behind PlanWithAuraView.tsx's
// prefill effect. Importing it still pulls in the whole .tsx module (the
// file's other exports use JSX), so this needs the same --jsx override as
// test/dailyBriefingEvidenceCompleteness.test.ts and friends (excluded
// from the root tsconfig.json program for the identical reason -- see
// tsconfig.json's own exclude list, which this file joins):
//
// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/planHomeHandoffActivityIdentity.test.ts
import { resolvePrefillActivity, resolveActivitySelection } from '../apps/web/components/PlanWithAuraView';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Two distinct, real catalog entries (confirmed present in FULL_ACTIVITY_CATALOG).
const DEEP_WORK = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'deep-work')!;
const WORKOUT = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'workout')!;
if (!DEEP_WORK || !WORKOUT) { console.error('FIXTURE SETUP FAILED: expected catalog ids deep-work/workout not found'); process.exit(1); }

// ============================================================
// 1. Home -> Plan with a valid activity id (the case HPG2's goal-linked
// handoff will also rely on -- Goals' own GoalActivity.activityId points
// into this exact same static catalog).
// ============================================================
{
  const result = resolvePrefillActivity(DEEP_WORK.title, DEEP_WORK.id);
  check('1. a valid id resolves activityId to itself', result.activityId === DEEP_WORK.id);
  check('1. a valid id resolves taskTitle to the catalog\'s OWN title', result.taskTitle === DEEP_WORK.title);
  check('1. a valid id marks the task as known (not custom)', result.isCustomTask === false);
}

// ============================================================
// 2. Home -> Plan with title only (no id) -- the existing, unchanged path.
// ============================================================
{
  const result = resolvePrefillActivity(DEEP_WORK.title, undefined);
  check('2. title-only (exact catalog match) still resolves taskTitle correctly', result.taskTitle === DEEP_WORK.title);
  check('2. title-only never fabricates an activityId (none was supplied)', result.activityId === undefined);
  check('2. title-only still correctly recognizes a catalog-exact title as known', result.isCustomTask === false);

  const freeText = resolvePrefillActivity('Completely Made Up Activity Nobody Catalogued', undefined);
  check('2. title-only with a free-text (non-catalog) title has no activityId', freeText.activityId === undefined);
  check('2. title-only with a free-text title is marked custom', freeText.isCustomTask === true);
  check('2. title-only with a free-text title still preserves the typed text verbatim', freeText.taskTitle === 'Completely Made Up Activity Nobody Catalogued');
}

// ============================================================
// 3. Duplicate-title risk: a validated id's OWN canonical title always
// wins over whatever (possibly mismatched, possibly shared-with-another-
// entry) title string accompanied it -- identity is never re-derived from
// text once a genuine id is in hand. This is the guarantee that protects
// against two catalog entries someday sharing a title.
// ============================================================
{
  // Deliberately pass WORKOUT's id alongside DEEP_WORK's title (a stand-in
  // for "two entries with colliding/mismatched titles") -- the id must win.
  const result = resolvePrefillActivity(DEEP_WORK.title, WORKOUT.id);
  check('3. a valid id resolves to ITS OWN activity, never the accompanying (mismatched) title\'s activity', result.activityId === WORKOUT.id);
  check('3. taskTitle is overwritten to the ID-matched entry\'s own title, not the mismatched title that was passed in', result.taskTitle === WORKOUT.title);
  check('3. the mismatched original title string is discarded entirely once the id resolves', result.taskTitle !== DEEP_WORK.title);
}

// ============================================================
// 4. Missing, stale, malformed, and unauthorized ids all collapse to the
// SAME safe fallback: title-only behavior, exactly as if no id had been
// passed. The catalog is static and non-user-scoped (confirmed by reading
// FULL_ACTIVITY_CATALOG/getActivityDefinition -- no userId parameter
// anywhere), so "unauthorized" and "nonexistent" are the same case here:
// any id this exact lookup doesn't match.
// ============================================================
{
  const missing = resolvePrefillActivity(DEEP_WORK.title, undefined);
  check('4. missing id (undefined) falls back to title-only, no crash', missing.activityId === undefined && missing.taskTitle === DEEP_WORK.title);

  const empty = resolvePrefillActivity(DEEP_WORK.title, '');
  check('4. empty-string id is treated as absent, falls back to title-only', empty.activityId === undefined && empty.taskTitle === DEEP_WORK.title);

  const stale = resolvePrefillActivity(DEEP_WORK.title, 'deep-work-v1-retired-id-no-longer-exists');
  check('4. a stale (no-longer-real) id falls back to title-only, no crash', stale.activityId === undefined && stale.taskTitle === DEEP_WORK.title);

  const malformed = resolvePrefillActivity(DEEP_WORK.title, '<script>alert(1)</script>');
  check('4. a malformed/garbage id falls back to title-only, no crash, no injection artifact in the result', malformed.activityId === undefined && malformed.taskTitle === DEEP_WORK.title);

  const unauthorizedShaped = resolvePrefillActivity(DEEP_WORK.title, 'goal-activity-belonging-to-another-user-abc123');
  check('4. an id shaped like a foreign/unauthorized record falls back to title-only, no crash (static catalog has no ownership to even check)', unauthorizedShaped.activityId === undefined && unauthorizedShaped.taskTitle === DEEP_WORK.title);

  // An invalid id must never corrupt or discard a perfectly good title.
  const customTitleWithBadId = resolvePrefillActivity('My Own Custom Thing', 'not-a-real-id');
  check('4. an invalid id alongside a legitimate free-text title still preserves that title verbatim', customTitleWithBadId.taskTitle === 'My Own Custom Thing' && customTitleWithBadId.activityId === undefined);
}

// ============================================================
// 5. resolveActivitySelection (the EXISTING, unmodified exact-title
// resolver used everywhere else in this component) is untouched --
// confirms this PR added a new function rather than changing the old
// one's behavior.
// ============================================================
{
  const existing = resolveActivitySelection(DEEP_WORK.title);
  check('5. resolveActivitySelection itself is unmodified -- still resolves a known title to activityId only (no taskTitle field)', existing.activityId === DEEP_WORK.id && existing.taskTitle === undefined);
}

// ============================================================
// 6. Never infers identity by title-matching when an id was supplied --
// the function must not fall back to a text search of its own even when
// the supplied id happens to be invalid and the title ALSO happens to
// exactly match a different real catalog entry by coincidence of the test
// setup. (Guards against a future refactor accidentally reintroducing a
// title-matching fallback inside the id-resolution branch itself.)
// ============================================================
{
  // Bad id, but title exactly matches WORKOUT -- must resolve via the
  // EXISTING, separate title path (isCustomTask false, no activityId, since
  // resolvePrefillActivity itself never calls resolveActivitySelection --
  // that happens later, in the component, via resolveCurrentActivitySelection).
  const result = resolvePrefillActivity(WORKOUT.title, 'totally-invalid-id');
  check('6. an invalid id never gets silently replaced by a title-matched id -- activityId stays unset here (title-based activityId resolution is a SEPARATE, later step, not folded into this function)', result.activityId === undefined);
  check('6. the legitimate matching title is still preserved for that later step to use', result.taskTitle === WORKOUT.title);
}

if (!allPassed) { console.error('SOME HPG1 ACTIVITY IDENTITY CHECKS FAILED'); process.exit(1); }
console.log('ALL HPG1 ACTIVITY IDENTITY CHECKS PASSED');
process.exit(0);
