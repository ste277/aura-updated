// G6-D0 (R1) — renders the synthetic sample readings (JSON + Markdown) into ../../samples/. Dev script only; the engine itself performs no I/O.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateReading } from '../src/engine.mjs';
import { SAMPLE_FIXTURES } from '../fixtures/synthetic-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', '..', 'samples');
const FIX = path.resolve(here, '..', 'fixtures', 'json');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });

const md = (name, input, r) => {
  const L = [`# Sample reading — ${name}`, '', '> SYNTHETIC FIXTURE · prototype output · not shown to any user · text PENDING_HUMAN_REVIEW', '',
    `**Reading:** \`${r.readingId}\` · **status:** ${r.status}${r.decline ? ` (${r.decline.reason})` : ''} · engine ${r.versions.engine} · rules ${r.versions.ruleset}`, '',
    `_${r.disclaimer.text}_`, ''];
  if (r.frame) L.push(`**Frame:** direction ${r.frame.directionReliable ? 'reliable' : `unreliable (${r.frame.directionReasons.join(', ')})`} · scale ${r.frame.scaleReliable ? 'reliable' : `unreliable (${r.frame.scaleReasons.join(', ')})`} · handedness ${r.frame.handedness.value} (${r.frame.handedness.source}) · palm facing ${r.frame.palmFacing}`, '');
  if (r.decline) L.push(`**No reading:** ${r.decline.text}`, '');
  if (r.errors) L.push('**Validation errors:**', ...r.errors.map((e) => `- \`${e.path}\` ${e.code}: ${e.msg}`), '');
  if (r.observations?.length) {
    L.push('## What the scan observed', '', '| Crease (anatomical) | Traditional name | Status | Evidence | Note |', '|---|---|---|---|---|');
    for (const o of r.observations) L.push(`| ${o.crease} | ${o.traditionalName} | ${o.status} | ${o.evidenceScore ?? '—'} | ${o.note ?? ''} |`);
    if (r.unclassifiedCreaseIds?.length) L.push('', `Unclassified crease candidates (not interpreted): ${r.unclassifiedCreaseIds.join(', ')}`);
    L.push('');
  }
  for (const s of r.sections) {
    L.push(`## ${s.title}`, '');
    if (!s.items.length) L.push('_Nothing in this area could be read from the scan._', '');
    for (const it of s.items) {
      L.push(`### ${it.familyId} — ${it.tier}${it.multiplePossibilities ? ' · multiple possibilities' : ''}`, '');
      for (const x of it.interpretations) {
        if (x.observation) L.push(`- **Observed:** ${x.observation}`);
        L.push(`- **Tradition:** ${x.interpretation}`, `- **Reflect:** ${x.reflection}`, `- _Rule \`${x.ruleId}\`_`);
      }
      L.push(`- **Why this is uncertain:** ${it.uncertainty.join(' ')}`,
        `- **Evidence:** creases ${it.evidence.creaseIds.join(', ')} · measured ${it.evidence.measuredValue} · evidence score ${it.evidence.evidenceScore}${it.evidence.capsApplied.length ? ` · caps: ${it.evidence.capsApplied.join(', ')}` : ''}`, '');
    }
    for (const d of s.declined) L.push(`- _Not read (${d.familyId}, ${d.reason}${d.crease ? `, ${d.crease}` : ''}${d.frameReasons ? `; ${d.frameReasons.join(', ')}` : ''}${d.ambiguousEndpointRoles ? `; ambiguous ${d.ambiguousEndpointRoles.join(', ')}` : ''}):_ ${d.text}${d.absentNote ? ` ${d.absentNote}` : ''}`);
    if (s.declined.length) L.push('');
  }
  return L.join('\n');
};

const index = ['# G6-D0-R1 sample readings (synthetic)', '', '| Fixture | Status | Interpretations | Declined | Reading id |', '|---|---|---|---|---|'];
for (const [name, mk] of Object.entries(SAMPLE_FIXTURES)) {
  const input = mk(); const r = generateReading(input);
  fs.writeFileSync(path.join(FIX, `${name}.json`), JSON.stringify(input, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, `${name}.reading.json`), JSON.stringify(r, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, `${name}.md`), md(name, input, r) + '\n');
  const n = r.sections.reduce((a, s) => a + s.items.length, 0); const dcl = r.sections.reduce((a, s) => a + s.declined.length, 0);
  index.push(`| [${name}](${name}.md) | ${r.status}${r.decline ? ` (${r.decline.reason})` : ''} | ${n} | ${dcl} | \`${r.readingId}\` |`);
}
fs.writeFileSync(path.join(OUT, 'README.md'), index.join('\n') + '\n');
console.log(index.join('\n'));
