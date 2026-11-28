/**
 * AURA-ANDROID-REL-04 IR-03 -- lib/signOut.ts unit checks: the logout
 * acknowledgement must be exact, and the confirmation wording must reflect the
 * real pending work. The full transition (tabs, replay, storage faults, lost
 * acknowledgement, concurrency) is covered by test/rel04AccountIsolation.test.ts.
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/signOutRel04.test.ts
 */
import { storage } from './rel04AccountIsolationHarness';
const acct = require('../apps/web/lib/accountSession');
const so = require('../apps/web/lib/signOut');

let passed = 0, failed = 0;
function check(label: string, ok: boolean) { ok ? passed++ : failed++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); }

type Answer = { status: number; type?: string; redirected?: boolean; body?: unknown; throws?: boolean };
function fakeFetch(logout: Answer, sessionUser: string | null) {
  const calls: string[] = [];
  const f = async (url: string, init: any = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url} redirect=${init.redirect ?? ''}`);
    if (url === '/api/auth/session') return new Response(JSON.stringify({ user: sessionUser ? { id: sessionUser } : null }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (logout.throws) throw new TypeError('Failed to fetch');
    const res = new Response(logout.body === undefined ? null : typeof logout.body === 'string' ? logout.body : JSON.stringify(logout.body), { status: logout.status, headers: { 'content-type': logout.type ?? 'application/json' } });
    if (logout.redirected) Object.defineProperty(res, 'redirected', { value: true });
    return res;
  };
  return { f, calls };
}

async function signOutWith(answer: Answer, sessionAfter: string | null) {
  so.__resetSignOutForTests();
  acct.__resetAccountSessionForTests('t');
  storage.clear();
  acct.setVerifiedAccount('user-a');
  const { f, calls } = fakeFetch(answer, sessionAfter);
  const res = await so.performSignOut({ fetch: f, confirm: () => true, settleTimeoutMs: 10 });
  return { out: res.outcome, calls };
}

(async () => {
  const ok = await signOutWith({ status: 200, body: { loggedOut: true } }, null);
  check('exact acknowledgement (200, JSON, loggedOut:true) -> signed-out', ok.out === 'signed-out');
  check('logout is requested with redirect:"error" (a redirect can never count as success)', ok.calls.some((c) => c === 'POST /api/auth/logout redirect=error'));
  for (const [label, ans] of [
    ['204 No Content', { status: 204 }],
    ['200 with loggedOut:"true" (string)', { status: 200, body: { loggedOut: 'true' } }],
    ['200 text/html', { status: 200, type: 'text/html', body: '<html></html>' }],
    ['200 marked redirected', { status: 200, body: { loggedOut: true }, redirected: true }],
    ['200 malformed JSON', { status: 200, body: '{not json' }],
    ['200 JSON body under a non-JSON media type containing "application/json"', { status: 200, type: 'text/plain; profile=application/json', body: { loggedOut: true } }],
    ['200 application/json-seq', { status: 200, type: 'application/json-seq', body: { loggedOut: true } }],
    ['200 array body', { status: 200, body: [{ loggedOut: true }] }],
  ] as Array<[string, Answer]>) {
    const r = await signOutWith(ans, 'user-a');
    check(`${label}: not accepted; reconciled (session still A) -> failed, A kept`, r.out === 'failed' && acct.getVerifiedAccount() === 'user-a' && r.calls.some((c) => c.startsWith('GET /api/auth/session')));
  }
  const http = await signOutWith({ status: 503, body: { error: 'x' } }, 'user-a');
  check('HTTP 503 is ambiguous: reconciled with a fresh session answer before A resumes', http.out === 'failed' && acct.getVerifiedAccount() === 'user-a' && http.calls.some((c) => c.startsWith('GET /api/auth/session')));
  const http2 = await signOutWith({ status: 503, body: { error: 'x' } }, null);
  check('HTTP 503 after the session actually ended -> signed-out-unconfirmed (never restored as A)', http2.out === 'signed-out-unconfirmed' && acct.getVerifiedAccount() === null);
  check('strict media type helper', acct.isJsonMediaType('application/json; charset=utf-8') && acct.isJsonMediaType('Application/JSON') && !acct.isJsonMediaType('text/plain; x=application/json') && !acct.isJsonMediaType('application/json-seq') && !acct.isJsonMediaType(null));
  const lost = await signOutWith({ status: 200, throws: true }, null);
  check('lost answer, session gone -> signed-out-unconfirmed', lost.out === 'signed-out-unconfirmed' && acct.getVerifiedAccount() === null);
  const switched = await signOutWith({ status: 200, throws: true }, 'user-b');
  check('lost answer, session now B -> account-changed to B', switched.out === 'account-changed' && acct.getVerifiedAccount() === 'user-b');

  check('wording: 1 owned', /1 activity log that has not synced yet/.test(so.describePendingWork({ owned: 1 })) && /remove it/.test(so.describePendingWork({ owned: 1 })));
  check('wording (R5): OWNED entries only; already-dispatched ones named as possibly SENT; removal not promised before the outcome', /2 activity logs that have not synced yet \(1 of them may already have been sent/.test(so.describePendingWork({ owned: 2, ownedSent: 1 })) && /where it can and tell you the result/.test(so.describePendingWork({ owned: 2, ownedSent: 1 })) && !/older|earlier version/.test(so.describePendingWork({ owned: 2, ownedSent: 1 })));
  check('wording (R5): unreadable storage says entries will be KEPT (what actually happens), never that they will be removed', /couldn't read this device's unsynced activity/i.test(so.describePendingWork({ owned: null })) && /kept on this device \(not removed\)/.test(so.describePendingWork({ owned: null })));
  check('wording: nothing pending -> no question', so.describePendingWork({ owned: 0 }) === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
