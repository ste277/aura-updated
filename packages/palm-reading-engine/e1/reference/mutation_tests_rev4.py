# AURA-PALM-03-C1 rev. 4 negative tests. Each mutation must be REJECTED (checker exit 1).
# Usage (repo root): python3 AURA_PALM_03_C1_EVIDENCE/mutation_tests_rev4.py <tmpdir>
import copy, json, os, subprocess, sys

ROOT = "."
EV = os.path.join(ROOT, "AURA_PALM_03_C1_EVIDENCE")
CAT = json.load(open(os.path.join(ROOT, "AURA_PALM_03_C1_INTERPRETATION_CATALOGUE.draft.json"), encoding="utf-8"))
SCH = os.path.join(ROOT, "AURA_PALM_03_C1_INTERPRETATION_LIBRARY_SCHEMA.json")
EXS = json.load(open(os.path.join(EV, "synthetic_reading_examples.json"), encoding="utf-8"))
TMP = sys.argv[1]
os.makedirs(TMP, exist_ok=True)

def rec(c, i): return next(e for e in c["interpretations"] if e["id"] == i)
def ex(d, i): return next(e for e in d["examples"] if e["id"] == i)

def run(script, *files):
    return subprocess.run([sys.executable, os.path.join(EV, script), *files], capture_output=True, text=True)

CM = [
 # rev. 3 set, recreated
 ("M1 clear tier", lambda c: rec(c, "C1-WE-HEAD-STRAIGHT")["observationQuality"].__setitem__("maxTier", "clear")),
 ("M2 western without Indian-gap", lambda c: rec(c, "C1-WE-RING-LONG").pop("complementsIndianGap")),
 ("M3 self-report undisclosed", lambda c: rec(c, "C1-IN-PALM-RAISED-GENEROUS")["userFacing"].__setitem__("observation", "Your palm is raised.")),
 ("M4 absence trigger", lambda c: rec(c, "C1-IN-PITR-KNOWLEDGE")["requires"][0]["observation"].__setitem__("categorical", "absent")),
 ("M5 lifespan wording", lambda c: rec(c, "C1-WE-HEART-JUPITER")["userFacing"].__setitem__("reading", "Western palmists read this as a long life.")),
 ("M6 Indian term in Western", lambda c: rec(c, "C1-WE-HEAD-SLOPING")["userFacing"].__setitem__("reading", "Western palmists read the rekhā as imagination.")),
 ("M7 default mode", lambda c: c["readingModes"].__setitem__("default", "indian-only")),
 ("M8 reviewed status", lambda c: rec(c, "C1-WE-FINGER-LONG")["review"].__setitem__("status", "APPROVED_FOR_PERSONALISED_READING")),
 ("M9 excluded record re-enabled", lambda c: rec(c, "C1-WE-INDEX-LONG")["userFacing"].__setitem__("reading", "Western palmists read a long index finger as leadership.")),
 ("M10 eligible despite failed criterion", lambda c: rec(c, "C1-WE-RING-LONG")["suitability"].__setitem__("harmfulAttributionRisk", "fail")),
 ("M11 tradition preference first", lambda c: c["readingModes"]["composition"].__setitem__("selectionOrder", ["tradition-preference"] + c["readingModes"]["composition"]["selectionOrder"][:-1])),
 ("M12 research history dropped", lambda c: rec(c, "C1-WE-ORIGIN-JOINED").pop("researchHistory")),
 # rev. 4 additions
 ("M13 Western quota (gap-only eligibility restored as a quota)", lambda c: c["readingModes"]["composition"].__setitem__("westernEligibility", "feature-level-indian-gap")),
 ("M14 indian-only admits Western", lambda c: c["readingModes"]["modeBehaviour"]["indian-only"]["traditions"].append("western-19c-chiromancy")),
 ("M15 mode without empty-result behaviour", lambda c: c["readingModes"]["modeBehaviour"]["western-only"].__setitem__("emptyResult", "")),
 ("M16 relationships domain unmapped", lambda c: c["readingModes"]["domains"].__setitem__("relationships", [])),
 ("M17 origin gap made essential", lambda c: (c["e1Planning"]["tiers"]["essential"].append("E1-L5"), c["e1Planning"]["tiers"]["optionalAssisted"].remove("E1-L5"))),
 ("M18 eligible-initial record needs a later capability", lambda c: rec(c, "C1-WE-ORIGIN-SEPARATE")["eligibility"].__setitem__("status", "eligible-initial")),
 ("M19 user-skipped worded as detector miss (E1-A1)", lambda c: next(r for r in c["globalPolicy"]["notAssessedReasons"] if r["code"] == "user-skipped").__setitem__("wording", "Not detected in the photo.")),
 ("M20 observed-absent reason missing (E1-A2)", lambda c: c["globalPolicy"].__setitem__("notAssessedReasons", [r for r in c["globalPolicy"]["notAssessedReasons"] if r["code"] != "observed-absent"])),
 ("M21 carry-forward E1-A3 dropped", lambda c: c["e1Planning"]["carriedForwardFromI1"].pop("E1-A3")),
 ("M22 forecast wording", lambda c: rec(c, "C1-IN-URDHVA-RING")["userFacing"].__setitem__("reflection", "You are going to organise something big.")),
 ("M23 zone descriptor without boundary margin", lambda c: rec(c, "C1-WE-HEART-JUPITER")["observationQuality"].pop("boundaryMargin")),
 ("M24 not-read wording reveals excluded meaning", lambda c: next(r for r in c["globalPolicy"]["notAssessedReasons"] if r["code"] == "not-read-in-this-version").__setitem__("wording", "Not read in this version (it would suggest pride).")),
 ("M25 capability serving only an excluded record planned", lambda c: (c["e1Planning"]["capabilities"].__setitem__("E1-X1", "index-length descriptor"), c["e1Planning"]["tiers"]["optionalAssisted"].append("E1-X1"), rec(c, "C1-WE-INDEX-LONG")["e1Capabilities"].append("E1-X1"))),
]

XM = [
 ("X1 excluded record emitted", lambda d: ex(d, "R3")["expected"]["combined"]["sections"].setdefault("personality", []).append("C1-WE-INDEX-LONG")),
 ("X2 user skip reported as detector miss (E1-A1)", lambda d: ex(d, "R6")["inputs"]["lines.head"].__setitem__("notAssessed", "detector-missing")),
 ("X3 Western item in indian-only", lambda d: ex(d, "R1")["expected"]["indian-only"]["sections"].__setitem__("personality", ["C1-WE-HEAD-SLOPING"])),
 ("X4 wrong section placement (rev. 3 Reading 2 error)", lambda d: ex(d, "R2")["expected"]["combined"]["sections"].__setitem__("personality", ["C1-WE-HEAD-STRAIGHT", "C1-WE-RING-LONG"])),
 ("X5 boundary value emitted", lambda d: ex(d, "R5")["expected"]["combined"]["sections"].__setitem__("personality", ["C1-WE-FINGER-SHORT", "C1-WE-HEAD-SLOPING"])),
 ("X6 item from an observed absence (E1-A2)", lambda d: (ex(d, "R6")["inputs"].__setitem__("marks.matsya", {"notAssessed": "observed-absent"}), ex(d, "R6")["expected"]["combined"]["sections"].__setitem__("strengths", ["C1-IN-MATSYA-PAIR-HOSPITALITY"]))),
 ("X7 later record in essential-only example", lambda d: ex(d, "R1")["expected"]["combined"]["sections"].__setitem__("life-direction", ["C1-WE-ORIGIN-SEPARATE"])),
 ("X8 not-assessed entry dropped", lambda d: ex(d, "R1")["expected"]["combined"]["notAssessed"].pop("lines.heart")),
 ("X9 quality-gated reading still emits", lambda d: ex(d, "R3Q")["expected"]["combined"]["sections"].__setitem__("personality", ["C1-WE-FINGER-LONG"])),
 ("X10 empty indian-only reading padded with nothing said", lambda d: ex(d, "R6")["expected"]["indian-only"].__setitem__("emptyResult", None)),
 ("X11 heart ending between zones read as one side", lambda d: ex(d, "R2")["expected"]["combined"]["sections"].__setitem__("emotional-relational", ["C1-WE-HEART-JUPITER"])),
 ("X12 Indian equivalent invented for heart line", lambda d: ex(d, "R6")["expected"]["indian-only"]["sections"].__setitem__("emotional-relational", ["C1-IN-PITR-KNOWLEDGE"])),
 ("X13 unknown mark treated as absent", lambda d: ex(d, "R1")["expected"]["combined"]["notAssessed"].__setitem__("marks.other", "observed-absent")),
]

SM = [
 ("S1 category limit 0 (sweep must find overflow)", lambda c: c["globalPolicy"].__setitem__("maxInterpretationsPerCategory", 0)),
 ("S2 Indian upward records career-only + limit 1 (sweep must find Indian displacement)", lambda c: (c["globalPolicy"].__setitem__("maxInterpretationsPerCategory", 1), [rec(c, i).__setitem__("categories", ["career-working-style"]) for i in ("C1-IN-URDHVA-MIDDLE", "C1-IN-URDHVA-INDEX", "C1-IN-URDHVA-RING", "C1-IN-URDHVA-LITTLE")], [rec(c, i).__setitem__("categories", ["career-working-style"]) for i in ("C1-WE-FINGER-LONG", "C1-WE-FINGER-SHORT")])),
]

ok = True
base_c = run("check_catalogue.py", os.path.join(ROOT, "AURA_PALM_03_C1_INTERPRETATION_CATALOGUE.draft.json"), SCH)
base_x = run("check_examples.py", os.path.join(ROOT, "AURA_PALM_03_C1_INTERPRETATION_CATALOGUE.draft.json"), os.path.join(EV, "synthetic_reading_examples.json"))
print("baseline catalogue:", "PASS" if base_c.returncode == 0 else "FAIL", "| baseline examples:", "PASS" if base_x.returncode == 0 else "FAIL")
ok &= base_c.returncode == 0 and base_x.returncode == 0
for name, f in CM:
    c = copy.deepcopy(CAT); f(c)
    p = os.path.join(TMP, "cat.json"); json.dump(c, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    r = run("check_catalogue.py", p, SCH)
    caught = r.returncode == 1
    ok &= caught
    print(name, "CAUGHT" if caught else "MISSED")
for name, f in XM:
    d = copy.deepcopy(EXS); f(d)
    p = os.path.join(TMP, "ex.json"); json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    r = run("check_examples.py", os.path.join(ROOT, "AURA_PALM_03_C1_INTERPRETATION_CATALOGUE.draft.json"), p)
    caught = r.returncode == 1
    ok &= caught
    print(name, "CAUGHT" if caught else "MISSED")
for name, f in SM:
    c = copy.deepcopy(CAT); f(c)
    p = os.path.join(TMP, "cat_s.json"); json.dump(c, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    r = run("check_examples.py", p, os.path.join(EV, "synthetic_reading_examples.json"))
    caught = r.returncode == 1 and "sweep" in r.stdout.split("FAILS:")[-1]
    ok &= caught
    print(name, "CAUGHT" if caught else "MISSED")
print(f"{len(CM)} catalogue + {len(XM)} example + {len(SM)} sweep mutations:", "ALL CAUGHT" if ok else "FAILURES")
sys.exit(0 if ok else 1)
