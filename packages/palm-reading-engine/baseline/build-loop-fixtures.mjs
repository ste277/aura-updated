// AURA-PALM-G6-D0-R1.4 — builds prototype/fixtures/r1-4-loop-validity-fixtures.json (deterministic, synthetic).
// Usage (from the R1.4 package root): node baseline/build-loop-fixtures.mjs <R1.1 prototype dir>
// Loop-shaped and tortuous polylines, built by fixed coordinates or by bisection + float-neighbour walk (no random
// search). Each fixture records: input, category, expectation, proof (R1.1's single-order validity verdict for the
// supplied order and its reversal) and the frozen R1.1 reading summary for EVERY point orientation.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const r11 = path.resolve(process.argv[2] || '../AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING/prototype');
const E11 = await import(pathToFileURL(path.join(r11, 'src/engine.mjs')).href);
const S11 = await import(pathToFileURL(path.join(r11, 'src/schema.mjs')).href);
const here = path.resolve('prototype');
const S = await import(pathToFileURL(path.join(here, 'src/schema.mjs')).href);
const F = await import(pathToFileURL(path.join(here, 'fixtures/synthetic-fixtures.mjs')).href);
const O = await import(pathToFileURL(path.join(here, 'test/oracle.mjs')).href);

const rev = (p) => [...p].reverse();
const serial = (s) => ({ valid: s.valid, items: [...s.items], declined: [...s.declined] });
const fixtures = [];
function add(id, category, pts, expect, slot = 'PTC') {
  const f = F.base();
  if (slot === 'PTC') f.creases.items[1].geometry.points = pts; else f.creases.items.push(F.crease('m1', 'MINOR', pts, 0.9));
  const proof = { r11Forward: S11.polylineProblem(pts), r11Reversed: S11.polylineProblem(rev(pts)) };
  const r11 = O.orientations(f).map(({ mask, input }) => ({ mask, summary: serial(O.summarize(E11.generateReading(input))) }));
  fixtures.push({ id, category, expect, slot, proof, input: f, r11 });
}
function construct(build, measure, target, accept, range = [0.5, 1.5], shapes = 120) {
  for (let shape = 0; shape < shapes; shape++) {
    let [lo, hi] = range; const f = (t) => measure(build(t, shape)) - target;
    if (Math.sign(f(lo)) === Math.sign(f(hi))) continue;
    for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m; else hi = m; }
    for (let k = -128; k <= 128; k++) { const pts = build(lo + k * Number.EPSILON * lo, shape); if (accept(pts)) return pts; }
  }
  return null;
}
const sumLen = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return L; };
const ratio = (p) => sumLen(p) / Math.hypot(p.at(-1).x - p[0].x, p.at(-1).y - p[0].y);

// 1. closed loop (first point repeated at the end) — invalid in both orders (repeated-point)
const ring = Array.from({ length: 9 }, (_, i) => ({ x: 0.45 + 0.12 * Math.cos((i * 2 * Math.PI) / 8), y: 0.55 + 0.12 * Math.sin((i * 2 * Math.PI) / 8) }));
ring[8] = { ...ring[0] };
add('L01-closed-loop', 'loop-closed', ring, 'invalid-both');
// 2. near-closed loop (gap 0.004) — tortuous in both orders
const near = Array.from({ length: 12 }, (_, i) => { const a = (i / 11) * (2 * Math.PI - 0.035); return { x: 0.45 + 0.12 * Math.cos(a), y: 0.55 + 0.12 * Math.sin(a) }; });
add('L02-near-closed-loop', 'loop-near-closed', near, 'invalid-both');
// 3. self-intersecting figure-8 — invalid in both orders
const fig8 = Array.from({ length: 13 }, (_, i) => { const t = (i / 12) * 2 * Math.PI * 0.92; return { x: 0.45 + 0.15 * Math.sin(t), y: 0.55 + 0.1 * Math.sin(2 * t) }; });
add('L03-figure-eight', 'loop-self-intersecting', fig8, 'invalid-both');
// 4. crossing hook (a spiral that cuts back over itself)
const hook = [{ x: 0.2, y: 0.4 }, { x: 0.5, y: 0.4 }, { x: 0.5, y: 0.6 }, { x: 0.35, y: 0.6 }, { x: 0.35, y: 0.3 }];
add('L04-crossing-hook', 'loop-self-intersecting', hook, 'invalid-both');
// 5. tortuous U at exactly the 2.0 limit, constructed so R1.1's verdict depends on point order (one order invalid)
const uShape = (t, shape) => { const w = 0.2 + 0.003 * shape; const h = (w / 2) * t; const x0 = 0.3, y0 = 0.35; return [{ x: x0, y: y0 }, { x: x0, y: y0 + h }, { x: x0 + w * 0.5, y: y0 + h + 0.0004 * (shape % 3) }, { x: x0 + w, y: y0 + h }, { x: x0 + w, y: y0 }]; };
const orderDep = (p) => { const a = S11.polylineProblem(p), b = S11.polylineProblem(rev(p)); return a !== b; };
const tortuousTargets = [S.GEOMETRY_CONTRACT.maxTortuosity + S.GEOMETRY_CONTRACT.eps];
let tcount = 0;
for (let s0 = 0; s0 < 3; s0++) {
  const pts = construct((t, sh) => uShape(t, sh + s0 * 40), ratio, tortuousTargets[0], orderDep, [0.9, 1.1], 40);
  if (pts) { add(`L05-tortuous-order-dependent-${tcount}`, 'tortuous-order-dependent', pts, 'invalid-both'); tcount++; }
}
// 6. orientations disagree on an INTERMEDIATE result: both orders invalid in R1.1 but with different codes
//    (a tiny self-crossing polyline whose length sits at the minimum-length limit: 'degenerate' in one order,
//    'self-intersecting' in the other)
const tinyCross = (t, shape) => {
  // an irregular 8-point path that walks out, turns gently (< 120°) and finally cuts back across its first segment
  const s = 0.0025 * t * (1 + 0.0137 * shape); const j = (k) => 1 + 0.031 * Math.sin(shape * 1.7 + k);
  const pts = [[0, 0], [1.0 * j(1), 0.05], [1.9 * j(2), 0.35], [2.4, 1.1 * j(3)], [2.2, 1.9], [1.5 * j(4), 2.3], [0.8, 1.9 * j(5)], [0.6, -0.4]];
  return pts.map(([x, y]) => ({ x: 0.4 + s * x, y: 0.4 + s * y }));
};
const codesDiffer = (p) => { const a = S11.polylineProblem(p), b = S11.polylineProblem(rev(p)); return a !== null && b !== null && a !== b; };
const inter = construct(tinyCross, sumLen, S.GEOMETRY_CONTRACT.minLength - S.GEOMETRY_CONTRACT.eps, codesDiffer, [0.5, 1.5], 120);
if (inter) add('L06-intermediate-code-disagreement', 'intermediate-disagreement', inter, 'invalid-both');
// 7. the same shapes reversed (explicit reversed fixtures, in addition to orientation enumeration)
add('L07-figure-eight-reversed', 'loop-self-intersecting', rev(fig8), 'invalid-both');
if (inter) add('L08-intermediate-disagreement-reversed', 'intermediate-disagreement', rev(inter), 'invalid-both');
// 8. valid controls: a gentle open arc and the same arc reversed, and a valid arc in the MINOR slot
const arc = Array.from({ length: 7 }, (_, i) => { const a = (i / 6) * 1.2; return { x: 0.1 + 0.5 * Math.sin(a), y: 0.32 + 0.25 * (1 - Math.cos(a)) }; });
add('L09-valid-open-arc', 'valid-control', arc, 'valid');
add('L10-valid-open-arc-reversed', 'valid-control', rev(arc), 'valid');
// 9. a loop in the MINOR slot (competing-candidate path) — invalid input regardless of slot
add('L11-closed-loop-minor-slot', 'loop-closed', ring, 'invalid-both', 'MINOR');

const out = { generatedBy: 'baseline/build-loop-fixtures.mjs', r11Prototype: 'AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING/prototype (frozen R1.1)', count: fixtures.length, fixtures };
fs.writeFileSync(path.join(here, 'fixtures', 'r1-4-loop-validity-fixtures.json'), JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ count: fixtures.length, ids: fixtures.map((f) => `${f.id}:${f.proof.r11Forward}/${f.proof.r11Reversed}`) }, null, 1));
