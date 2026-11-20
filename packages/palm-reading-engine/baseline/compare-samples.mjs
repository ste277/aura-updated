// Compares G6-D0 vs R1 sample readings (rule ids, tiers, declines). Usage: node compare-samples.mjs <g6 samples dir> <r1 samples dir>
import fs from 'node:fs'; import path from 'node:path';
const [a, b] = process.argv.slice(2);
const sum = (r) => ({ id: r.readingId, status: r.status + (r.decline ? `(${r.decline.reason})` : ''),
  items: r.sections.flatMap((s) => s.items.map((i) => `${i.familyId}:${i.tier}:${i.interpretations.map((x) => x.ruleId).join('|')}`)),
  declined: r.sections.flatMap((s) => s.declined.map((d) => `${d.familyId}:${d.reason}`)), quiet: r.sections.flatMap((s) => s.quiet) });
for (const f of fs.readdirSync(b).filter((x) => x.endsWith('.reading.json')).sort()) {
  const nb = sum(JSON.parse(fs.readFileSync(path.join(b, f))));
  const pa = path.join(a, f);
  if (!fs.existsSync(pa)) { console.log(`\n## ${f} (NEW in R1)\n  status ${nb.status}\n  items: ${nb.items.join(', ') || '—'}\n  declined: ${nb.declined.join(', ') || '—'}`); continue; }
  const na = sum(JSON.parse(fs.readFileSync(pa)));
  const add = (x, y) => x.filter((v) => !y.includes(v));
  console.log(`\n## ${f}\n  readingId ${na.id === nb.id ? 'unchanged' : `${na.id} → ${nb.id}`} · status ${na.status === nb.status ? na.status : `${na.status} → ${nb.status}`}`);
  const ch = [['items removed', add(na.items, nb.items)], ['items added', add(nb.items, na.items)], ['declines removed', add(na.declined, nb.declined)], ['declines added', add(nb.declined, na.declined)], ['quiet removed', add(na.quiet, nb.quiet)], ['quiet added', add(nb.quiet, na.quiet)]];
  const any = ch.filter(([, v]) => v.length);
  if (!any.length) console.log('  interpretations, tiers and declines: UNCHANGED');
  for (const [k, v] of any) console.log(`  ${k}: ${v.join(', ')}`);
}
