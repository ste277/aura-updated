/**
 * Moment View Navigation Fix: regression suite for the owner's own "View
 * details" action on a responded-to Moment update (Home's "What's Next"
 * card and its Updates-tab sibling, apps/web/components/UpdatesView.tsx).
 *
 * Root cause: the owner's "View" button called handleViewMomentUpdate
 * (apps/web/app/page.tsx), which ALWAYS opened the public, RECIPIENT-
 * facing /moment/[token] page (see AuraMomentClient.tsx: "Does this work
 * for you?" / "✓ [sender] will know you're in") -- regardless of who was
 * looking at it. For the OWNER looking at their own already-resolved
 * Moment, that page's copy and controls are wrong/confusing (an owner
 * cannot "accept" their own invitation). There is no scope (SOLO/SHARED)
 * branching anywhere in this code path -- AuraUpdate (apps/web/lib/
 * auraUpdates.ts) carries no `scope` field at all, so the fix applies
 * identically regardless of moment scope.
 *
 * Fix: the main "View details" CTA now opens the owner's own canonical
 * Plan/Moment details (the existing Plan tab, PlanWithAuraView.tsx, via
 * setActiveTab('plan')) -- the SAME destination handleOpenAgendaItem's
 * PLAN branch, handleOpenReminder's PLAN_APPROACHING branch, and
 * handleFindAnotherTimeForMoment already use elsewhere in this app, so
 * no new "details" screen was created. The public invitation page is
 * completely untouched and remains reachable via a new, separate,
 * explicit "View invitation" action.
 *
 * This is a source-scan suite (the established convention for JSX-
 * embedded behavior in this repo -- see test/insightsEvidenceIntegrity.test.ts),
 * reading the real, current source files rather than simulating clicks
 * (this repo has no React Testing Library harness).
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Extracts one `const <name> = useCallback((...) => { ... }, [...]);`
 * function body from page.tsx's source, by finding the declaration and
 * matching braces forward from its opening `{`. Deliberately brace-aware
 * (not a lazy regex `.*?}`) so a nested `{` inside the body -- e.g. an
 * object literal -- can never truncate the match early. */
function extractCallbackBody(source: string, name: string): string {
  const declIndex = source.indexOf(`const ${name} = useCallback(`);
  if (declIndex === -1) throw new Error(`extractCallbackBody: no "const ${name} = useCallback(" found`);
  const openBraceIndex = source.indexOf('{', declIndex);
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIndex, i + 1);
    }
  }
  throw new Error(`extractCallbackBody: unbalanced braces for "${name}"`);
}

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
const updatesViewSource = fs.readFileSync('apps/web/components/UpdatesView.tsx', 'utf8');
const momentClientSource = fs.readFileSync('apps/web/app/moment/[token]/AuraMomentClient.tsx', 'utf8');

// ============================================================
// ROOT CAUSE FIXED -- handleViewMomentUpdate no longer opens the public
// invitation page; it opens the owner's own Plan tab instead.
// ============================================================
{
  const body = stripComments(extractCallbackBody(pageSource, 'handleViewMomentUpdate'));
  check('handleViewMomentUpdate now calls setActiveTab(\'plan\') (SOLO Moment / SHARED Moment -> View details opens Plan details)', /setActiveTab\(['"]plan['"]\)/.test(body));
  check('handleViewMomentUpdate no longer opens /moment/ (the old bug: routing to the recipient-facing invitation page)', !/\/moment\//.test(body));
  check('handleViewMomentUpdate still marks the response seen (POST .../seen unchanged)', /\/api\/aura-moments\/\$\{momentToken\}\/seen/.test(body));
}

// ============================================================
// The invitation page remains reachable -- via a SEPARATE, explicit
// action, never the default "View details" destination.
// ============================================================
{
  const body = stripComments(extractCallbackBody(pageSource, 'handleViewMomentInvitation'));
  check('handleViewMomentInvitation exists as a genuinely separate handler', pageSource.includes('const handleViewMomentInvitation = useCallback('));
  check('handleViewMomentInvitation opens the exact same public /moment/[token] page the old handleViewMomentUpdate used to (invitation screen preserved, never removed)', /window\.open\(`\$\{window\.location\.origin\}\/moment\/\$\{momentToken\}`/.test(body));
}

// ============================================================
// Both call sites (Home's "What's Next" card and the Updates tab) wire
// the new prop through.
// ============================================================
check('page.tsx passes onViewMomentInvitation={handleViewMomentInvitation} to both <HomeDashboard> and <UpdatesView>', (pageSource.match(/onViewMomentInvitation=\{handleViewMomentInvitation\}/g) ?? []).length === 2);

// ============================================================
// NO REGRESSION -- the pending/"another time" path already correctly
// opened Plan details (handleFindAnotherTimeForMoment -> setActiveTab
// ('plan')) before this fix and must still do so unchanged. This is the
// "SHARED pending invite -> View details opens Plan details" requirement:
// already true today via this existing action, verified here so a future
// change can't silently regress it.
// ============================================================
{
  const body = stripComments(extractCallbackBody(pageSource, 'handleFindAnotherTimeForMoment'));
  check('handleFindAnotherTimeForMoment (the pending-invite action) still opens Plan details via setActiveTab(\'plan\') -- unchanged by this fix', /setActiveTab\(['"]plan['"]\)/.test(body));
  check('handleFindAnotherTimeForMoment never opens the invitation page', !/\/moment\//.test(body));
}

// ============================================================
// NO REGRESSION -- surfaces explicitly OUT OF SCOPE for this fix
// (My Day's agenda-item open, and Starting Soon / Upcoming reminders)
// are untouched: they still route a MOMENT-type target to the public
// page, exactly as before. This fix is scoped to the "What's Next"/
// Updates Moment-update surface only, per the brief.
// ============================================================
{
  const agendaBody = stripComments(extractCallbackBody(pageSource, 'handleOpenAgendaItem'));
  check('handleOpenAgendaItem (My Day, out of scope for this fix) is unchanged -- still opens /moment/ for a MOMENT target', /\/moment\//.test(agendaBody));

  const reminderBody = stripComments(extractCallbackBody(pageSource, 'handleOpenReminder'));
  check('handleOpenReminder (Starting Soon / Upcoming, out of scope for this fix) is unchanged -- still opens /moment/ for a MOMENT target', /\/moment\//.test(reminderBody));
}

// ============================================================
// HomeDashboard.tsx's "What's Next" MOMENT_UPDATE card.
// ============================================================
{
  const source = stripComments(homeDashboardSource);
  check('HomeDashboard: the old bare \'View\' ternary is gone', !source.includes("{isAccepted ? 'View' : 'Find another time'}"));
  check('HomeDashboard: the CTA is renamed to \'View details\'', source.includes("{isAccepted ? 'View details' : 'Find another time'}"));
  check('HomeDashboard: the main CTA\'s onClick branching (isAccepted -> onViewMomentUpdate, else -> onFindAnotherTimeForMoment) is unchanged', source.includes('onClick={() => (isAccepted ? onViewMomentUpdate?.(update.momentToken) : onFindAnotherTimeForMoment?.(update.momentToken))}'));
  check('HomeDashboard: a separate \'View invitation\' action exists', source.includes("View invitation") && source.includes('onViewMomentInvitation?.(update.momentToken)'));
  check('HomeDashboard: \'View invitation\' is only rendered for the accepted case (never shown as a competing default for the pending case)', /isAccepted && \(\s*<TextButton onClick=\{\(\) => onViewMomentInvitation\?\.\(update\.momentToken\)\}/.test(source));
  check('HomeDashboard: onViewMomentInvitation is declared in the props interface', homeDashboardSource.includes('onViewMomentInvitation?: (momentToken: string) => void;'));
}

// ============================================================
// UpdatesView.tsx's own UpdateCard (same fix, same shared root cause).
// ============================================================
{
  const source = stripComments(updatesViewSource);
  check('UpdatesView: the old bare \'View\' ternary is gone', !source.includes("{isAccepted ? 'View' : 'Find another time'}"));
  check('UpdatesView: the CTA is renamed to \'View details\'', source.includes("{isAccepted ? 'View details' : 'Find another time'}"));
  check('UpdatesView: the main CTA\'s onClick branching (isAccepted -> onView, else -> onFindAnotherTime) is unchanged', source.includes('onClick={() => (isAccepted ? onView(update.momentToken) : onFindAnotherTime(update.momentToken))}'));
  check('UpdatesView: a separate \'View invitation\' action exists', source.includes('View invitation') && source.includes('onViewInvitation(update.momentToken)'));
  check('UpdatesView: onViewMomentInvitation is a required prop, consistent with the existing onViewMomentUpdate/onFindAnotherTimeForMoment contract', updatesViewSource.includes('onViewMomentInvitation: (momentToken: string) => void;'));
  check('UpdatesView: both the New and Earlier sections pass onViewInvitation through to UpdateCard', (updatesViewSource.match(/onViewInvitation=\{onViewMomentInvitation\}/g) ?? []).length === 2);
}

// ============================================================
// NO REGRESSION -- invitation acceptance logic itself (the public
// /moment/[token] page's own respond()/accept/decline flow) is
// completely untouched by this fix.
// ============================================================
{
  check('AuraMomentClient.tsx: the accept/decline response flow is untouched (respond() still posts to /api/aura-moments/[token]/response)', momentClientSource.includes("await fetch(`/api/aura-moments/${token}/response`"));
  check('AuraMomentClient.tsx: the accepted-state confirmation copy is untouched', momentClientSource.includes("will know you're in."));
  check('AuraMomentClient.tsx: the pending-response prompt is untouched', momentClientSource.includes('Does this work for you?'));
}

if (!allPassed) {
  console.error('\nSome Moment View Navigation checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL MOMENT VIEW NAVIGATION CHECKS PASSED');
}
