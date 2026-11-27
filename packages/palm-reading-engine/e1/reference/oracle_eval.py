# AURA-PALM-03-E1-R2 -- evaluate a C1 reference oracle (corrected reference/check_examples.py, or the preserved
# original reference/original-c1-rev4/check_examples.py) on arbitrary abstract inputs.
# Usage: python3 -I oracle_eval.py <oracle.py> <catalogue.json> <cases.json> <out.json>
# cases.json: [{"inputs": {...}, "capabilities": ["essential"], "qualityAccepted": true}, ...]
import io, json, os, runpy, sys, contextlib
oracle, cat_path, cases_path, out_path = sys.argv[1:5]
here = os.path.dirname(os.path.abspath(__file__))
sys.argv = ["check_examples.py", cat_path, os.path.join(here, "synthetic_reading_examples.json")]
real_exit = sys.exit
sys.exit = lambda code=0: None
with contextlib.redirect_stdout(io.StringIO()):
    g = runpy.run_path(oracle)
sys.exit = real_exit
derive = g["derive"]
cases = json.load(open(cases_path, encoding="utf-8"))
out = [{m: derive(c, m) for m in ("combined", "indian-only", "western-only")} for c in cases]
json.dump(out, open(out_path, "w", encoding="utf-8"), ensure_ascii=False)
