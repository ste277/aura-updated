// AURA-PALM-G6-I1 — builds prototype/fixtures/g6-i1-adapter-inputs.json (deterministic, synthetic; no RNG).
// Usage (from packages/palm-reading-engine): node baseline/build-g6-i1-adapter-inputs.mjs
//
// Inputs: the FROZEN D1 detector output on the G4 synthetic fixtures (vendor/AURA_PALM_G4_D1/evidence/
// d1_candidates_existing_fixtures.json, sha256 pinned by vendor/AURA_PALM_G4_D1/SHA256SUMS) and the G4 synthetic
// frame (the fixed pseudo-landmarks PALM_POLY of research/palm-scan-g4d1/test/fixtures/synthetic-palm.mjs, used by
// every G4 synthetic fixture; reproduced below). No image, no camera, no real data.
// Cases per frozen detection:
//   frozen          the detector output exactly as frozen (raw, unbounded scores) — identity null
//   synthetic-score the same tracks with a DECLARED synthetic score of 0.6 (test input, not a calibration), identity
//                   null, and again with a synthetic user-confirmed identity (each planted major class labelled on
//                   the candidate nearest to it; others MINOR)
import fs from 'node:fs';
import crypto from 'node:crypto';

const VENDOR = 'vendor/AURA_PALM_G4_D1/evidence/d1_candidates_existing_fixtures.json';
const pinned = fs.readFileSync('vendor/AURA_PALM_G4_D1/SHA256SUMS', 'utf8').trim().split(/\s+/)[0];
const raw = fs.readFileSync(VENDOR);
if (crypto.createHash('sha256').update(raw).digest('hex') !== pinned) { console.error('vendored D1 evidence hash mismatch'); process.exit(1); }
const D1 = JSON.parse(raw);
// G4 synthetic pseudo-landmarks (pixels): wrist, thumb CMC, thumb MCP, index MCP, middle MCP, ring MCP, pinky MCP
const PALM_POLY = [{ x: 240, y: 560 }, { x: 140, y: 480 }, { x: 110, y: 380 }, { x: 150, y: 250 }, { x: 230, y: 235 }, { x: 305, y: 245 }, { x: 365, y: 270 }];
// G4 planted ground truth (quadratic Bézier control points) — used only to assign the synthetic identity labels
const PLANTED = { DTC: [{ x: 335, y: 318 }, { x: 270, y: 290 }, { x: 190, y: 305 }], PTC: [{ x: 160, y: 350 }, { x: 235, y: 360 }, { x: 305, y: 398 }], TC: [{ x: 175, y: 335 }, { x: 160, y: 440 }, { x: 225, y: 520 }] };
const frame = {
  capture: { handedness: { value: 'right', source: 'user-declared' }, dominantHand: 'unknown', orientation: { rotationDeg: 4, palmFacing: true }, quality: { status: 'accepted', issues: [] } },
  landmarks: { source: { detector: 'synthetic-fixture', version: '0.1.0' }, points: { wrist: PALM_POLY[0], indexMcp: PALM_POLY[3], pinkyMcp: PALM_POLY[6] } },
  scanConfidence: { value: 0.9, basis: 'uncalibrated-detector-score' },
};
const centroid = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
function labelsFor(cands) {
  const taken = new Set(); const labels = [];
  const pairs = [];
  cands.forEach((c, i) => { const m = centroid(c.points); for (const [cls, ctrl] of Object.entries(PLANTED)) { const g = centroid(ctrl); pairs.push({ i, cls, d: Math.hypot(m.x - g.x, m.y - g.y) }); } });
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.cls.localeCompare(b.cls));
  const byCand = new Map();
  for (const p of pairs) if (!byCand.has(p.i) && !taken.has(p.cls) && p.d < 60) { byCand.set(p.i, p.cls); taken.add(p.cls); }
  cands.forEach((_, i) => labels.push({ candidate: i, anatomicalClass: byCand.get(i) || 'MINOR', classConfidence: 0.9 }));
  return labels;
}
const cases = [];
for (const key of Object.keys(D1).sort()) {
  const cands = D1[key];
  const det = { detector: 'creases-directional-d1', version: 'frozen-d1', candidates: cands };
  const syn = { detector: 'creases-directional-d1', version: 'frozen-d1', candidates: cands.map((c) => ({ ...c, score: 0.6 })) };
  const id = key.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  cases.push({ id: `${id}--frozen`, category: 'adapter-frozen', detection: det, identity: null });
  cases.push({ id: `${id}--synthetic-score`, category: 'adapter-synthetic-score', detection: syn, identity: null });
  if (cands.length) cases.push({ id: `${id}--synthetic-score-confirmed`, category: 'adapter-synthetic-identity', detection: syn, identity: { synthetic: true, kind: 'user-confirmed', labels: labelsFor(cands) } });
}
const out = { note: 'AURA-PALM-G6-I1 adapter inputs (synthetic only). Frozen D1 output on the G4 synthetic fixtures + the G4 synthetic frame. synthetic-score cases carry a DECLARED test score (0.6), not a calibration; identities are synthetic and isolated to tests.',
  source: { file: VENDOR, sha256: pinned }, frame, cases };
fs.writeFileSync('prototype/fixtures/g6-i1-adapter-inputs.json', JSON.stringify(out, null, 1) + '\n');
console.log(`cases ${cases.length} (${['adapter-frozen', 'adapter-synthetic-score', 'adapter-synthetic-identity'].map((c) => `${c} ${cases.filter((x) => x.category === c).length}`).join(', ')})`);
