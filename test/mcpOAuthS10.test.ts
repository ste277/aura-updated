/**
 * AURA-MCP-02-I2b-S10 -- offline regression tests (no database).
 *
 *   SEC   secret compatibility (I2b-R-6 follow-up): every supported CSPRNG
 *         format is accepted -- including `openssl rand -hex 16`, which the
 *         S8 floor refused every time -- for each role: current AND retained
 *         cookie keys, pairwise salt, audit key; every S8 weak pattern and
 *         the "predictable balanced" sample are refused; no value in errors
 *   BUD   request time budget: the store calls of one request share ONE
 *         budget; a spent budget never reaches the database; outside a
 *         budget nothing changes
 *   DL    one deadline covers checkout + statement + COMMIT (the S8 COMMIT
 *         clock restart is gone); uncertain connections are destroyed and
 *         the pool recovers with a fresh connection
 *   HOLD  held activation transaction: committed / unknown / not_committed,
 *         abort, hold expiry, cancellation, phase-1 failure
 *   QO    query-only adapter fallback: nothing is written before commit()
 */
import { createHash, randomBytes } from 'crypto';
import { assessConfiguredSecret, assessSecret, loadOAuthKeysFromEnv } from '../packages/mcp-tools/src/auth/keys';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { boundedStatement, heldStatement, requestBudgetRemainingMs, runWithRequestBudget, outsideRequestBudget, StoreUnavailableError, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { check, sharedKeys, sleep, summary } from './mcpOAuthI2bHarness';

const rejects = (f: () => unknown, mustNotContain: string[] = []): boolean => {
  try {
    f();
    return false;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return mustNotContain.every((s) => !m.includes(s));
  }
};

/** A fake pg pool: per-statement behaviour, counts connections and how they were returned. */
function fakePool(behave: (text: string) => Promise<unknown> | unknown) {
  const st = { connects: 0, clean: 0, destroyed: 0, statements: [] as string[] };
  const pool = <BoundedPool>(<unknown>{
    connect: async () => {
      st.connects += 1;
      return {
        query: async (t: string) => {
          st.statements.push(t.split(';')[0]);
          const r = await behave(t);
          return r ?? { rows: [{ ok: 1 }], rowCount: 1, command: t.startsWith('BEGIN') ? 'SET' : t === 'COMMIT' ? 'COMMIT' : 'UPDATE' };
        },
        release: (err?: unknown) => {
          if (err) st.destroyed += 1;
          else st.clean += 1;
        },
      };
    },
  });
  return { pool, st };
}
const opts = { deadlineMs: 300, statementTimeoutMs: 200, lockTimeoutMs: 100 };
const failure = (p: Promise<unknown>) => p.then(() => null, (e) => e as unknown);

async function main() {
  // ------------------------------------------------------------------ SEC
  {
    // AURA-MCP-CI-01: deterministic, policy-aware coverage. The former loop drew
    // FRESH random samples and required every one to be accepted; an untagged
    // 16-byte hex value with no a-f letter (P = (10/16)^32 ~= 2.9e-7; 20,000
    // samples -> ~0.6% of runs) is refused BY POLICY (it is judged as legacy
    // text, exactly as the S8 rule did). Samples are now derived from a fixed
    // seed (the same 20,000 values on every run) and each is checked against
    // the documented policy instead of "always accepted".
    const s8Legacy = (v: string) => {
      const n = [...v].length;
      const counts = new Map<string, number>();
      for (const ch of v) counts.set(ch, (counts.get(ch) ?? 0) + 1);
      let h = 0;
      for (const c of counts.values()) h -= (c / n) * Math.log2(c / n);
      let per = false;
      for (let p = 1; p <= v.length / 2 && !per; p += 1) {
        let same = true;
        for (let i = p; i < v.length && same; i += 1) same = v[i] === v[i - p];
        per = same;
      }
      return v.length >= 32 && new Set(v).size >= 10 && !per && h * n >= 128;
    };
    const seeded = (tag: string, i: number, len: number) => {
      let out = Buffer.alloc(0);
      for (let b = 0; out.length < len; b += 1) out = Buffer.concat([out, createHash('sha256').update(`aura-ci01-s10:${tag}:${i}:${b}`).digest()]);
      return out.subarray(0, len);
    };
    // Policy for an untagged hex value: hex credit needs >= 1 a-f letter; a
    // digits-only value is judged by the legacy S8 rule.
    const hexExpectation = (v: string) => (/[a-fA-F]/.test(v) ? true : s8Legacy(v));
    const formats: [string, (i: number) => string, (v: string) => boolean][] = [
      ['hex, 16 bytes (openssl rand -hex 16)', (i) => seeded('hex16', i, 16).toString('hex'), hexExpectation],
      ['HEX upper case, 16 bytes', (i) => seeded('HEX16', i, 16).toString('hex').toUpperCase(), hexExpectation],
      ['hex, 20 bytes', (i) => seeded('hex20', i, 20).toString('hex'), hexExpectation],
      ['hex, 32 bytes (openssl rand -hex 32)', (i) => seeded('hex32', i, 32).toString('hex'), hexExpectation],
      ['base64, 24 bytes (openssl rand -base64 24)', (i) => seeded('b64-24', i, 24).toString('base64'), () => true],
      ['base64, 32 bytes with padding (openssl rand -base64 32)', (i) => seeded('b64-32', i, 32).toString('base64'), () => true],
      ['base64url, 24 bytes', (i) => seeded('b64u-24', i, 24).toString('base64url'), () => true],
      ['base64url, 32 bytes', (i) => seeded('b64u-32', i, 32).toString('base64url'), () => true],
    ];
    const N = 20_000;
    for (const [label, gen, expect] of formats) {
      let mismatches = 0;
      let refusedByPolicy = 0;
      for (let i = 0; i < N; i += 1) {
        const v = gen(i);
        const want = expect(v);
        if (!want) refusedByPolicy += 1;
        if (assessSecret(v).ok !== want) mismatches += 1;
      }
      check(`SEC policy-aware: ${label} (${N} fixed-seed samples; every verdict matches the documented policy; ${refusedByPolicy} refused by policy)`, mismatches === 0, { mismatches, refusedByPolicy });
    }
    // Deterministic fixtures: the recorded digits-only value and the tagged path.
    const digitsOnly = '64976964540383724985906370631171'; // recorded by a 4,000,000-sample probe
    const dRes = assessSecret(digitsOnly);
    check('SEC reproduction: the recorded digits-only 16-byte hex value is refused untagged (legacy text rule) -- the old "always accepted" assertion fails on it', !dRes.ok && dRes.format === 'text', dRes);
    check('SEC the same digits-only value is ACCEPTED when explicitly tagged "hex:" (128 bits)', assessConfiguredSecret(`hex:${digitsOnly}`).ok && assessConfiguredSecret(`hex:${digitsOnly}`).bits === 128);
    for (const v of ['7f3a9c0e5b2d8146ad3e9f7c0b1a5e28', '0B5E7D2A9C4F81E63A7D0C9B2E5F8146', '3c9e1f7a0b5d2e8c4a6f9d1b7e3c5a08d2f6b4e1']) {
      check(`SEC representative untagged hex value accepted per policy: ${v.slice(0, 8)}... (${v.length} chars)`, assessSecret(v).ok && assessSecret(v).format === 'hex');
    }
    for (const [label, v] of [['32 x "a"', 'a'.repeat(32)], ['balanced counting hex', '0123456789abcdeffedcba9876543210'], ['low-variety mixed case', 'ghijGHIJhgjiHGJIijghIJGHjihgJIHG'], ['odd-length hex-lexical, 8 symbols (S11 overlap class)', 'acf0be1dab0fce1adb1fc0eadf1b0caedb1']] as [string, string][]) {
      check(`SEC refused legacy value stays refused: ${label}`, !assessSecret(v).ok, assessSecret(v));
    }
    check('SEC mistagged hex under "base64:" stays refused (ambiguous_encoding)', assessConfiguredSecret(`base64:${'7f3a9c0e5b2d8146ad3e9f7c'}`).reason === 'ambiguous_encoding');
    check('SEC strength is format-aware: hex 4 bits/char, base64 6 bits/char', assessSecret('7f3a9c0e5b2d8146ad3e9f7c0b1a5e28').bits === 128 && assessSecret(seeded('fmt', 0, 24).toString('base64url')).bits === 192);

    // Every role, including RETAINED rotation keys, accepts each supported format.
    const strong = () => randomBytes(32).toString('base64url');
    // I2b-S12: new configuration declares its format (base64url:/base64:/hex:); untagged values only as retained cookie keys.
    const base = () => ({ AURA_MCP_OAUTH_COOKIE_KEYS: `base64url:${strong()}`, AURA_MCP_OAUTH_PAIRWISE_SALT: `base64url:${strong()}`, AURA_MCP_AUDIT_KEY: `base64url:${strong()}` });
    const jwksEnv = () => ({ AURA_MCP_OAUTH_JWKS: JSON.stringify(sharedKeys().jwks) });
    const hex16 = () => randomBytes(16).toString('hex');
    const roles: [string, (v: string) => Record<string, string>][] = [
      ['current cookie key', (v) => ({ AURA_MCP_OAUTH_COOKIE_KEYS: v })],
      ['retained (older) cookie key', (v) => ({ AURA_MCP_OAUTH_COOKIE_KEYS: `base64url:${strong()},${v}` })],
      ['pairwise salt', (v) => ({ AURA_MCP_OAUTH_PAIRWISE_SALT: v })],
      ['audit key', (v) => ({ AURA_MCP_AUDIT_KEY: v })],
    ];
    for (const [role, put] of roles) {
      check(`SEC loader accepts a 16-byte hex ${role} (declared hex:)`, !rejects(() => loadOAuthKeysFromEnv({ ...jwksEnv(), ...base(), ...put(`hex:${hex16()}`) })));
      check(`SEC loader accepts a 24-byte base64 ${role} (declared base64:)`, !rejects(() => loadOAuthKeysFromEnv({ ...jwksEnv(), ...base(), ...put(`base64:${randomBytes(24).toString('base64')}`) })));
      // I2b-S12: an UNTAGGED value is the legacy compatibility path -- retained cookie keys only.
      const untaggedOk = !rejects(() => loadOAuthKeysFromEnv({ ...jwksEnv(), ...base(), ...put(hex16()) }));
      check(`SEC untagged 16-byte hex as ${role}: ${role.startsWith('retained') ? 'accepted (legacy path)' : 'refused (format required)'}`, untaggedOk === role.startsWith('retained'));
    }

    const weak: [string, string][] = [
      ['32 x "a"', 'a'.repeat(32)],
      ['32 x "0"', '0'.repeat(32)],
      ['"ab" repeated', 'ab'.repeat(16)],
      ['"0123456789" repeated', '0123456789'.repeat(4)],
      ['a short word repeated', 'secret!'.repeat(6)],
      ['predictable balanced hex (S9 sample class)', '0123456789abcdeffedcba9876543210'],
      ['predictable balanced HEX', '0123456789ABCDEFFEDCBA9876543210'],
      ['hex counting run', '0123456789abcdef' + randomBytes(8).toString('hex')],
      ['alphabet run (base64 order)', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'],
      ['one character then zeros', 'x' + '0'.repeat(31)],
      ['mostly one character', 'a'.repeat(20) + randomBytes(6).toString('hex')],
      ['digits only (106 bits for 32)', '83720194857362910485736291048573'],
      ['lower-case words (S8 rule)', 'correcthorsebatterystapleokayyes'],
      ['hex, 15 bytes (30 chars, 120 bits)', randomBytes(15).toString('hex')],
      ['base64, 16 bytes (too short)', randomBytes(16).toString('base64')],
    ];
    for (const [label, v] of weak) {
      check(`SEC refused: ${label}`, !assessSecret(v).ok, assessSecret(v));
      for (const [role, put] of roles) check(`SEC loader refuses it as ${role}, without echoing the value`, rejects(() => loadOAuthKeysFromEnv({ ...jwksEnv(), ...base(), ...put(v) }), [v]));
    }
    // Compatibility: nothing the S8 rule accepted is newly refused (reference copy of the S8 rule).
    const s8Rule = (v: string) => {
      const n = [...v].length;
      const counts = new Map<string, number>();
      for (const ch of v) counts.set(ch, (counts.get(ch) ?? 0) + 1);
      let h = 0;
      for (const c of counts.values()) h -= (c / n) * Math.log2(c / n);
      let per = false;
      for (let p = 1; p <= v.length / 2 && !per; p += 1) {
        let same = true;
        for (let i = p; i < v.length && same; i += 1) same = v[i] === v[i - p];
        per = same;
      }
      return v.length >= 32 && new Set(v).size >= 10 && !per && h * n >= 128;
    };
    const fixtures = ['synthetic-cookie-key-new-0123456789abcdef', 'synthetic-cookie-key-old-0123456789abcdef', 'synthetic-pairwise-salt-0123456789abcdef', 'synthetic-audit-key-x-0123456789abcdefgh', 'Tr0ub4dor&3-horse-battery-staple-2026!'];
    check('SEC compatibility: synthetic / human-made strings the S8 rule accepted are still accepted', fixtures.every((f) => !s8Rule(f) || assessSecret(f).ok), fixtures.map((f) => [s8Rule(f), assessSecret(f)]));
    const ALPH = ['abcdefghijklmnopqrstuvwxyz0123456789-', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+= ', 'abcdef0123456789-_.'];
    let s8Accepted = 0;
    let newlyRefused = 0;
    for (let i = 0; i < 30_000; i += 1) {
      const a = ALPH[i % ALPH.length];
      const len = 32 + (i % 17);
      const bytes = randomBytes(len);
      const v = Array.from(bytes, (b) => a[b % a.length]).join('');
      if (s8Rule(v)) {
        s8Accepted += 1;
        if (!assessSecret(v).ok) newlyRefused += 1;
      }
    }
    check(`SEC compatibility: of ${s8Accepted} random mixed-alphabet strings the S8 rule accepted, none is newly refused`, s8Accepted > 20_000 && newlyRefused === 0, { s8Accepted, newlyRefused });
    check('SEC a 15-byte hex secret is refused for length, a 16-byte one is accepted (the floor is exactly 128 bits)', assessSecret(randomBytes(15).toString('hex')).reason === 'short' && assessSecret(randomBytes(16).toString('hex')).ok);
  }

  // ------------------------------------------------------------------ BUD
  {
    const slow = fakePool(async (t) => {
      if (t === 'UPDATE x') await sleep(200);
    });
    const t0 = Date.now();
    const out = await runWithRequestBudget(500, async () => {
      const a = await failure(boundedStatement(slow.pool, 'UPDATE x', [], { ...opts, deadlineMs: 3000 }));
      const b = await failure(boundedStatement(slow.pool, 'UPDATE x', [], { ...opts, deadlineMs: 3000 }));
      const c = await failure(boundedStatement(slow.pool, 'UPDATE x', [], { ...opts, deadlineMs: 3000 }));
      return { a, b, c, left: requestBudgetRemainingMs() };
    });
    const took = Date.now() - t0;
    check('BUD two 200 ms calls fit a 500 ms budget; the third is cut by what is left, not by its own 3 s deadline', out.a === null && out.b === null && out.c instanceof StoreUnavailableError && (out.c as StoreUnavailableError).reason === 'timeout', out);
    check('BUD the whole request stays within its budget (+ timer slack)', took < 650, took);
    const connectsBefore = slow.st.connects;
    const spent = await runWithRequestBudget(1, async () => {
      await sleep(5);
      return failure(boundedStatement(slow.pool, 'UPDATE x', [], opts));
    });
    check('BUD a call after the budget is spent fails at once and never touches the database', spent instanceof StoreUnavailableError && slow.st.connects === connectsBefore);
    const outside = await runWithRequestBudget(1, async () => {
      await sleep(5);
      return outsideRequestBudget(() => failure(boundedStatement(slow.pool, 'UPDATE x', [], opts)));
    });
    check('BUD work run outside the budget (the post-hand-off COMMIT) is not cut by it', outside === null);
    check('BUD outside any budget nothing changes (Infinity left)', requestBudgetRemainingMs() === Infinity);
    check('BUD invalid budgets are refused', rejects(() => runWithRequestBudget(0, async () => 1)) && rejects(() => runWithRequestBudget(1.5, async () => 1)));
  }

  // ------------------------------------------------------------------ DL
  {
    const p = fakePool(async (t) => {
      if (t === 'UPDATE x') await sleep(200);
      if (t === 'COMMIT') await new Promise(() => undefined); // never answers
    });
    const t0 = Date.now();
    const e = await failure(boundedStatement(p.pool, 'UPDATE x', [], opts));
    const took = Date.now() - t0;
    check('DL a hanging COMMIT after a 200 ms statement fails at the ONE 300 ms deadline (S8 restarted the clock: ~500 ms)', e instanceof StoreUnavailableError && (e as StoreUnavailableError).reason === 'timeout' && took < 380, took);
    check('DL the uncertain connection is destroyed, never returned to the pool', p.st.destroyed === 1 && p.st.clean === 0, p.st);
    const tight = fakePool(async (t) => {
      if (t === 'COMMIT') await new Promise(() => undefined);
    });
    const t1 = Date.now();
    await failure(boundedStatement(tight.pool, 'UPDATE x', [], { ...opts, deadlineMs: 2000, commitDeadlineMs: 100 }));
    check('DL commitDeadlineMs can only tighten the COMMIT phase', Date.now() - t1 < 250);
    // Recovery: after a destroyed connection the next call gets a fresh one and succeeds.
    let n = 0;
    const flaky = fakePool(async (t) => {
      if (t === 'COMMIT' && (n += 1) === 1) throw new Error('connection reset');
    });
    const first = await failure(boundedStatement(flaky.pool, 'UPDATE x', [], opts));
    const second = await failure(boundedStatement(flaky.pool, 'UPDATE x', [], opts));
    check('DL connection recovery: a failed COMMIT destroys that connection; the next call checks out a fresh one and succeeds', first instanceof StoreUnavailableError && second === null && flaky.st.connects === 2 && flaky.st.destroyed === 1 && flaky.st.clean === 1, flaky.st);
    const rb = fakePool(async (t) => (t === 'COMMIT' ? { rows: [], rowCount: null, command: 'ROLLBACK' } : undefined));
    check('DL a ROLLBACK tag is never a success', (await failure(boundedStatement(rb.pool, 'UPDATE x', [], opts))) instanceof StoreUnavailableError);
  }

  // ------------------------------------------------------------------ HOLD
  {
    const hold = { ...opts, holdMs: 400 };
    const ok = fakePool(() => undefined);
    const h1 = await heldStatement(ok.pool, 'UPDATE x', [], hold);
    const statementsBeforeCommit = [...ok.st.statements];
    check('HOLD the statement ran but nothing was committed before commit()', h1.result.rowCount === 1 && !statementsBeforeCommit.includes('COMMIT'), statementsBeforeCommit);
    check('HOLD commit() -> committed on the COMMIT tag; connection returned cleanly', (await h1.commit(200)) === 'committed' && ok.st.clean === 1 && ok.st.destroyed === 0, ok.st);
    check('HOLD a second commit() is a no-op (not_committed)', (await h1.commit(200)) === 'not_committed');

    const rb = fakePool(async (t) => (t === 'COMMIT' ? { rows: [], rowCount: null, command: 'ROLLBACK' } : undefined));
    const h2 = await heldStatement(rb.pool, 'UPDATE x', [], hold);
    check('HOLD a ROLLBACK tag -> unknown, connection destroyed', (await h2.commit(200)) === 'unknown' && rb.st.destroyed === 1);

    const hang = fakePool(async (t) => {
      if (t === 'COMMIT') await new Promise(() => undefined);
    });
    const h3 = await heldStatement(hang.pool, 'UPDATE x', [], hold);
    const t0 = Date.now();
    const o3 = await h3.commit(150);
    check('HOLD a COMMIT that never answers -> unknown after its bound, connection destroyed', o3 === 'unknown' && Date.now() - t0 < 250 && hang.st.destroyed === 1, { o3, st: hang.st });

    const ab = fakePool(() => undefined);
    const h4 = await heldStatement(ab.pool, 'UPDATE x', [], hold);
    h4.abort();
    h4.abort();
    check('HOLD abort() destroys the connection once (server rolls back), never sends COMMIT; later commit() -> not_committed', ab.st.destroyed === 1 && !ab.st.statements.includes('COMMIT') && (await h4.commit(100)) === 'not_committed', ab.st);

    const ex = fakePool(() => undefined);
    const h5 = await heldStatement(ex.pool, 'UPDATE x', [], { ...opts, holdMs: 100 });
    await sleep(180);
    check('HOLD a hold that is never decided is aborted at holdMs (no COMMIT ever sent)', ex.st.destroyed === 1 && !ex.st.statements.includes('COMMIT') && (await h5.commit(100)) === 'not_committed', ex.st);

    const bad = fakePool(async (t) => {
      if (t === 'UPDATE x') throw new Error('injected');
    });
    const e6 = await failure(heldStatement(bad.pool, 'UPDATE x', [], hold));
    check('HOLD a failing statement rejects with StoreUnavailableError and destroys the connection', e6 instanceof StoreUnavailableError && bad.st.destroyed === 1);

    const slowStmt = fakePool(async (t) => {
      if (t === 'UPDATE x') await sleep(500);
    });
    const e7 = await failure(heldStatement(slowStmt.pool, 'UPDATE x', [], hold));
    await sleep(350);
    check('HOLD phase 1 is bounded by deadlineMs (cancellation): timeout, connection destroyed, nothing committed', e7 instanceof StoreUnavailableError && (e7 as StoreUnavailableError).reason === 'timeout' && slowStmt.st.destroyed === 1 && !slowStmt.st.statements.includes('COMMIT'), slowStmt.st);

    const spentPool = fakePool(() => undefined);
    const e8 = await runWithRequestBudget(1, async () => {
      await sleep(5);
      return failure(heldStatement(spentPool.pool, 'UPDATE x', [], hold));
    });
    check('HOLD a spent request budget never starts an activation', e8 instanceof StoreUnavailableError && spentPool.st.connects === 0);
    check('HOLD invalid holdMs refused', (await failure(heldStatement(ok.pool, 'UPDATE x', [], { ...opts, holdMs: 0 }))) instanceof TypeError);
  }

  // ------------------------------------------------------------------ QO
  {
    const sent: string[] = [];
    const db = {
      query: async (text: string) => {
        sent.push(text.trim().split(/\s+/)[0]);
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      },
    };
    const store = createPostgresAdapterStore({ db: db as never, fieldKeys: sharedKeys().cookieKeys, cleanupEvery: 0 });
    const a = await store.beginIssuedActivation?.('AuthorizationCode', 'code-qo-1');
    check('QO query-only db: begin only READS (no write before hand-off)', !!a && sent.join(',') === 'SELECT', sent);
    a?.abort();
    check('QO abort writes nothing; commit after abort -> not_committed', (await a?.commit()) === 'not_committed' && !sent.includes('UPDATE'), sent);
    const b = await store.beginIssuedActivation?.('AuthorizationCode', 'code-qo-2');
    check('QO commit writes the activation exactly once -> committed', (await b?.commit()) === 'committed' && sent.filter((s) => s === 'UPDATE').length === 1, sent);
    check('QO non-code models have no activation', (await store.beginIssuedActivation?.('AccessToken', 'x')) === null);
  }

  summary('AURA-MCP-02-I2b-S10 offline');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
