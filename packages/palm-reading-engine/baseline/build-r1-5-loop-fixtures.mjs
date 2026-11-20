// AURA-PALM-G6-D0-R1.5 — builds prototype/fixtures/r1-5-loop-order-asymmetric-fixtures.json (deterministic, synthetic).
// Usage (from the R1.5 package root): node baseline/build-r1-5-loop-fixtures.mjs <R1.1 prototype dir> <empty scratch dir>
//
// R1.4-SF-01: no R1.4 loop fixture is valid in exactly ONE single point order under the R1.3 validator, so a validator
// that checks only one order (NC-44) cannot change any R1.4 loop outcome. These fixtures are curled hooks (open
// loop-shaped polylines) whose tortuosity sits within float rounding of the 2.0 + eps limit, so the path-length sum in
// one order exceeds the limit and in the other does not. Found by bisection + float-neighbour walk (no random search).
//
// Proof of the single-order verdicts uses a DERIVED COPY of the frozen src/schema.mjs, written to <scratch>, in which
// the private single-order validator `problemInOrder` is additionally exported. The frozen engine is never modified;
// the derived copy is used only here, and the proof is re-established independently in the R1.5 test
// (exact path-length arithmetic against GEOMETRY_CONTRACT) and empirically by NC-44 / NC-44b.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const r11 = path.resolve(process.argv[2] || '');
const scratch = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3] || !fs.existsSync(scratch) || fs.readdirSync(scratch).length) { console.error('usage: build-r1-5-loop-fixtures.mjs <R1.1 prototype> <EMPTY scratch dir>'); process.exit(2); }
const here = path.resolve('prototype');
const src = fs.readFileSync(path.join(here, 'src/schema.mjs'), 'utf8');
const marker = '\nfunction problemInOrder(pts) {';
if (src.split(marker).length !== 2) throw new Error('problemInOrder anchor not found exactly once');
fs.writeFileSync(path.join(scratch, 'schema-derived.mjs'), src.replace(marker, '\nexport function problemInOrder(pts) {'));
const D = await import(pathToFileURL(path.join(scratch, 'schema-derived.mjs')).href);
const S = await import(pathToFileURL(path.join(here, 'src/schema.mjs')).href);
const E11 = await import(pathToFileURL(path.join(r11, 'src/engine.mjs')).href);
const F = await import(pathToFileURL(path.join(here, 'fixtures/synthetic-fixtures.mjs')).href);
const O = await import(pathToFileURL(path.join(here, 'test/oracle.mjs')).href);

const rev = (p) => [...p].reverse();
const serial = (s) => ({ valid: s.valid, items: [...s.items], declined: [...s.declined] });
const sumLen = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return L; };
const ratio = (p) => sumLen(p) / Math.hypot(p.at(-1).x - p[0].x, p.at(-1).y - p[0].y);
// curled hook: walks out, curls up and back toward its start without crossing itself; `t` stretches it horizontally
const hook = (t, sh) => { const j = (k) => 1 + 0.07 * Math.sin(sh * 2.3 + k * 1.1); const s = 0.12;
  const base = [[0, 0], [0.13 * j(1), 0.02], [0.35, 0.09 * j(2)], [0.62 * j(3), 0.31], [0.71, 0.64 * j(4)], [0.55 * j(5), 0.9], [0.31, 0.97 * j(6)], [0.12 * j(7), 0.85]];
  return base.map(([x, y], i) => ({ x: 0.3 + s * x * (i === 0 ? 1 : t), y: 0.4 + s * y })); };
const target = S.GEOMETRY_CONTRACT.maxTortuosity + S.GEOMETRY_CONTRACT.eps;
function construct(want, start = 0) {
  for (let sh = start; sh < 400; sh++) {
    let lo = 0.2, hi = 3; const f = (t) => ratio(hook(t, sh)) - target;
    const flo = f(lo), fhi = f(hi); if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) continue;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m; else hi = m; }
    for (let k = -256; k <= 256; k++) {
      const p = hook(lo + k * Number.EPSILON * lo, sh); const c = S.canonicalSequence(p);
      if (D.problemInOrder(c) === want[0] && D.problemInOrder(rev(c)) === want[1]) return { pts: c, shape: sh };
    }
  }
  return null;
}
const fixtures = [];
function add(id, category, pts, expect, slot = 'PTC') {
  const f = F.base();
  if (slot === 'PTC') f.creases.items[1].geometry.points = pts; else f.creases.items.push(F.crease('m1', 'MINOR', pts, 0.9));
  const c = S.canonicalSequence(pts);
  const proof = { canonicalOrderProblem: D.problemInOrder(c), reversedOrderProblem: D.problemInOrder(rev(c)), engineProblem: S.polylineProblem(pts),
    tortuosityCanonical: ratio(c), tortuosityReversed: ratio(rev(c)), limit: target, method: 'derived copy of frozen src/schema.mjs exporting problemInOrder' };
  const r11s = O.orientations(f).map(({ mask, input }) => ({ mask, summary: serial(O.summarize(E11.generateReading(input))) }));
  fixtures.push({ id, category, expect, slot, proof, input: f, r11: r11s });
}
const a = construct([null, 'tortuous']); const b = construct(['tortuous', null]); const a2 = a && construct([null, 'tortuous'], a.shape + 1);
if (!a || !b || !a2) { console.error('could not construct the order-asymmetric fixtures'); process.exit(1); }
add('L12-hook-canonical-valid-reverse-tortuous', 'loop-order-asymmetric', a.pts, 'invalid-both');
add('L13-hook-canonical-valid-reverse-tortuous-supplied-reversed', 'loop-order-asymmetric', rev(a.pts), 'invalid-both');
add('L14-hook-canonical-tortuous-reverse-valid', 'loop-order-asymmetric', b.pts, 'invalid-both');
add('L15-hook-canonical-valid-reverse-tortuous-minor-slot', 'loop-order-asymmetric', a2.pts, 'invalid-both', 'MINOR');
const outFile = path.join(here, 'fixtures', 'r1-5-loop-order-asymmetric-fixtures.json');
fs.writeFileSync(outFile, JSON.stringify({ note: 'AURA-PALM-G6-D0-R1.5 order-asymmetric loop fixtures (synthetic; built by baseline/build-r1-5-loop-fixtures.mjs). Each is valid in exactly one single point order under the R1.3 single-order validator and must be invalid (tortuous) in every orientation.', fixtures }, null, 1) + '\n');
for (const fx of fixtures) console.log(fx.id, JSON.stringify({ c: fx.proof.canonicalOrderProblem, r: fx.proof.reversedOrderProblem, engine: fx.proof.engineProblem, tc: fx.proof.tortuosityCanonical, tr: fx.proof.tortuosityReversed }));
