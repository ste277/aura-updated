/**
 * Pending Activity Visual Consistency V1: regression suite for pending
 * (offline-queued, not yet server-confirmed) HabitLog presentation across
 * apps/web/components/CalendarViewSection.tsx, Timeline.tsx, and
 * InsightsView.tsx.
 *
 * Audited separately (not re-derived here): the canonical discriminator
 * (LoggedEntryItem.syncStatus === 'pending') was already correctly created
 * and maintained end-to-end by handleLogActivity (page.tsx), but three of
 * the four surfaces that render logEntries never read it at all, showing
 * a not-yet-confirmed offline-queued entry identically to a real,
 * server-persisted one. No component-test harness exists in this repo, so
 * this follows the established source-text/regex structural-assertion
 * pattern (see test/locationSaveFailureState.test.ts,
 * test/habitLogActivityIdentity.test.ts).
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const calendarSource = fs.readFileSync('apps/web/components/CalendarViewSection.tsx', 'utf8');
const timelineSource = fs.readFileSync('apps/web/components/Timeline.tsx', 'utf8');
const insightsSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');

function extractBraced(text: string, openBraceIndex: number): string {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  }
  return text.slice(openBraceIndex + 1, i - 1);
}

// ============================================================
// 0. Canonical discriminator itself, unchanged.
// ============================================================

check(
  "the canonical LoggedEntryItem type (CalendarViewSection.tsx) still declares syncStatus?: 'pending'",
  /syncStatus\?: 'pending';/.test(calendarSource)
);

// ============================================================
// 1/2/3. Calendar -- individual day-log row treats pending distinctly,
// never with the unconditional confirmed checkmark.
// ============================================================

const calendarRowStart = calendarSource.indexOf("<div key={log.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between'");
check('CalendarViewSection\'s individual log row was located', calendarRowStart !== -1);
const calendarRowBraceIndex = calendarSource.indexOf('{', calendarRowStart + calendarSource.slice(calendarRowStart).indexOf('style={{') + 'style='.length);
// Grab a generous, self-contained slice of the row's JSX rather than
// precisely brace-matching (the row contains many nested {} style objects) --
// bounded by the next sibling row-list close, which is unique enough here.
const calendarRowSlice = calendarSource.slice(calendarRowStart, calendarSource.indexOf('log.notes?.trim()', calendarRowStart));

check(
  "the row conditionally renders StatusBadge label=\"Pending sync\" tone=\"caution\" for a pending entry",
  /log\.syncStatus === 'pending' \?[\s\S]*?<StatusBadge label="Pending sync" tone="caution" \/>/.test(calendarRowSlice)
);
check(
  'the row still renders the plain green ✓ for the non-pending (confirmed) branch',
  /: \(\s*<span style=\{\{ color: '#4ade80', fontWeight: 800 \}\}>✓<\/span>/.test(calendarRowSlice)
);
check(
  'the confirmed ✓ is no longer rendered unconditionally (it is inside the ternary\'s else branch, not a bare sibling)',
  !/^\s*<span style=\{\{ color: '#4ade80', fontWeight: 800 \}\}>✓<\/span>/m.test(calendarRowSlice.split('log.syncStatus')[0] ?? '')
);

// ============================================================
// 4/5/6. Timeline -- the window-detail "Logged Badges" pill list
// distinguishes pending, with real text plus a distinct primitive
// (StatusBadge), not color alone.
// ============================================================

const badgesBlockStart = timelineSource.indexOf('{/* Render Logged Badges inside Banner if Any exist */}');
check('Timeline\'s "Logged Badges" block was located', badgesBlockStart !== -1);
const badgesBlockEnd = timelineSource.indexOf('{/* Activity Discovery Cards List */}', badgesBlockStart);
const badgesBlock = timelineSource.slice(badgesBlockStart, badgesBlockEnd);

check('the pill list checks log.syncStatus === \'pending\' per entry', /log\.syncStatus === 'pending'/.test(badgesBlock));
check('a pending entry renders StatusBadge label="Pending sync" tone="caution"', /<StatusBadge label="Pending sync" tone="caution" \/>/.test(badgesBlock));
check('a confirmed entry still renders the plain ✓ pill unchanged', /<span>✓<\/span>/.test(badgesBlock) && /<span>\{log\.activityTitle\}<\/span>/.test(badgesBlock));

// ============================================================
// 7. Timeline -- the per-window "{N} logged" count distinguishes
// confirmed from pending instead of labeling everything "logged".
// ============================================================

const windowLogsDeclIndex = timelineSource.indexOf('const windowLogs = getWindowLogs(win.name, win.startMinute, win.endMinute);');
check('windowLogs declaration was located', windowLogsDeclIndex !== -1);
const countBlockEnd = timelineSource.indexOf('{overlapMinutes > 0 &&', windowLogsDeclIndex);
const countBlock = timelineSource.slice(windowLogsDeclIndex, countBlockEnd);

check(
  'a per-window pending count is derived from windowLogs via log.syncStatus',
  /windowPendingCount = windowLogs\.filter\(\(log\) => log\.syncStatus === 'pending'\)\.length/.test(countBlock)
);
check(
  'the rendered count shows "{confirmed} logged · {pending} pending sync" when pending exists',
  /\$\{windowConfirmedCount\} logged · \$\{windowPendingCount\} pending sync/.test(countBlock)
);
check(
  'the rendered count falls back to the simple "{N} logged" form when nothing is pending',
  /\$\{windowLogs\.length\} logged`/.test(countBlock)
);

// ============================================================
// 8. Timeline's own transient quick-log action state (pendingLogged/
// optimisticLogged) is explicitly preserved, not merged with the
// canonical logEntries.syncStatus model.
// ============================================================

check('Timeline still declares its own local pendingLogged state (untouched, per-instructions)', /const \[pendingLogged, setPendingLogged\] = useState<string\[\]>\(\[\]\);/.test(timelineSource));
check('Timeline still declares its own local optimisticLogged state (untouched, per-instructions)', /const \[optimisticLogged, setOptimisticLogged\] = useState<string\[\]>\(\[\]\);/.test(timelineSource));

// ============================================================
// 9/10. Insights -- the local LoggedEntryItem redeclaration is gone;
// the canonical type (with syncStatus) is imported and re-exported.
// ============================================================

check('InsightsView no longer independently declares its own LoggedEntryItem interface', !/export interface LoggedEntryItem \{/.test(insightsSource));
check('InsightsView imports the canonical LoggedEntryItem from CalendarViewSection', /import \{ LoggedEntryItem \} from '\.\/CalendarViewSection';/.test(insightsSource));

// ============================================================
// 11/12. Insights -- every evidence/aggregate calculation inside the
// analytics useMemo uses confirmedLogEntries, never the raw prop.
// ============================================================

const analyticsStart = insightsSource.indexOf('const analytics = useMemo(() => {');
check('the analytics useMemo was located', analyticsStart !== -1);
const analyticsBraceIndex = insightsSource.indexOf('{', insightsSource.indexOf('=> {', analyticsStart));
const analyticsBody = extractBraced(insightsSource, analyticsBraceIndex);

check(
  'confirmedLogEntries is derived once, filtering out syncStatus === \'pending\'',
  /const confirmedLogEntries = logEntries\.filter\(\(entry\) => entry\.syncStatus !== 'pending'\);/.test(analyticsBody)
);

// Every use of the entries collection inside the useMemo body must go
// through confirmedLogEntries -- the ONLY acceptable bare "logEntries."
// reference inside this block is the one defining confirmedLogEntries
// itself.
const bareLogEntriesUsages = (analyticsBody.match(/(?<!confirmed)logEntries\./g) ?? []).length;
check(
  'the analytics useMemo references the raw logEntries prop exactly once (only to define confirmedLogEntries) -- every calculation uses confirmedLogEntries',
  bareLogEntriesUsages === 1
);

const requiredConfirmedOnlyUsages = [
  ['totalActivities', 'const totalActivities = confirmedLogEntries.length;'],
  ['observations map', 'const observations = new Map(confirmedLogEntries.map('],
  ['30-day heatmap dayLogs', 'const dayLogs = confirmedLogEntries.filter((e) => observationOf(e).dateKey === dateKey);'],
  ['past7Logs (7-day alignment)', 'const past7Logs = confirmedLogEntries.filter((e) => past7DateKeySet.has(observationOf(e).dateKey));'],
  ['time-of-day pattern counts', 'confirmedLogEntries.forEach((e) => {'],
  ['streak loggedDaysSet', 'const loggedDaysSet = new Set(confirmedLogEntries.map((entry) => observationOf(entry).dateKey));'],
  ['This Month monthEntries', 'const monthEntries = confirmedLogEntries.filter((e) => isInCalendarMonth(observationOf(e).dateKey, currentYear, currentMonth));'],
  ['window breakdown forEach', 'confirmedLogEntries.forEach((entry) => {'],
  ['resolvedDurations', 'const resolvedDurations = confirmedLogEntries.map((e) => e.durationMinutes ?? 30);'],
];
for (const [label, snippet] of requiredConfirmedOnlyUsages) {
  check(`${label} uses confirmedLogEntries (evidence excludes pending)`, analyticsBody.includes(snippet));
}

// ============================================================
// 12/13. The Recent Activity Trail is the deliberate exception: it may
// still show the full, unfiltered logEntries, but only because pending
// rows are now visibly labeled -- never presented as settled evidence.
// ============================================================

// indexOf('Recent Activity Trail') alone would match this test file's own
// explanatory comment earlier in the source (added by this very fix) --
// anchor on the actual rendered map call instead, which is unique.
const trailMapStart = insightsSource.indexOf('{logEntries.slice(0, 5).map((entry) => (');
check('the Recent Activity Trail section was located', trailMapStart !== -1);
const trailBlock = insightsSource.slice(trailMapStart, trailMapStart + 1500);

check('the Recent Activity Trail still maps over the full, unfiltered logEntries (not confirmedLogEntries)', /\{logEntries\.slice\(0, 5\)\.map\(\(entry\) => \(/.test(trailBlock));
check('a pending entry in the trail is visibly labeled via StatusBadge label="Pending sync"', /entry\.syncStatus === 'pending' && <StatusBadge label="Pending sync" tone="caution" \/>/.test(trailBlock));

// ============================================================
// Regression guards -- PR #86 (direct-log classification/queue) and
// PR #87 (Plan logging) untouched by this presentation-only fix. This
// task did not modify page.tsx at all; these checks read it read-only.
// ============================================================

check('handleLogActivity in page.tsx is unchanged: still returns Promise<\'confirmed\' | \'pending\'>', /Promise<'confirmed' \| 'pending'>/.test(pageSource));
check('handleLogActivity still sets syncStatus: \'pending\' only from the fetch-exception (network failure) branch', /syncStatus: 'pending' \} : item\)\)\);/.test(pageSource));
check('handleLogActivity still clears syncStatus on confirmed success', /syncStatus: undefined,/.test(pageSource));
check('page.tsx still imports classifyHabitLogSyncOutcome for offline-queue replay (PR #86 untouched)', /classifyHabitLogSyncOutcome/.test(pageSource));
check('page.tsx still generates clientRequestId once per log attempt (PR #86 idempotency untouched)', /const clientRequestId = crypto\.randomUUID\(\);/.test(pageSource));
check('Plan logging (handlePlanLogged) remains separate and untouched in page.tsx', /const handlePlanLogged = useCallback\(async \(\) => \{/.test(pageSource));

if (!allPassed) {
  console.error('\nSome Pending Activity Visual Consistency checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PENDING ACTIVITY VISUAL CONSISTENCY CHECKS PASSED');
}
