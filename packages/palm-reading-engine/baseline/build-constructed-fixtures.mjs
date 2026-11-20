// AURA-PALM-G6-D0-R1.3 — builds prototype/fixtures/r1-3-constructed-boundary-fixtures.json.
// Usage (from the R1.3 package root): node baseline/build-constructed-fixtures.mjs <R1.1 prototype dir>
// Every fixture is CONSTRUCTED (bisection + float-neighbour walk), never found by random search. For each fixture it
// records: the input, its category, PROOF that the intended condition is reached, and the frozen R1.1 reading summary
// for EVERY point orientation of the input (so the R1.3 tests can apply the no-upgrade oracle without R1.1 present).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const r11 = path.resolve(process.argv[2] || '../AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING/prototype');
const E11 = await import(pathToFileURL(path.join(r11, 'src/engine.mjs')).href);
const S11 = await import(pathToFileURL(path.join(r11, 'src/schema.mjs')).href);
const here = path.resolve('prototype');
const G = await import(pathToFileURL(path.join(here, 'src/geometry.mjs')).href);
const S = await import(pathToFileURL(path.join(here, 'src/schema.mjs')).href);
const F = await import(pathToFileURL(path.join(here, 'fixtures/synthetic-fixtures.mjs')).href);
const O = await import(pathToFileURL(path.join(here, 'test/oracle.mjs')).href);

const rev = (p) => [...p].reverse();
const canonLen = (pts) => { const c = S.canonicalSequence(S.collapseDuplicates(pts)); let L = 0; for (let i = 1; i < c.length; i++) L += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y); return L; };
const canonCx = (pts) => { const c = S.canonicalSequence(S.collapseDuplicates(pts)); let s = 0; for (const p of c) s += p.x; return s / c.length; };

/** Bisection on t so measure(build(t)) crosses `half`, then walk neighbouring floats until accept(pts) holds. */
function construct(build, measure, half, accept, shapes = 60, range = [0.9, 1.1]) {
  const found = [];
  for (let shape = 0; shape < shapes; shape++) {
    let [lo, hi] = range; const f = (t) => measure(build(t, shape)) - half;
    if (Math.sign(f(lo)) === Math.sign(f(hi))) continue;
    for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m; else hi = m; }
    for (let k = -96; k <= 96; k++) { const pts = build(lo + k * Number.EPSILON * lo, shape); if (accept(pts)) { found.push(pts); break; } }
    if (found.length >= 2) break;
  }
  return found;
}
const ptc = (L) => (t, shape) => { const k = 3 + (shape % 5); const bend = 0.03 + 0.01 * (shape % 7); return Array.from({ length: k + 1 }, (_, j) => ({ x: 0.05 + ((L * t) / k) * j * Math.cos(bend * j), y: 0.32 + ((L * t) / k) * j * Math.sin(bend * j) + (j % 2 ? 0.0001 * shape : 0) })); };
const fate = (L) => (t, shape) => { const k = 3 + (shape % 5); return Array.from({ length: k + 1 }, (_, j) => ({ x: 0.5 + (j % 2 ? 0.0021 + 0.0003 * shape : 0), y: 0.4 + ((L * t) / k) * j })); };
const centre = (edge) => (t, shape) => { const cx = edge * t; const w = 0.011 + 0.0007 * shape; return [{ x: cx - 0.02, y: 0.4 }, { x: cx + w, y: 0.55 }, { x: cx - 0.0031, y: 0.7 }, { x: cx - 0.01, y: 0.85 }, { x: cx + 0.0221 - w, y: 1 }]; };
const tiny = (t, shape) => { const k = 6; const s = 0.02 / k; return Array.from({ length: k + 1 }, (_, j) => ({ x: 0.3 + s * t * j * Math.cos(0.2 * j + 0.05 * shape), y: 0.4 + s * t * j * Math.sin(0.2 * j + 0.05 * shape) })); };

const lengthTie = (pts) => !S.polylineProblem(pts) && !!G.describe(pts).orderTies?.lengthNorm;
const centreTie = (pts) => !S.polylineProblem(pts) && !!G.describe(pts).orderTies?.centroidX;
const r11ValidityOrderDependent = (pts) => S11.polylineProblem(pts) !== S11.polylineProblem(rev(pts));

const serial = (s) => ({ valid: s.valid, items: [...s.items].map(([f, v]) => [f, v]), declined: [...s.declined] });
const fixtures = [];
function add(id, category, input, proof, expect) {
  const r11All = O.orientations(input).map(({ mask, input: g }) => ({ mask, summary: serial(O.summarize(E11.generateReading(g))) }));
  fixtures.push({ id, category, proof, expect, input, r11: r11All });
}
const withPTC = (p) => { const f = F.base(); f.creases.items[1].geometry.points = p; return f; };
const withMinors = (...lists) => { const f = F.base(); lists.forEach((p, i) => f.creases.items.push(F.crease(`m${i + 1}`, 'MINOR', p, 0.9))); return f; };

// ---- A. PTC length ties around every F-PTC-LENGTH boundary / margin edge (0.47, 0.50, 0.53, 0.67, 0.70, 0.73) ----
for (const L of [0.47, 0.5, 0.53, 0.6, 0.67, 0.7, 0.73]) for (const half of [L - 0.00005, L + 0.00005]) {
  construct(ptc(L), canonLen, half, lengthTie).forEach((pts, i) => add(`A-ptc-length-tie-${half.toFixed(5)}-${i}`, 'length-tie', withPTC(pts), { lengthNorm: G.describe(pts).orderTies.lengthNorm }, 'length-tie'));
}
// immediately below / at / above a 4-dp cutoff without a tie (straight two-point PTC)
for (const L of [0.4699, 0.47, 0.4701, 0.5299, 0.53, 0.5301, 0.6699, 0.67, 0.6701, 0.7299, 0.73, 0.7301]) {
  const pts = [{ x: 0.05, y: 0.32 }, { x: 0.05 + L, y: 0.32 }];
  add(`A-ptc-length-plain-${L}`, 'length-plain', withPTC(pts), { lengthNorm: G.describe(pts).lengthNorm, orderTies: G.describe(pts).orderTies ?? null }, 'no-tie');
}
// ---- B. fate-line length ties around F-CENTRAL-LONGITUDINAL 0.35 (margin 0.03 → 0.32, 0.35, 0.38) ----
for (const L of [0.32, 0.35, 0.38]) for (const half of [L - 0.00005, L + 0.00005]) {
  construct(fate(L), canonLen, half, (p) => lengthTie(p) && !G.describe(p).orderTies?.centroidX).forEach((pts, i) => add(`B-fate-length-tie-${half.toFixed(5)}-${i}`, 'fate-length-tie', withMinors(pts), { lengthNorm: G.describe(pts).orderTies.lengthNorm }, 'length-tie'));
}
// ---- C. fate-line centre ties at both edges (0.3, 0.7) ----
const centreTies = {};
for (const edge of [0.3, 0.7]) for (const half of [edge - 0.00005, edge + 0.00005]) {
  const found = construct(centre(edge), canonCx, half, (p) => centreTie(p) && !G.describe(p).orderTies?.lengthNorm);
  centreTies[half.toFixed(5)] = found;
  found.forEach((pts, i) => add(`C-centre-tie-${half.toFixed(5)}-${i}`, 'centre-tie', withMinors(pts), { centroidX: G.describe(pts).orderTies.centroidX }, 'centre-tie-sole'));
}
// ---- D. competing creases (the ten required regression cases) ----
const t1 = [{ x: 0.67445, y: 0.4 }, { x: 0.71845, y: 0.55 }, { x: 0.71045, y: 0.7 }, { x: 0.70245, y: 0.85 }, { x: 0.69445, y: 1 }]; // reviewer tied crease
const t2 = [{ x: 0.5, y: 0.45 }, { x: 0.505, y: 0.65 }, { x: 0.51, y: 0.95 }]; // clean competitor
const t4 = [{ x: 0.42, y: 0.5 }, { x: 0.425, y: 0.7 }, { x: 0.43, y: 0.98 }]; // second clean competitor
const horiz = [{ x: 0.35, y: 0.6 }, { x: 0.65, y: 0.62 }]; // not vertical: not a candidate
const tiedLow = (centreTies['0.29995'] || centreTies['0.30005'] || [])[0];
const degenerateCompetitor = construct(tiny, canonLen, S.GEOMETRY_CONTRACT.minLength - S.GEOMETRY_CONTRACT.eps, r11ValidityOrderDependent, 200, [0.5, 1.5])[0];
add('D01-reviewer-tied-crease-alone', 'competing', withMinors(t1), { centroidX: G.describe(t1).orderTies.centroidX }, 'centre-tie-sole');
add('D02-tied-plus-competitor', 'competing', withMinors(t1, t2), { centroidX: G.describe(t1).orderTies.centroidX }, 'conflict');
add('D03-first-reversed', 'competing', withMinors(rev(t1), t2), {}, 'conflict');
add('D04-competitor-reversed', 'competing', withMinors(t1, rev(t2)), {}, 'conflict');
add('D05-both-reversed', 'competing', withMinors(rev(t1), rev(t2)), {}, 'conflict');
if (degenerateCompetitor) add('D06-competitor-valid-in-one-order-only', 'competing', withMinors(t2, degenerateCompetitor), { r11Problems: [S11.polylineProblem(degenerateCompetitor), S11.polylineProblem(rev(degenerateCompetitor))] }, 'invalid');
if (tiedLow) add('D07-competitor-eligible-in-one-order-only', 'competing', withMinors(t2, tiedLow), { centroidX: G.describe(tiedLow).orderTies.centroidX }, 'conflict');
add('D08-suppressed-but-retained-for-conflict', 'competing', withMinors(t2, t1), {}, 'conflict');
add('D09-multiple-competitors', 'competing', withMinors(t1, t2, t4), {}, 'conflict');
add('D10a-noncompeting-control-tied-plus-horizontal', 'competing', withMinors(t1, horiz), {}, 'centre-tie-sole');
add('D10b-noncompeting-control-clean-alone', 'competing', withMinors(t2), {}, 'fate-tentative');
// ---- E. validity in both orders ----
const degen = construct(tiny, canonLen, S.GEOMETRY_CONTRACT.minLength - S.GEOMETRY_CONTRACT.eps, r11ValidityOrderDependent, 200, [0.5, 1.5]).slice(0, 2);
degen.forEach((pts, i) => add(`E-degenerate-order-dependent-${i}`, 'validity', withPTC(pts), { r11Problems: [S11.polylineProblem(pts), S11.polylineProblem(rev(pts))] }, 'invalid'));
const reviewerDegenerate = [{ x: 0.3, y: 0.4 }, { x: 0.2972918854869014, y: 0.3993659129622703 }, { x: 0.2949436822483936, y: 0.39768106637769013 }, { x: 0.2932577594334116, y: 0.39508413309481444 }, { x: 0.29249171646566946, y: 0.39179019563158446 }, { x: 0.29284052323859805, y: 0.3880777243283948 }, { x: 0.2944221919686611, y: 0.3842716091505034 }];
add('E-reviewer-degenerate', 'validity', withPTC(reviewerDegenerate), { r11Problems: [S11.polylineProblem(reviewerDegenerate), S11.polylineProblem(rev(reviewerDegenerate))] }, 'invalid');
add('E-valid-both-orders', 'validity', withPTC([{ x: 0.05, y: 0.32 }, { x: 0.4, y: 0.36 }, { x: 0.8, y: 0.45 }]), {}, 'valid');
add('E-invalid-both-orders', 'validity', withPTC([{ x: 0.1, y: 0.3 }, { x: 0.6, y: 0.35 }, { x: 0.15, y: 0.38 }]), {}, 'invalid');
add('E-consecutive-duplicates', 'validity', withPTC([{ x: 0.05, y: 0.32 }, { x: 0.05, y: 0.32 }, { x: 0.4, y: 0.36 }, { x: 0.4, y: 0.36 }, { x: 0.8, y: 0.45 }]), {}, 'valid');
add('E-revisited-point', 'validity', withPTC([{ x: 0.05, y: 0.32 }, { x: 0.4, y: 0.36 }, { x: 0.8, y: 0.45 }, { x: 0.4, y: 0.36 }]), {}, 'invalid');
add('E-near-zero-length', 'validity', withPTC([{ x: 0.3, y: 0.4 }, { x: 0.3, y: 0.419 }]), {}, 'invalid');
add('E-boundary-length-0.02', 'validity', withPTC([{ x: 0.1, y: 0.3 }, { x: 0.12, y: 0.3 }]), {}, 'valid');
{ const f = withPTC(reviewerDegenerate); for (let i = 0; i < 60; i++) f[`u${i}`] = i; add('E-degenerate-plus-60-errors', 'validity', f, {}, 'invalid-truncated'); }

const out = { generatedBy: 'baseline/build-constructed-fixtures.mjs', r11Prototype: 'AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING/prototype (frozen R1.1)', count: fixtures.length, fixtures };
fs.writeFileSync(path.join(here, 'fixtures', 'r1-3-constructed-boundary-fixtures.json'), JSON.stringify(out, null, 1) + '\n');
const byCat = {}; for (const f of fixtures) byCat[f.category] = (byCat[f.category] || 0) + 1;
console.log(JSON.stringify({ count: fixtures.length, byCategory: byCat, degenerateCompetitor: !!degenerateCompetitor, tiedLow: !!tiedLow }));
