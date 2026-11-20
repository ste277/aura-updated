// R1.3 sample-reading validation (derived from R1/R1.1; adds the saved-rule-spec check and tie-field absence). Usage: node validate-samples.mjs  (run from the R1 package root). Read-only.
import fs from 'node:fs'; import path from 'node:path';
import { generateReading } from '../prototype/src/engine.mjs';
import { SAMPLE_FIXTURES } from '../prototype/fixtures/synthetic-fixtures.mjs';
import { lintText } from '../prototype/src/policy.mjs';
import { ownLookup, DETECTOR_REGISTRY } from '../prototype/src/schema.mjs';
import { FAMILIES } from '../prototype/src/rules.mjs';
const FAM_HYP = new Set(FAMILIES.filter((f) => f.hypothesis).map((f) => f.id));
import { renderRuleSpec } from '../prototype/bin/rule-spec.mjs';
const results = []; let ok = true;
const check = (name, cond, msg) => { if (!cond) { ok = false; results.push(`FAIL ${name}: ${msg}`); } };
for (const [name, mk] of Object.entries(SAMPLE_FIXTURES)) {
  const input = mk(); const r = generateReading(input);
  const saved = fs.readFileSync(path.join('samples', `${name}.reading.json`), 'utf8');
  check(name, JSON.stringify(r, null, 2) + '\n' === saved, 'saved sample is not byte-identical to a fresh run');
  check(name, JSON.stringify(generateReading(mk())) === JSON.stringify(r), 'non-deterministic');
  const ids = new Set(input.creases.items.map((c) => c.id));
  const det = ownLookup(DETECTOR_REGISTRY, input.creases.source.detector);
  const items = r.sections.flatMap((s) => s.items);
  for (const it of items) {
    if (it.evidence.frame.requires.axis) check(name, it.evidence.frame.axisReliable, `${it.familyId} interpreted with unreliable axis (R1.1)`);
    if (FAM_HYP.has(it.familyId) && it.evidence.evidenceBeforeFrameCaps >= 0.75) check(name, it.evidence.capsApplied.includes('hypothesis-capped'), `${it.familyId} hypothesis cap not traced (R1.1)`);
    check(name, it.evidence.creaseIds.length > 0 && it.evidence.creaseIds.every((i) => ids.has(i)), `${it.familyId} evidence not in input`);
    check(name, it.provenance && it.provenance.guideDerived === false && it.provenance.reviewStatus === 'PENDING_HUMAN_REVIEW', `${it.familyId} provenance`);
    check(name, it.excludedClaims.includes('lifespan or longevity'), `${it.familyId} exclusions`);
    if (it.tier === 'clear') {
      check(name, det.status === 'synthetic', `${it.familyId} clear from research detector`);
      check(name, it.evidence.frame.palmFacing === true, `${it.familyId} clear with palm side unconfirmed`);
      if (it.evidence.frame.requires.direction) check(name, it.evidence.frame.directionReliable && it.evidence.frame.handedness.source !== 'landmark-model', `${it.familyId} clear with unreliable direction`);
      if (it.evidence.frame.requires.scale) check(name, it.evidence.frame.scaleReliable, `${it.familyId} clear with unreliable scale`);
      if (it.evidence.frame.requires.axis) check(name, it.evidence.frame.axisReliable, `${it.familyId} clear with unreliable axis`);
      check(name, it.evidence.evidenceScore >= 0.75, `${it.familyId} clear below 0.75`);
    }
    if (it.familyId === 'F-TC-BREAKS') {
      const tc = input.creases.items.find((c) => it.evidence.creaseIds.includes(c.id));
      check(name, det.capabilities.observesBreaks && Number.isInteger(tc.continuity.breaks) && tc.continuity.breaks === it.evidence.measuredValue, 'break claim without an observed break count');
      check(name, it.tier !== 'clear', 'break family at clear');
    }
    for (const x of it.interpretations) for (const t of [x.observation, x.interpretation, x.reflection]) if (t) check(name, lintText(t, 'v').length === 0, `prohibited text: ${t}`);
    for (const u of it.uncertainty) check(name, lintText(u, 'v').length === 0, `prohibited text: ${u}`);
  }
  const allText = JSON.stringify(r.sections);
  check(name, !/shows one or more breaks/.test(allText) || items.some((i) => i.familyId === 'F-TC-BREAKS'), 'break sentence without break family');
  for (const d of r.sections.flatMap((s) => s.declined)) check(name, typeof d.text === 'string' && d.text.length > 0, `${d.familyId} decline without text`);
  results.push(`ok   ${name}: status=${r.status} interpreted=${items.length} clear=${items.filter((i) => i.tier === 'clear').length} tentative=${items.filter((i) => i.tier === 'tentative').length} declined=${r.sections.reduce((n, s) => n + s.declined.length, 0)}`);
}
check('rule-spec', fs.readFileSync('03_INTERPRETATION_RULE_SPEC.md', 'utf8') === renderRuleSpec(), 'saved 03_INTERPRETATION_RULE_SPEC.md differs from the renderer');
for (const [name, mk] of Object.entries(SAMPLE_FIXTURES)) check(name, !/orderTie|tieExcludedCreaseIds/.test(JSON.stringify(generateReading(mk()))), 'tie fields on a non-tie sample');
console.log(results.join('\n')); console.log(ok ? 'ALL SAMPLE CHECKS PASS' : 'SAMPLE CHECKS FAILED'); process.exit(ok ? 0 : 1);
