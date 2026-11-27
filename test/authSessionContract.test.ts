/**
 * AURA-AUTH-SESSION-01-I1 -- the commit-authorization contract (R1 39232-02,
 * corrected in R2 39235), checked at COMPILE time (ts-node type-checks this
 * file: every `@ts-expect-error` below must still be an error, or the run
 * fails) and at RUN time with a scripted caller client. No database.
 *
 *   npx ts-node test/authSessionContract.test.ts
 *
 * Session material (a CommittedAuthSession with a raw sid) is reachable only
 * through: acknowledged COMMIT -> CommitAuthorization -> releaseCommittedAuthSession.
 */
import type {
  AmbiguousCommitClassification,
  CallerCommitDecision,
  CommitAuthorization,
  CommittedAuthSession,
  ProvisionalAuthSession,
} from '../apps/web/lib/authSessionStore';
import {
  classifyAmbiguousCommit,
  commitAuthSessionTransaction,
  createAuthSessionInTransaction,
  releaseCommittedAuthSession,
} from '../apps/web/lib/authSessionStore';

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
}

/** Compile-time only: never called. Each `@ts-expect-error` line must fail to type-check. */
async function compileTimeContract(p: ProvisionalAuthSession, d: CallerCommitDecision, a: CommitAuthorization, c: CommittedAuthSession) {
  // @ts-expect-error -- a provisional session has no raw session id
  void p.sid;
  // @ts-expect-error -- a provisional session is not a committed one
  const asCommitted: CommittedAuthSession = p;
  // @ts-expect-error -- a committed session cannot be fabricated from a plain object (private brand)
  const forgedSession: CommittedAuthSession = { state: 'committed', sid: 'x', idHash: 'y', userId: 'z', expiresAt: new Date() };
  // @ts-expect-error -- a commit authorization cannot be fabricated from a plain object (private brand)
  const forgedAuth: CommitAuthorization = { kind: 'commit_authorization', idHash: 'y', userId: 'z' };
  // @ts-expect-error -- release takes an authorization, never a provisional session
  await releaseCommittedAuthSession({} as never, p);
  // @ts-expect-error -- a decision cannot be used as an authorization without narrowing to 'committed'
  await releaseCommittedAuthSession({} as never, d.authorization);
  if (d.outcome === 'ambiguous') {
    // @ts-expect-error -- an ambiguous commit carries no authorization
    void d.authorization;
  }
  if (d.outcome === 'rolled_back') {
    // @ts-expect-error -- a rolled-back commit carries no authorization
    void d.authorization;
  }
  const label: AmbiguousCommitClassification = await classifyAmbiguousCommit({} as never, p);
  // @ts-expect-error -- a read-back classification is a label, never session material
  const fromLabel: CommittedAuthSession = label;
  // @ts-expect-error -- a classification has no sid
  void label.sid;
  // Supported path: only a narrowed 'committed' decision yields an authorization, and release may still yield none.
  if (d.outcome === 'committed') {
    const released: CommittedAuthSession | null = await releaseCommittedAuthSession({} as never, d.authorization);
    void released;
  }
  const sid: string = c.sid;
  return [asCommitted, forgedSession, forgedAuth, fromLabel, sid, a];
}
void compileTimeContract;
check('compile-time contract type-checked (no sid on provisional / decision / label; no forged session or authorization; only a narrowed committed decision authorizes)', true);

// --- Run time: a scripted caller client (no database) ---------------------------------
type Step = { ok?: unknown; err?: { code?: string; message?: string } } | 'hang';
function scriptedClient(steps: Step[]) {
  const sent: string[] = [];
  return {
    sent,
    client: {
      query(text: string) {
        sent.push(String(text).slice(0, 24));
        const step = steps[Math.min(sent.length - 1, steps.length - 1)];
        if (step === 'hang') return new Promise(() => {});
        if (step.err) return Promise.reject(Object.assign(new Error(step.err.message ?? 'x'), step.err.code ? { code: step.err.code } : {}));
        return Promise.resolve(step.ok);
      },
    },
  };
}
const INSERT_OK = { rows: [{ expiresAt: new Date(Date.now() + 3_600_000) }] };
const PRECHECK_OK = { rows: [{ in_tx: true, mine: true }] };
const hasSid = (x: unknown) => !!x && typeof x === 'object' && 'sid' in (x as object);

async function decide(commitStep: Step, precheck: Step = { ok: PRECHECK_OK }) {
  const s = scriptedClient([{ ok: INSERT_OK }, precheck, commitStep]);
  const p = await createAuthSessionInTransaction(s.client as never, '00000000-0000-4000-8000-000000000001');
  const d = await commitAuthSessionTransaction(s.client as never, p);
  return { p, d, sent: s.sent };
}

async function main() {
  const committed = await decide({ ok: { command: 'COMMIT' } });
  check('run: acknowledged COMMIT -> committed + authorization (no sid on either)', committed.d.outcome === 'committed' && !hasSid(committed.d) && !hasSid((committed.d as { authorization?: unknown }).authorization));
  const rolled = await decide({ ok: { command: 'ROLLBACK' } });
  check('run: COMMIT answered ROLLBACK -> rolled_back, no authorization', rolled.d.outcome === 'rolled_back' && !('authorization' in rolled.d));
  const rejected = await decide({ err: { code: '40001' } });
  check('run: COMMIT rejected (40001) -> rolled_back (rejected_at_commit), no authorization', rejected.d.outcome === 'rolled_back' && !('authorization' in rejected.d));
  for (const [label, step] of [
    ['socket error, no SQLSTATE', { err: { message: 'Connection terminated unexpectedly' } }],
    ['connection exception 08006', { err: { code: '08006' } }],
    ['admin shutdown 57P01', { err: { code: '57P01' } }],
    ['unexpected reply', { ok: { command: 'SELECT' } }],
  ] as const) {
    const r = await decide(step);
    check(`run: ${label} -> ambiguous, no authorization`, r.d.outcome === 'ambiguous' && !('authorization' in r.d), r.d);
    const again = await commitAuthSessionTransaction({} as never, r.p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check(`run: ${label} -> the provisional can never be committed again`, again === 'TypeError');
  }
  const notInTx = await decide({ ok: { command: 'COMMIT' } }, { ok: { rows: [{ in_tx: false, mine: false }] } });
  check('run: no open transaction holding the row -> rolled_back (session_not_in_transaction); COMMIT never sent', notInTx.d.outcome === 'rolled_back' && notInTx.sent.length === 2 && !notInTx.sent.includes('COMMIT'), notInTx);
  const preFail = await decide({ ok: { command: 'COMMIT' } }, { err: { message: 'socket hang up' } });
  check('run: connection lost before COMMIT was sent -> rolled_back (commit_not_sent), never authorized', preFail.d.outcome === 'rolled_back' && !preFail.sent.includes('COMMIT'));
  const aborted = await decide({ ok: { command: 'ROLLBACK' } }, { err: { code: '25P02' } });
  check('run: aborted transaction (25P02 on the check) -> COMMIT sent, answers ROLLBACK -> rolled_back', aborted.d.outcome === 'rolled_back' && aborted.sent.includes('COMMIT'));

  const forged = await releaseCommittedAuthSession({} as never, Object.freeze({ kind: 'commit_authorization', idHash: 'A'.repeat(43), userId: '00000000-0000-4000-8000-000000000001' }) as never).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
  check('run: a forged authorization is refused', forged === 'TypeError');
  const fakeProvisional = Object.freeze({ state: 'provisional' as const, idHash: 'A'.repeat(43), userId: '00000000-0000-4000-8000-000000000001', expiresAt: new Date() });
  const fp = await commitAuthSessionTransaction({} as never, fakeProvisional).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
  check('run: a hand-made provisional object cannot be committed / authorized', fp === 'TypeError');
  const cls = await classifyAmbiguousCommit({} as never, committed.p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
  check('run: classification is refused unless the commit was ambiguous', cls === 'TypeError');

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
