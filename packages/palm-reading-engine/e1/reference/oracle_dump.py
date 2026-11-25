# AURA-PALM-03-E1 -- runs the UNMODIFIED C1 reference oracle (check_examples.py, byte-identical to the C1 rev. 4
# evidence copy; see reference/README.md) and dumps its derived readings as JSON, so the E1 engine tests can compare
# against an independent implementation. Usage: python3 -I oracle_dump.py <catalogue.json> <examples.json> <out.json>
import io, itertools, json, os, runpy, sys, contextlib
here = os.path.dirname(os.path.abspath(__file__))
cat_path, ex_path, out_path = sys.argv[1:4]
sys.argv = ["check_examples.py", cat_path, ex_path]
real_exit = sys.exit
codes = []
sys.exit = lambda code=0: codes.append(code)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    g = runpy.run_path(os.path.join(here, "check_examples.py"))
sys.exit = real_exit
derive, OPTS, PROV = g["derive"], g["OPTS"], g["PROV"]
ex = json.load(open(ex_path, encoding="utf-8"))
out = {"oracleExit": codes[-1] if codes else None, "oracleStdoutTail": buf.getvalue().strip().splitlines()[-1:], "examples": {}, "sweep": []}
MODES = ("combined", "indian-only", "western-only")
for e in ex["examples"]:
    out["examples"][e["id"]] = {"example": e, "derived": {m: derive(e, m) for m in MODES}}
    if e["capabilities"] != ["essential"]:
        ee = dict(e, capabilities=["essential"])
        out["examples"][e["id"] + "@essential"] = {"example": ee, "derived": {m: derive(ee, m) for m in MODES}}
for combo in itertools.product(*OPTS.values()):
    inputs = {k: ({"provenance": PROV[k], "value": v} if v is not None else {"notAssessed": "user-skipped"}) for k, v in zip(OPTS, combo)}
    e = {"capabilities": ["essential"], "inputs": inputs, "qualityAccepted": True}
    out["sweep"].append({"inputs": inputs, "derived": {m: derive(e, m) for m in MODES}})
json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
print("dumped", len(out["examples"]), "examples and", len(out["sweep"]), "sweep inputs; oracle exit", out["oracleExit"])
