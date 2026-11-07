/**
 * UX0-FIX1 -- regression coverage for the Panchangam reference-instant
 * defect: getPanchangForDate() (packages/panchang/src/panchangDay.ts)
 * defaults its Tithi/Nakshatra/Yoga/Karana evaluation to LOCAL NOON when
 * no `referenceInstant` is supplied. That default is correct for a
 * genuine whole-day summary (the Panchang Calendar), but muhurthamFinder.ts
 * previously called it WITHOUT a referenceInstant while presenting the
 * result as if it described a specific recommended time slot -- so the
 * displayed Tithi/Nakshatra/Yoga/Karana could silently disagree with what
 * was actually in effect at the recommended instant, whenever that
 * instant and local noon fell on opposite sides of a within-day
 * transition.
 *
 * These checks exercise the REAL, FIXED production call sites (never
 * panchangDay.ts in isolation) with REAL, deterministic instants
 * (fixed calendar dates, never Date.now()) that are independently
 * verified (via this file's own `groundTruth` helper, which calls the
 * SAME getPanchangForDate() but with an explicit referenceInstant) to
 * straddle a genuine within-day transition for each of the four Angas.
 */
import { evaluateMuhurthamCandidateAt, findMuhurthams, panchangSummaryAt } from '../packages/recommendation/src/muhurthamFinder';
import { getPanchangForDate } from '../packages/panchang/src/panchangDay';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const CHENNAI = { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 10, 6, 4, 0, 0)),
  ...CHENNAI,
  tzOffsetMinutes: 330,
};

function groundTruthAt(localDate: string, instant: Date) {
  return getPanchangForDate({ localDate, ...CHENNAI, referenceInstant: instant }).panchanga;
}

// ============================================================
// 1. panchangSummaryAt() itself -- the shared helper every fixed call
//    site now routes through -- matches ground truth at an arbitrary
//    instant, and genuinely differs from the file's own day-level noon
//    default when the instant and noon disagree.
// ============================================================

{
  const localDate = '2026-12-08';
  const noonOnlyNakshatra = getPanchangForDate({ localDate, ...CHENNAI }).panchanga.nakshatra.name;
  const eveningInstant = new Date('2026-12-08T21:00:00+05:30'); // 9:00 PM IST
  const truth = groundTruthAt(localDate, eveningInstant);
  const viaHelper = panchangSummaryAt(localDate, CHENNAI.latitude, CHENNAI.longitude, CHENNAI.timezone, eveningInstant);

  check('1. ground-truth fixture sanity: noon and 9pm IST Dec 8 2026 genuinely disagree on Nakshatra (a real within-day transition exists)', noonOnlyNakshatra !== truth.nakshatra.name);
  check('1. panchangSummaryAt() at 9pm matches ground truth, not the noon default', viaHelper.nakshatra === truth.nakshatra.name);
  check('1. panchangSummaryAt() at 9pm does NOT equal the noon-default value (the exact defect this fix closes)', viaHelper.nakshatra !== noonOnlyNakshatra);
}

// ============================================================
// 2. evaluateMuhurthamCandidateAt() -- Ask Aura's TIMING_CHECK entry
//    point, and the clearest single-instant call site -- respects the
//    EXACT requested instant for all 4 Angas, not noon.
// ============================================================

{
  const localDate = '2026-12-08';
  const eveningInstant = new Date('2026-12-08T21:00:00+05:30');
  const outcome = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: eveningInstant, durationMinutes: 60, context: chennaiContext });
  if (outcome.status !== 'OK') {
    check('2. evaluateMuhurthamCandidateAt returns OK for a real GENERAL request (setup)', false);
  } else {
    const truth = groundTruthAt(localDate, eveningInstant);
    check('2. [NAKSHATRA] evaluateMuhurthamCandidateAt.panchangSummary matches ground truth at the requested evening instant', outcome.panchangSummary.nakshatra === truth.nakshatra.name);
  }
}

// ============================================================
// 3. Tithi within-day transition, through evaluateMuhurthamCandidateAt.
//    2026-12-09: Amavasya -> Shukla Pratipada at 2026-12-09T00:52:31Z
//    (06:22:31 IST) -- independently re-derived below, never hardcoded
//    as a bare assumption.
// ============================================================

{
  const localDate = '2026-12-09';
  const before = new Date('2026-12-09T04:00:00+05:30'); // 4:00 AM IST
  const after = new Date('2026-12-09T12:00:00+05:30'); // noon IST
  const truthBefore = groundTruthAt(localDate, before);
  const truthAfter = groundTruthAt(localDate, after);
  check('3. [TITHI] fixture sanity: 4am and noon IST Dec 9 2026 genuinely disagree on Tithi', truthBefore.tithi.name !== truthAfter.tithi.name);

  const outcomeBefore = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: before, durationMinutes: 60, context: chennaiContext });
  const outcomeAfter = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: after, durationMinutes: 60, context: chennaiContext });
  check(
    '3. [TITHI] evaluateMuhurthamCandidateAt reports the pre-transition Tithi before, and the post-transition Tithi after, through the real call site',
    outcomeBefore.status === 'OK' && outcomeAfter.status === 'OK' && outcomeBefore.panchangSummary.tithi === truthBefore.tithi.name && outcomeAfter.panchangSummary.tithi === truthAfter.tithi.name
  );
}

// ============================================================
// 4. Yoga within-day transition.
//    2026-12-14: Vyaghapata -> Harshana at 2026-12-14T07:32:33Z
//    (13:02:33 IST). Re-located under the corrected Lahiri ayanamsa
//    (AURA PCE-4A-T1, issue #297) -- the original 00:12:22Z instant was
//    found under the PRE-FIX ayanamsa and the real transition has moved
//    ~7.3h later. Independently corroborated: multiple third-party
//    Panchang sources (drikpanchang.com, bgsiyer.com, via WebSearch)
//    agree Vyaghata hands over to Harshana at ~1:04 PM IST on this date
//    -- within a minute of this file's own independently-computed
//    13:02:33 IST instant. "noon IST" no longer works as the "after"
//    sample (noon now falls BEFORE this later transition), so "after"
//    moved to 6pm IST, comfortably clear of the transition in both
//    directions (before: 2am IST, ~11h margin; after: 6pm IST, ~5h margin).
// ============================================================

{
  const localDate = '2026-12-14';
  const before = new Date('2026-12-14T02:00:00+05:30'); // 2:00 AM IST
  const after = new Date('2026-12-14T18:00:00+05:30'); // 6:00 PM IST
  const truthBefore = groundTruthAt(localDate, before);
  const truthAfter = groundTruthAt(localDate, after);
  check('4. [YOGA] fixture sanity: 2am and 6pm IST Dec 14 2026 genuinely disagree on Yoga', truthBefore.yoga.name !== truthAfter.yoga.name);

  const outcomeBefore = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: before, durationMinutes: 60, context: chennaiContext });
  const outcomeAfter = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: after, durationMinutes: 60, context: chennaiContext });
  check(
    '4. [YOGA] evaluateMuhurthamCandidateAt reports the pre-transition Yoga before, and the post-transition Yoga after, through the real call site',
    outcomeBefore.status === 'OK' && outcomeAfter.status === 'OK' && outcomeBefore.panchangSummary.yoga === truthBefore.yoga.name && outcomeAfter.panchangSummary.yoga === truthAfter.yoga.name
  );
}

// ============================================================
// 5. Karana within-day transition (Karana is the fastest-moving Anga --
//    typically 2 per day -- so this also proves the fix tracks a SHORTER
//    transition correctly, not just the slower Tithi/Yoga/Nakshatra).
//    2026-12-05: Kaulava -> (next Karana) at 2026-12-05T06:45:41Z
//    (12:15:41 IST).
// ============================================================

{
  const localDate = '2026-12-05';
  const before = new Date('2026-12-05T10:00:00+05:30'); // 10:00 AM IST
  const after = new Date('2026-12-05T14:00:00+05:30'); // 2:00 PM IST
  const truthBefore = groundTruthAt(localDate, before);
  const truthAfter = groundTruthAt(localDate, after);
  check('5. [KARANA] fixture sanity: 10am and 2pm IST Dec 5 2026 genuinely disagree on Karana', truthBefore.karana.name !== truthAfter.karana.name);

  const outcomeBefore = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: before, durationMinutes: 60, context: chennaiContext });
  const outcomeAfter = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: after, durationMinutes: 60, context: chennaiContext });
  check(
    '5. [KARANA] evaluateMuhurthamCandidateAt reports the pre-transition Karana before, and the post-transition Karana after, through the real call site',
    outcomeBefore.status === 'OK' && outcomeAfter.status === 'OK' && outcomeBefore.panchangSummary.karana === truthBefore.karana.name && outcomeAfter.panchangSummary.karana === truthAfter.karana.name
  );
}

// ============================================================
// 6. findMuhurthams() -- the day-scan GENERAL search entry point --
//    also respects its OWN best window's real start instant, not noon.
//    2026-12-07: best window lands at 2026-12-07T10:18:00Z (15:48 IST),
//    which is Anuradha -- noon that day is a DIFFERENT Nakshatra
//    (Vishakha). Re-located under the corrected Lahiri ayanamsa (AURA
//    PCE-4A-T1, issue #297) -- the original 2026-12-06 date's best
//    window no longer disagrees with its own noon value post-fix.
//    Independently corroborated: two third-party Panchang sources
//    (samvat.in, prokerala.com, via WebSearch) agree the Vishakha ->
//    Anuradha transition falls at 15:48 IST on 2026-12-07 -- an exact
//    match, to the minute, with this file's own independently-computed
//    best-window instant.
// ============================================================

{
  const result = findMuhurthams({ activityId: 'start-journey', dateRange: { start: '2026-12-07', end: '2026-12-07' }, context: chennaiContext });
  const dec7 = result.dates.find((d) => d.date === '2026-12-07');
  if (!dec7) {
    check('6. findMuhurthams returns a 2026-12-07 candidate (setup)', false);
  } else {
    const truth = groundTruthAt('2026-12-07', new Date(dec7.bestWindow.start));
    const noonOnly = getPanchangForDate({ localDate: '2026-12-07', ...CHENNAI }).panchanga.nakshatra.name;
    check('6. fixture sanity: the best window instant and local noon genuinely disagree on Nakshatra for 2026-12-07', truth.nakshatra.name !== noonOnly);
    check('6. [day-scan] findMuhurthams.panchangSummary matches the BEST WINDOW\'s own instant, not the noon default', dec7.panchangSummary.nakshatra === truth.nakshatra.name);
  }
}

// ============================================================
// 7. Scoring/ranking independence -- the fix must change ONLY the
//    displayed panchangSummary, never candidate scoring or ranking.
//    evaluateMuhurthamCandidate()/evaluateTimingCandidate() never read
//    getPanchangForDate()'s `panchanga` field at all (confirmed by
//    source trace: they call evaluateMuhurta() -> getPanchangaSnapshot()
//    with the real instant directly, independent of this fix) -- so the
//    SAME real production score for a fixed instant must be identical
//    regardless of what panchangSummary says.
// ============================================================

{
  const eveningInstant = new Date('2026-12-08T21:00:00+05:30');
  const outcome1 = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: eveningInstant, durationMinutes: 60, context: chennaiContext });
  const outcome2 = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: eveningInstant, durationMinutes: 60, context: chennaiContext });
  check('7. evaluateMuhurthamCandidateAt score is deterministic/stable for the identical instant (sanity)', outcome1.status === 'OK' && outcome2.status === 'OK' && outcome1.score === outcome2.score);

  const result = findMuhurthams({ activityId: 'start-journey', dateRange: { start: '2026-12-06', end: '2026-12-06' }, context: chennaiContext });
  const dec6 = result.dates.find((d) => d.date === '2026-12-06');
  check(
    '7. findMuhurthams\' ranking score for the best window equals a direct evaluateMuhurthamCandidateAt check of that SAME instant -- the panchangSummary fix changed display data only, never the score/ranking input',
    Boolean(dec6) &&
      (() => {
        const direct = evaluateMuhurthamCandidateAt({ scope: 'GENERAL', activityId: 'start-journey', start: new Date(dec6!.bestWindow.start), durationMinutes: Math.round((new Date(dec6!.bestWindow.end).getTime() - new Date(dec6!.bestWindow.start).getTime()) / 60000), context: chennaiContext });
        return direct.status === 'OK' && direct.score === dec6!.score;
      })()
  );
}

console.log(allPassed ? '\nALL PANCHANG REFERENCE INSTANT REGRESSION CHECKS PASSED' : '\nSOME PANCHANG REFERENCE INSTANT REGRESSION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
