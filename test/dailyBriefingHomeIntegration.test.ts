// AURA DB2 -- Home integration (HomeDashboard.tsx/DailyBriefingCard.tsx/
// page.tsx). No component-test harness exists in this repo for a plain
// .tsx file under the standard ts-node runner (established convention --
// see test/homeDashboardRightNowContract.test.ts's own header comment),
// so this follows the same source-text/regex structural-assertion
// pattern, plus pure-function tests on DailyBriefingCard's own exported
// helpers where practical.
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const homeSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
const cardSource = fs.readFileSync('apps/web/components/DailyBriefingCard.tsx', 'utf8');
const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const stripped = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
const homeStripped = stripped(homeSource);

// ============================================================
// 1. Home hierarchy -- Header -> Daily Briefing -> Right Now -> rest
// ============================================================

const pageHeaderIdx = homeSource.indexOf('<PageHeader');
const briefingCardIdx = homeSource.indexOf('<DailyBriefingCard');
const rightNowCommentIdx = homeSource.indexOf('RIGHT NOW\n');

check('1. PageHeader renders before DailyBriefingCard', pageHeaderIdx >= 0 && briefingCardIdx > pageHeaderIdx);
check('1. DailyBriefingCard renders before the Right Now section (recommended hierarchy: header -> briefing -> Right Now)', briefingCardIdx >= 0 && rightNowCommentIdx > briefingCardIdx);
check('1. DailyBriefingCard is imported from its own dedicated file (matches DayBuilderCard/PersonalizationPromptCard/RecompositionCard\'s own established "complex Home sections live in their own file" convention)', /import \{ DailyBriefingCard \} from '\.\/DailyBriefingCard';/.test(homeSource));

// ============================================================
// 2. Existing Home functionality untouched
// ============================================================

check('2. Right Now\'s own "● Right Now" eyebrow label is still present and unmodified', /●\s*Right Now/.test(homeSource));
check('2. Right Now still owns "Good Right Now"/"Happening now"/"Coming up"/"Best option right now" -- Daily Briefing never claims any of these labels', /'Happening now'/.test(homeSource) && /'Coming up'/.test(homeSource) && /'Best option right now'/.test(homeSource) && /'Good Right Now'/.test(homeSource));
check('2. DailyBriefingCard\'s own copy never uses "Best time now" or an equivalent competing label', !/Best time now/i.test(cardSource));
check('2. HomeDashboardProps gained userId as a purely ADDITIVE optional prop (no existing prop removed)', /userId\?:\s*string;/.test(homeSource) && /userName: string;/.test(homeSource));

// ============================================================
// 3. DB2 never recreates DB1's interpretation logic in React
// ============================================================

check('3. DailyBriefingCard never imports from packages/vedic (no direct astrology calculation in the component)', !/packages\/vedic/.test(cardSource));
check('3. DailyBriefingCard never defines its own favorable-house table (no literal Gochar rule numbers)', !/\[2,\s*4,\s*6,\s*8,\s*10,\s*11\]/.test(cardSource) && !/\[3,\s*6,\s*10,\s*11\]/.test(cardSource));
check('3. every narrative field the card renders is read directly off the fetched briefing object (b.dailyTheme/b.career/b.finance/b.focus/b.beMindful), never locally composed', /b\.dailyTheme/.test(cardSource) && /b\.career/.test(cardSource) && /b\.finance/.test(cardSource) && /b\.focus/.test(cardSource) && /b\.beMindful/.test(cardSource));
check('3. the card imports its type from the DB1 engine module itself (apps/web/lib/dailyAstroBriefing), not a redeclared shape', /import type \{ AstroDailyBriefing \} from '\.\.\/lib\/dailyAstroBriefing';/.test(cardSource));

// ============================================================
// 4. First-visit expand / subsequent-visit compact / manual toggle
// ============================================================

check('4. expand/collapse is tracked as its own React state, defaulting to collapsed until the first-visit check runs', /const \[expanded, setExpanded\] = useState\(false\)/.test(cardSource));
check('4. a dedicated effect keys off `state` (only reachable once status==="ok") before ever calling saveLastExpandedLocalDate -- never on mount/fetch-start', /if \(state\.status !== 'ok' \|\| !userId\) return;/.test(cardSource));
check('4. first-visit-today sets expanded=true AND persists the date; a return visit (already recorded) sets expanded=false, never both unconditionally', /if \(isFirstVisitToday\) \{\s*setExpanded\(true\);\s*saveLastExpandedLocalDate\(userId, localDate\);\s*\} else \{\s*setExpanded\(false\);\s*\}/.test(cardSource));
check('4. a manual Read-more/Collapse control exists independent of the persisted first-visit flag (setExpanded called directly from a TextButton onClick)', /onClick=\{\(\) => setExpanded\(true\)\}/.test(cardSource) && /onClick=\{\(\) => setExpanded\(false\)\}/.test(cardSource));
check('4. a failed/error fetch result NEVER reaches the persistence effect (that effect\'s own early-return requires status===\'ok\'; the error branch sets status:\'error\', not \'ok\')', /setState\(\{ status: 'error' \}\)/.test(cardSource));

// ============================================================
// 5. Missing birth profile / failure states
// ============================================================

check('5. the incomplete-profile CTA uses the exact copy specified in the brief', /Add your birth details to see your personalized daily briefing\./.test(cardSource));
check('5. the incomplete-profile CTA links through the EXISTING onOpenBirthProfile prop (no duplicate onboarding flow invented)', /onOpenBirthProfile && \(/.test(cardSource) && /onClick=\{onOpenBirthProfile\}/.test(cardSource));
check('5. a retry affordance exists for the error state, implemented by bumping a retryKey that the fetch effect depends on (re-fires the SAME fetch, not a different code path)', /setRetryKey\(\(k\) => k \+ 1\)/.test(cardSource) && /\[userId, timezone, retryKey\]/.test(cardSource));
check('5. the loading state uses role="status" + ariaLive="polite" (announced to screen readers, not a silent layout shift)', /role="status" ariaLive="polite"/.test(cardSource));
check('5. the error state uses role="alert"', /role="alert"/.test(cardSource));
check('5. the fetch effect declares `cancelled` FRESH inside its own body on every invocation (never a module/component-level shared flag) -- the exact closure shape test/dailyBriefingCardLifecycle.test.ts\'s deferred-promise suite independently verified is race-safe', /let cancelled = false;/.test(cardSource) && /if \(cancelled\) return;/.test(cardSource) && /cancelled = true;/.test(cardSource));

// ============================================================
// 6. Contextual Home -> Plan action reuses the existing contract
// ============================================================

check('6. DailyBriefingCard\'s onPlanClick prop has the exact existing handleOpenPlan/onPlanClick signature (activity?: string) => void -- no new navigation contract', /onPlanClick\?:\s*\(activity\?:\s*string\)\s*=>\s*void;/.test(cardSource));
check('6. the contextual action calls onPlanClick with a plain activity string ("Focused work"), never constructs a plan or candidate itself', /onPlanClick\('Focused work'\)/.test(cardSource) && !/createPlannedActivity|saveUpcomingPlanFromCandidate/.test(cardSource));
check('6. HomeDashboard passes its OWN existing onPlanClick prop straight through to DailyBriefingCard (not a new, second handler)', /<DailyBriefingCard userId=\{userId\} timezone=\{effectiveTimezone\} onOpenBirthProfile=\{onOpenBirthProfile\} onPlanClick=\{onPlanClick\}/.test(homeSource));

// ============================================================
// 9. DB2 review fix -- a mid-session timezone change must invalidate the
// fetch, not leave a stale briefing on screen (confirmed missing, then
// fixed, during independent final review: handleLocationChanged in
// page.tsx already refreshes My Day's agenda/story/reflection and the
// daily-assistant briefing/insight signals for exactly this reason --
// DailyBriefingCard's own fetch effect needed the same trigger).
// ============================================================

check('9. DailyBriefingCard accepts a timezone prop', /timezone\?:\s*string;/.test(cardSource));
check('9. the fetch effect depends on timezone (not just userId/retryKey) -- a timezone change re-fires the SAME fetch, invalidating the old one via the existing cancelled-flag cleanup', /\[userId, timezone, retryKey\]/.test(cardSource));
check('9. HomeDashboard threads its OWN existing effectiveTimezone (the same value the rest of Home already recomputes reactively on every user.timezone change) -- no new timezone state invented', /timezone=\{effectiveTimezone\}/.test(homeStripped));

// ============================================================
// 7. page.tsx wiring
// ============================================================

check('7. page.tsx threads the real session user\'s id through as userId (the exact field SessionUser already exposes)', /userId=\{user\?\.id\}/.test(pageSource));
check('7. this is the FIRST prop passed to <HomeDashboard, immediately followed by the existing userName prop (purely additive insertion, not a reordering of existing props)', /<HomeDashboard\s*\n\s*userId=\{user\?\.id\}\s*\n\s*userName=\{userNameDisplay\}/.test(pageSource));

// ============================================================
// 8. API route privacy/caching (cross-reference with dailyBriefingApi.test.ts)
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/daily-briefing/today/route.ts', 'utf8');
check('8. the route file exists at the exact ticket-specified path', fs.existsSync('apps/web/app/api/daily-briefing/today/route.ts'));
check('8. the route authenticates via the SAME getSessionFromRequest every other authenticated route already uses (no new auth mechanism)', /getSessionFromRequest\(req\)/.test(routeSource));
check('8. the route loads ONLY the session\'s own user (getUserById(session.userId)) -- no client-suppliable user id anywhere in the route', /getUserById\(session\.userId\)/.test(routeSource) && !/getUserById\(req\./.test(routeSource));

if (!allPassed) { console.error('SOME DB2 HOME INTEGRATION CHECKS FAILED'); process.exit(1); }
console.log('ALL DB2 HOME INTEGRATION CHECKS PASSED');
process.exit(0);
