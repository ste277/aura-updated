/**
 * AURA-AUTH-SESSION-01-I2 -- client session outcomes (lib/sessionClient.ts). No network.
 *   npx ts-node test/authSessionClient.test.ts
 * 503 / non-2xx / offline is "unknown" (never signed out, N7); sign-out succeeds
 * only on 200 (D8), retries once, then fails without signing out.
 */
import { fetchSessionBootstrap, signOutDurably, SIGN_OUT_FAILED_MESSAGE } from '../apps/web/lib/sessionClient';

let passes = 0;
let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (ok) passes++;
  else failures++;
};
const reply = (status: number, body?: unknown, badJson = false) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => { if (badJson) throw new SyntaxError('x'); return body; } });
const seq = (...rs: Array<() => Promise<any>>) => { let i = 0; const calls: string[] = []; const f = async (input: string, init?: { method?: string }) => { calls.push(`${init?.method ?? 'GET'} ${input}`); const r = rs[Math.min(i++, rs.length - 1)]; return r(); }; return Object.assign(f, { calls }); };
const offline = async () => { throw new TypeError('Failed to fetch'); };
const noWait = async () => {};

(async () => {
  check('B1 200 with a user -> signed_in', (await fetchSessionBootstrap(seq(reply(200, { user: { id: 'u' } })))).kind === 'signed_in');
  check('B2 200 { user: null } -> signed_out (the only signed-out outcome)', (await fetchSessionBootstrap(seq(reply(200, { user: null })))).kind === 'signed_out');
  check('B3 503 -> unknown (never signed out)', (await fetchSessionBootstrap(seq(reply(503, { error: 'x' })))).kind === 'unknown');
  check('B4 500 -> unknown', (await fetchSessionBootstrap(seq(reply(500)))).kind === 'unknown');
  check('B5 offline -> unknown (N7)', (await fetchSessionBootstrap(seq(offline))).kind === 'unknown');
  check('B6 unparseable 200 -> unknown', (await fetchSessionBootstrap(seq(reply(200, undefined, true)))).kind === 'unknown');
  const f1 = seq(reply(200, { loggedOut: true }));
  check('O1 logout 200 -> signed_out after one request', (await signOutDurably(f1, noWait)) === 'signed_out' && f1.calls.length === 1 && f1.calls[0] === 'POST /api/auth/logout');
  const f2 = seq(reply(503), reply(200));
  check('O2 503 then 200 -> signed_out (one automatic retry)', (await signOutDurably(f2, noWait)) === 'signed_out' && f2.calls.length === 2);
  const f3 = seq(reply(503), reply(503));
  check('O3 503 twice -> failed after exactly one retry (user stays signed in)', (await signOutDurably(f3, noWait)) === 'failed' && f3.calls.length === 2);
  const f4 = seq(offline, offline);
  check('O4 offline -> failed, never a local-only sign-out', (await signOutDurably(f4, noWait)) === 'failed');
  const f5 = seq(reply(401), reply(401));
  check('O5 a non-200 (e.g. 401) is not treated as a confirmed sign-out', (await signOutDurably(f5, noWait)) === 'failed');
  check('O6 the failure message is the approved D8 text', SIGN_OUT_FAILED_MESSAGE === "Couldn't sign out. Try again.");
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
