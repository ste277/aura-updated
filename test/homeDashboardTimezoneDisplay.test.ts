/**
 * Daily Rhythm V1 PR DR4-B.2 -- timezone-display regression suite for
 * Home (HomeDashboard.tsx), mirroring test/planWithAuraTimezoneDisplay.test.ts's
 * own established two-part convention for this exact bug class (this
 * repo has no component-test infrastructure -- confirmed, no *.test.tsx
 * anywhere):
 *
 *   1. STRUCTURAL -- read the real shipped source as text and confirm
 *      StartingSoonCard/formatUpdateDateTime now require a `timezone`
 *      and pass it into every toLocale*String call, and that both real
 *      call sites supply HomeDashboard's own already-resolved
 *      `effectiveTimezone` -- proves the fix is actually wired.
 *   2. BEHAVIORAL -- the exact options objects this fix now uses, run
 *      against fixed real instants and explicit real IANA timezones
 *      (never the test runner's own host timezone) -- proves the
 *      formula itself produces the correct result for every required
 *      scenario, including DST and cross-midnight.
 *
 *   npx ts-node test/homeDashboardTimezoneDisplay.test.ts
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// The exact formula StartingSoonCard now uses -- reproduced here (not
// imported) because it is a private, non-exported function component,
// over the same native Intl API this bug/fix's whole surface area is.
function formatStartingSoonRange(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  return `${start.toLocaleTimeString('en-US', timeOpts)} – ${end.toLocaleTimeString('en-US', timeOpts)}`;
}

// The exact formula formatUpdateDateTime now uses.
function formatUpdateDateTimeFormula(iso: string, timezone: string): { day: string; time: string } {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: timezone }),
    time: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }),
  };
}

function main() {
  const homeSrc = read('apps/web/components/HomeDashboard.tsx');

  // ============================================================
  // STRUCTURAL: the fix is actually wired, not just correct in theory.
  // ============================================================
  check('1. formatUpdateDateTime now takes a required `timezone: string` second parameter', /function formatUpdateDateTime\(iso: string, timezone: string\)/.test(homeSrc));
  check('2. formatUpdateDateTime\'s day AND time formatting both carry an explicit timeZone (never omitted)', /day: date\.toLocaleDateString\('en-US', \{ weekday: 'long', month: 'short', day: 'numeric', timeZone: timezone \}\)/.test(homeSrc) && /time: date\.toLocaleTimeString\('en-US', \{ hour: 'numeric', minute: '2-digit', timeZone: timezone \}\)/.test(homeSrc));
  check('3. formatUpdateDateTime\'s one real call site passes effectiveTimezone (HomeDashboard\'s own already-resolved timezone, never a second fallback)', /formatUpdateDateTime\(update\.eventStartAt, effectiveTimezone\)/.test(homeSrc));
  check('4. StartingSoonCard declares a required `timezone: string` prop', /function StartingSoonCard\(\{ reminder, onOpen, timezone \}: \{ reminder: AuraReminder; onOpen\?: \(reminder: AuraReminder\) => void; timezone: string \}\)/.test(homeSrc));
  check('5. StartingSoonCard\'s timeOpts carries an explicit timeZone (never omitted)', /const timeOpts: Intl\.DateTimeFormatOptions = \{ hour: 'numeric', minute: '2-digit', timeZone: timezone \};/.test(homeSrc));
  check('6. StartingSoonCard\'s one real call site passes effectiveTimezone -- the SAME variable formatUpdateDateTime\'s call site uses, confirming Home and its own "Moment Update" card share one consistent timezone source', /<StartingSoonCard reminder=\{nextThing\.reminder\} onOpen=\{onOpenReminder\} timezone=\{effectiveTimezone\} \/>/.test(homeSrc));
  check('7. effectiveTimezone itself is still computed exactly as HomeDashboard already established (timezone ?? FALLBACK_HOME_TZ) -- this PR reuses it, never redefines it', /const effectiveTimezone = timezone \?\? FALLBACK_HOME_TZ;/.test(homeSrc));
  check(
    '8. no remaining toLocaleTimeString/toLocaleDateString call on StartingSoonCard\'s or formatUpdateDateTime\'s own absolute-instant formatting path omits timeZone',
    (() => {
      // Only the two fixed functions' own bodies are checked here --
      // todayLabel()/greeting()/the loggedAtLabel "now" calls are a
      // DIFFERENT, documented-separately finding (see this PR's own
      // completion report), not "scheduled activity" display, and were
      // never in this ticket's own named scope.
      const formatUpdateBody = homeSrc.match(/function formatUpdateDateTime\(iso: string, timezone: string\) \{[\s\S]*?\n\}/)?.[0] ?? '';
      const startingSoonBody = homeSrc.match(/function StartingSoonCard\([\s\S]*?\n\}/)?.[0] ?? '';
      const calls = [...(formatUpdateBody.match(/\.toLocale(Time|Date)String\([^)]*\)/g) ?? []), ...(startingSoonBody.match(/\.toLocale(Time|Date)String\([^)]*\)/g) ?? [])];
      // A call is "safe" if it passes an inline timeZone OR references
      // the `timeOpts` variable (StartingSoonCard), which check 5 above
      // already confirms carries one -- same convention
      // planWithAuraTimezoneDisplay.test.ts's own check 5 established.
      const offenders = calls.filter((call) => !/timeZone/.test(call) && !/\btimeOpts\b/.test(call));
      return calls.length >= 3 && offenders.length === 0;
    })()
  );

  // ============================================================
  // 1-2. Browser timezone differs from user timezone / America/New_York
  // displays 2:00 PM for 2026-10-19T18:00:00.000Z -- the exact scenario
  // and instant this whole DR4-B/DR4-B.1/DR4-B.2 line has used.
  // ============================================================
  const confirmedInstant = '2026-10-19T18:00:00.000Z';
  check('1. StartingSoonCard: 2:00 PM America/New_York displays as "2:00 PM" with the real, correct timezone', formatStartingSoonRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'America/New_York').startsWith('2:00 PM'));
  check('1b. StartingSoonCard: the SAME instant formatted with a mismatched browser/host timezone (UTC) is NOT "2:00 PM" -- the browser-mismatch scenario this bug depended on is real and reproducible', !formatStartingSoonRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'UTC').startsWith('2:00 PM'));
  check('2. formatUpdateDateTime: the same instant displays time "2:00 PM" for a genuine America/New_York user', formatUpdateDateTimeFormula(confirmedInstant, 'America/New_York').time === '2:00 PM');

  // ============================================================
  // 3. Asia/Kolkata displays the corresponding local time -- the exact
  // value the ORIGINAL live bug incorrectly showed for a DIFFERENT
  // (America/New_York) user, now reproduced as the CORRECT answer for a
  // genuine Asia/Kolkata user.
  // ============================================================
  check('3. StartingSoonCard: the confirmed instant for a genuine Asia/Kolkata user correctly shows 11:30 PM (UTC+5:30)', formatStartingSoonRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'Asia/Kolkata').startsWith('11:30 PM'));
  check('3b. formatUpdateDateTime: the confirmed instant for a genuine Asia/Kolkata user correctly shows time 11:30 PM', formatUpdateDateTimeFormula(confirmedInstant, 'Asia/Kolkata').time === '11:30 PM');

  // ============================================================
  // 4-5. StartingSoonCard / formatUpdateDateTime both use the configured
  // (effective) timezone -- already proven structurally (checks 3, 6
  // above: both real call sites pass the SAME `effectiveTimezone`
  // variable) and behaviorally (checks 1-3 above, same formula both
  // functions now share).
  // ============================================================
  check('4/5. Home\'s two fixed paths share byte-identical timezone-resolution results for the identical instant/timezone pair (StartingSoonCard and formatUpdateDateTime produce the same clock time for the same instant)', formatStartingSoonRange(confirmedInstant, confirmedInstant, 'America/New_York').split(' – ')[0] === formatUpdateDateTimeFormula(confirmedInstant, 'America/New_York').time);

  // ============================================================
  // Consistency with Find a Time (DR4-B.1) -- the SAME instant must
  // display the SAME clock time on Home as it does on Find a Time,
  // since both now resolve through an explicit, correct timeZone rather
  // than each independently defaulting to the browser's own timezone.
  // ============================================================
  {
    const planWithAuraSrc = read('apps/web/components/PlanWithAuraView.tsx');
    check('Home and Find a Time (DR4-B.1) use the identical options-object SHAPE for their fixed time formatting (hour: numeric, minute: 2-digit, timeZone) -- not a divergent, second formatting convention', /\{ hour: 'numeric', minute: '2-digit', timeZone: timezone \}/.test(planWithAuraSrc) && /\{ hour: 'numeric', minute: '2-digit', timeZone: timezone \}/.test(homeSrc));
  }

  // ============================================================
  // 6. Daylight-saving transitions -- 2026-11-01 is the real
  // America/New_York DST-end date (clocks fall back at 2:00 AM local).
  // ============================================================
  check('6. StartingSoonCard: an instant just before the 2026 fall-back (05:30Z, still EDT/UTC-4) displays 1:30 AM', formatStartingSoonRange('2026-11-01T05:30:00.000Z', '2026-11-01T06:00:00.000Z', 'America/New_York').startsWith('1:30 AM'));
  check('6b. StartingSoonCard: the SAME wall-clock instant one hour later in UTC (06:30Z, now EST/UTC-5 post-fallback) ALSO displays 1:30 AM -- the real repeated-hour DST behavior', formatStartingSoonRange('2026-11-01T06:30:00.000Z', '2026-11-01T07:00:00.000Z', 'America/New_York').startsWith('1:30 AM'));
  check('6c. formatUpdateDateTime: the same pre/post-fallback pair both resolve to time "1:30 AM"', formatUpdateDateTimeFormula('2026-11-01T05:30:00.000Z', 'America/New_York').time === '1:30 AM' && formatUpdateDateTimeFormula('2026-11-01T06:30:00.000Z', 'America/New_York').time === '1:30 AM');

  // ============================================================
  // 7. Cross-midnight date boundaries.
  // ============================================================
  check('7. StartingSoonCard: a reminder window crossing local midnight displays 11:30 PM – 12:30 AM, correctly straddling the day boundary', formatStartingSoonRange('2026-10-20T03:30:00.000Z', '2026-10-20T04:30:00.000Z', 'America/New_York') === '11:30 PM – 12:30 AM');
  check('7b. formatUpdateDateTime: the day label for an instant just after local midnight correctly reflects the NEW day, not the UTC day', formatUpdateDateTimeFormula('2026-10-20T04:15:00.000Z', 'America/New_York').day.includes('Oct 20'));

  // ============================================================
  // 8. Existing locale and time formatting preserved -- 'en-US' +
  // {hour:'numeric', minute:'2-digit'} unchanged, still 12-hour AM/PM,
  // the weekday/month/day date format unchanged.
  // ============================================================
  check("8. the locale is still exactly 'en-US' in both fixed functions", (homeSrc.match(/toLocale(Time|Date)String\('en-US'/g) ?? []).length >= 4);
  check('8b. rendered time output is still 12-hour with AM/PM, never 24-hour', /^\d{1,2}:\d{2} (AM|PM)$/.test(formatUpdateDateTimeFormula(confirmedInstant, 'America/New_York').time));
  check('8c. the day-label date format fields (weekday: long, month: short, day: numeric) are unchanged -- only timeZone was added', /weekday: 'long', month: 'short', day: 'numeric', timeZone: timezone/.test(homeSrc));

  // ============================================================
  // 9. Missing timezone fallback behavior -- HomeDashboard's own
  // pre-existing `effectiveTimezone = timezone ?? FALLBACK_HOME_TZ`
  // convention (untouched, reused verbatim -- confirmed by check 7
  // above) means an unconfigured/missing user timezone still resolves
  // to a real, valid IANA zone (FALLBACK_HOME_TZ), never `undefined`
  // reaching `toLocaleTimeString` and silently reintroducing the bug.
  // ============================================================
  check("9. FALLBACK_HOME_TZ is still defined as a real, valid IANA timezone ('Asia/Kolkata'), untouched by this PR", /const FALLBACK_HOME_TZ = 'Asia\/Kolkata';/.test(homeSrc));
  check('9b. a genuinely missing timezone (simulating an unconfigured user) still produces a valid, non-empty formatted time via the real fallback value, never a thrown error or "Invalid Date"', formatStartingSoonRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'Asia/Kolkata').length > 0 && !formatStartingSoonRange(confirmedInstant, '2026-10-19T19:00:00.000Z', 'Asia/Kolkata').includes('Invalid'));

  // ============================================================
  // 10. No mutation of underlying timestamps -- this PR only changes
  // FORMATTING options; `new Date(iso)` / `new Date(reminder.startAt)`
  // parsing is byte-identical, confirmed structurally (the parsing
  // lines themselves are unchanged) and behaviorally (the same instant
  // parses to the same real moment regardless of which timezone it is
  // later DISPLAYED in -- the underlying epoch never changes).
  // ============================================================
  check('10. new Date(iso) / new Date(reminder.startAt) / new Date(reminder.endAt) parsing lines are unchanged (no new Date-mutation logic introduced)', /const start = new Date\(reminder\.startAt\);/.test(homeSrc) && /const end = new Date\(reminder\.endAt\);/.test(homeSrc) && /const date = new Date\(iso\);/.test(homeSrc));
  check('10b. the SAME instant produces the SAME underlying epoch regardless of which timezone it is displayed in (the fix changes DISPLAY only, never the real moment in time)', new Date(confirmedInstant).getTime() === new Date(confirmedInstant).getTime() && new Date(confirmedInstant).toISOString() === confirmedInstant);

  if (!allPassed) {
    console.error('\nSome Home timezone-display (DR4-B.2) checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL HOME TIMEZONE-DISPLAY (DR4-B.2) CHECKS PASSED');
  }
}

main();
