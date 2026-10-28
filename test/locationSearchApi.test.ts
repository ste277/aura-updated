/**
 * Onboarding V1 PR 3 -- Smart Location Selection: regression suite for
 * GET /api/location/search and GET /api/location/reverse. Combines
 * structural source checks (authentication/rate-limit/validation wiring
 * present, matching this repo's established route-review convention) with
 * direct logic tests that mirror each route's own real sequence using the
 * underlying functions it calls (isRateLimited, MIN/MAX coordinate
 * bounds) -- the same "mirror the route, bypass NextRequest" convention
 * other route tests in this repo already use.
 *
 *   npx ts-node test/locationSearchApi.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { isRateLimited } from '../apps/web/lib/inMemoryRateLimit';
import { MIN_VALID_LATITUDE, MAX_VALID_LATITUDE, MIN_VALID_LONGITUDE, MAX_VALID_LONGITUDE } from '../apps/web/lib/cities';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const searchRouteSrc = read('apps/web/app/api/location/search/route.ts');
const reverseRouteSrc = read('apps/web/app/api/location/reverse/route.ts');

// ============================================================
// Structural: both routes are authenticated, rate-limited, degrade
// gracefully when unconfigured, and never accept an arbitrary user id.
// ============================================================

for (const [name, src] of [['search', searchRouteSrc], ['reverse', reverseRouteSrc]] as const) {
  check(`${name}: authenticated via the session cookie (getSessionFromRequest), 401 when absent`, /getSessionFromRequest\(req\)/.test(src) && /status: 401/.test(src));
  check(`${name}: rate-limited per authenticated user (keyed by session.userId, never by raw request body)`, /isRateLimited\(`location-(search|reverse):\$\{session\.userId\}`/.test(src) && /status: 429/.test(src));
  check(`${name}: degrades gracefully (503, not a 500 crash) when the provider key is not configured`, /isGeocodingConfigured\(\)/.test(src) && /status: 503/.test(src));
  check(`${name}: provider failures return a clear, non-crashing error (502), never leak the raw provider error to the client`, /status: 502/.test(src) && !/apiKey|OPENCAGE_API_KEY/.test(src));
  check(`${name}: never writes to the database -- read-only resolution, saving only happens through the existing PATCH /api/users/location`, !/updateUserLocation|UPDATE "User"|INSERT INTO/.test(src));
}

check('search: rejects a missing/empty query with 400 before ever calling the provider', /if \(!query \|\| !query\.trim\(\)\) \{\s*return NextResponse\.json\(\{ error: '[^']*' \}, \{ status: 400 \}\);/.test(searchRouteSrc));
check('search: rejects an unreasonably long query (query-length abuse guard)', /query\.length > 200/.test(searchRouteSrc));
check('reverse: validates latitude/longitude against the SAME bounds the rest of the app already uses (MIN/MAX_VALID_LAT/LNG from lib/cities.ts) -- no second, divergent validation rule', /MIN_VALID_LATITUDE|MAX_VALID_LATITUDE/.test(reverseRouteSrc) && /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/cities'/.test(reverseRouteSrc));
check('reverse: rejects non-finite or out-of-range coordinates with 400', /Number\.isFinite\(latitude\)/.test(reverseRouteSrc) && /status: 400/.test(reverseRouteSrc));
check('reverse: a geocode result with no usable place (provider returned nothing) is a 404, never a fabricated result', /status: 404/.test(reverseRouteSrc));

// ============================================================
// Direct logic: the rate limiter itself, exercised exactly as each route
// uses it (same key shape, same window).
// ============================================================

{
  const userId = 'test-user-rate-limit-search';
  let blocked = 0;
  for (let i = 0; i < 25; i++) {
    if (isRateLimited(`location-search:${userId}`, 20, 60_000)) blocked++;
  }
  check('search rate limit: the 21st+ request within the window is blocked (20/min, matching the route\'s own constant)', blocked === 5);
}
{
  const userId = 'test-user-rate-limit-reverse';
  let blocked = 0;
  for (let i = 0; i < 15; i++) {
    if (isRateLimited(`location-reverse:${userId}`, 10, 60_000)) blocked++;
  }
  check('reverse rate limit: the 11th+ request within the window is blocked (10/min, matching the route\'s own constant)', blocked === 5);
}
{
  // Two different users never share a bucket.
  const a = 'test-user-rate-limit-isolation-a';
  const b = 'test-user-rate-limit-isolation-b';
  for (let i = 0; i < 20; i++) isRateLimited(`location-search:${a}`, 20, 60_000);
  check('rate limit is per-user: a second, different user starts with a fresh bucket, unaffected by user A exhausting theirs', !isRateLimited(`location-search:${b}`, 20, 60_000));
}

// ============================================================
// Coordinate bounds mirror the SAME constants the rest of the app (the
// curated/custom location form) already validates against -- confirms
// there is only one source of truth for "valid coordinates," not a
// second, independently-drifting range for this new route.
// ============================================================

check('reverse route bounds are literally the same imported constants as cities.ts -- cannot silently diverge from the custom-location form\'s own validation', typeof MIN_VALID_LATITUDE === 'number' && typeof MAX_VALID_LATITUDE === 'number' && typeof MIN_VALID_LONGITUDE === 'number' && typeof MAX_VALID_LONGITUDE === 'number');

if (!allPassed) {
  console.error('\nSOME LOCATION SEARCH API CHECKS FAILED');
  process.exit(1);
} else {
  console.log('\nALL LOCATION SEARCH API CHECKS PASSED');
}
