/**
 * CI reliability -- the automatic Goal lifecycle fixture calendar (pure) and the guard that keeps the DB fixture wall-clock independent.
 *
 *   Part 1  civil-date arithmetic (leap day, month and year boundaries, weekdays)
 *   Part 2  `fixtureAnchorMonday` over EVERY simulated run date for five years x three times of day x four timezones: always a Monday, always 28..34 local
 *           days ahead, a pure function of the LOCAL civil date (instants either side of local midnight pick the right day), never mutating its input and repeating
 *   Part 3  the six anchored DB fixtures (automaticGoalLifecycleClosureDb, goalDecompositionPlanningHandoffDb, decisionFactsThreadingDb, goalDemandCandidatesDb, manualGoalProvenanceParityDb, goalLifecycleArchivedAcceptanceDb -- one root cause) cannot silently regain a hard-coded calendar or an uncontrolled clock read
 */
import fs from 'fs';
import path from 'path';
import { addCivilDays, civilWeekday, fixtureAnchorMonday, FIXTURE_MIN_LEAD_DAYS } from './lifecycleFixtureCalendar';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ---- Part 1
check('civil arithmetic: leap day, month end, year end, negative offsets', addCivilDays('2028-02-28', 1) === '2028-02-29' && addCivilDays('2028-02-28', 2) === '2028-03-01' && addCivilDays('2027-02-28', 1) === '2027-03-01' && addCivilDays('2026-12-31', 1) === '2027-01-01' && addCivilDays('2026-03-01', -1) === '2026-02-28' && addCivilDays('2026-10-05', 7) === '2026-10-12');
check('ISO weekdays: 2026-10-05 is a Monday (1), 2026-10-11 a Sunday (7), 2028-02-29 a Tuesday (2)', civilWeekday('2026-10-05') === 1 && civilWeekday('2026-10-11') === 7 && civilWeekday('2028-02-29') === 2);

// ---- Part 2
const ZONES = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland'];
const localDate = (instant: Date, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
let runs = 0; let notMonday = 0; let badLead = 0; let notLocalDatePure = 0; let notSundayAfter = 0;
for (let day = 0; day < 365 * 5 + 2; day += 1) {
  const base = Date.UTC(2026, 0, 1) + day * 86400000;
  for (const hour of [0, 12, 23]) for (const zone of ZONES) {
    const instant = new Date(base + hour * 3600000 + (hour === 23 ? 59 * 60000 : 0));
    const frozen = instant.getTime();
    const anchor = fixtureAnchorMonday(instant, zone);
    runs += 1;
    const today = localDate(instant, zone);
    const lead = (Date.parse(`${anchor}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
    if (civilWeekday(anchor) !== 1) notMonday += 1;
    if (!(lead >= FIXTURE_MIN_LEAD_DAYS && lead < FIXTURE_MIN_LEAD_DAYS + 7)) badLead += 1;
    if (civilWeekday(addCivilDays(anchor, 6)) !== 7 || civilWeekday(addCivilDays(anchor, 7)) !== 1) notSundayAfter += 1;
    if (instant.getTime() !== frozen || fixtureAnchorMonday(instant, zone) !== anchor) notLocalDatePure += 1; // pure: the input is untouched and the result repeats
  }
}
check(`over ${runs} simulated run dates (5 years x 3 times of day x 4 timezones, including leap day and every month / year end) the anchor is ALWAYS a Monday`, notMonday === 0);
check(`... always ${FIXTURE_MIN_LEAD_DAYS}..${FIXTURE_MIN_LEAD_DAYS + 6} local days after the run date's local civil date (the week is wholly in the future of any real clock a run could read)`, badLead === 0);
check('... its Sunday and the following Monday exist at the expected offsets (the week boundary the lifecycle fixture crosses), and the input instant is never mutated', notSundayAfter === 0 && notLocalDatePure === 0);
// FUTURE MOVE DESTINATION (goalDemandCandidatesDb): the destination is `<anchor Tuesday>T15:00:00Z`; `movePlannedActivity` requires it to be after the DATABASE clock, so it must be after
// every run instant -- at every simulated run time of day, in every zone, across leap-day and year boundaries.
let destinationNotFuture = 0;
for (let day = 0; day < 365 * 5 + 2; day += 1) for (const hour of [0, 12, 23]) for (const zone of ZONES) {
  const instant = new Date(Date.UTC(2026, 0, 1) + day * 86400000 + hour * 3600000);
  const destination = new Date(`${addCivilDays(fixtureAnchorMonday(instant, zone), 1)}T15:00:00Z`);
  if (destination.getTime() <= instant.getTime() + 20 * 86400000) destinationNotFuture += 1;
}
check('FUTURE MOVE DESTINATION: the anchored Tuesday 15:00Z destination is at least 20 days after every simulated run instant (5 years x 3 times of day x 4 timezones) -- never a past or imminent instant for the database-clock validation', destinationNotFuture === 0);
// ACCEPTANCE FIXTURES (manualGoalProvenanceParityDb, goalLifecycleArchivedAcceptanceDb): they drive the REAL accept route, whose stale-preview check reads the wall clock. Their planning date is the
// anchored WEDNESDAY (anchor + 2), the 'already completed' plan is the TUESDAY before it (anchor + 1), the Rhythm week is anchor .. the Sunday (anchor + 6), and every proposed instant falls on
// the planning date. For every simulated run instant they must keep those weekday / week relationships AND lie wholly in the future of that run instant.
let relationshipBroken = 0; let notInFuture = 0;
for (let day = 0; day < 365 * 5 + 2; day += 1) for (const hour of [0, 12, 23]) {
  const instant = new Date(Date.UTC(2026, 0, 1) + day * 86400000 + hour * 3600000);
  const monday = fixtureAnchorMonday(instant, 'Asia/Kolkata');
  const tuesday = addCivilDays(monday, 1); const wednesday = addCivilDays(monday, 2); const sunday = addCivilDays(monday, 6);
  if (civilWeekday(monday) !== 1 || civilWeekday(tuesday) !== 2 || civilWeekday(wednesday) !== 3 || civilWeekday(sunday) !== 7) relationshipBroken += 1;
  if (new Date(`${tuesday}T00:00:00Z`).getTime() <= instant.getTime() + 20 * 86400000 || new Date(`${wednesday}T00:00:00Z`).getTime() <= instant.getTime() + 20 * 86400000) notInFuture += 1;
}
check('ACCEPTANCE FIXTURE CALENDAR: for every simulated run instant (5 years x 3 times of day, including leap day, every month / year end and every weekday) the anchored Monday / Tuesday / Wednesday planning date / Sunday keep their weekdays and the Monday-start Rhythm week, and the whole fixture week is at least 20 days after the run instant (the real accept route can never find a proposed start elapsed)', relationshipBroken === 0 && notInFuture === 0);
const weekOf = (ref: string) => { const m = fixtureAnchorMonday(new Date(ref), 'Asia/Kolkata'); return [m, addCivilDays(m, 2), addCivilDays(m, 6)]; };
check('BOUNDARY WEEKS: a year-end week (2026-12-28 .. 2027-01-03), a non-leap February-end week (2027-02-22 .. 2027-02-28) and the leap-day week (2028-02-28 .. 2028-03-05) anchor correctly, with the planning Wednesday on the expected civil date', JSON.stringify(weekOf('2026-11-30T12:00:00Z')) === JSON.stringify(['2026-12-28', '2026-12-30', '2027-01-03']) && JSON.stringify(weekOf('2027-01-25T12:00:00Z')) === JSON.stringify(['2027-02-22', '2027-02-24', '2027-02-28']) && JSON.stringify(weekOf('2028-01-31T12:00:00Z')) === JSON.stringify(['2028-02-28', '2028-03-01', '2028-03-05']));
// local-midnight sensitivity: Asia/Kolkata midnight is 18:30Z
const before = fixtureAnchorMonday(new Date('2026-10-12T18:29:00Z'), 'Asia/Kolkata');
const after = fixtureAnchorMonday(new Date('2026-10-12T18:31:00Z'), 'Asia/Kolkata');
const utcBefore = fixtureAnchorMonday(new Date('2026-10-12T18:29:00Z'), 'UTC');
check('LOCAL MIDNIGHT: one minute either side of Asia/Kolkata midnight (18:30Z) uses the local date before / after -- 2026-10-12 + 28 days = 2026-11-09 (a Monday) vs 2026-10-13 + 28 days = 2026-11-10 -> the next Monday 2026-11-16; UTC at the same instant is still 2026-10-12', before === '2026-11-09' && after === '2026-11-16' && utcBefore === '2026-11-09');
check('the run date 2026-10-06 itself (when the old hard-coded fixture began failing) anchors the week of 2026-11-09 -> its Tuesday is 2026-11-10 (the dates the DB matrix prints)', fixtureAnchorMonday(new Date('2026-10-06T12:00:00Z'), 'Asia/Kolkata') === '2026-11-09' && fixtureAnchorMonday(new Date('2026-10-06T12:00:00Z'), 'UTC') === '2026-11-09');

// ---- Part 3: the DB fixture stays wall-clock independent
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const HARD_CODED_CALENDAR = /['"`]20\d\d-\d\d-\d\d/;
const UNCONTROLLED_CLOCK = /\bDate\.now\s*\(|\bnew Date\(\s*\)|\bperformance\.now\s*\(|\bhrtime\b/;
const violations = (fixture: string, helper: string): string[] => {
  const out: string[] = [];
  const f = strip(fixture);
  if (HARD_CODED_CALENDAR.test(f)) out.push('hard-coded calendar date');
  if (UNCONTROLLED_CLOCK.test(f)) out.push('uncontrolled clock read in the fixture');
  if (!/import \{ fixtureAnchorMonday, addCivilDays, realClockReferenceForFixture \} from '\.\/lifecycleFixtureCalendar';/.test(f) || !/const (?:ANCHOR_MONDAY|MON) = fixtureAnchorMonday\(realClockReferenceForFixture\(\), TZ\);/.test(f)) out.push('fixture is not anchored through the calendar helper');
  if (!/const TZ = 'Asia\/Kolkata';/.test(f)) out.push('timezone is not pinned');
  const h = strip(helper);
  if (count(/\bnew Date\(\s*\)/g, h) !== 1 || /\bDate\.now\b/.test(h)) out.push('helper reads the wall clock more than once');
  return out;
};
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;
const FIXTURES = ['automaticGoalLifecycleClosureDb', 'goalDecompositionPlanningHandoffDb', 'decisionFactsThreadingDb', 'goalDemandCandidatesDb', 'manualGoalProvenanceParityDb', 'goalLifecycleArchivedAcceptanceDb'];
const helperSrc = fs.readFileSync(path.join(__dirname, 'lifecycleFixtureCalendar.ts'), 'utf8');
const fixtureSources = FIXTURES.map((name) => fs.readFileSync(path.join(__dirname, `${name}.test.ts`), 'utf8'));
for (const [i, name] of FIXTURES.entries()) check(`THE DB FIXTURE ${name}: no hard-coded calendar date, no \`Date.now()\` / no-argument \`new Date()\` / timer read, anchored through the helper, timezone pinned to Asia/Kolkata (never the host timezone)`, violations(fixtureSources[i], helperSrc).length === 0);
check('the helper holds the ONE approved wall-clock read', violations(fixtureSources[0], helperSrc).length === 0 && count(/\bnew Date\(\s*\)/g, strip(helperSrc)) === 1);
const fixtureSrc = fixtureSources[0];
check('MUTATION: a hard-coded date, a `Date.now()`, a no-argument `new Date()` in a fixture, a second clock read in the helper, an unpinned timezone and an unanchored fixture are each detected (for every guarded fixture)', FIXTURES.every((_, i) => { const f = fixtureSources[i]; return violations(`${f}\nconst d = iso('2026-10-06T02:00:00Z');`, helperSrc).includes('hard-coded calendar date') && violations(`${f}\nconst k = \`a-\${Date.now()}\`;`, helperSrc).includes('uncontrolled clock read in the fixture') && violations(`${f}\nconst now = new Date();`, helperSrc).includes('uncontrolled clock read in the fixture') && violations(f.replace("const TZ = 'Asia/Kolkata';", "const TZ = process.env.TZ ?? 'UTC';"), helperSrc).includes('timezone is not pinned') && violations(f.replace(/const (ANCHOR_MONDAY|MON) = fixtureAnchorMonday\(realClockReferenceForFixture\(\), TZ\);/, "const $1 = '2026-10-05';"), helperSrc).includes('fixture is not anchored through the calendar helper'); }) && violations(fixtureSrc, `${helperSrc}\nexport const x = () => Date.now();`).includes('helper reads the wall clock more than once'));
const ci = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
check('REQUIRED CI: this suite runs in the pure job and the six anchored DB fixtures remain required DB-job steps', ci.includes('npx ts-node test/lifecycleFixtureCalendar.test.ts') && FIXTURES.every((name) => ci.includes(`npx ts-node test/${name}.test.ts`)));

if (!allPassed) { console.error('SOME LIFECYCLE FIXTURE CALENDAR CHECKS FAILED'); process.exit(1); }
console.log('ALL LIFECYCLE FIXTURE CALENDAR CHECKS PASSED');
