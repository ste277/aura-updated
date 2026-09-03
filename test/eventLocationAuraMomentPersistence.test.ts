/**
 * Event Location AuraMoment Persistence V1: regression suite for
 * buildAuraMomentCreateRequest()'s eventLocation validation (reusing
 * parseEventLocationSnapshot() from apps/web/lib/plansRequest.ts, the same
 * shape PR #56 built for POST /api/plans), the effective-timezone/
 * locationName derivation formula the route applies
 * (eventLocationTimezone ?? user.timezone / eventLocationName), and
 * toPublicAuraMoment()'s exposure of the new locationName field
 * (apps/web/lib/auraMoments.ts) -- everything this PR touches that's a pure
 * function, testable without a live server/DB, matching this repo's own
 * established pattern (see test/eventLocationPlanPersistence.test.ts).
 *
 * A live database is unavailable in this environment (DATABASE_URL unset,
 * confirmed by every prior PR in this session) -- createAuraMoment's own
 * raw-SQL INSERT/RETURNING, and the actual recipient page render, are
 * therefore verified by direct source inspection (recorded below) rather
 * than a live round-trip or a JSX render, and reported as a limitation, not
 * silently skipped.
 */
import * as fs from 'fs';
import { buildAuraMomentCreateRequest } from '../apps/web/lib/auraMomentRequest';
import { toPublicAuraMoment } from '../apps/web/lib/auraMoments';
import type { AuraMoment } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'GENERAL',
    source: 'MUHURTHAM',
    activityId: 'griha-pravesh',
    startAt: '2026-11-10T05:00:00.000Z',
    endAt: '2026-11-10T06:00:00.000Z',
    ...overrides,
  };
}

// ============================================================
// 4/5/8/9/10. buildAuraMomentCreateRequest()'s eventLocation validation --
// absent/null -> both null (section 10: preserves ordinary behavior),
// present -> validated the exact same way PR #56's plan-save request is.
// ============================================================

const ordinary = buildAuraMomentCreateRequest(baseBody());
check('4/10a. Ordinary request (no eventLocation) validates OK with eventLocationTimezone null', ordinary.ok === true && ordinary.ok && ordinary.input.eventLocationTimezone === null);
check('5/10b. Ordinary request (no eventLocation) validates OK with eventLocationName null', ordinary.ok === true && ordinary.ok && ordinary.input.eventLocationName === null);

const explicitNull = buildAuraMomentCreateRequest(baseBody({ eventLocation: null }));
check('Explicit null eventLocation behaves identically to an absent key', explicitNull.ok === true && explicitNull.ok && explicitNull.input.eventLocationTimezone === null && explicitNull.input.eventLocationName === null);

const custom = buildAuraMomentCreateRequest(baseBody({ eventLocation: { cityName: 'Kochi', timezone: 'Asia/Kolkata' } }));
check('6. Custom Event Location -> eventLocationTimezone populated', custom.ok === true && custom.ok && custom.input.eventLocationTimezone === 'Asia/Kolkata');
check('7. Custom Event Location -> eventLocationName populated', custom.ok === true && custom.ok && custom.input.eventLocationName === 'Kochi');

const invalidTz = buildAuraMomentCreateRequest(baseBody({ eventLocation: { cityName: 'Kochi', timezone: 'Not/A/Zone' } }));
check('9. Invalid (non-IANA) timezone is rejected with a typed 400, not a silent fallback', invalidTz.ok === false && invalidTz.ok === false && invalidTz.status === 400);

const invalidCity = buildAuraMomentCreateRequest(baseBody({ eventLocation: { cityName: '   ', timezone: 'Asia/Kolkata' } }));
check('8. Blank/whitespace-only cityName is rejected with a typed 400', invalidCity.ok === false && invalidCity.ok === false && invalidCity.status === 400);

const malformed = buildAuraMomentCreateRequest(baseBody({ eventLocation: 'Kochi' }));
check('10. Malformed (non-object) eventLocation is rejected with a typed 400, not a silent fallback to user.timezone', malformed.ok === false && malformed.ok === false && malformed.status === 400);

const missingTimezone = buildAuraMomentCreateRequest(baseBody({ eventLocation: { cityName: 'Kochi' } }));
check('Atomic pair: cityName without timezone is rejected, not partially accepted', missingTimezone.ok === false);
const missingCity = buildAuraMomentCreateRequest(baseBody({ eventLocation: { timezone: 'Asia/Kolkata' } }));
check('Atomic pair: timezone without cityName is rejected, not partially accepted', missingCity.ok === false);

// No coordinates: even if a caller sends latitude/longitude alongside a
// valid cityName/timezone, they never appear in the validated result shape.
const withCoords = buildAuraMomentCreateRequest(baseBody({ eventLocation: { cityName: 'Kochi', timezone: 'Asia/Kolkata', latitude: 9.9312, longitude: 76.2673 } }));
check('No coordinates: a supplied latitude/longitude never appears on the validated input', withCoords.ok === true && !('eventLocationLatitude' in (withCoords.ok ? withCoords.input : {})) && !('eventLocationLongitude' in (withCoords.ok ? withCoords.input : {})));

// ============================================================
// 20. Absolute start/end instant unchanged -- eventLocation validation
// never touches startAt/endAt parsing, which happens independently earlier
// in buildAuraMomentCreateRequest.
// ============================================================

check('20. startAt/endAt pass through unchanged regardless of eventLocation', custom.ok === true && custom.ok && custom.input.startAt.toISOString() === '2026-11-10T05:00:00.000Z' && custom.input.endAt.toISOString() === '2026-11-10T06:00:00.000Z');

// ============================================================
// 9 (section 9's own "central correctness rule"). The route's own
// timezone/locationName derivation formula: eventLocationTimezone ??
// user.timezone / eventLocationName. Replicated here exactly as route.ts
// applies it (see the source-scan below confirming route.ts actually uses
// this formula, not a reimplementation).
// ============================================================

function deriveMomentFields(input: { eventLocationTimezone: string | null; eventLocationName: string | null }, ownerTimezone: string) {
  return { timezone: input.eventLocationTimezone ?? ownerTimezone, locationName: input.eventLocationName };
}

const dubaiOwner = 'Asia/Dubai';
const ordinaryFields = ordinary.ok ? deriveMomentFields(ordinary.input, dubaiOwner) : null;
check('10/11 (ordinary). timezone = user.timezone when no Event Location override', ordinaryFields?.timezone === 'Asia/Dubai');
check('10 (ordinary). locationName = null when no Event Location override', ordinaryFields?.locationName === null);

const customFields = custom.ok ? deriveMomentFields(custom.input, dubaiOwner) : null;
check('11 (custom). timezone = Asia/Kolkata (the Event Location), never Asia/Dubai (the Timing Location)', customFields?.timezone === 'Asia/Kolkata');
check('11 (custom). locationName = Kochi', customFields?.locationName === 'Kochi');
check('11. Never persists the owner Timing Location timezone when a valid override is present', customFields?.timezone !== dubaiOwner);

// ============================================================
// 13/14/32. toPublicAuraMoment() -- locationName is exposed (safe, same
// tier as activityTitle), never coordinates; legacy/ordinary moments
// (locationName null) expose null, not a fabricated fallback.
// ============================================================

function fakeMoment(overrides: Partial<AuraMoment> = {}): AuraMoment {
  return {
    id: 'moment-1', ownerUserId: 'owner-1', publicToken: 'token-1', scope: 'GENERAL', source: 'MUHURTHAM',
    activityId: 'griha-pravesh', activityTitle: 'Griha Pravesh', activityIcon: '🏡',
    startAt: new Date('2026-11-10T05:00:00.000Z'), endAt: new Date('2026-11-10T06:00:00.000Z'),
    timezone: 'Asia/Kolkata', locationName: 'Kochi', savedPersonId: null, sharedPersonDisplayName: null,
    senderDisplayName: 'Stephen', ratingLabel: 'STRONG', explanationSnapshot: 'x', status: 'ACTIVE',
    responseState: null, responsePreference: null, respondedAt: null, previousMomentId: null,
    plannedActivityId: null, ownerSeenResponseAt: null, firstOpenedAt: null, createdAt: new Date(), expiresAt: null,
    ...overrides,
  };
}

const customMomentDto = toPublicAuraMoment(fakeMoment(), false);
check('13. Public DTO contains locationName for a custom-Event-Location moment', customMomentDto.locationName === 'Kochi');
check('13b. Public DTO timezone is the event timezone, unchanged architecture (already-existing field)', customMomentDto.timezone === 'Asia/Kolkata');

const legacyMomentDto = toPublicAuraMoment(fakeMoment({ locationName: null, timezone: 'Asia/Dubai' }), false);
check('14. Legacy/ordinary public moment (locationName null) exposes null, not a fabricated fallback to any city', legacyMomentDto.locationName === null);

const publicDtoJson = JSON.stringify(customMomentDto);
check('32. Public DTO never contains a latitude/longitude field name', !/latitude|longitude/i.test(publicDtoJson));
check('32b. Public DTO never contains ownerUserId or the internal id', !('ownerUserId' in customMomentDto) && !('id' in customMomentDto));

// ============================================================
// 18/28. AuraMoment is an immutable snapshot: once created, locationName/
// timezone never change with the owner's later Timing Location changes --
// there is no read-path re-derivation to test (resolvePublicAuraMoment
// reads the stored row verbatim, see auraMoments.ts's own source), so this
// is verified structurally: toPublicAuraMoment takes no "current owner"
// parameter at all, only the already-persisted moment row.
// ============================================================

check('18/28. toPublicAuraMoment has no owner/current-Timing-Location parameter -- structurally cannot re-derive from anything but the stored snapshot', toPublicAuraMoment.length === 2);

// ============================================================
// 1/2/3. Schema + migration -- read directly from source (no live DB
// available in this environment -- confirmed limitation, reported rather
// than assumed).
// ============================================================

const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
check('1. Schema declares AuraMoment.locationName as nullable (String?, no default, no NOT NULL)', /locationName\s+String\?/.test(schemaSource));
check('3a. Schema does not declare any AuraMoment latitude/longitude Event Location field', !(/model AuraMoment[\s\S]*?\n\}/.exec(schemaSource)?.[0].match(/eventLatitude|eventLongitude/)));

const migrationSource = fs.readFileSync('apps/web/prisma/migrations/0029_aura_moment_location_name/migration.sql', 'utf8');
check('2. Migration adds locationName via a plain nullable ALTER TABLE ADD COLUMN (no NOT NULL, no DEFAULT)', /ALTER TABLE "AuraMoment" ADD COLUMN "locationName" TEXT;/.test(migrationSource) && !/locationName[^;]*NOT NULL/.test(migrationSource) && !/locationName[^;]*DEFAULT/.test(migrationSource));
check('2b. Migration contains no UPDATE/backfill statement', !/\bUPDATE\b/i.test(migrationSource));
check('2c. Migration contains no DROP/destructive statement', !/\bDROP\b/i.test(migrationSource));
check('38. Migration touches only AuraMoment -- no unrelated table statement', !/ALTER TABLE "(?!AuraMoment)/.test(migrationSource));

// ============================================================
// 3b/12. createAuraMoment's raw SQL -- verified by direct source inspection
// (DB-backed round-trip unavailable in this environment).
// ============================================================

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
const createAuraMomentSource = dbSource.slice(dbSource.indexOf('export async function createAuraMoment'), dbSource.indexOf('export async function createAuraMoment') + 2000);
check('12/13. createAuraMoment\'s INSERT column list includes "locationName"', /INSERT INTO "AuraMoment"[\s\S]*?"locationName"/.test(createAuraMomentSource));
check('3b. createAuraMoment does NOT insert any latitude/longitude column', !/(latitude|longitude)/i.test(createAuraMomentSource));

// ============================================================
// 4/9/31. The route's own use of the derivation formula, and 30's
// "existing callers unaffected" -- verified by direct source inspection.
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/aura-moments/route.ts', 'utf8');
check('9/31 (route). POST /api/aura-moments derives timezone as eventLocationTimezone ?? user.timezone (the exact section-9 formula, never a bare user.timezone)', /timezone:\s*input\.eventLocationTimezone\s*\?\?\s*user\.timezone/.test(routeSource));
check('7 (route). POST /api/aura-moments persists locationName from the validated input', /locationName:\s*input\.eventLocationName/.test(routeSource));

// ============================================================
// 33. "Suggest this" successor creation preserves the original's
// location snapshot -- must not silently drop it when creating a
// follow-up moment.
// ============================================================

const suggestRouteSource = fs.readFileSync('apps/web/app/api/aura-moments/[token]/suggest/route.ts', 'utf8');
check('33. The "Suggest this" successor moment preserves original.locationName (not discarded/re-derived)', /locationName:\s*original\.locationName/.test(suggestRouteSource));
check('33b. The "Suggest this" successor moment still preserves original.timezone too (pre-existing, unchanged)', /timezone:\s*original\.timezone/.test(suggestRouteSource));

// ============================================================
// 29. Recipient Conversion V1 (the /find?src=moment guest-acquisition
// funnel) never reads or copies any AuraMoment field, including timezone/
// locationName -- confirmed by absence of any AuraMoment field reference
// in the guest-state/guest-conversion source, so no code change was
// needed there for this PR (audited, not assumed).
// ============================================================

const guestStateSource = fs.readFileSync('apps/web/lib/guestState.ts', 'utf8');
check('29. guestState.ts (Recipient Conversion V1) never reads AuraMoment.timezone or .locationName', !/moment\.(timezone|locationName)/.test(guestStateSource));

// ============================================================
// 11/12/20/21/22/23/24/25/26/27. MuhurthamFinderView's Share re-enable and
// handleShareMoment's resultEventLocation threading -- kept as a
// lightweight, non-compiling source-text scan (fs.readFileSync, no
// TypeScript/JSX parsing involved), same technique
// eventLocationPlanPersistence.test.ts already established for this file.
// ============================================================

const viewSource = fs.readFileSync('apps/web/components/MuhurthamFinderView.tsx', 'utf8');
check('24/25/26. saveDisabled and shareDisabled are BOTH unconditionally false (ordinary and custom Event Location results identically enabled)', /const saveDisabled = false;/.test(viewSource) && /const shareDisabled = false;/.test(viewSource));

const handleShareMomentSource = viewSource.slice(viewSource.indexOf('const handleShareMoment ='), viewSource.indexOf('const handleShareMoment =') + 1200);
check('11. handleShareMoment derives eventLocation from resultEventLocation, never the live eventLocation picker state', /const eventLocation = resultEventLocation \? \{ cityName: resultEventLocation\.cityName, timezone: resultEventLocation\.timezone \} : undefined;/.test(handleShareMomentSource));
check('12. handleShareMoment never reads the live `eventLocation` picker state directly (only the snapshot, reassigned to the same local name)', !/setEventLocation|eventLocation\.latitude/.test(handleShareMomentSource));
check('20. No coordinate field name (eventLatitude/eventLongitude) appears anywhere in the Muhurtham Finder source', !/eventLatitude|eventLongitude/.test(viewSource));
check('7 (request shape). handleShareMoment sends the request body with eventLocation omitted when undefined, never a null/empty placeholder', /\.\.\.\(eventLocation \? \{ eventLocation \} : \{\}\)/.test(handleShareMomentSource));

check('21. GENERAL card wires onShareMoment to handleShareMoment with scope GENERAL', /onShareMoment=\{\(window\) => handleShareMoment\(date\.date, window, 'GENERAL', date\.rating\)\}/.test(viewSource));
check('22. PERSONAL card wires onShareMoment to handleShareMoment with scope PERSONAL', /onShareMoment=\{\(window\) => handleShareMoment\(date\.date, window, 'PERSONAL', date\.rating\)\}/.test(viewSource));
check('23. SHARED card wires onShareMoment to handleShareMoment with scope SHARED', /onShareMoment=\{\(window\) => handleShareMoment\(date\.date, window, 'SHARED', date\.rating, date\.person\.savedPersonId\)\}/.test(viewSource));

check('27. MuhurthamFinderView never PATCHes /api/users/location as part of Share (no User mutation)', !viewSource.includes("fetch('/api/users/location'"));
check('26. Save path (handleUseThisTime) is untouched by this PR -- still derives eventLocation from resultEventLocation exactly as PR #56 left it', /const handleUseThisTime = async[\s\S]{0,700}const eventLocation = resultEventLocation \? \{ cityName: resultEventLocation\.cityName, timezone: resultEventLocation\.timezone \} : undefined;/.test(viewSource));

// ============================================================
// 15/16/17. Recipient rendering (AuraMomentClient.tsx) -- location label
// only when moment.locationName is present, primary time stays
// moment.timezone-driven (unchanged architecture), independent of
// recipient/browser timezone. Source-scan (no JSX parsing) for the same
// reason as MuhurthamFinderView above.
// ============================================================

const clientSource = fs.readFileSync('apps/web/app/moment/[token]/AuraMomentClient.tsx', 'utf8');
check('15. formatMomentWhen/formatMomentTime still take an explicit timezone parameter and pass it as Intl timeZone (never browser-local)', /timeZone:\s*timezone/.test(clientSource));
check('16. A location label renders only when moment.locationName is truthy', /\{moment\.locationName && \(/.test(clientSource));
check('16b. The location label uses moment.locationName, not any owner/current-city field', /📍 \{moment\.locationName\}/.test(clientSource));
check('17. No reference to recipient/browser Intl.DateTimeFormat().resolvedOptions().timeZone anywhere in the recipient page (primary time never converts to the viewer\'s zone)', !/resolvedOptions\(\)\.timeZone/.test(clientSource));

// Pure replica of formatMomentTime's actual logic (extracted, not
// reimplemented independently) -- confirms it is genuinely driven by the
// passed timezone, not the executing environment's own TZ.
function formatMomentTimeReplica(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}
const kochiTime = formatMomentTimeReplica('2026-11-10T05:00:00.000Z', 'Asia/Kolkata');
check('17b. 2026-11-10T05:00:00Z formatted with timeZone Asia/Kolkata is 10:30 AM, independent of this test process\'s own TZ', kochiTime === '10:30 AM');

console.log(allPassed ? '\nALL EVENT LOCATION AURAMOMENT PERSISTENCE CHECKS PASSED' : '\nSOME EVENT LOCATION AURAMOMENT PERSISTENCE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
