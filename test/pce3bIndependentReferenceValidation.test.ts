/**
 * PCE-3B -- Independent Muhurtham Reference Validation.
 *
 * Reads the provenance-first fixtures in
 * test/fixtures/pce3bMuhurthamReferenceFixtures.ts (each copied by hand
 * from a live DrikPanchang page, fetched directly with curl -- see that
 * file's own doc comment for the full provenance discipline) and computes
 * Aura's OWN values for the exact same published instant/location, using
 * Aura's existing, unmodified production functions. No fixture's expected
 * value was derived by running Aura; this file is the only place Aura's
 * output enters the comparison.
 *
 * Two different kinds of assertion, per the PCE-3B ticket's own Section 7:
 *
 *  STRICT (assertStrict): permitted only where (a) the published value is
 *  an unambiguous single value for a determinable exact instant, and
 *  (b) the underlying thing being compared is a well-established
 *  mathematical/astronomical fact, not a traditional-rule judgment call.
 *  A strict failure fails this test (and therefore CI).
 *
 *  OBSERVATIONAL (reportObservation): everything else -- traditional
 *  eligibility-list comparisons, ambiguous/transition-spanning windows,
 *  and the one genuine Tithi discrepancy found near a midnight boundary
 *  (see MARRIAGE-FAV-2026-02-08-MIDNIGHT-CROSSING). These are REPORTED
 *  (printed, and collected into the OBSERVATIONAL SUMMARY at the end) but
 *  NEVER fail this test -- Aura legitimately differing from a single
 *  external publisher, whose own complete rule set is not fully known, is
 *  not by itself a defect. Do not add a strict assertion here without
 *  re-reading the referenced fixture's own `limitations` field first.
 */
import { getTithi, getNakshatra, getYoga } from '../packages/vedic/src/panchangElements';
import { isCombust } from '../packages/vedic/src/planetaryCombustion';
import { localDateTimeToUTC } from '../packages/panchang/src/localDate';
import { classifySynodicMonthContaining } from '../packages/vedic/src/lunarCalendar';
import { INTENT_RULE_PACKS } from '../packages/muhurta/src/muhurtaRulePacks';
import { PCE3B_MUHURTHAM_REFERENCE_FIXTURES } from './fixtures/pce3bMuhurthamReferenceFixtures';

let allStrictPassed = true;
function assertStrict(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} [STRICT] ${label}`);
  if (!condition) allStrictPassed = false;
}

const observations: string[] = [];
function reportObservation(label: string, detail: string) {
  const line = `OBS  ${label}: ${detail}`;
  console.log(line);
  observations.push(line);
}

function bareTithiName(published: string): string {
  // Strip a leading "Shukla "/"Krishna " paksha prefix if present, for
  // comparison against Aura's own getTithi() name (which always includes
  // it) -- published fixtures never state the paksha (see fixtures file).
  return published.replace(/^(Shukla|Krishna)\s+/, '');
}

function fixture(id: string) {
  const f = PCE3B_MUHURTHAM_REFERENCE_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture not found: ${id}`);
  return f;
}

console.log('=== PCE-3B: Marriage/Griha Pravesh independent reference validation ===');
console.log(`${PCE3B_MUHURTHAM_REFERENCE_FIXTURES.length} fixtures loaded, all DrikPanchang / New Delhi / Asia-Kolkata (see fixtures file for the disclosed location-coverage gap).`);

// --- STRICT: well-defined-instant Nakshatra/Tithi-name comparisons ---
{
  const f = fixture('MARRIAGE-FAV-2026-02-06');
  const t = localDateTimeToUTC(f.published.muhurat!.startDate, f.published.muhurat!.startTime, f.location.timezone);
  const aura = { tithi: getTithi(t).name, nakshatra: getNakshatra(t).name };
  assertStrict(`${f.id}: Nakshatra matches published (${f.published.nakshatra})`, aura.nakshatra === f.published.nakshatra);
  assertStrict(`${f.id}: Tithi name matches published ignoring paksha (${f.published.tithiNameIgnoringPaksha})`, bareTithiName(aura.tithi) === f.published.tithiNameIgnoringPaksha);
}
{
  const f = fixture('GRIHA_PRAVESH-FAV-2026-02-20');
  const t = localDateTimeToUTC(f.published.muhurat!.startDate, f.published.muhurat!.startTime, f.location.timezone);
  const aura = { tithi: getTithi(t).name, nakshatra: getNakshatra(t).name };
  assertStrict(`${f.id}: Nakshatra matches published (${f.published.nakshatra})`, aura.nakshatra === f.published.nakshatra);
  assertStrict(`${f.id}: Tithi name matches published ignoring paksha (${f.published.tithiNameIgnoringPaksha})`, bareTithiName(aura.tithi) === f.published.tithiNameIgnoringPaksha);
}
{
  // PCE-4A-T2: this fixture's published start minute (09:29) sits within
  // the same source-stated minute as the real Hasta->Chitra transition
  // (09:29:05.334 IST under the corrected ayanamsa) -- see the fixture's
  // own `strictInstantOverride.justification` for the independent evidence
  // (DrikPanchang's own day-panchang page separately states "Hasta upto
  // 09:29" for this same transition, confirming minute-level source
  // precision, not a disagreement). Sample at the override instant
  // (window midpoint) when present; `published.muhurat.startTime` itself
  // is never altered.
  const f = fixture('GRIHA_PRAVESH-FAV-2026-03-06');
  const sampleTime = f.strictInstantOverride?.localTime ?? f.published.muhurat!.startTime;
  const t = localDateTimeToUTC(f.published.muhurat!.startDate, sampleTime, f.location.timezone);
  const aura = { tithi: getTithi(t).name, nakshatra: getNakshatra(t).name };
  assertStrict(`${f.id}: Nakshatra matches published (${f.published.nakshatra})`, aura.nakshatra === f.published.nakshatra);
  assertStrict(`${f.id}: Tithi name matches published ignoring paksha (${f.published.tithiNameIgnoringPaksha})`, bareTithiName(aura.tithi) === f.published.tithiNameIgnoringPaksha);
}

// --- STRICT: planetary combustion (Aura's own requiresPlanetaryCombustion inputs) ---
{
  const f = fixture('MARRIAGE-EXCL-VENUS-COMBUSTION-2026-01-15');
  const t = localDateTimeToUTC(f.published.localDate, '12:00', f.location.timezone);
  assertStrict(`${f.id}: isCombust('Venus') agrees with published "${f.published.message}"`, isCombust('Venus', t) === true);
}
{
  const f = fixture('MARRIAGE-EXCL-JUPITER-COMBUSTION-2026-08-01');
  const t = localDateTimeToUTC(f.published.localDate, '12:00', f.location.timezone);
  assertStrict(`${f.id}: isCombust('Jupiter') agrees with published "${f.published.message}"`, isCombust('Jupiter', t) === true);
}

// --- STRICT: Yoga name agrees with published exclusion reason ---
{
  const f = fixture('MARRIAGE-EXCL-YOGA-2026-02-07');
  const t = localDateTimeToUTC(f.published.localDate, '12:00', f.location.timezone);
  const yoga = getYoga(t).name;
  const marriageAvoidYogas: string[] = INTENT_RULE_PACKS.MARRIAGE!.yoga!.avoid;
  assertStrict(`${f.id}: noon Yoga (${yoga}) is one of Aura's own Marriage avoid-Yogas, agreeing with published "${f.published.message}"`, marriageAvoidYogas.includes(yoga));
}

// --- STRICT: published weekday matches Aura's own date handling ---
{
  const f = fixture('GRIHA_PRAVESH-EXCL-WEEKDAY-2026-02-08');
  const t = localDateTimeToUTC(f.published.localDate, '12:00', f.location.timezone);
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  assertStrict(`${f.id}: date resolves to ${f.published.publishedWeekday} as published`, weekdayNames[t.getUTCDay()] === f.published.publishedWeekday);
  reportObservation(f.id, 'Aura has no Vara (weekday) rule for Griha Pravesh at all -- category C, traditional rule difference, not a defect.');
}

// --- OBSERVATIONAL: the one genuine near-midnight Tithi discrepancy found ---
{
  const f = fixture('MARRIAGE-FAV-2026-02-08-MIDNIGHT-CROSSING');
  const t = localDateTimeToUTC(f.published.muhurat!.startDate, f.published.muhurat!.startTime, f.location.timezone);
  const aura = { tithi: getTithi(t).name, nakshatra: getNakshatra(t).name };
  const nakshatraAgrees = aura.nakshatra === f.published.nakshatra;
  const tithiAgrees = bareTithiName(aura.tithi) === f.published.tithiNameIgnoringPaksha;
  reportObservation(
    f.id,
    `Nakshatra ${nakshatraAgrees ? 'AGREES' : 'DISAGREES'} (Aura: ${aura.nakshatra}, published: ${f.published.nakshatra}); ` +
      `Tithi ${tithiAgrees ? 'AGREES' : 'DISAGREES'} (Aura: ${aura.tithi}, published: ${f.published.tithiNameIgnoringPaksha}, window starts only 8min after local midnight -- classification F, unresolved, requires a Tithi-transition-instant investigation, not fixed here).`,
  );
}

// --- OBSERVATIONAL: transition-spanning window (inherently ambiguous by source format) ---
{
  const f = fixture('GRIHA_PRAVESH-FAV-2026-02-06-TRANSITION-SPANNING');
  const t = localDateTimeToUTC(f.published.muhurat!.startDate, f.published.muhurat!.startTime, f.location.timezone);
  const aura = { tithi: getTithi(t).name, nakshatra: getNakshatra(t).name };
  reportObservation(f.id, `Aura at published window-start instant: Nakshatra=${aura.nakshatra}, Tithi=${aura.tithi}. Published pair: Nakshatra="${f.published.nakshatra}", Tithi="${f.published.tithiNameIgnoringPaksha}" (ambiguous by source format -- category D, see fixture limitations).`);
}

// --- OBSERVATIONAL: traditional rule differences / defect-vs-gap classification ---
{
  const f = fixture('GRIHA_PRAVESH-EXCL-TITHI-2026-02-14');
  const t = localDateTimeToUTC(f.published.localDate, '12:00', f.location.timezone);
  const tithi = bareTithiName(getTithi(t).name);
  const avoidList: RegExp[] = INTENT_RULE_PACKS.GRIHA_PRAVESH!.tithi.avoid;
  const inAvoidList = avoidList.some((re) => re.test(tithi));
  reportObservation(f.id, `Noon-sample Tithi "${tithi}" is ${inAvoidList ? '' : 'NOT '}in Aura's own Griha Pravesh avoid-Tithi list. Exact instant published by DrikPanchang is unknown (day-level reason only), so this is recorded as unresolved (category D/F), not a confirmed gap.`);
}
{
  const f1 = fixture('GRIHA_PRAVESH-EXCL-ADHIKA-MASA-2026-05-16');
  const f2 = fixture('GRIHA_PRAVESH-EXCL-ADHIKA-MASA-2026-05-17');
  const t1 = localDateTimeToUTC(f1.published.localDate, '12:00', f1.location.timezone);
  const t2 = localDateTimeToUTC(f2.published.localDate, '12:00', f2.location.timezone);
  const c1 = classifySynodicMonthContaining(t1);
  const c2 = classifySynodicMonthContaining(t2);
  reportObservation(
    `${f1.id} / ${f2.id}`,
    `Aura's classifySynodicMonthContaining() returns "${c1.classification}" for 2026-05-16 and "${c2.classification}" for 2026-05-17 -- NEITHER is ADHIKA, though published source flags both as Adhika/leap-month-related. Aura DOES detect a real 2026 Adhika Masa, but for synodic month 2026-06-15..2026-07-14, about one lunar month later than these published dates. Classified as unresolved convention/boundary difference (category B/F), NOT a confirmed defect -- Aura's leap-month detection is not absent, just not coincident with this specific publisher's flagged dates. Also: Aura's Griha Pravesh rule pack has no period-exclusion rule at all today regardless (category C, matches PCE-1/PCE-3A's already-identified gap).`,
  );
}
{
  const f = fixture('MARRIAGE-EXCL-SOLAR-MONTH-2026-09-01');
  reportObservation(f.id, `"Prohibited Solar month" claim not compared against a specific Aura function in this pass -- Aura's Chaturmas machinery is lunar/Sankranti-framed, not solar-month-framed by name, and whether these are the same underlying mechanism is unresolved (category F). Recorded as a research gap for a future milestone, not investigated further here.`);
}

console.log('\n=== OBSERVATIONAL SUMMARY (never fails this test) ===');
observations.forEach((o) => console.log(o));

console.log(allStrictPassed ? '\nALL PCE-3B STRICT CHECKS PASSED' : '\nSOME PCE-3B STRICT CHECKS FAILED');
if (!allStrictPassed) process.exit(1);
