/**
 * AURA-MOBILE-01-IOS-02 -- executes the city-lookup route handler
 * (apps/web/app/api/location/reverse/route.ts) after its move from
 * GET ?lat=&lng= to POST { latitude, longitude }.
 *
 *   npx ts-node test/ios02ReverseRoutePost.test.ts
 *
 * SYNTHETIC ONLY: the session and the geocoding module are mocked; the
 * provider is never contacted and no network request is made.
 */
import * as path from 'path';

const routeDir = path.join(__dirname, '..', 'apps', 'web', 'app', 'api', 'location', 'reverse');
function installMock(id: string, exports: unknown) {
  const resolved = require.resolve(id, { paths: [routeDir] });
  const Module = require('module'); const m = new Module(resolved);
  m.filename = resolved; m.loaded = true; m.exports = exports; require.cache[resolved] = m;
}

let sessionUser: string | null = 'ios02-user-1';
let configured = false;
let providerMode: 'ok' | 'null' | 'throw' = 'ok';
const geocodeCalls: Array<[unknown, unknown]> = [];
installMock('../../../../lib/session', { getSessionFromRequest: () => (sessionUser ? { userId: sessionUser } : null) });
installMock('../../../../lib/geocoding', {
  isGeocodingConfigured: () => configured,
  reverseGeocode: async (lat: unknown, lng: unknown) => {
    geocodeCalls.push([lat, lng]);
    if (providerMode === 'throw') throw new Error('Geocoding provider unreachable.');
    if (providerMode === 'null') return null;
    return { displayName: 'Synthetic Town', cityName: 'Synthetic Town', latitude: 12.35, longitude: 78.9, timezone: 'Asia/Kolkata' };
  },
});

const route = require('../apps/web/app/api/location/reverse/route');
const { MIN_VALID_LATITUDE, MAX_VALID_LATITUDE, MIN_VALID_LONGITUDE, MAX_VALID_LONGITUDE } = require('../apps/web/lib/cities');

const logged: string[] = [];
console.error = (...a: unknown[]) => { logged.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(' ')); };
console.log = ((orig) => (...a: unknown[]) => orig(...a))(console.log);

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; process.stdout.write(`${ok ? 'OK  ' : 'FAIL'} ${label}\n`); }

const SYN = { latitude: 12.3456, longitude: 78.9012 };
function post(body: string | undefined, contentType = 'application/json', extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (contentType) headers['content-type'] = contentType;
  const req = new Request('http://localhost/api/location/reverse', { method: 'POST', headers, body });
  return req as any;
}
async function call(req: any) {
  const res: Response = await route.POST(req);
  const text = await res.text();
  return { status: res.status, cache: res.headers.get('cache-control') ?? '', text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
const noCoords = (s: string) => !s.includes('12.3456') && !s.includes('78.9012');
let userSeq = 0;
const freshUser = () => { sessionUser = `ios02-user-${++userSeq}`; };

async function run() {
  check('R0 the route exports POST and no longer exports GET (GET -> 405 from Next)', typeof route.POST === 'function' && route.GET === undefined);

  // --- authentication first ---
  sessionUser = null; configured = true;
  let r = await call(post(JSON.stringify(SYN)));
  check('R1 unauthenticated -> 401, provider not called', r.status === 401 && geocodeCalls.length === 0);
  check('R2 ...401 response is no-store', /no-store/.test(r.cache));

  // --- 503 preserved when OpenCage is not configured, body never read ---
  freshUser(); configured = false;
  const unread = post(JSON.stringify(SYN));
  r = await call(unread);
  check('R3 provider not configured -> 503 { configured: false }, provider not called', r.status === 503 && r.json?.configured === false && geocodeCalls.length === 0);
  check('R4 ...coordinates body is not even read when unconfigured', unread.bodyUsed === false);
  check('R5 ...503 response is no-store', /no-store/.test(r.cache));

  configured = true;
  // --- request shape validation ---
  freshUser();
  r = await call(post(JSON.stringify(SYN), 'text/plain'));
  check('R6 non-JSON content type -> 415', r.status === 415 && geocodeCalls.length === 0);
  freshUser();
  r = await call(post(JSON.stringify({ ...SYN, pad: 'x'.repeat(2000) })));
  check('R7 body over 1 KB -> 413', r.status === 413 && geocodeCalls.length === 0);
  freshUser();
  r = await call(post('{"latitude":1,"longitude":2}', 'application/json', { 'content-length': '999999' }));
  check('R8 declared content-length over 1 KB -> 413 before reading', r.status === 413);
  const bad: Array<[string, string]> = [
    ['malformed JSON', '{latitude:'],
    ['empty body', ''],
    ['JSON null', 'null'],
    ['numeric strings are not coerced', JSON.stringify({ latitude: '12.3456', longitude: '78.9012' })],
    ['latitude out of range', JSON.stringify({ latitude: 91, longitude: 0 })],
    ['longitude out of range', JSON.stringify({ latitude: 0, longitude: -181 })],
    ['missing longitude', JSON.stringify({ latitude: 1 })],
    ['boolean', JSON.stringify({ latitude: true, longitude: false })],
  ];
  let allBad = true; let badEcho = false;
  for (const [, body] of bad) {
    freshUser();
    const x = await call(post(body));
    if (x.status !== 400) allBad = false;
    if (!noCoords(x.text)) badEcho = true;
  }
  check('R9 invalid / mistyped / out-of-range coordinates -> 400 (8 cases), provider never called', allBad && geocodeCalls.length === 0);
  check('R10 ...error messages never echo coordinates', !badEcho);

  // --- happy path ---
  freshUser();
  r = await call(post(JSON.stringify(SYN), 'application/json; charset=utf-8'));
  check('R11 valid body -> 200 with result', r.status === 200 && r.json?.result?.cityName === 'Synthetic Town');
  check('R12 ...provider receives the numbers exactly', geocodeCalls.length === 1 && geocodeCalls[0][0] === SYN.latitude && geocodeCalls[0][1] === SYN.longitude);
  check('R13 ...200 response is private, no-store', /private/.test(r.cache) && /no-store/.test(r.cache));
  check('R14 shared lib/cities bounds: exact limits accepted, just outside rejected', await (async () => {
    for (const b of [{ latitude: MAX_VALID_LATITUDE, longitude: MAX_VALID_LONGITUDE }, { latitude: MIN_VALID_LATITUDE, longitude: MIN_VALID_LONGITUDE }]) { freshUser(); if ((await call(post(JSON.stringify(b)))).status !== 200) return false; }
    for (const b of [{ latitude: MAX_VALID_LATITUDE + 0.01, longitude: 0 }, { latitude: MIN_VALID_LATITUDE - 0.01, longitude: 0 }]) { freshUser(); if ((await call(post(JSON.stringify(b)))).status !== 400) return false; }
    return true;
  })());

  freshUser(); providerMode = 'null';
  r = await call(post(JSON.stringify(SYN)));
  check('R15 no usable place -> 404, no coordinates echoed', r.status === 404 && noCoords(r.text));

  freshUser(); providerMode = 'throw'; logged.length = 0;
  r = await call(post(JSON.stringify(SYN)));
  check('R16 provider failure -> 502 with generic message, no coordinates echoed', r.status === 502 && noCoords(r.text));
  check('R17 ...server log line carries no coordinates and no request body', logged.length === 1 && noCoords(logged[0]) && !/latitude|longitude/.test(logged[0]));
  providerMode = 'ok';

  // --- rate limit unchanged (10/min per user) ---
  freshUser();
  let blocked = 0;
  for (let i = 0; i < 12; i++) if ((await call(post(JSON.stringify(SYN)))).status === 429) blocked++;
  check('R18 rate limit unchanged: 11th and 12th request within a minute -> 429', blocked === 2);

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { process.stdout.write(`FAIL (threw) ${e?.stack ?? e}\n`); process.exit(1); });
