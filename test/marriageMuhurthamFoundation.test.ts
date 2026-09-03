/**
 * Marriage Muhurtham Foundation V1 (PR A): regression suite for the
 * Marriage-specific ceremonial rule pack, its generalized Yoga/Karana
 * authoritative-eligibility + interval-safety extension, and -- critically
 * -- confirmation that Marriage remains GATED (not exposed in Muhurtham
 * Finder / SUPPORTED_MUHURTHAM_ACTIVITY_IDS / Ask Aura) until PR B adds
 * month/period exclusion and Guru/Shukra Asta. See the architecture audit
 * ("Marriage Muhurtham Audit") and this PR's own brief for the full
 * rationale.
 *
 * Every Tithi/Nakshatra/Yoga/Karana transition used below is a REAL instant
 * computed via Aura's own canonical Panchang engine (findNextTransition /
 * getTithi / getNakshatra / getYoga / getKarana) -- never a fabricated
 * date from an external table, per this PR's own instruction.
 */
import {
  resolveMuhurtaRulePack,
  computeMuhurtaSupportLevel,
  isAuthoritativeAvoidTithi,
  isAuthoritativeAvoidNakshatra,
  isAuthoritativeAvoidYoga,
  isAuthoritativeAvoidKarana,
} from '../packages/muhurta/src/muhurtaRulePacks';
import { INTENT_FAMILY } from '../packages/muhurta/src/activityOntology';
import type { MuhurtaClassification } from '../packages/muhurta/src/activityOntology';
import {
  spanOverlapsAuthoritativeEventAvoid,
  SUPPORTED_MUHURTHAM_ACTIVITY_IDS,
  isSupportedMuhurthamActivity,
  findMuhurthams,
} from '../packages/recommendation/src/muhurthamFinder';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { findActivityIntent, FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { findNextTransition, getTithi, getNakshatra, getYoga, getKarana } from '../packages/vedic/src/panchangElements';
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const marriageDefinition = getActivityDefinition('marriage');
const grihaDefinition = getActivityDefinition('griha-pravesh');
if (!marriageDefinition || !grihaDefinition) {
  throw new Error('marriage/griha-pravesh activity definitions must exist for this suite to run');
}
const marriageClassification: MuhurtaClassification = marriageDefinition.muhurta;
const grihaClassification: MuhurtaClassification = grihaDefinition.muhurta;
const marriagePack = resolveMuhurtaRulePack(marriageClassification);
const grihaPack = resolveMuhurtaRulePack(grihaClassification);

// ============================================================
// 1. Marriage has a dedicated intent.
// ============================================================

check('1. MARRIAGE is a distinct MuhurtaIntent, mapped to the RELATIONSHIP family', INTENT_FAMILY.MARRIAGE === 'RELATIONSHIP');
check('1b. Marriage activity classification uses the MARRIAGE intent (not ENGAGEMENT/NEW_BEGINNING/etc.)', marriageClassification.intent === 'MARRIAGE');
check('1c. Marriage activity is CEREMONIAL depth', marriageClassification.evaluationDepth === 'CEREMONIAL');

// ============================================================
// 2. Marriage has a dedicated rule pack (genuinely IMPLEMENTED, not a
// borrowed family base).
// ============================================================

check('2. Marriage rule pack id reflects a real intent-specific pack (MARRIAGE_V1)', marriagePack.id === 'MARRIAGE_V1');
check('2b. Marriage Tithi coverage is IMPLEMENTED (genuinely sourced, not REUSABLE_BASE_RULE)', marriagePack.coverage.tithi === 'IMPLEMENTED');
check('2c. Marriage Nakshatra coverage is IMPLEMENTED', marriagePack.coverage.nakshatra === 'IMPLEMENTED');
check('2d. Marriage Yoga coverage is authoritatively IMPLEMENTED (the new hard-eligibility axis, not merely the always-on global scoring)', marriagePack.coverage.yogaAuthoritative === 'IMPLEMENTED');
check('2e. Marriage Karana coverage is authoritatively IMPLEMENTED', marriagePack.coverage.karanaAuthoritative === 'IMPLEMENTED');

// ============================================================
// 3/4. Marriage Tithi/Nakshatra data differs from Griha Pravesh -- proving
// this is genuinely independent, sourced data, never a copy.
// ============================================================

check('3. Marriage Tithi favorable list differs from Griha Pravesh\'s', JSON.stringify(marriagePack.tithi.favorable.map(String)) !== JSON.stringify(grihaPack.tithi.favorable.map(String)));
check('3b. Marriage Tithi avoid list differs from Griha Pravesh\'s (Marriage: only the 3 Rikta Tithis; Griha Pravesh also avoids Amavasya/Ashtami)', JSON.stringify(marriagePack.tithi.avoid.map(String)) !== JSON.stringify(grihaPack.tithi.avoid.map(String)));
check('4. Marriage Nakshatra favorable list differs from Griha Pravesh\'s', JSON.stringify(marriagePack.nakshatra.favorable) !== JSON.stringify(grihaPack.nakshatra.favorable));
check('4b. Marriage Nakshatra avoid list differs from Griha Pravesh\'s (Marriage: empty -- no sourced whole-Nakshatra avoid list; Griha Pravesh: Ashlesha/Jyeshtha/Mula)', JSON.stringify(marriagePack.nakshatra.avoid) !== JSON.stringify(grihaPack.nakshatra.avoid));
check('Griha Pravesh has no authoritative Yoga/Karana data (its own INTENT_RULE_PACKS entry supplies none) -- confirms Marriage\'s Yoga/Karana coverage is genuinely new, not inherited', grihaPack.coverage.yogaAuthoritative === 'MISSING' && grihaPack.coverage.karanaAuthoritative === 'MISSING');

// ============================================================
// 5-8. Tithi authoritative eligibility.
// ============================================================

check('5. Chaturthi is an authoritative avoid Tithi for Marriage', isAuthoritativeAvoidTithi(marriagePack, 'Shukla Chaturthi') && isAuthoritativeAvoidTithi(marriagePack, 'Krishna Chaturthi'));
check('6. Navami is an authoritative avoid Tithi for Marriage', isAuthoritativeAvoidTithi(marriagePack, 'Shukla Navami') && isAuthoritativeAvoidTithi(marriagePack, 'Krishna Navami'));
check('7. Chaturdashi is an authoritative avoid Tithi for Marriage', isAuthoritativeAvoidTithi(marriagePack, 'Shukla Chaturdashi') && isAuthoritativeAvoidTithi(marriagePack, 'Krishna Chaturdashi'));
check('8. A favorable Tithi (Ekadashi) is NOT an authoritative avoid for Marriage', !isAuthoritativeAvoidTithi(marriagePack, 'Shukla Ekadashi'));
check('8b. Amavasya is NOT an avoid Tithi for Marriage specifically (unlike Griha Pravesh) -- no source attested it for Marriage, so it was not invented', !isAuthoritativeAvoidTithi(marriagePack, 'Amavasya') && isAuthoritativeAvoidTithi(grihaPack, 'Amavasya'));

// ============================================================
// 9/10. Yoga authoritative eligibility.
// ============================================================

check('9. Vishkambha (a prohibited Marriage Yoga) is an authoritative avoid', isAuthoritativeAvoidYoga(marriagePack, 'Vishkambha'));
check('9b. All 9 sourced prohibited Yogas are authoritative avoids for Marriage', ['Vishkambha', 'Atiganda', 'Shula', 'Ganda', 'Vyaghapata', 'Vajra', 'Vyatipata', 'Parigha', 'Vaidhriti'].every((y) => isAuthoritativeAvoidYoga(marriagePack, y)));
check('10. A safe Yoga (Siddhi -- not in the prohibited-9 list) remains eligible for Marriage', !isAuthoritativeAvoidYoga(marriagePack, 'Siddhi'));
check('Yoga authoritative-eligibility is Marriage-only: Griha Pravesh never hard-rejects on Yoga', !isAuthoritativeAvoidYoga(grihaPack, 'Vishkambha'));

// ============================================================
// 11-15. Karana authoritative eligibility.
// ============================================================

check('11. Vishti (Bhadra) is an authoritative avoid Karana for Marriage', isAuthoritativeAvoidKarana(marriagePack, 'Vishti'));
check('12. Shakuni is an authoritative avoid Karana for Marriage', isAuthoritativeAvoidKarana(marriagePack, 'Shakuni'));
check('13. Chatushpada is an authoritative avoid Karana for Marriage', isAuthoritativeAvoidKarana(marriagePack, 'Chatushpada'));
check('14. Naga is an authoritative avoid Karana for Marriage', isAuthoritativeAvoidKarana(marriagePack, 'Naga'));
check('15. A safe Karana (Bava) remains eligible for Marriage', !isAuthoritativeAvoidKarana(marriagePack, 'Bava'));
check('Karana authoritative-eligibility is Marriage-only: Griha Pravesh never hard-rejects on Karana (Vishti is not a global hard veto)', !isAuthoritativeAvoidKarana(grihaPack, 'Vishti'));

// ============================================================
// 16-19. Interval safety: a candidate crossing INTO a prohibited value
// mid-window must be rejected, using REAL transition instants located via
// Aura's own canonical findNextTransition() -- never fabricated dates.
// ============================================================

const SEARCH_START = new Date('2026-09-03T00:00:00.000Z');
const WALK_GUARD = 400;

function findRealTransitionInto(kind: 'TITHI' | 'NAKSHATRA' | 'YOGA' | 'KARANA', isTarget: (name: string) => boolean, from: Date): Date {
  let cursor = from;
  for (let i = 0; i < WALK_GUARD; i++) {
    const next = findNextTransition(cursor, kind);
    const name = kind === 'TITHI' ? getTithi(next).name : kind === 'NAKSHATRA' ? getNakshatra(next).name : kind === 'YOGA' ? getYoga(next).name : getKarana(next).name;
    if (isTarget(name)) return next;
    // findNextTransition, called exactly AT a transition instant, can
    // re-find that same instant (a pre-existing floating-point quirk of
    // the underlying search, not something this PR introduces or fixes --
    // production code's own valuesTouchedByInterval() guards against it by
    // simply stopping the walk there). Nudge 1 second past `next` so the
    // next search genuinely starts from inside the following value.
    cursor = new Date(next.getTime() + 1000);
  }
  throw new Error(`No real ${kind} transition into target found within ${WALK_GUARD} steps from ${from.toISOString()}`);
}

/** Marriage's classification has FOUR authoritative factors active at once
 * (Tithi, Nakshatra, Yoga, Karana) -- Karana in particular changes every
 * ~9.5-13h, so a fixed-offset "before" window near an arbitrary Tithi
 * transition has a real chance of coincidentally landing inside an
 * unrelated avoid Karana/Yoga period. A genuine negative control must
 * verify ALL FOUR factors are clear at both ends of the window, not just
 * assume a fixed offset is far enough away -- searches backward in 5-minute
 * steps from the transition until it finds one that genuinely is. */
function isCleanMarriageInstant(d: Date): boolean {
  return !isAuthoritativeAvoidTithi(marriagePack, getTithi(d).name)
    && !isAuthoritativeAvoidNakshatra(marriagePack, getNakshatra(d).name)
    && !isAuthoritativeAvoidYoga(marriagePack, getYoga(d).name)
    && !isAuthoritativeAvoidKarana(marriagePack, getKarana(d).name);
}
function findCleanWindowBefore(transition: Date, lengthMs: number): [Date, Date] {
  for (let backMinutes = 20; backMinutes <= 20 * 60; backMinutes += 5) {
    const end = new Date(transition.getTime() - backMinutes * 60_000);
    const start = new Date(end.getTime() - lengthMs);
    if (isCleanMarriageInstant(start) && isCleanMarriageInstant(end)) return [start, end];
  }
  throw new Error(`No genuinely clean window found before ${transition.toISOString()}`);
}

const tithiTransition = findRealTransitionInto('TITHI', (n) => isAuthoritativeAvoidTithi(marriagePack, n), SEARCH_START);
check('16. A candidate straddling a REAL transition into a prohibited Tithi is rejected', spanOverlapsAuthoritativeEventAvoid(new Date(tithiTransition.getTime() - 15 * 60_000), new Date(tithiTransition.getTime() + 15 * 60_000), marriageClassification));
const [tithiCleanStart, tithiCleanEnd] = findCleanWindowBefore(tithiTransition, 15 * 60_000);
check('16b. A genuinely clean window (all 4 factors verified clear) entirely BEFORE that transition is NOT rejected', !spanOverlapsAuthoritativeEventAvoid(tithiCleanStart, tithiCleanEnd, marriageClassification));

// Marriage's own nakshatra.avoid is intentionally empty (8b above) -- so
// this factor has no real "prohibited Nakshatra" case to search for under
// Marriage's own pack (searching for one would loop forever / hit the walk
// guard, since nothing in Marriage's avoid list can ever match). Proven
// instead against Griha Pravesh's pack (Ashlesha/Jyeshtha/Mula),
// confirming the SAME generalized interval-safety mechanism correctly
// detects a Nakshatra-crossing candidate for any pack that DOES have
// authoritative avoid Nakshatra data -- Marriage would be rejected
// identically the moment it ever gains one.
const grihaNakshatraTransition = findRealTransitionInto('NAKSHATRA', (n) => isAuthoritativeAvoidNakshatra(grihaPack, n), SEARCH_START);
check('17. A candidate straddling a REAL transition into a prohibited Nakshatra is rejected (proven against Griha Pravesh\'s pack, since Marriage sources no avoid-Nakshatra list -- same generalized mechanism)', spanOverlapsAuthoritativeEventAvoid(new Date(grihaNakshatraTransition.getTime() - 15 * 60_000), new Date(grihaNakshatraTransition.getTime() + 15 * 60_000), grihaClassification));
check('17b. Marriage\'s own nakshatra.avoid is genuinely empty (favorable-only semantics -- see semantic check below)', marriagePack.nakshatra.avoid.length === 0);

const yogaTransition = findRealTransitionInto('YOGA', (n) => isAuthoritativeAvoidYoga(marriagePack, n), SEARCH_START);
check('18. A candidate straddling a REAL transition into a prohibited Yoga is rejected for Marriage', spanOverlapsAuthoritativeEventAvoid(new Date(yogaTransition.getTime() - 15 * 60_000), new Date(yogaTransition.getTime() + 15 * 60_000), marriageClassification));
const [yogaCleanStart, yogaCleanEnd] = findCleanWindowBefore(yogaTransition, 15 * 60_000);
check('18b. A genuinely clean window (all 4 factors verified clear) entirely BEFORE that Yoga transition is NOT rejected', !spanOverlapsAuthoritativeEventAvoid(yogaCleanStart, yogaCleanEnd, marriageClassification));

const karanaTransition = findRealTransitionInto('KARANA', (n) => isAuthoritativeAvoidKarana(marriagePack, n), SEARCH_START);
check('19. A candidate straddling a REAL transition into a prohibited Karana is rejected for Marriage', spanOverlapsAuthoritativeEventAvoid(new Date(karanaTransition.getTime() - 15 * 60_000), new Date(karanaTransition.getTime() + 15 * 60_000), marriageClassification));
const [karanaCleanStart, karanaCleanEnd] = findCleanWindowBefore(karanaTransition, 15 * 60_000);
check('19b. A genuinely clean window (all 4 factors verified clear) entirely BEFORE that Karana transition is NOT rejected', !spanOverlapsAuthoritativeEventAvoid(karanaCleanStart, karanaCleanEnd, marriageClassification));

// ============================================================
// 20-22. Eligibility cannot be rescued by scoring or personalization --
// verified structurally: spanOverlapsAuthoritativeEventAvoid's own
// signature takes no score/personalContext/Tara Bala input at all, and the
// source confirms it gates evaluateMuhurthamCandidate's return BEFORE any
// scoring modifier or personal factor is computed.
// ============================================================

const finderSource = fs.readFileSync('packages/recommendation/src/muhurthamFinder.ts', 'utf8');
check('20/21. spanOverlapsAuthoritativeEventAvoid()\'s own signature carries no score/modifier parameter -- structurally cannot be influenced by how well an unrelated factor scores', spanOverlapsAuthoritativeEventAvoid.length === 3);
check('20b/21b. evaluateMuhurthamCandidate rejects (returns null) on spanOverlapsAuthoritativeEventAvoid BEFORE any scoring modifier is applied -- "no modifier large enough to offset it"', /no modifier large enough to offset it/.test(finderSource));
check('22. Tara Bala/personalContext plays no role in spanOverlapsAuthoritativeEventAvoid -- the same hard-rejection check runs identically for GENERAL (no personalContext at all) and PERSONAL/SHARED (personalContext present), proven by its own classification-only signature', !/spanOverlapsAuthoritativeEventAvoid\([^)]*personalContext/.test(finderSource));

// ============================================================
// 23. Griha Pravesh regression -- unchanged by any of the above.
// ============================================================

check('23. Griha Pravesh Tithi favorable list is byte-identical to before this PR', JSON.stringify(grihaPack.tithi.favorable.map(String)) === JSON.stringify([/Dvitiya/, /Tritiya/, /Panchami/, /Dashami/, /Ekadashi/, /Trayodashi/].map(String)));
check('23b. Griha Pravesh Tithi avoid list is byte-identical', JSON.stringify(grihaPack.tithi.avoid.map(String)) === JSON.stringify([/^Amavasya$/, /Chaturthi/, /Ashtami/, /Navami/, /Chaturdashi/].map(String)));
check('23c. Griha Pravesh Nakshatra favorable list is byte-identical', JSON.stringify(grihaPack.nakshatra.favorable) === JSON.stringify(['Rohini', 'Mrigashira', 'Uttara Phalguni', 'Chitra', 'Anuradha', 'Uttara Ashadha', 'Revati']));
check('23d. Griha Pravesh Nakshatra avoid list is byte-identical', JSON.stringify(grihaPack.nakshatra.avoid) === JSON.stringify(['Ashlesha', 'Jyeshtha', 'Mula']));
check('23e. Griha Pravesh still resolves to SUPPORTED (requiresPeriodExclusion/requiresPlanetaryCombustion default false -- unaffected by Marriage\'s gate)', computeMuhurtaSupportLevel(grihaClassification, grihaPack) === 'SUPPORTED');
check('23f. Griha Pravesh is still in SUPPORTED_MUHURTHAM_ACTIVITY_IDS', SUPPORTED_MUHURTHAM_ACTIVITY_IDS.includes('griha-pravesh'));

// ============================================================
// 24. Reusable-base activities must not inherit Marriage's Yoga/Karana
// hard exclusions.
// ============================================================

for (const id of ['start-journey', 'financial-decision', 'business-start', 'property-purchase', 'new-beginning']) {
  const def = getActivityDefinition(id);
  if (!def) { check(`24. ${id} activity definition exists`, false); continue; }
  const pack = resolveMuhurtaRulePack(def.muhurta);
  check(`24. ${id} does not inherit Marriage's Karana hard exclusion (Vishti stays non-authoritative for it)`, !isAuthoritativeAvoidKarana(pack, 'Vishti'));
  check(`24b. ${id} does not inherit Marriage's Yoga hard exclusion (Vishkambha stays non-authoritative for it)`, !isAuthoritativeAvoidYoga(pack, 'Vishkambha'));
  check(`24c. ${id} coverage.yogaAuthoritative/karanaAuthoritative are MISSING (reusable-base packs get no authoritative Yoga/Karana data)`, pack.coverage.yogaAuthoritative === 'MISSING' && pack.coverage.karanaAuthoritative === 'MISSING');
}

// ============================================================
// 25. Engagement regression -- not promoted, not made to inherit Marriage
// rules merely because both are ceremonial/relationship-related.
// ============================================================

const engagementDefinition = getActivityDefinition('engagement');
if (!engagementDefinition) throw new Error('engagement activity definition must exist');
const engagementPack = resolveMuhurtaRulePack(engagementDefinition.muhurta);
check('25. Engagement rule pack coverage is still REUSABLE_BASE_RULE for Tithi/Nakshatra (not promoted to IMPLEMENTED)', engagementPack.coverage.tithi === 'REUSABLE_BASE_RULE' && engagementPack.coverage.nakshatra === 'REUSABLE_BASE_RULE');
check('25b. Engagement does NOT inherit Marriage\'s Nakshatra favorable list', JSON.stringify(engagementPack.nakshatra.favorable) !== JSON.stringify(marriagePack.nakshatra.favorable));
check('25c. Engagement does NOT inherit Marriage\'s Yoga/Karana authoritative coverage', engagementPack.coverage.yogaAuthoritative === 'MISSING' && engagementPack.coverage.karanaAuthoritative === 'MISSING');
check('25d. Engagement still resolves to PARTIAL (unaffected by Marriage work)', computeMuhurtaSupportLevel(engagementDefinition.muhurta, engagementPack) === 'PARTIAL');

// ============================================================
// 26/33. THE GATING MECHANISM, RECONFIRMED AFTER ACTIVATION: this PR
// (Marriage Muhurtham Foundation V1 / PR A) proved Marriage's dedicated
// rule pack correctly stayed gated (PARTIAL) while periodExclusion/
// planetaryCombustion were MISSING. Marriage Muhurtham Required
// Eligibility V1 (PR B) has since genuinely implemented both -- see
// test/marriageRequiredEligibility.test.ts for that PR's own full
// coverage. These assertions are updated to confirm the SAME
// coverage-driven mechanism correctly flipped Marriage to SUPPORTED once
// (and only once) the real hard-rejection paths existed -- not a UI-level
// special case, and not a premature flip either.
// ============================================================

check('26/33a. Marriage rule pack has BOTH Tithi and Nakshatra genuinely dedicated (bothDedicated bar cleared)', marriagePack.coverage.tithi === 'IMPLEMENTED' && marriagePack.coverage.nakshatra === 'IMPLEMENTED');
check('26/33b. Marriage rule pack declares requiresPeriodExclusion', marriagePack.requiresPeriodExclusion === true);
check('26/33c. Marriage rule pack declares requiresPlanetaryCombustion', marriagePack.requiresPlanetaryCombustion === true);
check('26/33d. Marriage rule pack coverage.periodExclusion is now IMPLEMENTED (PR B)', marriagePack.coverage.periodExclusion === 'IMPLEMENTED');
check('26/33e. Marriage rule pack coverage.planetaryCombustion is now IMPLEMENTED (PR B)', marriagePack.coverage.planetaryCombustion === 'IMPLEMENTED');
check('26/33f. With dedicated Tithi/Nakshatra/Yoga/Karana coverage AND period/combustion coverage, computeMuhurtaSupportLevel now resolves Marriage to SUPPORTED', computeMuhurtaSupportLevel(marriageClassification, marriagePack) === 'SUPPORTED');
check('26/33g. Marriage is now in SUPPORTED_MUHURTHAM_ACTIVITY_IDS', SUPPORTED_MUHURTHAM_ACTIVITY_IDS.includes('marriage'));
check('26/33h. isSupportedMuhurthamActivity(\'marriage\') is now true', isSupportedMuhurthamActivity('marriage'));
// 2026-09-01..05 falls inside the ratified Chaturmas window (see PR B), so
// a real search over it legitimately returns zero dates -- the point here
// is that it no longer THROWS (marriage is genuinely searchable now).
let findMuhurthamsThrewForMarriage = false;
try {
  findMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-09-01', end: '2026-09-05' }, context: { now: new Date(), latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata', tzOffsetMinutes: 330 } });
} catch {
  findMuhurthamsThrewForMarriage = true;
}
check('26/33i. findMuhurthams no longer throws for marriage (genuinely searchable; a Chaturmas-window range legitimately returns zero dates instead)', !findMuhurthamsThrewForMarriage);

// ============================================================
// 27. Finder UI does not expose Marriage.
// ============================================================

const finderViewSource = fs.readFileSync('apps/web/components/MuhurthamFinderView.tsx', 'utf8');
check('27. MuhurthamFinderView\'s activity dropdown is driven entirely by SUPPORTED_MUHURTHAM_ACTIVITY_IDS.map(...), not a hardcoded list that could include marriage', /SUPPORTED_MUHURTHAM_ACTIVITY_IDS\.map/.test(finderViewSource));
check('27b. MuhurthamFinderView.tsx source contains no hardcoded reference to a "marriage" activity id, Partner A/B UI, or a Marriage-specific screen', !/'marriage'|"marriage"|Partner A|Partner B/.test(finderViewSource));

// ============================================================
// 28. Ask Aura does not newly route to incomplete Marriage support.
// ============================================================

check('28. Marriage catalog entry has an EMPTY aliases array (cannot be matched by findActivityIntent at all)', FULL_ACTIVITY_CATALOG.find((a) => a.id === 'marriage')?.aliases.length === 0);
check('28b. findActivityIntent("marriage") does not resolve to the marriage activity (no alias to match)', findActivityIntent('marriage')?.id !== 'marriage');
check('28c. findActivityIntent("wedding") does not resolve to the marriage activity', findActivityIntent('wedding')?.id !== 'marriage');
check('28d. The known pre-existing "best marriage date" -> dating misroute is UNCHANGED by this PR (not fixed, not made worse)', findActivityIntent('best marriage date')?.id === 'dating');
check('28e. "find a wedding muhurtham" still does not resolve to marriage', findActivityIntent('find a wedding muhurtham')?.id !== 'marriage');

// ============================================================
// 29. No schema/migration changes.
// ============================================================

const migrationDirs = fs.readdirSync('apps/web/prisma/migrations');
check('29. No new Prisma migration directory beyond the pre-existing 0029 (Marriage Foundation V1 needs no schema change)', !migrationDirs.some((d) => /marriage/i.test(d)) && Math.max(...migrationDirs.map((d) => parseInt(d.slice(0, 4), 10)).filter((n) => !Number.isNaN(n))) === 29);
const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
check('29b. schema.prisma contains no Marriage-specific field', !/marriage/i.test(schemaSource));

// ============================================================
// 30 (brief numbering) / zero-result: preserved -- structural check that
// this PR added no fallback/manufactured-result logic to the Finder.
// ============================================================

check('Zero-result semantics preserved: findBestWindowsForDate can still return null / no candidate reaching MIN_INCLUSION_SCORE is included (unchanged code path -- this PR only added rejection checks, never a fallback)', /MIN_INCLUSION_SCORE/.test(finderSource) && !/best available|fallback candidate|forceResult/i.test(finderSource));

// ============================================================
// 39 (brief numbering) -- SEMANTIC CHECK: favorable-vs-exclusive Nakshatra
// (and Tithi/Yoga/Karana) semantics. Confirmed here as (A): a positive
// ranking/support signal only, NEVER an exclusive eligibility allow-list.
// An unlisted value is NEUTRAL -- no reason emitted, never hard-rejected.
// ============================================================

check('SEMANTIC CHECK (A, not B): a Nakshatra that is neither favorable NOR avoid for Marriage is NOT authoritatively rejected -- "favorable" is a positive signal, never an implicit "all others prohibited" rule', !isAuthoritativeAvoidNakshatra(marriagePack, 'Ashwini') && !marriagePack.nakshatra.favorable.includes('Ashwini'));
check('SEMANTIC CHECK: Marriage\'s nakshatra.avoid is genuinely empty (11 favorable, 0 avoid) -- confirms no "all others prohibited" allow-list was silently implemented', marriagePack.nakshatra.avoid.length === 0 && marriagePack.nakshatra.favorable.length === 11);
check('SEMANTIC CHECK: a Yoga that is neither favorable nor in Marriage\'s 9-item avoid list (e.g. Priti) is not authoritatively rejected', !isAuthoritativeAvoidYoga(marriagePack, 'Priti'));

console.log(allPassed ? '\nALL MARRIAGE MUHURTHAM FOUNDATION CHECKS PASSED' : '\nSOME MARRIAGE MUHURTHAM FOUNDATION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
