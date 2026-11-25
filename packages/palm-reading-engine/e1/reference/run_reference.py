# AURA-PALM-03-E1 -- reruns the UNMODIFIED C1 reference checks (check_catalogue.py, check_examples.py and the 40-case
# mutation_tests_rev4.py) in the C1 evidence directory layout they expect, against a given catalogue/schema.
# Usage: python3 -I run_reference.py <catalogue.json> <schema.json> <workdir>
import os, shutil, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
cat, sch, work = sys.argv[1:4]
ev = os.path.join(work, "AURA_PALM_03_C1_EVIDENCE")
os.makedirs(ev, exist_ok=True)
shutil.copy(cat, os.path.join(work, "AURA_PALM_03_C1_INTERPRETATION_CATALOGUE.draft.json"))
shutil.copy(sch, os.path.join(work, "AURA_PALM_03_C1_INTERPRETATION_LIBRARY_SCHEMA.json"))
for f in ("check_catalogue.py", "check_examples.py", "mutation_tests_rev4.py", "synthetic_reading_examples.json"):
    shutil.copy(os.path.join(here, f), os.path.join(ev, f))
r = subprocess.run([sys.executable, os.path.join(ev, "mutation_tests_rev4.py"), os.path.join(work, "mut")], cwd=work, capture_output=True, text=True)
sys.stdout.write(r.stdout); sys.stderr.write(r.stderr)
sys.exit(r.returncode)
