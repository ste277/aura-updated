/**
 * AURA-READY-02-F3 -- the signed-out landing screen (LoginScreen) explains
 * what Aura is and offers "Try it without an account", a link to the EXISTING
 * guest Find a Time at /find, without changing email sign-in.
 *
 *   npx ts-node --project tsconfig.jsdom-tests.json test/landingGuestEntryJsdom.test.ts
 */
import { React, mount, click, flush, typeInto, createControllableFetch } from './jsdomReactHarness';
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
const { LoginScreen } = require('../apps/web/components/LoginScreen');

(async () => {
  const f = createControllableFetch();
  (global as any).fetch = f.fetchFn;
  let loggedIn = 0;
  const h = await mount(React.createElement(LoginScreen, { onLoggedInCheck: () => { loggedIn++; } }));
  const text = () => (h.container.textContent ?? '').replace(/\s+/g, ' ');
  const guestLink = () => [...h.container.querySelectorAll('a')].find((a) => /Try it without an account/.test(a.textContent ?? '')) as HTMLAnchorElement | undefined;

  // 1. Introduction.
  const heading = h.container.querySelector('h2#landing-intro-title');
  check('1. intro heading "Make time for what matters." is shown', heading?.textContent?.trim() === 'Make time for what matters.');
  check('1. intro explains Aura and Panchangam in plain words', /Aura helps you find favorable times for your plans, balancing your schedule with Panchangam, the traditional Indian guide to auspicious timing\./.test(text()));
  check('1. intro section is labelled by its heading (accessible landmark)', h.container.querySelector('section')?.getAttribute('aria-labelledby') === 'landing-intro-title');

  // 3. Guest entry point.
  const a = guestLink();
  check('3. "Try it without an account" is a real link to the existing /find route', !!a && a.getAttribute('href') === '/find');
  check('3. it is keyboard-reachable (a native <a href>, no tabindex=-1)', !!a && a.tabIndex === 0 && a.getAttribute('tabindex') !== '-1');
  check('3. it is a secondary action: after the email form, not the submit button', (() => {
    const form = h.container.querySelector('form');
    return !!form && !!a && !!(form.compareDocumentPosition(a) & 4 /* FOLLOWING */) && !form.contains(a);
  })());
  check('3. touch target is at least 44 px tall', /min-height: 44px/.test(a?.getAttribute('style') ?? ''));
  check('3. honest helper text: explore now, sign in to save (no claim that everything works without an account)', /Find a good time for a plan now\. Sign in only when you want to save it\./.test(text()));
  check('3. primary action is still the email "Continue" submit button', (h.container.querySelector('form button[type=submit]')?.textContent ?? '') === 'Continue');

  // 2. Email sign-in still works, and the code step stays focused.
  await typeInto(h.container.querySelector('input[type=email]') as HTMLInputElement, 'f3-user@e2e.aura.local');
  await click(h.container.querySelector('form button[type=submit]') as HTMLButtonElement);
  check('2. Continue calls the existing request-link endpoint with the email', f.calls[0]?.url === '/api/auth/request-link' && (f.calls[0]?.body as any)?.email === 'f3-user@e2e.aura.local');
  f.resolve(0, res(200, { devLoginCode: '123456' }));
  await flush();
  check('2. code step appears with Resend code / Change email (F2 intact)', !!h.container.querySelector('input[placeholder="123456"]') && /Resend code/.test(text()) && /Change email/.test(text()));
  check('2. intro and guest link are hidden on the code step (focused, no extra scrolling)', !h.container.querySelector('h2#landing-intro-title') && !guestLink());
  await typeInto(h.container.querySelector('input[placeholder="123456"]') as HTMLInputElement, '123456');
  await click([...h.container.querySelectorAll('button')].find((b) => b.textContent === 'Sign in')!);
  check('2. verify-code is sent for the same address', JSON.stringify(f.calls[1]?.body) === JSON.stringify({ email: 'f3-user@e2e.aura.local', code: '123456' }));
  // AURA-ANDROID-REL-04 (R2): verify-code names the account it signed in, and
  // the client confirms it with a fresh session answer before continuing.
  f.resolve(1, res(200, { ok: true, userId: 'u-f3' }));
  await flush();
  check('2. the sign-in is confirmed with a fresh session read', f.calls[2]?.url === '/api/auth/session');
  f.resolve(2, res(200, { user: { id: 'u-f3', email: 'f3-user@e2e.aura.local' } }));
  await flush(); await flush();
  check('2. a correct code signs in', loggedIn === 1);

  // Change email returns to the landing step, intro and guest link included.
  await h.unmount();
  const f2 = createControllableFetch();
  (global as any).fetch = f2.fetchFn;
  const h2 = await mount(React.createElement(LoginScreen, { onLoggedInCheck: () => {} }));
  await typeInto(h2.container.querySelector('input[type=email]') as HTMLInputElement, 'typo@e2e.aura.local');
  await click(h2.container.querySelector('form button[type=submit]') as HTMLButtonElement);
  f2.resolve(0, res(200, { devLoginCode: '111111' }));
  await flush();
  await click([...h2.container.querySelectorAll('button')].find((b) => b.textContent === 'Change email')!);
  await flush();
  check('2. Change email returns to the landing step with the intro and guest link', !!h2.container.querySelector('h2#landing-intro-title') && !![...h2.container.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/find'));
  await h2.unmount();

  // Structural guards.
  const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const login = strip(fs.readFileSync(path.join(__dirname, '..', 'apps/web/components/LoginScreen.tsx'), 'utf8'));
  check('4/5. no separate guest experience: the link targets the existing /find route only', (login.match(/href="\/find"/g) ?? []).length === 1 && fs.existsSync(path.join(__dirname, '..', 'apps/web/app/find/page.tsx')));
  const signInLib = strip(fs.readFileSync(path.join(__dirname, '..', 'apps/web/lib/signInCode.ts'), 'utf8'));
  check('no registration gate / allowlist / auth-logic change introduced (verify-code now called via lib/signInCode.ts, AURA-ANDROID-REL-04 R2)', !/allowlist|invite|waitlist|isAllowed/i.test(login + signInLib) && /verifySignInCode/.test(login) && /\/api\/auth\/verify-code/.test(signInLib));

  console.log(`\n${count} checks`);
  if (!allPassed) { console.log('SOME CHECKS FAILED'); process.exit(1); }
  console.log('All landing guest-entry checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
