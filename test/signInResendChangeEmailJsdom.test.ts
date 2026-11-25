/**
 * AURA-READY-03-F2 -- "Resend code" and "Change email" on the 6-digit
 * sign-in code screen (AURA-READY-02 finding F2: the code screen was a dead
 * end, with no way to recover from a mistyped address or a lost email).
 *
 * Deterministic: a controllable fetch mock (the test decides when and how
 * every request resolves) and a controlled Date.now for the resend cooldown.
 * The real LoginScreen is mounted with React 18 in jsdom (shared harness), and
 * the real requestSignInCode helper is exercised directly.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/signInResendChangeEmailJsdom.test.ts
 */
import { React, mount, click, flush, typeInto, act, createControllableFetch } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ---- controlled clock (only Date.now; timers stay real) ----
const realNow = Date.now.bind(Date);
let clockOffset = 0;
Date.now = () => realNow() + clockOffset;
async function advance(seconds: number) {
  clockOffset += seconds * 1000;
  // Let the component's 1-second countdown tick observe the new time.
  await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
}

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });

const { requestSignInCode, RESEND_COOLDOWN_SECONDS, SIGN_IN_OFFLINE_MESSAGE } = require('../apps/web/lib/signInCode');
const { LoginScreen } = require('../apps/web/components/LoginScreen');

const RATE_LIMIT_MSG = 'Too many sign-in requests. Try again in about 10 minutes.';
const PROVIDER_MSG = "Our email provider isn't responding right now. Please try again in a few minutes.";

(async () => {
  // =========================================================================
  // A. requestSignInCode -- reuses the existing endpoint, maps its outcomes.
  // =========================================================================
  {
    const f = createControllableFetch();
    const p = requestSignInCode({ email: 'a@e2e.aura.local' }, f.fetchFn);
    f.resolve(0, res(200, { devLoginCode: '111111' }));
    const r = await p;
    check('A1. uses the existing POST /api/auth/request-link endpoint', f.calls[0].url === '/api/auth/request-link');
    check('A2. success -> SENT with the dev-only code; no link when the server sends none', r.kind === 'SENT' && r.devLoginCode === '111111' && r.devLoginUrl === null);
    check('A3. body is just the email when there is no guest token', JSON.stringify(f.calls[0].body) === JSON.stringify({ email: 'a@e2e.aura.local' }));
  }
  {
    const f = createControllableFetch();
    const p = requestSignInCode({ email: 'a@e2e.aura.local', guestStateToken: 'gst' }, f.fetchFn);
    f.resolve(0, res(200, { sent: true }));
    const r = await p;
    check('A4. guest flow forwards its guest state token; production response {sent:true} -> SENT', (f.calls[0].body as any).guestStateToken === 'gst' && r.kind === 'SENT' && r.devLoginCode === null);
  }
  {
    const f = createControllableFetch();
    const p = requestSignInCode({ email: 'a@e2e.aura.local' }, f.fetchFn);
    f.resolve(0, res(429, { error: RATE_LIMIT_MSG }));
    const r = await p;
    check('A5. 429 -> RATE_LIMITED with the server\'s own message', r.kind === 'RATE_LIMITED' && r.message === RATE_LIMIT_MSG);
  }
  {
    const f = createControllableFetch();
    const p = requestSignInCode({ email: 'a@e2e.aura.local' }, f.fetchFn);
    f.resolve(0, res(502, { error: PROVIDER_MSG }));
    const r = await p;
    check('A6. provider failure (502) -> FAILED with the server message', r.kind === 'FAILED' && r.message === PROVIDER_MSG);
  }
  {
    const f = createControllableFetch();
    const p = requestSignInCode({ email: 'a@e2e.aura.local' }, f.fetchFn);
    f.reject(0, new TypeError('Failed to fetch'));
    const r = await p;
    check('A7. network failure -> FAILED with the offline message (never an unhandled rejection)', r.kind === 'FAILED' && r.message === SIGN_IN_OFFLINE_MESSAGE);
  }
  check('A8. client cooldown is 30 s', RESEND_COOLDOWN_SECONDS === 30);

  // =========================================================================
  // B. LoginScreen (Home sign-in), mounted.
  // =========================================================================
  const f = createControllableFetch();
  (global as any).fetch = f.fetchFn;
  let loggedIn = 0;
  const h = await mount(React.createElement(LoginScreen, { onLoggedInCheck: () => { loggedIn++; } }));
  const q = (sel: string) => h.container.querySelector(sel) as HTMLElement | null;
  const btn = (re: RegExp) => [...h.container.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
  const text = () => (h.container.textContent ?? '').replace(/\s+/g, ' ');
  const callsTo = (u: string) => f.calls.filter((c) => c.url === u);
  async function submitEmail(addr: string, idx: number, response = res(200, { devLoginCode: '123456' })) {
    await typeInto(q('input[type=email]') as HTMLInputElement, addr);
    await click(btn(/^Continue$/)!);
    f.resolve(idx, response);
    await flush();
  }

  // B1. First send: code screen states where the code went, with both actions.
  await submitEmail('first@e2e.aura.local', 0);
  check('B1. code screen shows "Sent to first@…"', /Sent to first@e2e\.aura\.local/.test(text()));
  check('B1. Resend code and Change email are both present', !!btn(/Resend code/) && !!btn(/^Change email$/));
  const resend = () => btn(/Resend code|Sending/)!;
  check('B1. both actions are at least 44 px tall (mobile touch target)', /min-height: 44px/.test(resend().getAttribute('style') ?? '') && /min-height: 44px/.test(btn(/^Change email$/)!.getAttribute('style') ?? ''));

  // B2. Cooldown right after a send: disabled, counts down, clicks do nothing.
  check('B2. resend is disabled during the cooldown and shows the seconds left', resend().disabled && /Resend code \(\d+s\)/.test(resend().textContent ?? ''));
  await click(resend());
  await flush();
  check('B2. clicking during the cooldown sends nothing', callsTo('/api/auth/request-link').length === 1);

  // B3. Successful resend; repeated clicks while in flight send ONE request.
  await advance(RESEND_COOLDOWN_SECONDS + 1);
  check('B3. after the cooldown "Resend code" is enabled', !resend().disabled && resend().textContent === 'Resend code');
  await typeInto(q('input[placeholder="123456"]') as HTMLInputElement, '999999');
  await click(resend());
  await click(resend());
  await click(resend());
  await flush();
  check('B3. three rapid clicks -> exactly one request', callsTo('/api/auth/request-link').length === 2);
  check('B3. while in flight the button reads "Sending…" and is disabled', resend().disabled && /Sending/.test(resend().textContent ?? ''));
  check('B3. Change email is locked while a resend is in flight', btn(/^Change email$/)!.disabled);
  f.resolve(1, res(200, { devLoginCode: '222222' }));
  await flush();
  check('B3. resend went to the same address', (f.calls[1].body as any).email === 'first@e2e.aura.local');
  check('B3. success message names the address and asks for the newest code', /We sent a new code to first@e2e\.aura\.local\. Use the newest code\./.test(text()));
  check('B3. the stale typed code is cleared and the new dev code is shown', (q('input[placeholder="123456"]') as HTMLInputElement).value === '' && /Code: 222222/.test(text()) && !/111111|123456 /.test(text().replace('placeholder', '')));
  check('B3. cooldown restarts after a send', resend().disabled && /\(\d+s\)/.test(resend().textContent ?? ''));

  // B4. Rate limited (server 429): its message is shown; cooldown restarts.
  await advance(RESEND_COOLDOWN_SECONDS + 1);
  await click(resend());
  f.resolve(2, res(429, { error: RATE_LIMIT_MSG }));
  await flush();
  check('B4. rate limit: the server\'s message is shown as an alert', q('[role=alert]')?.textContent === RATE_LIMIT_MSG);
  check('B4. rate limit: resend paused again (no hammering the quota)', resend().disabled);
  check('B4. rate limit: still on the code screen, previous dev code kept', !!q('input[placeholder="123456"]') && /Code: 222222/.test(text()));

  // B5. Resend failure: provider error, then offline.
  await advance(RESEND_COOLDOWN_SECONDS + 1);
  await click(resend());
  f.resolve(3, res(502, { error: PROVIDER_MSG }));
  await flush();
  check('B5. provider failure message shown', q('[role=alert]')?.textContent === PROVIDER_MSG);
  await advance(RESEND_COOLDOWN_SECONDS + 1);
  await click(resend());
  f.reject(4, new TypeError('Failed to fetch'));
  await flush();
  check('B5. offline failure message shown, button usable again after the cooldown', q('[role=alert]')?.textContent === SIGN_IN_OFFLINE_MESSAGE && !/Sending/.test(resend().textContent ?? ''));

  // B6. Change email before verifying: back to email entry, state cleared.
  await typeInto(q('input[placeholder="123456"]') as HTMLInputElement, '222222');
  await click(btn(/^Change email$/)!);
  await flush();
  check('B6. Change email returns to email entry', !!q('input[type=email]') && !q('input[placeholder="123456"]'));
  check('B6. pending verification cleared: no code input, no dev code, no "Sent to", no old messages', !/Code: 222222|Sent to|We sent a new code|Failed|reach the server/.test(text()));
  check('B6. the previous address is prefilled for easy correction', (q('input[type=email]') as HTMLInputElement).value === 'first@e2e.aura.local');

  // B7. Verification uses the NEW address.
  await submitEmail('second@e2e.aura.local', 5, res(200, { devLoginCode: '333333' }));
  check('B7. the new code was requested for second@', (f.calls[5].body as any).email === 'second@e2e.aura.local');
  check('B7. code screen shows the new address and a fresh, empty code input', /Sent to second@e2e\.aura\.local/.test(text()) && (q('input[placeholder="123456"]') as HTMLInputElement).value === '');
  check('B7. a fresh cooldown starts for the new address', resend().disabled);
  await typeInto(q('input[placeholder="123456"]') as HTMLInputElement, '333333');
  await click(btn(/^Sign in$/)!);
  await flush();
  const verify1 = callsTo('/api/auth/verify-code')[0];
  check('B7. verify-code is sent for second@ (never the previous first@)', !!verify1 && JSON.stringify(verify1.body) === JSON.stringify({ email: 'second@e2e.aura.local', code: '333333' }));

  // B8. Existing code sign-in: a wrong code shows the server error; the right one signs in.
  f.resolve(6, res(401, { error: 'That code is not valid. Check the email or request a new one.' }));
  await flush();
  check('B8. wrong code: server error shown, not signed in', /That code is not valid/.test(text()) && loggedIn === 0);
  await click(btn(/^Sign in$/)!);
  f.resolve(7, res(200, { ok: true, userId: 'u-second' }));
  await flush();
  // AURA-ANDROID-REL-04 (R2): the sign-in is confirmed with a fresh session read for that account.
  f.resolve(8, res(200, { user: { id: 'u-second' } }));
  await flush(); await flush();
  check('B8. correct code: onLoggedInCheck fires once', loggedIn === 1);

  // B9. No magic-link regression: only request-link and verify-code were called.
  const urls = new Set(f.calls.map((c) => c.url));
  check('B9. only request-link, verify-code and the confirming session read were requested (no /api/auth/verify link)', [...urls].every((u) => u === '/api/auth/request-link' || u === '/api/auth/verify-code' || u === '/api/auth/session'));
  check('B9. no sign-in link is rendered when the server returns only a code', !h.container.querySelector('a[href*="/api/auth/verify"]'));
  await h.unmount();

  // =========================================================================
  // C. Structural guards (guest /find flow + both screens).
  // =========================================================================
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const guest = read('apps/web/app/find/GuestFindClient.tsx');
  const login = read('apps/web/components/LoginScreen.tsx');
  const actions = read('apps/web/components/SignInCodeActions.tsx');
  const helper = read('apps/web/lib/signInCode.ts');
  check('C1. guest flow renders SignInCodeActions on its code step', /<SignInCodeActions[\s\S]*?onChangeEmail=\{handleChangeEmail\}/.test(guest));
  check('C2. guest resend reuses the same guest state token and the sent-to address', /requestCode=\{\(\) => requestSignInCode\(\{ email: sentTo, guestStateToken \}\)\}/.test(guest));
  check('C3. guest verify-code uses sentTo, never the editable email field', /verifySignInCode\(\{ email: sentTo, code \}\)/.test(guest) && !/verifySignInCode\(\{ email, code \}\)/.test(guest) && !/JSON\.stringify\(\{ email, code \}\)/.test(guest));
  check('C4. guest Change email clears sentTo, code, dev extras, error and returns to EMAIL', /handleChangeEmail = \(\) => \{[\s\S]*?setSentTo\(null\)[\s\S]*?setCode\(''\)[\s\S]*?setDevLoginUrl\(null\)[\s\S]*?setDevLoginCode\(null\)[\s\S]*?setError\(''\)[\s\S]*?setSignupStep\('EMAIL'\)/.test(guest));
  check('C5. LoginScreen verify-code uses sentTo (via verifySignInCode, AURA-ANDROID-REL-04 R2)', /verifySignInCode\(\{ email: sentTo, code \}\)/.test(login));
  check('C6. no screen builds or calls a magic link itself', ![guest, login, actions, helper].some((s) => /\/api\/auth\/verify\?|createMagicLinkToken/.test(s)));
  check('C7. messages never depend on account existence (no exists/newUser/isRegistered branching)', ![login, actions, helper].some((s) => /\bexists\b|newUser|isRegistered|accountExists/.test(s)));
  check('C8. request-link server route untouched by this change (quota 3 per 10 min still defined there)', /RATE_LIMIT_MAX_REQUESTS = 3/.test(read('apps/web/app/api/auth/request-link/route.ts')));

  Date.now = realNow;
  console.log(`\n${count} checks`);
  if (!allPassed) { console.log('SOME CHECKS FAILED'); process.exit(1); }
  console.log('All sign-in resend / change-email checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
