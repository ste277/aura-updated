# AURA-PALM-03-C1 rev. 4 — reference oracle for the synthetic reading examples.
# Re-derives each example's expected reading from the catalogue's own rules (eligibility, capabilities, modes,
# thresholds + boundary margins, selection order, placement, not-assessed vocabulary) and compares it with the
# hand-composed expectation. Evidence only: it is NOT the E1 engine and is not wired into anything.
# Usage: python3 check_examples.py <catalogue.json> <examples.json>
import json, sys

cat = json.load(open(sys.argv[1], encoding="utf-8"))
ex = json.load(open(sys.argv[2], encoding="utf-8"))
RM = cat["readingModes"]; GP = cat["globalPolicy"]
MODES = RM["modeBehaviour"]; ORDER = RM["placement"]["sectionOrder"]; LIMIT = GP["maxInterpretationsPerCategory"]
CODES = {r["code"] for r in GP["notAssessedReasons"]}
ESS = set(cat["e1Planning"]["tiers"]["essential"])
SUP = RM["composition"]["comparablySuitable"]["supportRank"]
REC = cat["interpretations"]
fails = []
def F(m): fails.append(m)

def key_of(r):
    d = str(r.get("observation", {}).get("descriptor", ""))
    return r["feature"]

def match(rec, inputs):
    """Return ('match'|'boundary'|'no', features_used)."""
    used = []; boundary = False
    m = rec["observationQuality"].get("boundaryMargin", 0.0)
    for r in rec["requires"]:
        k = key_of(r); used.append(k)
        x = inputs.get(k)
        if not x or "notAssessed" in x: return "no", used
        if x.get("provenance") not in r["provenanceAllowed"]: return "no", used
        ob = r.get("observation", {})
        if "categorical" in ob:
            if str(x["value"]) != str(ob["categorical"]): return "no", used
            if x.get("nearEdge"): boundary = True
        elif "range" in ob:
            g = lambda q: None if q is None else int(round(q * 10000))
            v = g(x["value"]); lo = g(ob["range"].get("min")); hi = g(ob["range"].get("max")); mg = g(m)
            if (lo is not None and abs(v - lo) <= mg) or (hi is not None and abs(v - hi) <= mg): boundary = True
            elif (lo is not None and v < lo) or (hi is not None and v > hi): return "no", used
    return ("boundary" if boundary else "match"), used

def concerns(rec):
    return sum(1 for k, v in rec["suitability"].items() if v == "concern")

def rank(rec):
    band = 0 if concerns(rec) <= 2 else 1
    trad = 0 if rec["tradition"].startswith("indian") else 1
    return (SUP.index(rec["overallSupport"]), band, trad, REC.index(rec))

def derive(e, mode):
    caps = set()
    for c in e["capabilities"]:
        caps |= ESS if c == "essential" else {c}
    inputs = e["inputs"]
    out = {"sections": {}, "overflow": [], "notAssessed": {}, "emptyResult": None}
    trads = set(MODES[mode]["traditions"])
    observed = [k for k, v in inputs.items() if "notAssessed" not in v]
    for k, v in inputs.items():
        if "notAssessed" in v: out["notAssessed"][k] = v["notAssessed"]
    if not e["qualityAccepted"]:
        for k in observed: out["notAssessed"][k] = "quality-gated"
        out["emptyResult"] = MODES[mode]["emptyResult"]
        return out
    cands = []; status = {k: None for k in observed}; bfeat = set()
    for rec in REC:
        if rec["tradition"] not in trads: continue
        el = rec["eligibility"]["status"]
        res, used = match(rec, inputs)
        if res == "no": continue
        usable = el == "eligible-initial" or (el == "eligible-later" and set(rec["e1Capabilities"]) <= caps)
        if el == "historical-context-only":
            for k in used: status[k] = status[k] or "historical"
            continue
        if not usable:
            if el in ("excluded-initial", "held") and res == "match":
                for k in used:
                    if status.get(k) in (None, "boundary"): status[k] = "not-read"
            continue
        if res == "boundary":
            for k in used:
                bfeat.add(k)
                if status.get(k) is None: status[k] = "boundary"
            continue
        cands.append(rec)
        for k in used: status[k] = "matched"
    keep = []
    for rec in cands:
        hit = [r["feature"] for r in rec["requires"] if r["feature"] in bfeat]
        if hit:
            for f in hit: status[f] = "boundary"
        else:
            keep.append(rec)
    cands = keep
    for k in observed:
        s = status[k]
        if s in ("matched", "historical"): continue
        out["notAssessed"][k] = {"not-read": "not-read-in-this-version", "boundary": "boundary", None: "no-supported-content"}[s]
    placed = set()
    for rec in sorted(cands, key=rank):
        for c in rec["categories"]:
            if c in ORDER and len(out["sections"].get(c, [])) < LIMIT:
                out["sections"].setdefault(c, []).append(rec["id"]); placed.add(rec["id"]); break
        else:
            out["overflow"].append(rec["id"])
    out["sections"] = {c: out["sections"][c] for c in ORDER if c in out["sections"]}
    if not out["sections"] and not out["overflow"]:
        out["emptyResult"] = MODES[mode]["emptyResult"]
    return out

byid = {r["id"]: r for r in REC}
for e in ex["examples"]:
    for k, v in e["inputs"].items():
        if "notAssessed" in v:
            if v["notAssessed"] not in CODES: F(f"{e['id']}: unknown not-assessed code {v['notAssessed']}")
            if e["source"] == "user-assisted" and v["notAssessed"] == "detector-missing": F(f"{e['id']}: E1-A1 detector-missing used for user-assisted input {k}")
    for mode in ("combined", "indian-only", "western-only"):
        exp = e["expected"][mode]; got = derive(e, mode)
        tag = f"{e['id']}/{mode}"
        for k in ("sections", "overflow", "notAssessed", "emptyResult"):
            if exp.get(k) != got.get(k): F(f"{tag}: {k} expected {exp.get(k)} derived {got.get(k)}")
        ids = [i for s in exp["sections"].values() for i in s] + exp["overflow"]
        if len(ids) != len(set(ids)): F(f"{tag}: an item appears twice")
        for c, s in exp["sections"].items():
            if c not in ORDER: F(f"{tag}: section {c} not in sectionOrder")
            if len(s) > LIMIT: F(f"{tag}: section {c} over limit")
        for i in ids:
            r = byid.get(i)
            if not r: F(f"{tag}: unknown id {i}"); continue
            if r["eligibility"]["status"] not in ("eligible-initial", "eligible-later"): F(f"{tag}: non-eligible record {i} emitted")
            if r["tradition"] not in MODES[mode]["traditions"]: F(f"{tag}: {i} not allowed in {mode}")
            for q in r["requires"]:
                x = e["inputs"].get(q["feature"], {})
                if x.get("notAssessed") == "observed-absent": F(f"{tag}: E1-A2 {i} emitted from an observed absence")
        for k, c in exp["notAssessed"].items():
            if c not in CODES: F(f"{tag}: unknown code {c}")

# ---------------------------------------------------------------- exhaustive essential-input sweep
# Every combination of essential-version inputs (well clear of thresholds), every mode: no candidate overflows its
# categories, so tradition ranking never displaces an Indian item, and every mode either emits or gives its empty-result.
import itertools
OPTS = {
    "lines.upward": [None, "middle", "index", "ring", "little"],
    "lines.heart": [None, "index", "between-index-middle", "middle"],
    "lines.head": [None, 0.0, 0.2],
    "lines.life": [None, "present"],
    "measurements.middleToPalmRatio": [None, 0.6, 0.87, 1.1],
    "measurements.indexToRingRatio": [None, 0.8, 1.0, 1.2],
}
PROV = {"lines.upward": "user-confirmed", "lines.heart": "user-confirmed", "lines.head": "user-confirmed", "lines.life": "user-confirmed",
        "measurements.middleToPalmRatio": "automatic-measured", "measurements.indexToRingRatio": "automatic-measured"}
n = 0; maxitems = 0
for combo in itertools.product(*OPTS.values()):
    inputs = {k: ({"provenance": PROV[k], "value": v} if v is not None else {"notAssessed": "user-skipped"}) for k, v in zip(OPTS, combo)}
    e = {"capabilities": ["essential"], "inputs": inputs, "qualityAccepted": True}
    for mode in ("combined", "indian-only", "western-only"):
        got = derive(e, mode); n += 1
        items = [i for s in got["sections"].values() for i in s]
        maxitems = max(maxitems, len(items))
        if got["overflow"]: F(f"sweep {combo}/{mode}: overflow {got['overflow']}")
        if not items and got["emptyResult"] != MODES[mode]["emptyResult"]: F(f"sweep {combo}/{mode}: empty without emptyResult")
        for i in items:
            if byid[i]["eligibility"]["status"] != "eligible-initial": F(f"sweep: {i} not eligible-initial")
        if mode == "combined":
            ind = derive(e, "indian-only"); ii = {i for s in ind["sections"].values() for i in s}
            if not ii <= set(items): F(f"sweep {combo}: Indian item displaced in combined: {sorted(ii - set(items))}")
print("sweep:", n, "derivations; max items in one reading:", maxitems)
print("examples:", len(ex["examples"]), "x 3 modes")
print("FAILS:" if fails else "ALL EXAMPLE CHECKS PASS", *fails, sep="\n  ")
sys.exit(1 if fails else 0)
