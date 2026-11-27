/**
 * AURA-AUTH-SESSION-01-I1 R1 (finding 39232-02) -- the provisional/committed
 * result contract, checked at COMPILE time (ts-node type-checks this file:
 * every `@ts-expect-error` below must still be an error, or the run fails) and
 * at run time. No database.
 *
 *   npx ts-node test/authSessionContract.test.ts
 */
import type { CommittedAuthSession, ProvisionalAuthSession } from '../apps/web/lib/authSessionStore';
import { confirmCommittedAuthSession, createAuthSession, createAuthSessionInTransaction } from '../apps/web/lib/authSessionStore';

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

/** Compile-time only: never called. Each line must fail to type-check. */
function compileTimeContract(p: ProvisionalAuthSession, c: CommittedAuthSession) {
  // @ts-expect-error -- a provisional session has no raw session id
  void p.sid;
  // @ts-expect-error -- a provisional session is not a committed one
  const asCommitted: CommittedAuthSession = p;
  // @ts-expect-error -- a committed session cannot be fabricated from a plain object (private brand)
  const forged: CommittedAuthSession = { state: 'committed', sid: 'x', idHash: 'y', userId: 'z', expiresAt: new Date() };
  // @ts-expect-error -- the provisional state can never claim to be committed
  const claimed: ProvisionalAuthSession = { ...p, state: 'committed' };
  // A committed session exposes its raw id (the only supported source for a token).
  const sid: string = c.sid;
  // confirmCommittedAuthSession is the only bridge, and it may yield no session.
  type Confirmed = Awaited<ReturnType<typeof confirmCommittedAuthSession>>;
  const maybe: Confirmed = null;
  type Provisional = Awaited<ReturnType<typeof createAuthSessionInTransaction>>;
  type Committed = Awaited<ReturnType<typeof createAuthSession>>;
  const pState: Provisional['state'] = 'provisional';
  const cState: Committed['state'] = 'committed';
  return [asCommitted, forged, claimed, sid, maybe, pState, cState];
}
void compileTimeContract;

check('compile-time contract type-checked (provisional has no sid, is not committed, committed cannot be forged)', true);

async function main() {
  // Run-time: a hand-made provisional object (not from the helper) cannot be confirmed.
  const fake = Object.freeze({ state: 'provisional' as const, idHash: 'A'.repeat(43), userId: '00000000-0000-4000-8000-000000000000', expiresAt: new Date() });
  const r = await confirmCommittedAuthSession({} as never, fake).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
  check('run-time: a provisional object not produced by createAuthSessionInTransaction cannot be confirmed', r === 'TypeError');
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
