/**
 * AURA-ANDROID-REL-04 IR-01 / IR-03 (R2) -- account-bound plan creation and
 * mutations through the REAL client callers, plus the REAL mounted /find
 * sign-in-and-save flow, against the in-process routes and middleware of
 * rel04AccountIsolationHarness (synthetic accounts A and B).
 *
 *   TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx"}' npx ts-node --project tsconfig.jsdom-tests.json test/rel04BoundWritesJsdom.test.ts
 *
 * POST /api/plans persistence here is the harness `planStore`, which runs the
 * REAL refuseUnboundWrite -> session -> refuseAccountMismatch sequence before
 * storing (the real route's ordering and zero-db-call refusals are asserted in
 * rel04AccountIsolation SB5). Deterministic simulation, one process.
 */
import { React, mount, flush, act, click, typeInto } from './jsdomReactHarness';
import { Device, addUser, check, finish, planStore, plansOf, registerCurrentModulesAsTab, routes, storage, store } from './rel04AccountIsolationHarness';

const A = 'synthetic-user-a';
const B = 'synthetic-user-b';
addUser(A, 'alicesynth@example.invalid');
addUser(B, 'bobsynth@example.invalid');
routes['POST /api/plans'] = planStore.handler;

const dev = new Device();
const later = new Date(Date.now() + 3 * 3600_000);
const candidate = {
  start: later.toISOString(), end: new Date(later.getTime() + 3600_000).toISOString(), score: 8, label: 'VERY_GOOD', muhurtaScore: 5, reasons: [],
  metadata: { windowType: 'NEUTRAL', windowLabel: 'Steady', activityType: 'Workout', dateLabel: 'Today' },
};
dev.extra['/api/guest/timing-search'] = () => ({ candidates: [candidate] });
dev.extra['/api/guest/state'] = () => ({ token: 'guest-token-1' });
dev.extra['/api/auth/request-link'] = () => ({ sent: true });
(global as any).fetch = dev.fetch;
(window as any).fetch = dev.fetch;
(window as any).confirm = () => true;
(window as any).alert = () => {};

const acct = require('../apps/web/lib/accountSession');
const bf = require('../apps/web/lib/accountBoundFetch');
const { performSignOut } = require('../apps/web/lib/signOut');
const { saveUpcomingPlanFromCandidate, PlanOverlapSaveError } = require('../apps/web/components/PlanWithAuraView');
const { GuestFindClient } = require('../apps/web/app/find/GuestFindClient'); // installs the account-bound fetch wrapper
registerCurrentModulesAsTab('this-tab');

const settle = async (n = 10) => { for (let i = 0; i < n; i++) await flush(); };
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ');
const btn = (el: HTMLElement, re: RegExp) => [...el.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim())) as HTMLButtonElement | undefined;
const postsTo = (path: string) => dev.calls.filter((c) => c.key === `POST ${path}`);
async function verifyAs(user: string) { dev.signIn(user); await act(async () => { await acct.fetchVerifiedSession(); }); }

async function main() {
  // ---------------------------------------------------------------- P1-P4 plan creation through the shared helper
  await verifyAs(A);
  const bindingA = acct.captureAccountBinding();
  const ok = await saveUpcomingPlanFromCandidate(candidate, 60, { binding: bindingA });
  check('P1 ordinary plan creation, bound to A at the action -> stored for A, request stated A', ok && plansOf(A).length === 1 && postsTo('/api/plans').slice(-1)[0]?.expected === A);

  // Delayed confirmation after a RECOGNIZED switch: the client refuses to send.
  const delayed = acct.captureAccountBinding();
  await verifyAs(B);
  const before = postsTo('/api/plans').length;
  let refused = '';
  try { await saveUpcomingPlanFromCandidate(candidate, 60, { binding: delayed }); } catch (e: any) { refused = e?.reason; }
  check('P2 delayed plan confirmation bound to A after a recognized switch to B: refused, nothing sent, nothing for B', refused === 'stale' && postsTo('/api/plans').length === before && plansOf(B).length === 0);

  // Overlap override after an UNRECOGNIZED switch: the stored binding is reused; the server refuses.
  await verifyAs(A);
  planStore.overlapNext = true;
  let overlap: any = null;
  try { await saveUpcomingPlanFromCandidate(candidate, 60, { overlapPolicy: 'REJECT_ACTIVE_OVERLAP' }); } catch (e) { overlap = e; }
  check('P3 overlap refusal carries the binding of the original action (A)', overlap instanceof PlanOverlapSaveError && overlap.binding?.account === A);
  dev.signIn(B); // another tab signed in as B; this tab has not heard yet
  let overrideErr: any = null;
  try { await saveUpcomingPlanFromCandidate(candidate, 60, { overlapPolicy: 'ALLOW', binding: overlap.binding }); } catch (e) { overrideErr = e; }
  check('P4 "Save anyway" re-sent with A\'s binding under B\'s cookie -> refused by the server (409), nothing for B', overrideErr && postsTo('/api/plans').slice(-1)[0]?.status === 409 && plansOf(B).length === 0);
  await settle(2);
  check('P5 the 409 account_mismatch answer makes this tab forget its account (re-verify)', acct.getVerifiedAccount() === undefined);

  // ---------------------------------------------------------------- P6 unbound plan creation
  await verifyAs(A);
  const raw = await dev.fetch('/api/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'old client' }) });
  check('P6 plan creation without an account binding (out-of-date client) -> 503 upgrade, nothing stored', raw.status === 503 && plansOf(A).length === 1);

  // ---------------------------------------------------------------- P7-P9 global wrapper: existing mutations and reads
  const gate = dev.hold('POST', '/api/plans/p-1/skip', 'before');
  const mutation = window.fetch('/api/plans/p-1/skip', { method: 'POST' }).catch((e: unknown) => e);
  await gate.arrived;
  check('P7 an existing plan mutation states the account (A)', postsTo('/api/plans/p-1/skip').slice(-1)[0]?.expected === A);
  let signOutDone = false;
  const so = performSignOut({ fetch: dev.fetch, confirm: () => true }).then((r: any) => { signOutDone = true; return r; });
  await settle(4);
  check('P8 sign-out waits for (and first aborts) the in-flight mutation before sending logout', postsTo('/api/auth/logout').length === 0 || dev.calls.find((c) => c.key === 'POST /api/plans/p-1/skip')?.status === 'aborted');
  gate.release();
  await mutation;
  const r = await so;
  check('P8 then signs out', signOutDone && r.outcome === 'signed-out');
  await verifyAs(A);
  storage.setItem('aura_auth_transition_v2', JSON.stringify({ kind: 'signing-out', tx: 'x', tab: 'other-tab', at: Date.now() }));
  let blocked = '';
  try { await window.fetch('/api/habits/h-1/complete', { method: 'POST' }); } catch (e: any) { blocked = e?.reason; }
  check('P9 during another tab\'s sign-out, existing mutations are refused client-side', blocked === 'transition' && postsTo('/api/habits/h-1/complete').length === 0);
  storage.removeItem('aura_auth_transition_v2');
  dev.signIn(B); // unrecognized cookie change
  const read = await window.fetch('/api/habit-logs');
  await settle(2);
  check('P10 an account-sensitive read after an unrecognized cookie change is refused (409, no B data) and the tab re-verifies', read.status === 409 && acct.getVerifiedAccount() === undefined);

  // ---------------------------------------------------------------- F4 mounted /find: competing sign-in during verification
  dev.cookie = null;
  await act(async () => { await acct.fetchVerifiedSession(); });
  dev.verifyAs['alicesynth@example.invalid'] = A;
  async function driveToCode(): Promise<HTMLElement> {
    const h = await mount(React.createElement(GuestFindClient, { initialSource: 'DIRECT', initialRestoreToken: null }));
    await settle();
    const c = h.container as HTMLElement;
    await click(btn(c, /Workout/)!); await settle(3);
    await click(btn(c, /^Continue$/)!); await settle(3);
    await click(btn(c, /Find my moment/)!); await settle(6);
    await click(btn(c, /Save this moment/)!); await settle(3);
    await typeInto(c.querySelector('input[type=email]') as HTMLInputElement, 'alicesynth@example.invalid');
    await act(async () => { (c.querySelector('form') as HTMLFormElement).dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); });
    await settle(6);
    await typeInto(c.querySelector('input[placeholder="123456"]') as HTMLInputElement, '123456');
    (driveToCode as any).unmount = h.unmount;
    return c;
  }
  const submitCode = async (c: HTMLElement) => act(async () => { (c.querySelector('form') as HTMLFormElement).dispatchEvent(new (window as any).Event('submit', { bubbles: true, cancelable: true })); });

  {
    const c = await driveToCode();
    check('F4 precondition: /find reached the code step as a guest', /6-digit sign-in code/.test(text(c)));
    const plansBefore = store.plans.length;
    const planPostsBefore = postsTo('/api/plans').length;
    // verify-code signs in A (its Set-Cookie applied); a competing sign-in as B
    // lands right after it, before the confirming session read is sent.
    const gateV = dev.hold('POST', '/api/auth/verify-code', 'after');
    const submit = submitCode(c);
    await gateV.arrived;
    dev.signIn(B);
    gateV.release();
    await submit; await settle(6);
    check('F4 competing sign-in after verification: not confirmed and the user is told', /confirm which account|Another sign-in/i.test(text(c)));
    check('F4 no plan request sent at all, nothing stored', postsTo('/api/plans').length === planPostsBefore && store.plans.length === plansBefore);
    await (driveToCode as any).unmount();
  }
  {
    dev.cookie = null;
    await act(async () => { await acct.fetchVerifiedSession(); });
    const c = await driveToCode();
    const plansBefore = store.plans.length;
    // The competing sign-in lands after the confirming read was SENT (it saw A):
    // the save goes out bound to A and the server refuses it under B.
    const gateS = dev.hold('GET', '/api/auth/session', 'before');
    const submit = submitCode(c);
    await gateS.arrived;
    dev.signIn(B);
    gateS.release();
    await submit; await settle(6);
    check('F4b competing sign-in after the confirming read: the A-bound save is refused by the server (409); nothing stored', postsTo('/api/plans').slice(-1)[0]?.status === 409 && store.plans.length === plansBefore && plansOf(B).length === 0);
    check('F4b and the page does not claim success', !/is saved/.test(text(c)));
    await (driveToCode as any).unmount();
  }

  // ---------------------------------------------------------------- F5 mounted /find: late save completion after an account change
  {
    dev.cookie = null;
    await act(async () => { await acct.fetchVerifiedSession(); });
    const c = await driveToCode();
    const gateP = dev.hold('POST', '/api/plans', 'after'); // stored for A, answer delayed
    const submit = submitCode(c);
    await gateP.arrived;
    check('F5 the save request stated the account the code verified (A)', postsTo('/api/plans').slice(-1)[0]?.expected === A);
    // Another tab signs in as B and announces it.
    dev.signIn(B);
    await act(async () => { acct.__deliverStorageEventForTests({ key: 'aura_account_announce_v2', newValue: JSON.stringify({ account: B, tab: 'other-tab', at: Date.now() }) }); });
    await settle(4);
    gateP.release();
    await submit; await settle(8);
    check('F5 the late completion is not shown in the new context (no "is saved", flow reset)', !/is saved/.test(text(c)));
    check('F5 the plan exists for A only (the server bound it to A), never B', plansOf(B).length === 0 && plansOf(A).some((p) => p.title));
    await (driveToCode as any).unmount();
  }

  void bf;
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
