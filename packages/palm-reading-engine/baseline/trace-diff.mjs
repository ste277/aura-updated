// Lists every JSON path whose value differs between R1 and R1.1 sample readings. Usage: node trace-diff.mjs <r1 samples> <r1.1 samples>
import fs from 'node:fs'; import path from 'node:path';
const [a, b] = process.argv.slice(2);
const flat = (v, p = '', out = {}) => { if (v && typeof v === 'object') { for (const k of Object.keys(v)) flat(v[k], `${p}${Array.isArray(v) ? `[${k}]` : `.${k}`}`, out); if (!Object.keys(v).length) out[p] = JSON.stringify(v); } else out[p] = JSON.stringify(v); return out; };
const norm = (p) => p.replace(/\[\d+\]/g, '[]');
for (const f of fs.readdirSync(b).filter((x) => x.endsWith('.reading.json')).sort()) {
  const A = flat(JSON.parse(fs.readFileSync(path.join(a, f)))), B = flat(JSON.parse(fs.readFileSync(path.join(b, f))));
  const kinds = new Map();
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (A[k] !== B[k]) { const t = !(k in A) ? 'added' : !(k in B) ? 'removed' : 'changed'; const key = `${t} ${norm(k)}`; kinds.set(key, (kinds.get(key) || 0) + 1); }
  console.log(`## ${f}`); for (const [k, n] of [...kinds].sort()) console.log(`  ${k} ×${n}`);
}
