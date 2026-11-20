// R1.2 — proves the R1.1-RV-02 deferral changed nothing: selectVariants' body is textually identical in R1.1 and R1.2,
// and every family's variant ranges and margins are identical. Usage: node verify-rv02-unchanged.mjs <r1.1 proto> <r1.2 proto>
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [a, b] = process.argv.slice(2).map((p) => path.resolve(p));
const body = (dir) => { const s = fs.readFileSync(path.join(dir, 'src', 'engine.mjs'), 'utf8'); const i = s.indexOf('function selectVariants('); return s.slice(i, s.indexOf('\n}\n', i) + 2); };
const A = body(a), B = body(b);
console.log(`selectVariants body identical (baseline vs candidate): ${A === B} (${A.length} chars)`);
const fams = async (dir) => (await import(pathToFileURL(path.join(dir, 'src', 'rules.mjs')).href)).FAMILIES.map((f) => [f.id, f.margin, f.variants.map((v) => [v.id, v.min, v.max])]);
const same = JSON.stringify(await fams(a)) === JSON.stringify(await fams(b));
console.log(`variant ranges and margins identical (baseline vs candidate): ${same}`);
process.exit(A === B && same ? 0 : 1);
