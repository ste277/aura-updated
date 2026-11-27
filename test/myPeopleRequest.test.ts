/**
 * AURA-MP-1 -- pure validation suite for the My People API contracts and
 * the feature switch (no database). Covers:
 *   - the switch: fail-closed in production, on by default locally;
 *   - CREATE, both contracts: legacy (switch off) = chart required, five
 *     original types, My People keys rejected; My People (on) = name only;
 *   - UPDATE is PARTIAL in both contracts: no chart keys = chart untouched;
 *     a partial chart is always a 400; `chart: null` clears (on only);
 *   - special-day validation: unknown year, 29 Feb, 31 Apr, year range,
 *     OTHER needs a label, remindDaysBefore range, unknown keys rejected.
 */
import { isMyPeopleEnabled } from '../apps/web/lib/myPeopleGate';
import {
  buildPersonOccasionInput,
  buildSavedPersonCreateInput,
  buildSavedPersonInput,
  buildSavedPersonUpdate,
  parsePersonOccasionFields,
  validatePersonOccasion,
} from '../apps/web/lib/savedPersonRequest';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const ON = { myPeopleEnabled: true };
const OFF = { myPeopleEnabled: false };
const CHART = { birthDate: '1992-03-14', birthTime: '08:15', birthTimezone: 'Asia/Kolkata', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707 };

// ---------------- Switch ----------------
check('switch: production + unset -> OFF (fail-closed)', isMyPeopleEnabled({ NODE_ENV: 'production' }) === false);
check('switch: production + "true"/"yes"/"0" -> OFF (only "1" enables)', ['true', 'yes', '0', ''].every((v) => isMyPeopleEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_AURA_MY_PEOPLE: v }) === false));
check('switch: production + "1" -> ON', isMyPeopleEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_AURA_MY_PEOPLE: '1' }) === true);
check('switch: local/dev/test + unset -> ON', isMyPeopleEnabled({ NODE_ENV: 'development' }) === true && isMyPeopleEnabled({}) === true);
check('switch: local/dev + "0" -> OFF (lets a developer exercise the rollback state)', isMyPeopleEnabled({ NODE_ENV: 'development', NEXT_PUBLIC_AURA_MY_PEOPLE: '0' }) === false);

// ---------------- CREATE: legacy contract (switch off) ----------------
{
  const r = buildSavedPersonCreateInput({ name: 'Ravi' }, OFF);
  check('OFF: name-only create is rejected exactly as today (birthDate error)', !r.ok && r.status === 400 && r.error === 'birthDate must be YYYY-MM-DD.');
  const full = buildSavedPersonCreateInput({ name: 'Anu', relationshipType: 'PARTNER', ...CHART }, OFF);
  check('OFF: a full legacy body is accepted unchanged', full.ok && full.input.birthDate === '1992-03-14' && full.input.birthTime === '08:15' && full.input.relationshipType === 'PARTNER');
  check('OFF: buildSavedPersonInput (the original validator) == the legacy contract', JSON.stringify(buildSavedPersonInput({ name: 'Anu', relationshipType: 'PARTNER', ...CHART })) === JSON.stringify(full));
  const newType = buildSavedPersonCreateInput({ name: 'Amma', relationshipType: 'PARENT', ...CHART }, OFF);
  check('OFF: a My People relationship type (PARENT) is rejected', !newType.ok && newType.status === 400);
  for (const key of ['notes', 'interests', 'relationshipLabel', 'locationName', 'timezone', 'chart']) {
    const body: Record<string, unknown> = { name: 'Anu', ...CHART, [key]: key === 'interests' ? ['x'] : key === 'chart' ? CHART : 'x' };
    if (key === 'chart') for (const k of Object.keys(CHART)) delete body[k];
    const res = buildSavedPersonCreateInput(body, OFF);
    check(`OFF: My People-only key "${key}" is rejected with 400`, !res.ok && res.status === 400);
  }
}

// ---------------- CREATE: My People contract (switch on) ----------------
{
  const r = buildSavedPersonCreateInput({ name: '  Ravi  ' }, ON);
  check('ON: name-only create is accepted, name trimmed, relationship defaults to OTHER, no chart', r.ok && r.input.name === 'Ravi' && r.input.relationshipType === 'OTHER' && r.input.birthDate === undefined && r.input.birthTime === undefined);
  check('ON: empty name rejected', !buildSavedPersonCreateInput({ name: '   ' }, ON).ok);
  check('ON: 81-char name rejected', !buildSavedPersonCreateInput({ name: 'x'.repeat(81) }, ON).ok);
  const all = buildSavedPersonCreateInput({ name: 'Amma', relationshipType: 'PARENT', relationshipLabel: ' Amma ', locationName: 'Madurai', timezone: 'Asia/Kolkata', interests: ['Filter coffee', 'filter coffee', ' ', 'Carnatic music'], notes: ' Moving in Jan ', chart: CHART }, ON);
  check('ON: every optional field accepted; strings trimmed; interests de-duplicated case-insensitively and blanks dropped', all.ok && all.input.relationshipType === 'PARENT' && all.input.relationshipLabel === 'Amma' && all.input.locationName === 'Madurai' && all.input.timezone === 'Asia/Kolkata' && JSON.stringify(all.input.interests) === JSON.stringify(['Filter coffee', 'Carnatic music']) && all.input.notes === 'Moving in Jan' && all.input.birthDate === '1992-03-14');
  check('ON: CHILD and SIBLING accepted', buildSavedPersonCreateInput({ name: 'A', relationshipType: 'CHILD' }, ON).ok && buildSavedPersonCreateInput({ name: 'B', relationshipType: 'SIBLING' }, ON).ok);
  check('ON: an unknown relationship type is still rejected', !buildSavedPersonCreateInput({ name: 'A', relationshipType: 'COLLEAGUE' }, ON).ok);
  check('ON: invalid timezone rejected ("UTC+5:30", "Mars/Base")', !buildSavedPersonCreateInput({ name: 'A', timezone: 'UTC+5:30' }, ON).ok && !buildSavedPersonCreateInput({ name: 'A', timezone: 'Mars/Base' }, ON).ok);
  check('ON: 11 interests rejected; a 41-char interest rejected; a non-array rejected', !buildSavedPersonCreateInput({ name: 'A', interests: Array.from({ length: 11 }, (_, i) => `i${i}`) }, ON).ok && !buildSavedPersonCreateInput({ name: 'A', interests: ['x'.repeat(41)] }, ON).ok && !buildSavedPersonCreateInput({ name: 'A', interests: 'cricket' }, ON).ok);
  check('ON: notes over 1000 chars rejected; 1000 accepted', !buildSavedPersonCreateInput({ name: 'A', notes: 'x'.repeat(1001) }, ON).ok && buildSavedPersonCreateInput({ name: 'A', notes: 'x'.repeat(1000) }, ON).ok);
  check('ON: a PARTIAL flat chart (birthDate only) is rejected -- never half-written', !buildSavedPersonCreateInput({ name: 'A', birthDate: '1992-03-14' }, ON).ok);
  check('ON: a partial chart object is rejected', !buildSavedPersonCreateInput({ name: 'A', chart: { birthDate: '1992-03-14', birthTime: '08:15' } }, ON).ok);
  check('ON: chart object AND flat fields together are rejected', !buildSavedPersonCreateInput({ name: 'A', chart: CHART, birthDate: '1992-03-14' }, ON).ok);
}

// ---------------- UPDATE: always partial ----------------
{
  for (const opts of [OFF, ON]) {
    const tag = opts.myPeopleEnabled ? 'ON' : 'OFF';
    const nameOnly = buildSavedPersonUpdate({ name: 'Ravi K' }, opts);
    check(`${tag}: PATCH {name} -> update has ONLY name (chart and every other field untouched)`, nameOnly.ok && JSON.stringify(nameOnly.update) === JSON.stringify({ name: 'Ravi K' }));
    const legacyFull = buildSavedPersonUpdate({ name: 'Anu', relationshipType: 'PARTNER', ...CHART }, opts);
    check(`${tag}: a legacy full body replaces the chart whole (exactly today's edit)`, legacyFull.ok && legacyFull.update.chart?.birthDate === '1992-03-14' && legacyFull.update.chart?.birthTimezone === 'Asia/Kolkata' && legacyFull.update.name === 'Anu');
    check(`${tag}: a partial flat chart in PATCH is a 400 (cannot clear or half-write a chart)`, !buildSavedPersonUpdate({ birthTime: '09:00' }, opts).ok && !buildSavedPersonUpdate({ birthDate: '1992-03-14', birthTime: '09:00' }, opts).ok);
    check(`${tag}: an empty PATCH is a valid no-op`, (() => { const r = buildSavedPersonUpdate({}, opts); return r.ok && Object.keys(r.update).length === 0; })());
  }
  check('OFF: PATCH with a My People key (notes) is rejected, so the legacy screen can never write them', !buildSavedPersonUpdate({ notes: 'x' }, OFF).ok);
  check('OFF: PATCH chart:null is rejected (the legacy screen cannot clear a chart)', !buildSavedPersonUpdate({ chart: null }, OFF).ok);
  const clear = buildSavedPersonUpdate({ chart: null }, ON);
  check('ON: PATCH chart:null clears the chart (explicit only)', clear.ok && clear.update.chart === null);
  const clearNotes = buildSavedPersonUpdate({ notes: null, interests: null, relationshipLabel: '' }, ON);
  check('ON: notes:null / interests:null / empty label clear those fields', clearNotes.ok && clearNotes.update.notes === null && JSON.stringify(clearNotes.update.interests) === '[]' && clearNotes.update.relationshipLabel === null);
}

// ---------------- Special days ----------------
{
  const Y = 2026;
  const ok = (body: Record<string, unknown>) => buildPersonOccasionInput(body, Y);
  const bday = ok({ kind: 'BIRTHDAY', month: 12, day: 5 });
  check('special day: birthday with no year accepted; default lead time 7 days', bday.ok && bday.input.year === null && bday.input.remindDaysBefore === 7);
  check('special day: 29 Feb with no year accepted', ok({ kind: 'BIRTHDAY', month: 2, day: 29 }).ok);
  check('special day: 29 Feb 1992 (leap) accepted; 29 Feb 1991 rejected', ok({ kind: 'BIRTHDAY', month: 2, day: 29, year: 1992 }).ok && !ok({ kind: 'BIRTHDAY', month: 2, day: 29, year: 1991 }).ok);
  check('special day: 31 Apr rejected; 30 Feb rejected; 31 Dec accepted', !ok({ kind: 'BIRTHDAY', month: 4, day: 31 }).ok && !ok({ kind: 'BIRTHDAY', month: 2, day: 30 }).ok && ok({ kind: 'BIRTHDAY', month: 12, day: 31 }).ok);
  check('special day: month 0 / 13 rejected; day 0 rejected; non-integers rejected', !ok({ kind: 'BIRTHDAY', month: 0, day: 1 }).ok && !ok({ kind: 'BIRTHDAY', month: 13, day: 1 }).ok && !ok({ kind: 'BIRTHDAY', month: 1, day: 0 }).ok && !ok({ kind: 'BIRTHDAY', month: 1.5, day: 1 }).ok && !ok({ kind: 'BIRTHDAY', month: '1', day: 1 }).ok);
  check('special day: year 1899 and next year rejected; 1900 and this year accepted', !ok({ kind: 'ANNIVERSARY', month: 1, day: 1, year: 1899 }).ok && !ok({ kind: 'ANNIVERSARY', month: 1, day: 1, year: Y + 1 }).ok && ok({ kind: 'ANNIVERSARY', month: 1, day: 1, year: 1900 }).ok && ok({ kind: 'ANNIVERSARY', month: 1, day: 1, year: Y }).ok);
  check('special day: OTHER requires a label', !ok({ kind: 'OTHER', month: 6, day: 1 }).ok && ok({ kind: 'OTHER', label: 'Graduation', month: 6, day: 1 }).ok);
  check('special day: remindDaysBefore null (never ahead), 0 (on the day) and 30 accepted; -1 and 31 rejected', ok({ kind: 'BIRTHDAY', month: 1, day: 1, remindDaysBefore: null }).ok && ok({ kind: 'BIRTHDAY', month: 1, day: 1, remindDaysBefore: 0 }).ok && ok({ kind: 'BIRTHDAY', month: 1, day: 1, remindDaysBefore: 30 }).ok && !ok({ kind: 'BIRTHDAY', month: 1, day: 1, remindDaysBefore: -1 }).ok && !ok({ kind: 'BIRTHDAY', month: 1, day: 1, remindDaysBefore: 31 }).ok);
  check('special day: kind, month and day are required on create; unknown kind rejected', !ok({ month: 1, day: 1 }).ok && !ok({ kind: 'BIRTHDAY', day: 1 }).ok && !ok({ kind: 'PUJA', month: 1, day: 1 }).ok);
  check('special day: an unknown key (e.g. calendar, personId) is rejected -- calendar types are not client-writable yet', !parsePersonOccasionFields({ calendar: 'TITHI' }).ok && !parsePersonOccasionFields({ savedPersonId: 'x' }).ok);
  check('special day: merged-update validation catches a year that makes an existing 29 Feb invalid', validatePersonOccasion({ kind: 'BIRTHDAY', month: 2, day: 29, year: 2023, label: null, remindDaysBefore: 7 }, Y) !== null);
}

// ---------------- Route rendering ----------------
// Every My People route reads the switch PER REQUEST. A route Next.js
// prerenders at build time would freeze the build-time switch state (e.g. a
// 404) into the deployment, so each must opt out explicitly.
{
  const fs = require('fs');
  const path = require('path');
  const routes = [
    'app/api/people/route.ts',
    'app/api/people/[personId]/route.ts',
    'app/api/people/[personId]/occasions/route.ts',
    'app/api/people/[personId]/occasions/[occasionId]/route.ts',
    'app/api/people/occasions/upcoming/route.ts',
  ];
  const missing = routes.filter((r) => !/^export const dynamic = 'force-dynamic';$/m.test(fs.readFileSync(path.join(__dirname, '../apps/web', r), 'utf8')));
  check('every My People route is force-dynamic (never prerendered with a build-time switch state)', missing.length === 0, );
  if (missing.length) console.log('  missing:', missing.join(', '));
}

if (!allPassed) {
  console.error('\nSOME MY PEOPLE REQUEST CHECKS FAILED');
  process.exit(1);
}
console.log('\nALL MY PEOPLE REQUEST CHECKS PASSED');
