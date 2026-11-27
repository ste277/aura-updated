import json, re, sys
cat = json.load(open(sys.argv[1], encoding="utf-8"))
schema = json.load(open(sys.argv[2], encoding="utf-8"))
D = schema["$defs"]
fails = []
def F(m): fails.append(m)

top_req = schema["required"]
for k in top_req:
    if k not in cat: F(f"top-level missing {k}")
if cat["status"] != "UNREVIEWED_RESEARCH_CONTENT": F("status")
if cat.get("readingModes", {}).get("default") != "combined": F("default reading mode must be combined (D1)")
comp = cat.get("readingModes", {}).get("composition", {})
if comp.get("selectionOrder", [None])[-1] != "tradition-preference" or not comp.get("noForcedTraditionSlots"): F("tradition preference must be the last tie-breaker with no forced slots")
if cat["globalPolicy"].get("markPolicy") != "unreported-is-unknown": F("markPolicy (D2)")
src_ids = {s["id"] for s in cat["sources"]} | {"WE-X (life line = lifespan)"}
for s in cat["sources"]:
    for k in D["sourceRecord"]["required"]:
        if k not in s: F(f"source {s.get('id')} missing {k}")
    if s["tradition"] not in D["tradition"]["enum"]: F(f"source {s['id']} tradition")

ireq = D["interpretation"]["required"]
iprops = set(D["interpretation"]["properties"])
idpat = re.compile(D["interpretation"]["properties"]["id"]["pattern"])
fpat = re.compile(D["featureRef"]["properties"]["feature"]["pattern"])
cats = set(D["category"]["enum"]); trads = set(D["tradition"]["enum"]); sup = set(D["supportLevel"]["enum"])
prov = set(D["featureRef"]["properties"]["provenanceAllowed"]["items"]["enum"])
proh = set(D["prohibitedClaim"]["enum"])
seen = set()
BANNED = re.compile(r"\b(die|dies|death|lifespan|life span|live long|long life|longevity|rich|wealth|money|marri|husband|wife|children|sons|daughter|fertil|caste|varṇa|varna|health|illness|disease|accident|misfortune|guarantee|will become|you will|destined|fate)\w*", re.I)
for e in cat["interpretations"]:
    i = e.get("id", "?")
    for k in ireq:
        if k not in e: F(f"{i}: missing {k}")
    for k in e:
        if k not in iprops: F(f"{i}: unknown property {k}")
    if not idpat.match(i): F(f"{i}: id pattern")
    if i in seen: F(f"{i}: duplicate"); seen.add(i)
    seen.add(i)
    if e["tradition"] not in trads: F(f"{i}: tradition")
    if (e["tradition"].startswith("indian")) != i.startswith("C1-IN"): F(f"{i}: id/tradition mismatch")
    for c in e["categories"]:
        if c not in cats: F(f"{i}: category {c}")
    if e.get("overallSupport") not in sup: F(f"{i}: overallSupport")
    for r in e["requires"]:
        if not fpat.match(r["feature"]): F(f"{i}: feature id {r['feature']}")
        for p in r["provenanceAllowed"]:
            if p not in prov: F(f"{i}: provenance {p}")
        if any(p in ("user-confirmed", "user-reported", "user-self-assessed") for p in r["provenanceAllowed"]) and e["observationQuality"]["maxTier"] != "tentative":
            F(f"{i}: trace/report-based record not capped at tentative")
    if e["observationQuality"]["maxTier"] != "tentative": F(f"{i}: D3 ceiling is tentative for all records")
    for s in e["sources"]:
        if s["sourceId"] not in src_ids: F(f"{i}: unknown source {s['sourceId']}")
        if s["supportLevel"] not in sup: F(f"{i}: source supportLevel")
    for c in e.get("conflicts", []):
        if c["handling"] not in D["interpretation"]["properties"]["conflicts"]["items"]["properties"]["handling"]["enum"]: F(f"{i}: conflict handling")
    for p in e["exclusions"]["claimsNeverMade"]:
        if p not in proh: F(f"{i}: prohibited enum {p}")
    if set(e["exclusions"]["claimsNeverMade"]) != proh: F(f"{i}: not all prohibited claims listed")
    if e["review"]["status"] != "UNREVIEWED_RESEARCH_CONTENT": F(f"{i}: review status")
    if e["overallSupport"] == "inferred" and not e["userFacing"].get("applicationNote"): F(f"{i}: inferred without applicationNote")
    emit = not e["userFacing"]["reading"].startswith("NOT FOR EMISSION")
    if e["overallSupport"] in ("disputed", "unsupported") and emit and not any(c["handling"] in ("show-both-attributed",) for c in e.get("conflicts", [])):
        F(f"{i}: disputed record emittable without show-both conflict policy")
    uf = " ".join(e["userFacing"].get(k, "") for k in ("observation", "reading", "reflection"))
    m = BANNED.findall(uf)
    if m: F(f"{i}: banned wording in user-facing text: {sorted(set(m))}")
    # reading must be attributed to a tradition/text
    if emit and not re.search(r"(tradition|text|treatise|palmist|Bṛhatsaṃhitā|Cheiro|guide)", e["userFacing"]["reading"], re.I):
        F(f"{i}: reading lacks attribution frame")
    # tradition separation: Indian readings must not use Western line names and vice versa
    if i.startswith("C1-IN") and re.search(r"\b(heart|head|life|fate) line\b|mount of", uf, re.I): F(f"{i}: Western term in Indian reading")
    if i.startswith("C1-WE") and re.search(r"lekhā|rekhā|ūrdhva|Sarasvat", uf): F(f"{i}: Indian term in Western reading")

    if e.get("readingModes") is None: F(f"{i}: readingModes missing")
    if i.startswith("C1-WE"):
        if "complementsIndianGap" not in e: F(f"{i}: Western record lacks complementsIndianGap (D1)")
        if "indian-only" in e.get("readingModes", []): F(f"{i}: Western record in indian-only mode")
    else:
        if "western-only" in e.get("readingModes", []): F(f"{i}: Indian record in western-only mode")
    u = e.get("uncertainty", {})
    if u.get("sourceSupport") != e["overallSupport"]: F(f"{i}: uncertainty.sourceSupport mismatch")
    if any("user-self-reported" in r["provenanceAllowed"] for r in e["requires"]):
        sr = e.get("selfReport")
        if not sr or sr.get("subject") != "hand-feature": F(f"{i}: self-reported record lacks hand-feature selfReport (D2)")
        elif not any("not sure" in a for a in sr["answers"]): F(f"{i}: selfReport lacks 'not sure'")
        if "your answer" not in e["userFacing"]["observation"]: F(f"{i}: self-report not disclosed in observation (D2)")
    for r in e["requires"]:
        if str(r.get("observation", {}).get("categorical", "")).lower() in ("absent", "none", "missing", "0"): F(f"{i}: triggered by absence")
    if e.get("wordingFidelity", {}).get("status") == "softened-withdrawn" and not e["userFacing"]["reading"].startswith("NOT FOR EMISSION"): F(f"{i}: withdrawn softened wording still emittable")
    if e["observationQuality"].get("displayRule") != "never-as-confidence": F(f"{i}: displayRule")

    el = e.get("eligibility", {}).get("status")
    if el not in ("eligible-initial", "eligible-later", "held", "excluded-initial", "historical-context-only"): F(f"{i}: eligibility missing/invalid")
    su = e.get("suitability", {})
    crit = ["sourceFidelity", "observationRequirements", "culturalContext", "relevanceToUser", "harmfulAttributionRisk", "constructiveReflection"]
    if any(k not in su for k in crit): F(f"{i}: suitability incomplete")
    if el in ("eligible-initial", "eligible-later") and any(su.get(k) == "fail" for k in crit): F(f"{i}: eligible despite a failed suitability criterion")
    if el in ("excluded-initial", "held") and not e["userFacing"]["reading"].startswith("NOT FOR EMISSION") and el == "excluded-initial": F(f"{i}: excluded record still has emittable reading")
    if el == "excluded-initial" and "researchHistory" not in e: F(f"{i}: excluded record lost its research history")


# ---------------------------------------------------------------- rev. 4 checks (C1 final refinements, 2026-11-25)
if cat.get("libraryVersion") != schema["properties"]["libraryVersion"]["const"]: F("libraryVersion does not match schema")
rm = cat.get("readingModes", {})
if comp.get("westernEligibility") != "suitable-additional-coverage": F("westernEligibility must be suitable-additional-coverage (no quota)")
cs = comp.get("comparablySuitable", {})
if cs.get("supportRank") != ["direct", "inferred", "disputed"]: F("comparablySuitable.supportRank")
mbh = rm.get("modeBehaviour", {})
for m in ("combined", "indian-only", "western-only"):
    b = mbh.get(m)
    if not b or not b.get("emptyResult") or not b.get("traditions"): F(f"modeBehaviour.{m} incomplete"); continue
    for t in b["traditions"]:
        if t not in trads: F(f"modeBehaviour.{m}: unknown tradition {t}")
if mbh:
    if any(not t.startswith("indian") for t in mbh.get("indian-only", {}).get("traditions", [])): F("indian-only admits a non-Indian tradition")
    if any(not t.startswith("western") for t in mbh.get("western-only", {}).get("traditions", [])): F("western-only admits a non-Western tradition")
    used = {e["tradition"] for e in cat["interpretations"]}
    if not used <= set(mbh.get("combined", {}).get("traditions", [])): F("combined must admit every tradition used in the catalogue")
    if set(mbh.get("combined", {}).get("traditions", [])) != set(mbh.get("indian-only", {}).get("traditions", [])) | set(mbh.get("western-only", {}).get("traditions", [])): F("combined must be exactly indian-only + western-only")
dom = rm.get("domains", {})
for d in ("personality", "relationships", "career", "life-direction"):
    if not dom.get(d): F(f"domain {d} unmapped")
    for c in dom.get(d, []):
        if c not in cats or c in ("overview", "historical-context-only"): F(f"domain {d}: invalid category {c}")
pl = rm.get("placement", {})
if pl.get("rule") != "first-listed-category-with-room": F("placement rule")
if set(pl.get("sectionOrder", [])) != cats - {"overview", "historical-context-only"}: F("placement.sectionOrder must list every reading category once")
gpol = cat["globalPolicy"]
if gpol.get("futureLanguage") != "questions-only-never-forecasts": F("futureLanguage")
nar = {r["code"]: r for r in gpol.get("notAssessedReasons", [])}
for code in ("user-skipped", "user-cannot-see", "not-traced", "trace-unusable", "frame-unavailable", "quality-gated", "boundary", "mark-unknown", "observed-absent", "no-supported-content", "not-read-in-this-version", "detector-missing"):
    if code not in nar: F(f"notAssessedReasons lacks {code}")
DET = re.compile(r"detect|photo|camera|scanner", re.I)
for code in ("user-skipped", "user-cannot-see"):
    if code in nar and DET.search(nar[code]["wording"]): F(f"E1-A1: {code} wording reads as a detector/photo limitation")
if "detector-missing" in nar and "never used for user" not in nar["detector-missing"]["carries"]: F("E1-A1: detector-missing must be reserved for detector sources")
if "observed-absent" in nar and "no reading" not in nar["observed-absent"]["wording"]: F("E1-A2: observed-absent must state that nothing is read from it")
if "not-read-in-this-version" in nar and nar["not-read-in-this-version"]["wording"] != "Not read in this version.": F("RC-11: not-read wording must not reveal anything")
CAPID = set(cat.get("e1Planning", {}).get("capabilities", {}))
tiers = cat.get("e1Planning", {}).get("tiers", {})
ESS = set(tiers.get("essential", []))
if ESS != {"E1-E1", "E1-E2", "E1-E3", "E1-E4", "E1-E5"}: F("essential tier must be E1-E1..E1-E5")
alltiers = [c for t in tiers.values() for c in t]
if sorted(alltiers) != sorted(CAPID) or len(alltiers) != len(set(alltiers)): F("every capability in exactly one tier")
if "E1-L5" in ESS: F("origin-gap descriptor must not be essential")
cf = cat.get("e1Planning", {}).get("carriedForwardFromI1", {})
for k in ("M4", "E1-A1", "E1-A2", "E1-A3", "E1-A4", "E1-A5"):
    if not cf.get(k): F(f"carry-forward {k} missing")
FUT = re.compile(r"\b(you will|you'll|will (be|have|find|meet|become|get)|going to|your future|in the future|destined|fate)\b", re.I)
excluded_only_caps = set()
for e in cat["interpretations"]:
    i = e["id"]; el = e["eligibility"]["status"]; ec = set(e.get("e1Capabilities", []))
    if not ec: F(f"{i}: e1Capabilities missing"); continue
    for c in ec:
        if c not in CAPID and c != "not-planned": F(f"{i}: unknown capability {c}")
    if el == "eligible-initial" and not ec <= ESS: F(f"{i}: eligible-initial record needs a non-essential capability {sorted(ec - ESS)}")
    if el == "eligible-later" and ec <= ESS: F(f"{i}: eligible-later record needs only essential capabilities (should be initial?)")
    if el in ("eligible-initial", "eligible-later") and "not-planned" in ec: F(f"{i}: eligible record depends on a not-planned capability")
    if el in ("eligible-initial", "eligible-later"):
        uf = e["userFacing"]
        if not uf["reflection"].rstrip().endswith("?"): F(f"{i}: reflection is not a question (futureLanguage)")
        if FUT.search(" ".join(uf.get(k, "") for k in ("observation", "reading", "reflection"))): F(f"{i}: forecast wording")
    if el in ("eligible-initial", "eligible-later") and e["tradition"].startswith("western"):
        g = e.get("complementsIndianGap", {})
        if not g or not all(g.get(k) for k in g) : F(f"{i}: complementsIndianGap incomplete")
    for r in e["requires"]:
        d = str(r.get("observation", {}).get("descriptor", ""))
        if (d.startswith("proposed.urdhva.terminationFinger") or d.startswith("proposed.heart.radialEndFinger")) and "boundaryMargin" not in e["observationQuality"]:
            F(f"{i}: zone descriptor without boundaryMargin (RC-7)")
# capabilities that would serve only excluded or held records must not be essential or optional
served = {}
for e in cat["interpretations"]:
    for c in e["e1Capabilities"]:
        served.setdefault(c, set()).add(e["eligibility"]["status"])
for c in tiers.get("essential", []) + tiers.get("optionalAssisted", []):
    if c in ("E1-E1", "E1-E2"): continue
    if not served.get(c, set()) & {"eligible-initial", "eligible-later"}: F(f"{c}: planned capability serves no eligible record")
for e in cat["interpretations"]:
    if e["eligibility"]["status"] == "excluded-initial":
        for c in e["e1Capabilities"]:
            if c in ("E1-E1", "E1-E2"): continue
            if not served[c] & {"eligible-initial", "eligible-later"}: F(f"{e['id']}: capability {c} would exist only for an excluded record")
ini = [e for e in cat["interpretations"] if e["eligibility"]["status"] == "eligible-initial"]
def modes_of(e):
    return [m for m, b in mbh.items() if e["tradition"] in b.get("traditions", [])]
for e in ini:
    if sorted(modes_of(e)) != sorted(e["readingModes"]): F(f"{e['id']}: readingModes disagree with modeBehaviour")
print("rev4 coverage (eligible-initial) by mode and domain:")
for m in ("combined", "indian-only", "western-only"):
    rs = [e for e in ini if m in e["readingModes"]]
    print(f"  {m}: {len(rs)} records;", ", ".join(f"{d}={sum(1 for e in rs if set(e['categories']) & set(cs_))}" for d, cs_ in dom.items()))
print("capability tiers:", {k: v for k, v in tiers.items()})

emittable = [e["id"] for e in cat["interpretations"] if e["eligibility"]["status"] in ("eligible-initial", "eligible-later")]
from collections import Counter
print("eligibility:", dict(Counter(e["eligibility"]["status"] for e in cat["interpretations"])))
nowA=[e["id"] for e in cat["interpretations"] if e["eligibility"]["status"] == "eligible-initial" and not any(r["feature"].startswith("proposed.") or str(r.get("observation", {}).get("descriptor", "")).startswith("proposed.") for r in e["requires"])]
print("emittable on current I1 features (after review + E1):", len(nowA), nowA)
print("entries:", len(cat["interpretations"]), "| eligible (initial + later):", len(emittable))
print("FAILS:" if fails else "ALL CHECKS PASS", *fails, sep="\n  ")
sys.exit(1 if fails else 0)
