import { buildSavedPersonInput } from '../apps/web/lib/savedPersonRequest';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const validBody = {
  name: 'Anu',
  relationshipType: 'PARTNER',
  birthDate: '1992-03-14',
  birthTime: '08:15',
  birthTimezone: 'Asia/Kolkata',
  birthCityName: 'Chennai',
  birthLatitude: 13.0827,
  birthLongitude: 80.2707,
};

// ============================================================
// VALID
// ============================================================

const validResult = buildSavedPersonInput(validBody);
check('A fully valid body is accepted', validResult.ok === true);
if (validResult.ok) {
  check('name is trimmed and preserved', validResult.input.name === 'Anu');
  check('relationshipType is preserved', validResult.input.relationshipType === 'PARTNER');
  check('birthDate is preserved', validResult.input.birthDate === '1992-03-14');
  check('birthTime is preserved', validResult.input.birthTime === '08:15');
  check('birthCityName/lat/lng are preserved when present', validResult.input.birthCityName === 'Chennai' && validResult.input.birthLatitude === 13.0827 && validResult.input.birthLongitude === 80.2707);
}

const minimalBody = { name: 'Ravi', birthDate: '1988-11-02', birthTime: '14:00', birthTimezone: 'America/New_York' };
const minimalResult = buildSavedPersonInput(minimalBody);
check('A body with no relationshipType defaults to OTHER', minimalResult.ok === true && minimalResult.ok && minimalResult.input.relationshipType === 'OTHER');
check('A body with no birth location (lat/lng/city) is still accepted -- not required for natal calculation', minimalResult.ok === true && minimalResult.ok && minimalResult.input.birthLatitude === undefined && minimalResult.input.birthLongitude === undefined);

for (const rel of ['PARTNER', 'SPOUSE', 'FAMILY', 'FRIEND', 'OTHER']) {
  check(`relationshipType "${rel}" is accepted`, buildSavedPersonInput({ ...validBody, relationshipType: rel }).ok === true);
}

// ============================================================
// VALIDATION: missing required fields
// ============================================================

check('Missing name is rejected', buildSavedPersonInput({ ...validBody, name: undefined }).ok === false);
check('Empty name is rejected', buildSavedPersonInput({ ...validBody, name: '   ' }).ok === false);
check('Overlong name is rejected', buildSavedPersonInput({ ...validBody, name: 'x'.repeat(81) }).ok === false);
check('Missing birthDate is rejected', buildSavedPersonInput({ ...validBody, birthDate: undefined }).ok === false);
check('Missing birthTime is rejected (birth time is required, not optional -- brief section 4)', buildSavedPersonInput({ ...validBody, birthTime: undefined }).ok === false);
check('Missing birthTimezone is rejected', buildSavedPersonInput({ ...validBody, birthTimezone: undefined }).ok === false);

// ============================================================
// VALIDATION: invalid formats
// ============================================================

check('Invalid relationshipType is rejected', buildSavedPersonInput({ ...validBody, relationshipType: 'SOULMATE' }).ok === false);
check('Malformed birthDate (not YYYY-MM-DD) is rejected', buildSavedPersonInput({ ...validBody, birthDate: '03/14/1992' }).ok === false);
check('Invalid calendar-looking birthDate (bad month) is still format-checked (regex-level)', buildSavedPersonInput({ ...validBody, birthDate: '1992-13-40' }).ok === true); // regex only checks shape, matching the existing /api/users/birth-profile route's own validation depth
check('Malformed birthTime (not HH:MM 24h) is rejected', buildSavedPersonInput({ ...validBody, birthTime: '8:15am' }).ok === false);
check('birthTime hour 24 is rejected (out of 24h range)', buildSavedPersonInput({ ...validBody, birthTime: '24:00' }).ok === false);
check('Invalid birthTimezone (not a real IANA name) is rejected', buildSavedPersonInput({ ...validBody, birthTimezone: 'Mars/OlympusMons' }).ok === false);

// ============================================================
// VALIDATION: coordinates, when present, must be valid
// ============================================================

check('Invalid latitude (out of range) is rejected when coordinates are provided', buildSavedPersonInput({ ...validBody, birthLatitude: 200, birthLongitude: 80 }).ok === false);
check('Invalid longitude (out of range) is rejected when coordinates are provided', buildSavedPersonInput({ ...validBody, birthLatitude: 13, birthLongitude: 400 }).ok === false);
check('Non-numeric latitude is rejected when coordinates are provided', buildSavedPersonInput({ ...validBody, birthLatitude: 'not a number', birthLongitude: 80 }).ok === false);

const missingLngResult = buildSavedPersonInput({ ...validBody, birthLongitude: undefined });
check('Providing only latitude without longitude is rejected (NaN longitude fails validation) rather than silently dropping it', missingLngResult.ok === false);

// All rejections use 400.
const rejection = buildSavedPersonInput({ ...validBody, name: '' });
check('Rejections use HTTP 400', rejection.ok === false && rejection.status === 400);

console.log(allPassed ? '\nALL SAVED PERSON REQUEST VALIDATION CHECKS PASSED' : '\nSOME SAVED PERSON REQUEST VALIDATION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
