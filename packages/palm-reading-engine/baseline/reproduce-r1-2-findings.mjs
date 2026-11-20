// R1.3 — reproduces the R1.2 review's three BLOCKING inputs on a given prototype and compares with frozen R1.1.
// Usage: node reproduce-r1-2-findings.mjs <R1.1 prototype> <prototype under test>    In-memory; writes nothing.
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [a, b] = process.argv.slice(2).map((p) => path.resolve(p));
const E11 = await import(pathToFileURL(path.join(a, 'src/engine.mjs')).href), EX = await import(pathToFileURL(path.join(b, 'src/engine.mjs')).href);
const F = await import(pathToFileURL(path.join(b, 'fixtures/synthetic-fixtures.mjs')).href);
const sh = (r, re) => (r.status === 'invalid-input' ? 'invalid:' + r.errors.map((e) => e.code).join(',') : r.sections.flatMap((s) => s.items).filter((i) => re.test(i.familyId)).map((i) => `${i.familyId}:${i.tier}:${i.interpretations.map((x) => x.ruleId).join('|')}`).join(', ') || '(none)');
const rev = (p) => [...p].reverse();
const t1 = [{ x: 0.67445, y: 0.4 }, { x: 0.71845, y: 0.55 }, { x: 0.71045, y: 0.7 }, { x: 0.70245, y: 0.85 }, { x: 0.69445, y: 1 }], t2 = [{ x: 0.5, y: 0.45 }, { x: 0.505, y: 0.65 }, { x: 0.51, y: 0.95 }];
const mk1 = (p, q) => { const f = F.base(); f.creases.items.push(F.crease('c-min', 'MINOR', p, 0.9)); f.creases.items.push(F.crease('c-min2', 'MINOR', q, 0.9)); return f; };
for (const [n, p, q] of [['ff', t1, t2], ['rf', rev(t1), t2], ['fr', t1, rev(t2)], ['rr', rev(t1), rev(t2)]]) { const r = EX.generateReading(mk1(p, q)); console.log(`R1.2-RV-01 ${n}  R1.1: ${sh(E11.generateReading(mk1(p, q)), /CENTRAL/)} | candidate: ${sh(r, /CENTRAL/)} (central ${r.observations.at(-1).status})`); }
const p2 = [{ x: 0.5583907616893989, y: 0.45001347382079715 }, { x: 0.46139470016110945, y: 0.4033938342777382 }, { x: 0.36128638885288633, y: 0.3672463362578602 }, { x: 0.2588324658184172, y: 0.34095313697868695 }, { x: 0.15480934999743828, y: 0.32544483892760157 }, { x: 0.05, y: 0.32 }];
const mk2 = (p) => { const f = F.base(); f.creases.items[1].geometry.points = p; return f; };
for (const [n, p] of [['f', p2], ['r', rev(p2)]]) console.log(`R1.2-RV-02 ${n}  R1.1: ${sh(E11.generateReading(mk2(p)), /PTC-LENGTH/)} | candidate: ${sh(EX.generateReading(mk2(p)), /PTC-LENGTH/)}`);
const p3 = [{ x: 0.3, y: 0.4 }, { x: 0.2972918854869014, y: 0.3993659129622703 }, { x: 0.2949436822483936, y: 0.39768106637769013 }, { x: 0.2932577594334116, y: 0.39508413309481444 }, { x: 0.29249171646566946, y: 0.39179019563158446 }, { x: 0.29284052323859805, y: 0.3880777243283948 }, { x: 0.2944221919686611, y: 0.3842716091505034 }];
for (const [n, p] of [['f', p3], ['r', rev(p3)]]) console.log(`R1.2-RV-03 ${n}  R1.1: ${sh(E11.generateReading(mk2(p)), /PTC-LENGTH|DTC-RISE/)} | candidate: ${sh(EX.generateReading(mk2(p)), /PTC-LENGTH|DTC-RISE/)}`);
