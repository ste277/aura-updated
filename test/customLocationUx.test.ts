import { CITY_OPTIONS, parseCoordinate, formatCoordinateDirectional, isValidCustomLocation, MIN_VALID_LATITUDE, MAX_VALID_LATITUDE, MIN_VALID_LONGITUDE, MAX_VALID_LONGITUDE } from '../apps/web/lib/cities';
import { isValidIanaTimezone, searchTimezones } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

/**
 * Planning Custom Location UX Fix. Covers only the new pure parsing/
 * validation helpers -- this is a UI/UX fix to the existing custom Planning
 * Location form (You -> Planning -> Location & Time), not a change to
 * Panchang/Timing Search/Day Builder scoring, and never touches Birth
 * Details.
 */

// ============================================================
// parseCoordinate -- section 15's required input formats
// ============================================================

check('Plain decimal latitude parses', parseCoordinate('8.8932', 'lat') === 8.8932);
check('Plain negative decimal latitude parses', parseCoordinate('-33.8688', 'lat') === -33.8688);
check('Plain decimal longitude parses', parseCoordinate('76.6141', 'lng') === 76.6141);
check('Plain negative decimal longitude parses', parseCoordinate('-74.0060', 'lng') === -74.006);

check('"8.8932 N" parses to +8.8932', parseCoordinate('8.8932 N', 'lat') === 8.8932);
check('"33.8688 S" parses to -33.8688', parseCoordinate('33.8688 S', 'lat') === -33.8688);
check('"76.6141 E" parses to +76.6141', parseCoordinate('76.6141 E', 'lng') === 76.6141);
check('"74.0060 W" parses to -74.0060', parseCoordinate('74.0060 W', 'lng') === -74.006);
check('Lowercase direction letters accepted ("8.8932 n")', parseCoordinate('8.8932 n', 'lat') === 8.8932);
check('Extra whitespace around value/direction is tolerated', parseCoordinate('  8.8932   N  ', 'lat') === 8.8932);
check('Optional degree symbol is tolerated ("8.8932° N")', parseCoordinate('8.8932° N', 'lat') === 8.8932);

// Axis-direction mismatch: N/S only valid for latitude, E/W only for longitude.
check('"8.8932 E" is rejected for latitude (E/W is a longitude direction)', parseCoordinate('8.8932 E', 'lat') === null);
check('"76.6141 N" is rejected for longitude (N/S is a latitude direction)', parseCoordinate('76.6141 N', 'lng') === null);

// Ambiguous signed-magnitude-plus-direction.
check('"-8.8932 N" is rejected (ambiguous sign + direction)', parseCoordinate('-8.8932 N', 'lat') === null);

// Invalid formats.
check('Blank latitude is rejected', parseCoordinate('', 'lat') === null);
check('Whitespace-only latitude is rejected', parseCoordinate('   ', 'lat') === null);
check('Non-numeric latitude ("abc") is rejected', parseCoordinate('abc', 'lat') === null);
check('DMS input ("8° 53\' 35\\" N") is rejected -- decimal degrees only (section 10)', parseCoordinate('8° 53\' 35" N', 'lat') === null);
check('A stray direction letter with no number is rejected', parseCoordinate('N', 'lat') === null);

// ============================================================
// formatCoordinateDirectional -- presentation only (section 7)
// ============================================================

check('formatCoordinateDirectional(8.8932, lat) -> "8.8932° N"', formatCoordinateDirectional(8.8932, 'lat') === '8.8932° N');
check('formatCoordinateDirectional(-33.8688, lat) -> "33.8688° S"', formatCoordinateDirectional(-33.8688, 'lat') === '33.8688° S');
check('formatCoordinateDirectional(76.6141, lng) -> "76.6141° E"', formatCoordinateDirectional(76.6141, 'lng') === '76.6141° E');
check('formatCoordinateDirectional(-74.006, lng) -> "74.006° W"', formatCoordinateDirectional(-74.006, 'lng') === '74.006° W');

// ============================================================
// isValidCustomLocation -- range + timezone validity (section 3/4/8/9)
// ============================================================

check('A valid location (Kollam) passes', isValidCustomLocation({ latitude: 8.8932, longitude: 76.6141, timezone: 'Asia/Kolkata' }));
check('Latitude of exactly MIN_VALID_LATITUDE passes (inclusive bound)', isValidCustomLocation({ latitude: MIN_VALID_LATITUDE, longitude: 0, timezone: 'Asia/Kolkata' }));
check('Latitude of exactly MAX_VALID_LATITUDE passes (inclusive bound)', isValidCustomLocation({ latitude: MAX_VALID_LATITUDE, longitude: 0, timezone: 'Asia/Kolkata' }));
check('Latitude 100 is rejected', !isValidCustomLocation({ latitude: 100, longitude: 76.6141, timezone: 'Asia/Kolkata' }));
check('Longitude 200 is rejected', !isValidCustomLocation({ latitude: 8.8932, longitude: 200, timezone: 'Asia/Kolkata' }));
check('Longitude of exactly MIN_VALID_LONGITUDE passes (inclusive bound)', isValidCustomLocation({ latitude: 0, longitude: MIN_VALID_LONGITUDE, timezone: 'Asia/Kolkata' }));
check('Longitude of exactly MAX_VALID_LONGITUDE passes (inclusive bound)', isValidCustomLocation({ latitude: 0, longitude: MAX_VALID_LONGITUDE, timezone: 'Asia/Kolkata' }));
check('NaN latitude is rejected', !isValidCustomLocation({ latitude: NaN, longitude: 76.6141, timezone: 'Asia/Kolkata' }));
check('An invalid timezone string is rejected even with valid coordinates', !isValidCustomLocation({ latitude: 8.8932, longitude: 76.6141, timezone: 'Not/AZone' }));
check(
  'A latitude beyond the Panchang-safe range (e.g. 80, inside geographic -90..90 but outside the -66.5..66.5 solar-window-safe range) is still rejected -- ' +
    'this app deliberately keeps the narrower bound so a value can never be saved only to fail later inside the Panchang engine',
  !isValidCustomLocation({ latitude: 80, longitude: 0, timezone: 'Asia/Kolkata' })
);

// ============================================================
// isValidIanaTimezone -- section 9
// ============================================================

check('"Asia/Kolkata" is a valid timezone', isValidIanaTimezone('Asia/Kolkata'));
check('"Asia/Dubai" is a valid timezone', isValidIanaTimezone('Asia/Dubai'));
check('"Europe/London" is a valid timezone', isValidIanaTimezone('Europe/London'));
check('"America/New_York" is a valid timezone', isValidIanaTimezone('America/New_York'));
check('"IST" is NOT a valid IANA timezone (abbreviation, not accepted)', !isValidIanaTimezone('IST'));
check('"UTC+5:30" is NOT a valid IANA timezone (offset string, not accepted)', !isValidIanaTimezone('UTC+5:30'));
check('"India" is NOT a valid IANA timezone (country name, not accepted)', !isValidIanaTimezone('India'));
check('An empty string is not a valid timezone', !isValidIanaTimezone(''));
check('A nonsense string is not a valid timezone', !isValidIanaTimezone('Not/AZone'));

// Regression guard: the '/' requirement added to reject bare abbreviations
// (IST/UTC/GMT/etc.) must not reject any timezone this app already stores
// for every one of its curated CITY_OPTIONS entries.
for (const city of CITY_OPTIONS) {
  check(`Existing curated city "${city.cityName}"'s timezone (${city.timezone}) still validates`, isValidIanaTimezone(city.timezone));
}

// ============================================================
// searchTimezones -- section 5's searchable selector, backed by runtime
// Intl data (no external dependency, no large timezone-name database added).
// ============================================================

const kolkataResults = searchTimezones('Kolkata');
check('Searching "Kolkata" returns at least one result', kolkataResults.length > 0);
check('Searching "Kolkata" includes Asia/Kolkata', kolkataResults.some((r) => r.id === 'Asia/Kolkata'));
check('Every Asia/Kolkata result carries a real offset label', kolkataResults.find((r) => r.id === 'Asia/Kolkata')?.offsetLabel === 'UTC+05:30');

const dubaiResults = searchTimezones('Dubai');
check('Searching "Dubai" returns at least one result', dubaiResults.length > 0);
check('Searching "Dubai" includes Asia/Dubai', dubaiResults.some((r) => r.id === 'Asia/Dubai'));
check('Asia/Dubai carries the correct UTC+04:00 offset (no DST)', dubaiResults.find((r) => r.id === 'Asia/Dubai')?.offsetLabel === 'UTC+04:00');

check('Every returned option is independently a valid IANA timezone', [...kolkataResults, ...dubaiResults].every((r) => isValidIanaTimezone(r.id)));
check('An empty query returns no suggestions (nothing to search yet)', searchTimezones('').length === 0);
check('A query matching nothing real returns no suggestions', searchTimezones('Not A Real Place Zzzz').length === 0);
check('The `limit` parameter caps the number of results', searchTimezones('a', 3).length <= 3);

// Regression guard: word-PREFIX matching, not raw substring. Searching the
// exact ambiguous abbreviation this fix exists to guard against ("IST")
// must never surface a zone merely because "ist" appears mid-word --
// caught during manual verification: a naive substring search matched
// "America/Boa_Vista" and "Indian/Christmas" (both just contain "ist"
// inside an unrelated word) alongside the one genuine match,
// "Europe/Istanbul" (which actually starts with "Ist").
const istResults = searchTimezones('IST');
check('Searching "IST" does not surface America/Boa_Vista (mid-word "ist" in "Vista", not a real match)', !istResults.some((r) => r.id === 'America/Boa_Vista'));
check('Searching "IST" does not surface Indian/Christmas (mid-word "ist" in "Christmas", not a real match)', !istResults.some((r) => r.id === 'Indian/Christmas'));
check('Searching "IST" still surfaces Europe/Istanbul (genuinely starts with "Ist")', istResults.some((r) => r.id === 'Europe/Istanbul'));
check('A word-internal substring query ("ata", found inside "Kolkata" and "Jakarta" but not as a word start) returns no results', searchTimezones('ata').length === 0);

console.log(allPassed ? '\nALL CUSTOM LOCATION UX CHECKS PASSED' : '\nSOME CUSTOM LOCATION UX CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
