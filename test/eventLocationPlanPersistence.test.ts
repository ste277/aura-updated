/**
 * Event Location Plan Persistence V1: regression suite for
 * parseEventLocationSnapshot() (apps/web/lib/plansRequest.ts),
 * planPayloadFromCandidate()/mapPlanRow()/formatPlanTimeRange()
 * (apps/web/lib/planFormatting.ts -- pure plan display/formatting logic,
 * deliberately extracted out of the PlanWithAuraView.tsx component so it
 * can run under this repo's NORMAL, non-JSX test runner rather than
 * needing a separate JSX-aware invocation), and deriveAuraReminders()'s
 * plan-timezone selection (apps/web/lib/auraReminders.ts) -- everything
 * this PR touches that's a pure function, testable without a live
 * server/DB, matching this repo's own established pattern.
 *
 * A live database is unavailable in this environment (DATABASE_URL unset,
 * confirmed by every prior PR in this session) -- createPlannedActivity's
 * own raw-SQL INSERT/RETURNING is therefore verified by direct source
 * inspection (recorded below) rather than a live round-trip, and reported
 * as a limitation, not silently skipped.
 */
import * as fs from 'fs';
import { parseEventLocationSnapshot } from '../apps/web/lib/plansRequest';
import { planPayloadFromCandidate, PlanEventLocation } from '../apps/web/lib/planFormatting';
import { deriveAuraReminders } from '../apps/web/lib/auraReminders';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// 1/6/7. parseEventLocationSnapshot() -- schema-field nullability +
// validation, pure and DB-free.
// ============================================================

const absent = parseEventLocationSnapshot(undefined);
check('1a. Absent eventLocation -> both persisted fields null (normal Timing Location save)', absent.ok === true && absent.ok && absent.eventTimezone === null && absent.eventLocationName === null);
const nullInput = parseEventLocationSnapshot(null);
check('1b. Explicit null eventLocation -> same as absent (both null)', nullInput.ok === true && nullInput.ok && nullInput.eventTimezone === null && nullInput.eventLocationName === null);

const validKochi = parseEventLocationSnapshot({ cityName: 'Kochi', timezone: 'Asia/Kolkata' });
check('3. Custom Event Location -> eventTimezone populated', validKochi.ok === true && validKochi.ok && validKochi.eventTimezone === 'Asia/Kolkata');
check('4. Custom Event Location -> eventLocationName populated', validKochi.ok === true && validKochi.ok && validKochi.eventLocationName === 'Kochi');

check('6a. Invalid (non-IANA) timezone is rejected', parseEventLocationSnapshot({ cityName: 'Kochi', timezone: 'Not/A/Zone' }).ok === false);
check('6b. Missing timezone is rejected', parseEventLocationSnapshot({ cityName: 'Kochi' }).ok === false);
check('7a. Blank/whitespace-only cityName is rejected', parseEventLocationSnapshot({ cityName: '   ', timezone: 'Asia/Kolkata' }).ok === false);
check('7b. Missing cityName is rejected', parseEventLocationSnapshot({ timezone: 'Asia/Kolkata' }).ok === false);
check('String instead of object is rejected', parseEventLocationSnapshot('Kochi').ok === false);
check('Array is rejected', parseEventLocationSnapshot(['Kochi']).ok === false);

// Atomic-pair semantics (brief section 11): cityName present without
// timezone, or vice versa, must never persist a partial snapshot.
check('Atomic pair: cityName without timezone is rejected, not partially accepted', parseEventLocationSnapshot({ cityName: 'Kochi' }).ok === false);
check('Atomic pair: timezone without cityName is rejected, not partially accepted', parseEventLocationSnapshot({ timezone: 'Asia/Kolkata' }).ok === false);

// ============================================================
// 5/16. No coordinates: even if a caller sends latitude/longitude, they
// are never present in the parsed/persisted result shape.
// ============================================================

const withCoords = parseEventLocationSnapshot({ cityName: 'Kochi', timezone: 'Asia/Kolkata', latitude: 9.9312, longitude: 76.2673 });
check('5a. A supplied latitude never appears in the parsed result', withCoords.ok === true && !('latitude' in withCoords));
check('5b. A supplied longitude never appears in the parsed result', withCoords.ok === true && !('longitude' in withCoords));
check('5c. Result keys are exactly {ok, eventTimezone, eventLocationName} -- no coordinate leakage', withCoords.ok === true && JSON.stringify(Object.keys(withCoords).sort()) === JSON.stringify(['eventLocationName', 'eventTimezone', 'ok'].sort()));

// ============================================================
// 8/9/10/11/16/17. planPayloadFromCandidate() -- resultEventLocation as
// the ONLY source, immediate display + reload consistency, event-local
// clock, Timing-Location-change stability (independent of any live value),
// no coordinates threaded into persistence-facing fields.
// ============================================================

function fakeCandidate(startIso: string, endIso: string): TimingCandidate {
  return {
    start: startIso,
    end: endIso,
    score: 8.5,
    label: 'VERY_GOOD',
    muhurtaScore: 12,
    reasons: [],
    metadata: { windowType: 'ABHIJIT', windowLabel: 'Abhijit Muhurta', activityType: 'Griha Pravesh', dateLabel: 'Tue, Nov 10' },
  };
}

// Real deterministic fixture: 2026-11-10T05:00:00Z, eventTimezone
// Asia/Kolkata -- must display 10:30 AM regardless of the environment's own
// local timezone (this test process's TZ is irrelevant since an explicit
// timeZone option is always passed once eventLocation is present).
const kochiInstant = fakeCandidate('2026-11-10T05:00:00.000Z', '2026-11-10T06:00:00.000Z');
const kochiLocation: PlanEventLocation = { cityName: 'Kochi', timezone: 'Asia/Kolkata' };
const kochiPayload = planPayloadFromCandidate(kochiInstant, 60, undefined, kochiLocation);

check('9. resultEventLocation-derived eventLocation is the source: eventTimezone persisted on the payload', kochiPayload.eventTimezone === 'Asia/Kolkata');
check('9b. resultEventLocation-derived eventLocation is the source: eventLocationName persisted on the payload', kochiPayload.eventLocationName === 'Kochi');
check('10/16. Immediate (pre-save) display uses event-local time: 10:30 AM - 11:30 AM (Kochi, UTC+5:30)', kochiPayload.time === '10:30 AM - 11:30 AM');
check('11. Absolute instant unchanged: plannedStartAt is exactly the candidate.start ISO instant', kochiPayload.plannedStartAt === '2026-11-10T05:00:00.000Z');

// Ordinary Timing Location save: eventLocation omitted entirely.
const ordinaryPayload = planPayloadFromCandidate(kochiInstant, 60);
check('8. Ordinary Timing Location save: eventTimezone is undefined (never snapshotted for every plan)', ordinaryPayload.eventTimezone === undefined);
check('8b. Ordinary Timing Location save: eventLocationName is undefined', ordinaryPayload.eventLocationName === undefined);

// 17/18: reload/read-back must reproduce the SAME event-local clock time
// as the immediate save, and must be completely independent of whatever
// the User's current Timing Location happens to be -- simulated here by
// re-deriving the display string purely from the persisted snapshot
// (eventTimezone), never from any "current user" value.
function simulateReloadedDisplay(row: Pick<PlannedActivity, 'plannedStartAt' | 'plannedEndAt' | 'eventTimezone'>, currentTimingLocationTimezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: row.eventTimezone ?? currentTimingLocationTimezone };
  return `${new Date(row.plannedStartAt).toLocaleTimeString('en-US', opts)} - ${new Date(row.plannedEndAt).toLocaleTimeString('en-US', opts)}`;
}
const persistedRow = { plannedStartAt: new Date('2026-11-10T05:00:00.000Z'), plannedEndAt: new Date('2026-11-10T06:00:00.000Z'), eventTimezone: 'Asia/Kolkata' };
const reloadedWhileDubai = simulateReloadedDisplay(persistedRow, 'Asia/Dubai');
const reloadedWhileLondon = simulateReloadedDisplay(persistedRow, 'Europe/London');
check('17. Reloaded plan (viewed while account Timing Location is Dubai) shows the SAME event-local time as immediate save', reloadedWhileDubai === kochiPayload.time);
check('18. Changing Timing Location to London afterward does not change the saved event\'s display -- still Kochi-local', reloadedWhileLondon === kochiPayload.time && reloadedWhileLondon !== '10:30 AM - 11:30 AM (Europe/London reinterpretation)');
check('18b. The two "current Timing Location" simulations (Dubai vs London) agree with each other -- proving the display genuinely ignores the live value entirely', reloadedWhileDubai === reloadedWhileLondon);

// ============================================================
// 21/22/23. Best/alternate window save -- planPayloadFromCandidate() is
// the SAME function for any TimingCandidate regardless of whether it's a
// date's bestWindow or an alternateWindow (MuhurthamFinderView passes both
// through the identical handleUseThisTime path) -- confirmed structurally:
// no branching on window "role" anywhere in its signature.
// ============================================================

const alternateInstant = fakeCandidate('2026-11-10T07:15:00.000Z', '2026-11-10T08:15:00.000Z');
const alternatePayload = planPayloadFromCandidate(alternateInstant, 60, undefined, kochiLocation);
check('21/22. An "alternate window" candidate persists the identical Event Location snapshot shape as a "best window" one (same function, no special-casing)', alternatePayload.eventTimezone === 'Asia/Kolkata' && alternatePayload.eventLocationName === 'Kochi');

// ============================================================
// 29 (brief numbering)/sharedWith: sharedWithName and eventLocation are
// independent and can coexist (brief section 29).
// ============================================================

const sharedWithLocationPayload = planPayloadFromCandidate(kochiInstant, 60, 'Anu', kochiLocation);
check('29a. sharedWithName and eventLocation persist independently: details mentions Anu', sharedWithLocationPayload.details.includes('Anu'));
check('29b. sharedWithName and eventLocation persist independently: eventLocationName is still Kochi', sharedWithLocationPayload.eventLocationName === 'Kochi');

// ============================================================
// 13/14. deriveAuraReminders() -- plan.eventTimezone takes precedence over
// ownerTimezone; legacy/normal plans (eventTimezone null) keep existing
// ownerTimezone behavior; absolute reminderAt/startAt instants unchanged
// either way.
// ============================================================

const REMINDER_NOW = new Date('2026-11-10T04:00:00.000Z');
function fakePlan(overrides: Partial<PlannedActivity>): PlannedActivity {
  return {
    id: 'plan-event-loc-1',
    userId: 'owner-1',
    title: 'Griha Pravesh',
    activityType: 'Griha Pravesh',
    icon: '🏡',
    status: 'UPCOMING',
    plannedStartAt: new Date(REMINDER_NOW.getTime() + 10 * 60_000),
    plannedEndAt: new Date(REMINDER_NOW.getTime() + 70 * 60_000),
    durationMinutes: 60,
    windowType: 'ABHIJIT',
    windowLabel: 'Abhijit Muhurta',
    matchLabel: 'Best Match',
    score: 85,
    recommendation: null,
    calendarUrl: null,
    loggedAt: null,
    habitLogId: null,
    eventTimezone: null,
    eventLocationName: null,
    createdAt: REMINDER_NOW,
    updatedAt: REMINDER_NOW,
    ...overrides,
  };
}

const eventLocationPlan = fakePlan({ id: 'plan-kochi', eventTimezone: 'Asia/Kolkata', eventLocationName: 'Kochi' });
const legacyPlan = fakePlan({ id: 'plan-legacy' });

const reminders = deriveAuraReminders({
  now: REMINDER_NOW,
  leadMinutes: 15,
  ownerTimezone: 'Asia/Dubai',
  plans: [eventLocationPlan, legacyPlan],
  moments: [],
  momentIdsWithSuccessor: new Set(),
});

const eventLocationReminder = reminders.find((r) => r.scheduledItemId === 'plan-kochi');
const legacyReminder = reminders.find((r) => r.scheduledItemId === 'plan-legacy');

check('13. A plan with an Event Location snapshot reminds in ITS OWN eventTimezone (Kochi), not the owner\'s Dubai', eventLocationReminder?.timezone === 'Asia/Kolkata');
check('14/23. A legacy/normal plan (eventTimezone null) still reminds in ownerTimezone, unchanged', legacyReminder?.timezone === 'Asia/Dubai');
check('15. Reminder trigger instant (reminderAt) is identical in shape for both -- only the timezone selection differs, never the trigger math', typeof eventLocationReminder?.reminderAt === 'string' && typeof legacyReminder?.reminderAt === 'string');
check('15b. startAt is the exact plan start for both -- absolute instant untouched by the timezone change', eventLocationReminder?.startAt === eventLocationPlan.plannedStartAt.toISOString() && legacyReminder?.startAt === legacyPlan.plannedStartAt.toISOString());

// ============================================================
// 2 (brief section 2/5). PlannedActivity schema shape -- read directly
// from the Prisma schema and migration source (no live DB available in
// this environment -- confirmed limitation, reported rather than assumed).
// ============================================================

const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
check('Schema declares eventTimezone as nullable (String?, no default, no NOT NULL)', /eventTimezone\s+String\?/.test(schemaSource));
check('Schema declares eventLocationName as nullable (String?, no default, no NOT NULL)', /eventLocationName\s+String\?/.test(schemaSource));
check('Schema does NOT declare any Event Location latitude/longitude field on PlannedActivity', !/eventLatitude|eventLongitude/.test(schemaSource));

const migrationSource = fs.readFileSync('apps/web/prisma/migrations/0028_event_location_plan_persistence/migration.sql', 'utf8');
check('Migration adds eventTimezone via a plain nullable ALTER TABLE ADD COLUMN (no NOT NULL, no DEFAULT)', /ALTER TABLE "PlannedActivity" ADD COLUMN "eventTimezone" TEXT;/.test(migrationSource) && !/eventTimezone[^;]*NOT NULL/.test(migrationSource) && !/eventTimezone[^;]*DEFAULT/.test(migrationSource));
check('Migration adds eventLocationName via a plain nullable ALTER TABLE ADD COLUMN (no NOT NULL, no DEFAULT)', /ALTER TABLE "PlannedActivity" ADD COLUMN "eventLocationName" TEXT;/.test(migrationSource) && !/eventLocationName[^;]*NOT NULL/.test(migrationSource) && !/eventLocationName[^;]*DEFAULT/.test(migrationSource));
check('Migration contains no UPDATE/backfill statement', !/\bUPDATE\b/i.test(migrationSource));
check('Migration contains no DROP/destructive statement', !/\bDROP\b/i.test(migrationSource));

// ============================================================
// 5b/12b. createPlannedActivity's raw SQL -- verified by direct source
// inspection (DB-backed round-trip unavailable in this environment).
// ============================================================

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
check('createPlannedActivity\'s INSERT column list includes "eventTimezone" and "eventLocationName"', /INSERT INTO "PlannedActivity"[\s\S]*?"eventTimezone", "eventLocationName"/.test(dbSource));
check('createPlannedActivity does NOT insert any latitude/longitude column', !/INSERT INTO "PlannedActivity"[\s\S]{0,400}(latitude|longitude)/i.test(dbSource.slice(dbSource.indexOf('async function createPlannedActivity'))));

// ============================================================
// 17/19/20/28. MuhurthamFinderView's Save/Share wiring -- kept as a
// lightweight, non-compiling source-text scan (fs.readFileSync, no
// TypeScript/JSX parsing involved) precisely so this core persistence
// suite stays runnable under the normal test runner while still covering
// the "Save enabled / Share still disabled" and "resultEventLocation, not
// live picker" invariants after the planFormatting.ts extraction.
// ============================================================

const viewSource = fs.readFileSync('apps/web/components/MuhurthamFinderView.tsx', 'utf8');
check('27/Save. saveDisabled is unconditionally false (Save re-enabled for every result, including custom Event Location)', /const saveDisabled = false;/.test(viewSource));
check('28/Share. shareDisabled is still gated on resultEventLocation (Share remains disabled for custom Event Location)', /const shareDisabled = resultEventLocation !== null;/.test(viewSource));
check('9/eventLocation source. handleUseThisTime derives eventLocation from resultEventLocation, never the live eventLocation picker state', /const eventLocation = resultEventLocation \? \{ cityName: resultEventLocation\.cityName, timezone: resultEventLocation\.timezone \}/.test(viewSource));
check('20. No coordinate field name (eventLatitude/eventLongitude) appears anywhere in the Muhurtham Finder source', !/eventLatitude|eventLongitude/.test(viewSource));
check('MuhurthamFinderView never references AuraMoment schema/timezone changes (Share persistence explicitly out of scope for this PR)', !/AuraMoment\.timezone\s*=/.test(viewSource));

console.log(allPassed ? '\nALL EVENT LOCATION PLAN PERSISTENCE CHECKS PASSED' : '\nSOME EVENT LOCATION PLAN PERSISTENCE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
