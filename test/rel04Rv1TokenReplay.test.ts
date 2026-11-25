/**
 * AURA-ANDROID-REL-04 -- RV-1 (S5-A revocation check), run in-process.
 *
 *   npx ts-node test/rel04Rv1TokenReplay.test.ts
 *
 * S5-A defines RV-1 as: replay a synthetic session token after logout in a
 * disposable environment; expected ACCEPTED until `exp`, documenting the
 * residual of revocation Option B. This test does exactly that with the dev
 * signing secret, no database, no network and no real account:
 *
 *  - POST /api/auth/logout returns a Set-Cookie that removes `as_session`
 *    with the issuing attributes and `Cache-Control: no-store`;
 *  - a copy of the token taken before logout STILL VERIFIES afterwards
 *    (stateless tokens; no server-side revocation). This assertion documents
 *    the accepted residual. If server-side revocation is implemented later,
 *    flip it.
 *  - the token stops verifying after `exp`, and a tampered token never verifies.
 */
process.env.NODE_ENV = 'test';
delete process.env.AUTH_SECRET;

const auth = require('../apps/web/lib/auth');
const logoutRoute = require('../apps/web/app/api/auth/logout/route');
const { NextRequest } = require(require.resolve('next/server', { paths: [require('path').join(__dirname, '..', 'apps', 'web', 'app', 'api', 'auth')] }));

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

(async () => {
  const token: string = auth.createSessionToken('synthetic-user-rv1', 'rv1@example.invalid');
  check('synthetic token verifies before logout', auth.verifySessionToken(token)?.userId === 'synthetic-user-rv1');

  const res = await logoutRoute.POST(new NextRequest('http://localhost/api/auth/logout', { method: 'POST', headers: { cookie: `as_session=${token}`, 'X-Aura-Expected-Account': 'synthetic-user-rv1' } }));
  const setCookie = res.headers.get('set-cookie') ?? '';
  check('logout responds 200 { loggedOut: true }', res.status === 200 && (await res.json()).loggedOut === true);
  check('logout Set-Cookie empties as_session with Max-Age=0 on path /', /^as_session=;/.test(setCookie) && /Max-Age=0/i.test(setCookie) && /Path=\//i.test(setCookie));
  check('logout Set-Cookie keeps HttpOnly and SameSite=Lax', /HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie));
  check('logout response is Cache-Control: no-store', res.headers.get('cache-control') === 'no-store');

  // RV-1 residual (documented, accepted under revocation Option B pending owner sign-off).
  check('RV-1 RESIDUAL: a token copied before logout is still accepted afterwards', auth.verifySessionToken(token)?.userId === 'synthetic-user-rv1');

  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 30 * 24 * 60 * 60 * 1000 + 60_000;
    check('the copied token is rejected after its 30-day exp', auth.verifySessionToken(token) === null);
  } finally {
    Date.now = realNow;
  }
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ userId: 'other', email: 'x@example.invalid', exp: Date.now() + 1e9 })).toString('base64url');
  check('a token with a swapped payload never verifies', auth.verifySessionToken(`${forged}.${sig}`) === null && auth.verifySessionToken(`${body}.x${sig}`) === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
