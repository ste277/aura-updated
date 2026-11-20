// AURA-PALM-G6-D0-R1.5 — campaign core (harness-owned; NOT part of the interpretation engine).
//
// R1.4-RV-01/02 (coverage contract trusted self-reported reports): campaign case generation, de-duplication,
// orientation-variant enumeration and per-case evaluation live here, in ONE module shared by the campaign scripts
// (baseline/differential.mjs, baseline/fixture-campaigns.mjs) and by the contract verifier
// (prototype/test/campaign-verify.mjs). Because generation is a pure function of the seed (random campaigns) or of the
// fixture files (fixture campaigns), the verifier can REGENERATE every case a report claims, and RE-EVALUATE it with
// both frozen engines, instead of trusting the report's totals.
//
// The random generator and case construction are moved here VERBATIM from the R1.4 differential (mulberry32, the
// same draw order, the same 16 seeded masks for > 5 creases), so the R1.4 campaign sequences are reproduced exactly.
//
// Per-case evidence record (one NDJSON line per canonical-distinct compared case; see recordOf):
//   j        compared-case index (0-based, in generation order)      n        generation index of the case
//   id       case id (`${seed}-${n}` or the fixture id)               key/raw  canonical / raw input keys (coverage.mjs)
//   variants number of distinct orientation variants evaluated       masks    the orientation masks evaluated
//   valid    the candidate accepts the input                          r13      digest of the candidate's forward reading
//   r11      digest of R1.1's readings for every variant (in order)   r13all   all candidate variant readings identical
//   upgrades sorted violation kinds vs the R1.1 meet                 r11Disagree  R1.1 orientations disagree
//   ties     tie categories (coverage.mjs classifyTies)              tags     construction tags
//   centralConflict  the candidate's central-longitudinal observation is a conflict
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { adaptDetection } from '../../adapter/feature-adapter.mjs'; // G6-I1: the fixtures-adapter campaign runs the adapter live

export const RANDOM_GENERATOR_ID = 'mulberry32/v1 (uint32 state, integer arithmetic, period 2^32; unchanged from R1.3)';
export const FIXTURE_GENERATOR_ID = 'constructed fixtures (deterministic; no RNG)';
export const RECORD_SCHEMA = 'r1.5-case-record/1';
export const UPGRADE_KINDS = Object.freeze(['claim-presence-upgrade', 'confidence-upgrade', 'invalid-to-valid', 'conflict-abstention-to-claim', 'additional-interpretation']);
export const TIE_FIELDS = Object.freeze(['observed', 'reconciledInTrace', 'outcomeRelevant', 'abstention', 'tierLowered', 'candidateRank', 'outcomeUnchanged', 'harmless', 'noopChanged']);

const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** Digest of a reading with the two as-supplied fingerprint fields removed (RV-15 exclusion; same as oracle.orderFree). */
export const readingDigest = (r) => sha256(JSON.stringify({ ...r, readingId: undefined, inputSha256: undefined }));
export const fileSha256 = (p) => sha256(fs.readFileSync(p));
const clone = (o) => JSON.parse(JSON.stringify(o));
const hasPoints = (c) => Array.isArray(c?.geometry?.points) && c.geometry.points.length >= 2;

// ---------- RNG (verbatim from R1.4) ----------
export function mulberry32(a) { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** All orientation variants for the given masks of the creases with points (mask bit b = reverse the b-th such crease). */
export function variantsForMasks(input, masks) {
  const idx = (input?.creases?.items || []).map((c, i) => (hasPoints(c) ? i : -1)).filter((i) => i >= 0);
  return masks.map((m) => { const g = clone(input); idx.forEach((ci, b) => { if (m & (1 << b)) g.creases.items[ci].geometry.points.reverse(); }); return { mask: m, input: g }; });
}
const dedupe = (list) => { const seen = new Set(); return list.filter(({ input }) => { const k = JSON.stringify(input); if (seen.has(k)) return false; seen.add(k); return true; }); };

/**
 * Random campaign stream. Yields one entry per GENERATED input, in order:
 *   { n, duplicate: true, rawNew }                                   (canonical duplicate; skipped)
 *   { n, duplicate: false, rawNew, id, input, tags, raw, key, vars } (canonical-distinct; to be compared)
 * ctx = { F (synthetic-fixtures module), FIX (r1-3 constructed fixtures JSON), C (coverage module) }.
 */
export function* randomCaseStream(seed, ctx) {
  const SEED = seed >>> 0; const { F, FIX, C } = ctx;
  const rnd = mulberry32(SEED);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pool = { lengthTie: [], fateTie: [], centreTie: [], validityBoundary: [], competitor: [] };
  for (const fx of FIX.fixtures) {
    if (fx.category === 'length-tie') pool.lengthTie.push(fx.input.creases.items[1].geometry.points);
    if (fx.category === 'fate-length-tie') pool.fateTie.push(fx.input.creases.items.at(-1).geometry.points);
    if (fx.category === 'centre-tie') pool.centreTie.push(fx.input.creases.items.at(-1).geometry.points);
    if (fx.proof?.r11Problems) for (const c of fx.input.creases.items) if (c.geometry.points.length > 2 && c.geometry.points.every((p) => Math.abs(p.x - c.geometry.points[0].x) < 0.03)) pool.validityBoundary.push(c.geometry.points);
  }
  pool.competitor = [[{ x: 0.5, y: 0.45 }, { x: 0.505, y: 0.65 }, { x: 0.51, y: 0.95 }], [{ x: 0.42, y: 0.5 }, { x: 0.425, y: 0.7 }, { x: 0.43, y: 0.98 }], [{ x: 0.6, y: 0.4 }, { x: 0.598, y: 0.7 }, { x: 0.603, y: 0.97 }]];
  const BASES = [F.base, F.strong, F.weak, F.d3bUserConfirmed, F.multipleInterpretations, F.contradictory, F.missingMajor, F.ambiguousIdentity, F.d1Unclassified];
  const CONF = [0.95, 0.9, 0.75, 0.7499, 0.74996, 0.6, 0.5, 0.49996, 0.3];
  const jitter = (pts, s) => pts.map((p) => ({ x: p.x + (rnd() - 0.5) * s, y: p.y + (rnd() - 0.5) * s }));
  function randomPolyline() {
    const kind = pick(['h', 'v', 'd', 'z', 'half', 'arc']); const n = 2 + Math.floor(rnd() * 7); const x0 = 0.05 + rnd() * 0.4, y0 = 0.15 + rnd() * 0.5; const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      if (kind === 'h') out.push({ x: x0 + 0.5 * t, y: y0 + 0.08 * t + (rnd() - 0.5) * 0.005 });
      else if (kind === 'v') out.push({ x: 0.4 + rnd() * 0.2 + (rnd() - 0.5) * 0.005, y: 0.35 + 0.65 * t });
      else if (kind === 'd') out.push({ x: x0 + 0.4 * t, y: y0 + 0.4 * t });
      else if (kind === 'z') out.push({ x: x0 + 0.5 * t, y: y0 + (i % 2 ? 0.03 : 0) });
      else if (kind === 'half') out.push({ x: Math.round((x0 + 0.5 * t) * 1e4) / 1e4 + 0.00005, y: Math.round((y0 + 0.1 * Math.sin(2 * t)) * 1e4) / 1e4 + 0.00005 });
      else out.push({ x: 0.06 + 0.4 * Math.sin(2.2 * t), y: 0.34 + 0.7 * t });
    }
    return out;
  }
  const INJECT = { lengthTie: true, centreAndFateTie: true, competitor: true, validity: true }; // negative controls flip these
  function makeCase(n) {
    const f = pick(BASES)(); const tags = new Set();
    for (const c of f.creases.items) {
      if (rnd() < 0.3) c.geometry.points = randomPolyline();
      if (rnd() < 0.15 && c.detection.confidenceBasis === 'synthetic-declared') { const v = pick(CONF); c.detection.confidence = v; if (c.identity.classSource === 'synthetic-declared') c.identity.classConfidence = v; }
    }
    const ptc = f.creases.items.find((c) => c.identity.anatomicalClass === 'PTC');
    if (INJECT.lengthTie && ptc && rnd() < 0.3) { ptc.geometry.points = clone(pick(pool.lengthTie)); tags.add('length-tie'); }
    const minors = [];
    if (INJECT.centreAndFateTie && rnd() < 0.25) { minors.push(clone(pick(rnd() < 0.5 ? pool.fateTie : pool.centreTie))); tags.add('centre-or-fate-tie'); }
    if (INJECT.competitor && rnd() < 0.25) { minors.push(jitter(pick(pool.competitor), 0.004)); if (minors.length > 1 || rnd() < 0.5) { minors.push(jitter(pick(pool.competitor), 0.004)); } tags.add('competing'); }
    if (INJECT.validity && rnd() < 0.04 && pool.validityBoundary.length) { const tgt = pick(f.creases.items); tgt.geometry.points = clone(pick(pool.validityBoundary)); tags.add('validity-boundary'); }
    if (rnd() < 0.1) minors.push(randomPolyline());
    minors.forEach((p, i) => f.creases.items.push(F.crease(`m${i}`, 'MINOR', p, pick([0.9, 0.8, 0.6]))));
    for (const c of f.creases.items) if (rnd() < 0.5) c.geometry.points.reverse();
    if (rnd() < 0.2) f.scanConfidence.value = pick([0.95, 0.75, 0.5, 0.41, 0.4, 0.39]);
    if (rnd() < 0.2) f.capture.orientation.rotationDeg = pick([0, 4, -30, 44.9999, 45, -45, 45.0001, 60, 180, -180]);
    if (rnd() < 0.15) f.capture.quality.issues = pick([[], ['hand-rotated'], ['hand-cut-off'], ['palm-not-visible'], ['hand-too-small', 'hand-rotated']]);
    if (rnd() < 0.12) f.capture.orientation.palmFacing = pick([true, null, false]);
    if (rnd() < 0.12) f.capture.handedness = pick([{ value: 'unknown', source: 'unknown' }, { value: 'left', source: 'landmark-model' }, { value: 'right', source: 'user-declared' }]);
    if (rnd() < 0.04) f.landmarks = { present: false };
    if (rnd() < 0.04) { const k = pick([1, 49, 50, 51, 200]); for (let i = 0; i < k; i++) f[`u${i}`] = i; tags.add('error-truncation'); }
    if (rnd() < 0.02) f.creases.items[0].id = pick(['', 'death', 'constructor']);
    return { input: f, tags, id: `${SEED}-${n}` };
  }
  // ≤ 5 creases with points: all 2^k masks; otherwise all-reversed, each single reversal and 16 seeded masks (R1.4).
  function masksOf(input) {
    const k = (input?.creases?.items || []).filter(hasPoints).length;
    if (k <= 5) return Array.from({ length: 1 << k }, (_, m) => m);
    const masks = new Set([0, (1 << k) - 1, ...Array.from({ length: k }, (_, b) => 1 << b)]);
    for (let j = 0; j < 16; j++) masks.add(Math.floor(rnd() * (1 << k)));
    return [...masks];
  }
  const seenRaw = new Set(), seenCanon = new Set();
  for (let n = 0; ; n++) {
    const { input, tags, id } = makeCase(n);
    const raw = C.rawInputKey(input), key = C.canonicalInputKey(input);
    const rawNew = !seenRaw.has(raw); if (rawNew) seenRaw.add(raw);
    if (seenCanon.has(key)) { yield { n, duplicate: true, rawNew }; continue; }
    seenCanon.add(key);
    const vars = dedupe(variantsForMasks(input, masksOf(input)));
    yield { n, duplicate: false, rawNew, id, input, tags: [...tags].sort(), raw, key, vars };
  }
}

export const FIXTURE_CAMPAIGNS = Object.freeze(['fixtures-boundary', 'fixtures-competing', 'fixtures-loop', 'fixtures-adapter']);
export const FIXTURE_FILES = Object.freeze(['r1-3-constructed-boundary-fixtures.json', 'r1-4-loop-validity-fixtures.json', 'r1-5-loop-order-asymmetric-fixtures.json', 'g6-i1-adapter-inputs.json']);
/** The fixture list of a fixture campaign, read from the candidate's fixture files. */
export function fixtureSet(campaign, protoDir) {
  const load = (f) => JSON.parse(fs.readFileSync(path.join(path.resolve(protoDir), 'fixtures', f), 'utf8')).fixtures;
  const R13 = load(FIXTURE_FILES[0]);
  if (campaign === 'fixtures-boundary') return R13.filter((f) => ['length-tie', 'length-plain', 'fate-length-tie', 'centre-tie'].includes(f.category));
  if (campaign === 'fixtures-competing') return R13.filter((f) => f.category === 'competing');
  if (campaign === 'fixtures-loop') return [...load(FIXTURE_FILES[1]), ...load(FIXTURE_FILES[2]), ...R13.filter((f) => f.category === 'validity')];
  if (campaign === 'fixtures-adapter') {
    // G6-I1: frozen synthetic detector output passed through the adapter LIVE; a case the adapter refuses throws
    const A = JSON.parse(fs.readFileSync(path.join(path.resolve(protoDir), 'fixtures', FIXTURE_FILES[3]), 'utf8'));
    return A.cases.map((c) => ({ id: c.id, category: c.category, input: adaptDetection(c.detection, A.frame, c.identity).features }));
  }
  throw new Error(`unknown fixture campaign ${campaign}`);
}
/** Fixture campaign stream: same entry shape as randomCaseStream (all 2^k variants, de-duplicated, uncapped; k ≤ 12). */
export function* fixtureCaseStream(campaign, protoDir, ctx) {
  const { C } = ctx; const seenRaw = new Set(), seenCanon = new Set(); let n = 0;
  for (const fx of fixtureSet(campaign, protoDir)) {
    const raw = C.rawInputKey(fx.input), key = C.canonicalInputKey(fx.input);
    const rawNew = !seenRaw.has(raw); if (rawNew) seenRaw.add(raw);
    if (seenCanon.has(key)) { yield { n: n++, duplicate: true, rawNew }; continue; }
    seenCanon.add(key);
    const k = fx.input.creases.items.filter(hasPoints).length;
    if (k > 12) throw new Error(`${fx.id}: ${k} creases with points exceeds the 2^12 enumeration bound`);
    const vars = dedupe(variantsForMasks(fx.input, Array.from({ length: 1 << k }, (_, m) => m)));
    yield { n: n++, duplicate: false, rawNew, id: fx.id, input: fx.input, tags: [fx.category], raw, key, vars, fixture: fx };
  }
}

/**
 * Independent variant expectation (does not use the stream's mask choice): the number of DISTINCT orientation variants
 * when all 2^k are enumerated, by brute force over masks; for > 5 creases (sampled masks) the required members are the
 * forward, all-reversed and every single-crease reversal (as distinct inputs).
 */
export function expectedVariantSet(input, sampled) {
  const k = (input?.creases?.items || []).filter(hasPoints).length;
  const keyOf = (g) => JSON.stringify(g);
  if (!sampled || k <= 5) return { exact: true, keys: new Set(variantsForMasks(input, Array.from({ length: 1 << k }, (_, m) => m)).map((v) => keyOf(v.input))) };
  return { exact: false, keys: new Set(variantsForMasks(input, [0, (1 << k) - 1, ...Array.from({ length: k }, (_, b) => 1 << b)]).map((v) => keyOf(v.input))) };
}

/** Evaluate one canonical-distinct case with both engines (via the shared oracle) and build its evidence record. */
export function evaluateCase(c, j, { E11, EC, G, O, C }) {
  const rc = c.vars.map(({ input }) => EC.generateReading(input));
  const r11 = c.vars.map(({ input }) => E11.generateReading(input));
  const sums = r11.map((r) => O.summarize(r));
  const upgrades = [...new Set(O.violations(O.summarize(rc[0]), O.meet(sums)).map((x) => x.kind))].sort();
  const t = C.classifyTies(c.input, rc[0], G.describe, sums);
  const record = {
    schema: RECORD_SCHEMA, j, n: c.n, id: c.id, key: c.key, raw: c.raw, variants: c.vars.length, masks: c.vars.map((v) => v.mask),
    valid: rc[0].status !== 'invalid-input', r13: readingDigest(rc[0]), r11: sha256(JSON.stringify(r11.map(readingDigest))),
    r13all: rc.every((r) => O.orderFree(r) === O.orderFree(rc[0])), upgrades, r11Disagree: C.r11OrientationsDisagree(sums),
    ties: Object.fromEntries(TIE_FIELDS.map((f) => [f, !!t[f]])), tags: c.tags,
    centralConflict: rc[0].observations?.find((o) => o.crease === 'CENTRAL_LONGITUDINAL')?.status === 'conflict',
  };
  return { record, rc, r11, sums };
}

/** Counts derived ONLY from evidence records (the contract compares every self-reported count against these). */
export function countsFromRecords(records) {
  const k = { comparedCases: records.length, canonicalDistinct: new Set(records.map((r) => r.key)).size, invalidCases: 0, eligibleCanonicalDistinct: 0, orientationVariants: 0, orientationComparisons: 0,
    observedTies: 0, reconciledInTraceTies: 0, outcomeRelevantTies: 0, abstentionTies: 0, tierLoweredTies: 0, candidateRankTies: 0, outcomeUnchangedTies: 0, harmlessTies: 0, noopChangedTies: 0,
    outcomeRelevantNotObserved: 0, r11DisagreementCases: 0, constructedTieCases: 0, competingCases: 0, competingConflicts: 0, validityBoundaryCases: 0, validityBoundaryInvalid: 0, errorTruncationCases: 0, reversalMismatches: 0 };
  const upgrades = Object.fromEntries(UPGRADE_KINDS.map((x) => [x, 0]));
  const F = { observed: 'observedTies', reconciledInTrace: 'reconciledInTraceTies', outcomeRelevant: 'outcomeRelevantTies', abstention: 'abstentionTies', tierLowered: 'tierLoweredTies', candidateRank: 'candidateRankTies', outcomeUnchanged: 'outcomeUnchangedTies', harmless: 'harmlessTies', noopChanged: 'noopChangedTies' };
  for (const r of records) {
    if (r.valid) k.eligibleCanonicalDistinct++; else k.invalidCases++;
    k.orientationVariants += r.variants; k.orientationComparisons += r.variants - 1;
    for (const [f, c] of Object.entries(F)) if (r.ties?.[f]) k[c]++;
    if (r.ties?.outcomeRelevant && !r.ties?.observed) k.outcomeRelevantNotObserved++;
    if (r.r11Disagree) k.r11DisagreementCases++;
    if (r.tags?.includes('length-tie') || r.tags?.includes('centre-or-fate-tie')) k.constructedTieCases++;
    if (r.tags?.includes('competing')) { k.competingCases++; if (r.centralConflict) k.competingConflicts++; }
    if (r.tags?.includes('validity-boundary')) { k.validityBoundaryCases++; if (!r.valid) k.validityBoundaryInvalid++; }
    if (r.tags?.includes('error-truncation')) k.errorTruncationCases++;
    if (!r.r13all) k.reversalMismatches++;
    for (const u of r.upgrades || []) upgrades[u] = (upgrades[u] ?? 0) + 1;
  }
  return { counts: k, upgrades };
}

/** Digest identifying a campaign's case set (ordered canonical keys); two campaigns with equal digests are the same. */
export const caseSetDigest = (records) => sha256(records.map((r) => r.key).join('\n'));

/** Provenance: sha256 of every file that determines a campaign's result. */
export function provenanceOf({ candidate, baseline, scripts }) {
  const hashDir = (dir, sub, filter) => Object.fromEntries(fs.readdirSync(path.join(dir, sub)).filter(filter).sort().map((f) => [`${sub}/${f}`, fileSha256(path.join(dir, sub, f))]));
  return {
    candidateEngine: hashDir(candidate, 'src', (f) => f.endsWith('.mjs')),
    baselineEngine: hashDir(baseline, 'src', (f) => f.endsWith('.mjs')),
    harness: Object.fromEntries([...['test/oracle.mjs', 'test/coverage.mjs', 'test/campaign-core.mjs', 'test/campaign-verify.mjs', 'test/independent-oracle.mjs'].map((f) => [f, fileSha256(path.join(candidate, f))]),
      ['adapter/feature-adapter.mjs', fileSha256(path.join(candidate, '..', 'adapter', 'feature-adapter.mjs'))], ...scripts.map((p) => [`baseline/${path.basename(p)}`, fileSha256(p)])]),
    fixtures: Object.fromEntries(['synthetic-fixtures.mjs', ...FIXTURE_FILES].map((f) => [`fixtures/${f}`, fileSha256(path.join(candidate, 'fixtures', f))])),
    node: process.version,
  };
}
