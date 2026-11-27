#!/usr/bin/env python3
"""AURA-AUTH-SESSION-01-I1 R1 -- mutation negative controls.

Each mutation deliberately removes one protection from the R1 code, runs the
suites that must catch it, records the failing checks, then restores the file
and verifies its sha256 is identical to the original.

Usage (from the worktree root, disposable loopback DB):
  DATABASE_URL=postgresql://...@127.0.0.1:PORT/DB python3 AURA_AUTH_SESSION_01_I1_R1_EVIDENCE/mutations/runMutations.py
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile

MUTATIONS = [
    ("M1 remove server statement timeout", "apps/web/lib/authSessionDb.ts",
     "`BEGIN; SET LOCAL statement_timeout = '${statementMs}ms'; ` +", "`BEGIN; SELECT 1; ` +",
     ["authSessionR1Db", "authSessionStoreDb"]),
    ("M2 unsafe connection reuse (return failed connections to the pool)", "apps/web/lib/authSessionDb.ts",
     "client.release(new Error(reason));", "client.release();",
     ["authSessionDeadline", "authSessionStoreDb"]),
    ("M3 deadline reset on retry (each attempt gets a fresh deadline)", "apps/web/lib/authSessionStore.ts",
     "SESSION_WRITE_BOUNDS, { deadlineAt, clock });", "SESSION_WRITE_BOUNDS, { clock });",
     ["authSessionDeadline", "authSessionR1Db"]),
    ("M4 retry confirmed failures too", "apps/web/lib/authSessionStore.ts",
     "const retry = e.outcome === 'uncertain' && attempt", "const retry = attempt",
     ["authSessionDeadline", "authSessionR1Db"]),
    ("M5 calendar-day expiry (days => 30)", "apps/web/lib/authSessionDb.ts",
     "`make_interval(hours => ${SESSION_TTL_HOURS})`", "`make_interval(days => 30)`",
     ["authSessionR1Db"]),
    ("M6 provisional result exposes the raw sid", "apps/web/lib/authSessionStore.ts",
     "Object.freeze({ state: 'provisional' as const, idHash, userId,", "Object.freeze({ state: 'provisional' as const, sid, idHash, userId,",
     ["authSessionR1Db"]),
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
for name, path, old, new, tests in MUTATIONS:
    original = sha(path)
    backup = tempfile.mktemp()
    shutil.copyfile(path, backup)
    src = open(path).read()
    if src.count(old) != 1:
        results.append({"mutation": name, "error": "anchor not found exactly once"})
        continue
    open(path, "w").write(src.replace(old, new))
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
