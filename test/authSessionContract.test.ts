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
const INSERT_OK = { rows: [{ expiresAt: new Date(Date.now() + 3_600_000), authSessionTxid: '987654321' }] };
const COMMIT_OK = [{ command: 'DO' }, { command: 'COMMIT' }];
const hasSid = (x: unknown) => !!x && typeof x === 'object' && 'sid' in (x as object);

/** R3: the commit helper sends ONE message (binding check + COMMIT); `commitStep` is its reply. */
async function decide(commitStep: Step) {
  const s = scriptedClient([{ ok: INSERT_OK }, commitStep]);
  const p = await createAuthSessionInTransaction(s.client as never, '00000000-0000-4000-8000-000000000001');
  const d = await commitAuthSessionTransaction(s.client as never, p);
  return { p, d, sent: s.sent };
}

async function main() {
  const committed = await decide({ ok: COMMIT_OK });
  check('run: acknowledged COMMIT of the originating transaction -> committed + authorization (no sid on either)', committed.d.outcome === 'committed' && !hasSid(committed.d) && !hasSid((committed.d as { authorization?: unknown }).authorization));
  check('run (R3): exactly two queries -- the INSERT, then ONE combined binding-check + COMMIT message', committed.sent.length === 2 && committed.sent[1].startsWith('DO $auth_session_commit'), committed.sent);
  const mismatch = await decide({ err: { code: 'P0A01' } });
  check('run (R3): binding check raises (different / no transaction, or row missing) -> rolled_back (transaction_mismatch), no authorization', mismatch.d.outcome === 'rolled_back' && (mismatch.d as { reason?: string }).reason === 'transaction_mismatch' && !('authorization' in mismatch.d));
  const aborted = await decide({ err: { code: '25P02' } });
  check('run: aborted transaction (25P02) -> rolled_back (aborted_transaction), no authorization', aborted.d.outcome === 'rolled_back' && (aborted.d as { reason?: string }).reason === 'aborted_transaction' && !('authorization' in aborted.d));
  const rolled = await decide({ ok: [{ command: 'DO' }, { command: 'ROLLBACK' }] });
  check('run: COMMIT answered ROLLBACK -> rolled_back, no authorization', rolled.d.outcome === 'rolled_back' && !('authorization' in rolled.d));
  const rejected = await decide({ err: { code: '40001' } });
  check('run: COMMIT rejected (40001) -> rolled_back (rejected_at_commit), no authorization', rejected.d.outcome === 'rolled_back' && !('authorization' in rejected.d));
  for (const [label, step] of [
    ['socket error, no SQLSTATE', { err: { message: 'Connection terminated unexpectedly' } }],
    ['connection exception 08006', { err: { code: '08006' } }],
    ['admin shutdown 57P01', { err: { code: '57P01' } }],
    ['unexpected single reply', { ok: { command: 'COMMIT' } }],
    ['unexpected reply shape (3 results)', { ok: [{ command: 'DO' }, { command: 'COMMIT' }, { command: 'COMMIT' }] }],
  ] as const) {
    const r = await decide(step as Step);
    check(`run: ${label} -> ambiguous, no authorization`, r.d.outcome === 'ambiguous' && !('authorization' in r.d), r.d);
    const again = await commitAuthSessionTransaction({} as never, r.p).then(() => 'resolved', (e) => (e instanceof TypeError ? 'TypeError' : 'other'));
    check(`run: ${label} -> the provisional can never be committed again`, again === 'TypeError');
  }
  const noTxid = scriptedClient([{ ok: { rows: [{ expiresAt: new Date(Date.now() + 3_600_000) }] } }]);
  const nt = await createAuthSessionInTransaction(noTxid.client as never, '00000000-0000-4000-8000-000000000001').then(() => 'created', (e) => (e?.reason === 'shape' ? 'shape' : 'other'));
  check('run (R3): an INSERT reply without the originating transaction id never yields a provisional session', nt === 'shape', nt);

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
