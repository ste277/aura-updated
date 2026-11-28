#!/usr/bin/env python3
"""AURA-AUTH-SESSION-01-I1 R3 (39237) -- mutation negative controls: historical M1-M9 re-executed against R3 (M10 retired, superseded by N1/N2), R3 N1-N5 added.

Each mutation deliberately removes one protection from the R1 code, runs the
suites that must catch it, records the failing checks, then restores the file
and verifies its sha256 is identical to the original.

Usage (from the worktree root, disposable loopback DB):
  DATABASE_URL=postgresql://...@127.0.0.1:PORT/DB python3 AURA_AUTH_SESSION_01_I1_R3_EVIDENCE/mutations/runMutations.py
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile

MUTATIONS = [
    # Historical R1 controls, re-executed against R3
    ("M1 remove server statement timeout", "apps/web/lib/authSessionDb.ts",
     [("`BEGIN; SET LOCAL statement_timeout = '${statementMs}ms'; ` +", "`BEGIN; SELECT 1; ` +")], ["authSessionR1Db", "authSessionStoreDb"]),
    ("M2 unsafe connection reuse", "apps/web/lib/authSessionDb.ts",
     [("client.release(new Error(reason));", "client.release();")], ["authSessionDeadline", "authSessionStoreDb"]),
    ("M3 deadline reset on retry", "apps/web/lib/authSessionStore.ts",
     [("SESSION_WRITE_BOUNDS, { deadlineAt, clock });", "SESSION_WRITE_BOUNDS, { clock });")], ["authSessionDeadline", "authSessionR1Db"]),
    ("M4 retry confirmed failures too", "apps/web/lib/authSessionStore.ts",
     [("const retry = e.outcome === 'uncertain' && attempt", "const retry = attempt")], ["authSessionDeadline", "authSessionR1Db"]),
    ("M5 calendar-day expiry", "apps/web/lib/authSessionDb.ts",
     [("`make_interval(hours => ${SESSION_TTL_HOURS})`", "`make_interval(days => 30)`")], ["authSessionR1Db"]),
    ("M6 provisional exposes the raw sid", "apps/web/lib/authSessionStore.ts",
     [("Object.freeze({ state: 'provisional' as const, idHash, userId,", "Object.freeze({ state: 'provisional' as const, sid, idHash, userId,")], ["authSessionR1Db"]),
    # Historical R2 controls, re-executed (M7 anchor updated for the R3 single-message reply; M10 retired: see N1/N2)
    ("M7 ambiguous COMMIT treated as acknowledged", "apps/web/lib/authSessionStore.ts",
     [("    return finish({ outcome: 'ambiguous', reason: 'connection' });\n  }\n  if (reply === 'deadline')", "    reply = [{ command: 'DO' }, { command: 'COMMIT' }];\n  }\n  if (reply === 'deadline')")], ["authSessionContract", "authSessionR1Db"]),
    ("M8 ambiguous keeps the raw id and read-back releases it", "apps/web/lib/authSessionStore.ts",
     [("      provisionalSids.delete(provisional); // the raw id is gone for good", "      // (mutation) raw id kept"),
      ("  return rows.length === 1 ? 'committed_undisclosed' : 'not_committed';", "  return (rows.length === 1 ? { label: 'committed_undisclosed', sid: provisionalSids.get(provisional) } : 'not_committed') as never;")],
     ["authSessionR1Db"]),
    ("M9 release ignores the read-back", "apps/web/lib/authSessionStore.ts",
     [("  if (!live) return null;\n  return committed(sid, authorization.idHash, authorization.userId, live.expiresAt);", "  return committed(sid, authorization.idHash, authorization.userId, live?.expiresAt ?? new Date());")],
     ["authSessionR1Db", "authSessionR3Db"]),
    # R3 controls (39237)
    ("N1 authorization issued for a substituted transaction (binding loosened to 'any transaction')", "apps/web/lib/authSessionStore.ts",
     [("`IF txid_current_if_assigned() IS DISTINCT FROM ${txid}::bigint ` +", "`IF txid_current_if_assigned() IS NULL ` +")], ["authSessionR3Db"]),
    ("N2 originating-transaction binding bypassed (check never raises)", "apps/web/lib/authSessionStore.ts",
     [("`THEN RAISE EXCEPTION 'auth_session_transaction_mismatch' USING ERRCODE = '${TRANSACTION_MISMATCH_SQLSTATE}'; END IF; ` +", "`THEN NULL; END IF; ` +")], ["authSessionR3Db", "authSessionR1Db"]),
    ("N3 non-atomic authorization consumption (consumed after the read-back)", "apps/web/lib/authSessionStore.ts",
     [("  authorizedSids.delete(authorization);\n  const live = await lookupAuthSession(pool, authorization.idHash, authorization.userId, opts);", "  const live = await lookupAuthSession(pool, authorization.idHash, authorization.userId, opts);\n  authorizedSids.delete(authorization);")],
     ["authSessionR3Db"]),
    ("N4 authorization reuse (never consumed)", "apps/web/lib/authSessionStore.ts",
     [("  authorizedSids.delete(authorization);\n  const live = await lookupAuthSession(", "  const live = await lookupAuthSession(")], ["authSessionR3Db", "authSessionR1Db"]),
    ("N5 release authority restored after an ambiguous COMMIT", "apps/web/lib/authSessionStore.ts",
     [("    provisionalTxids.delete(provisional);\n    if (decision.outcome !== 'committed') {", "    if (decision.outcome === 'ambiguous') { provisionalStates.set(provisional, 'open'); return Object.freeze(decision); }\n    provisionalTxids.delete(provisional);\n    if (decision.outcome !== 'committed') {")],
     ["authSessionR3Db"]),
]

def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()

def run(test):
    r = subprocess.run(["npx", "ts-node", f"test/{test}.test.ts"], capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    fails = [l[:150] for l in out.splitlines() if l.startswith("FAIL")]
    tail = [l for l in out.splitlines() if re.search(r"passed, \d+ failed|error TS\d+", l)][-1:] or ["(no summary)"]
    return {"exit": r.returncode, "summary": tail[0][:160], "failing_checks": fails[:6]}

results = []
for name, path, edits, tests in MUTATIONS:
    original = sha(path)
    backup = tempfile.mktemp()
    shutil.copyfile(path, backup)
    src = open(path).read()
    bad = [o for o, _ in edits if src.count(o) != 1]
    if bad:
        results.append({"mutation": name, "error": f"anchor not found exactly once: {bad[0][:60]}"})
        os.unlink(backup)
        continue
    for o, n in edits:
        src = src.replace(o, n)
    open(path, "w").write(src)
    try:
        res = {t: run(t) for t in tests}
    finally:
        shutil.copyfile(backup, path)
        os.unlink(backup)
    restored = sha(path) == original
    caught = any(v["exit"] != 0 for v in res.values())
    results.append({"mutation": name, "file": path, "caught": caught, "restored_sha256_identical": restored, "results": res})
    print(f"{name}: caught={caught} restored={restored}", file=sys.stderr)
print(json.dumps(results, indent=2))
