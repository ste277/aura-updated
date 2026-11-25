// Shared helpers for the E1 tests (synthetic only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const E1 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PKG = path.resolve(E1, '..');
export const REPO = path.resolve(PKG, '..', '..');
export const CAT_PATH = path.join(E1, 'library', 'catalogue.json');
export const SCHEMA_PATH = path.join(E1, 'library', 'schema.json');
export const EXAMPLES_PATH = path.join(E1, 'reference', 'synthetic_reading_examples.json');
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `palm-e1-${tag}-`));

export function python(args, opts = {}) {
  const r = spawnSync('python3', ['-I', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`python3 is required for the C1 reference checks: ${r.error.message}`);
  return r;
}

let oracleCache = null;
/** Run the unmodified C1 reference oracle once and return its dump. */
export function oracleDump() {
  if (oracleCache) return oracleCache;
  const dir = tmpdir('oracle');
  const out = path.join(dir, 'oracle.json');
  const r = python([path.join(E1, 'reference', 'oracle_dump.py'), CAT_PATH, EXAMPLES_PATH, out]);
  if (r.status !== 0) throw new Error(`oracle failed: ${r.stderr || r.stdout}`);
  oracleCache = readJson(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return oracleCache;
}

/** Engine reading -> the oracle's comparison shape. */
export function shape(reading) {
  return {
    sections: Object.fromEntries(reading.sections.map((s) => [s.category, s.items.map((i) => i.recordId)])),
    overflow: reading.moreFromYourReading.map((i) => i.recordId),
    notAssessed: Object.fromEntries(reading.notAssessed.map((n) => [n.feature, n.code])),
    emptyResult: reading.emptyResult,
  };
}

/** Python check_catalogue.py verdict on a catalogue object. */
export function pythonCheck(catalogue, schemaPath = SCHEMA_PATH) {
  const dir = tmpdir('pycheck');
  const p = path.join(dir, 'cat.json');
  fs.writeFileSync(p, JSON.stringify(catalogue));
  const r = python([path.join(E1, 'reference', 'check_catalogue.py'), p, schemaPath]);
  fs.rmSync(dir, { recursive: true, force: true });
  return r.status === 0;
}

export const rec = (c, id) => c.interpretations.find((e) => e.id === id);
export const clone = (x) => structuredClone(x);

/** The 25 C1 catalogue mutations (mutation_tests_rev4.py M1..M25), re-expressed for the JS loader. */
export const CATALOGUE_MUTATIONS = [
  ['M1 clear tier', (c) => { rec(c, 'C1-WE-HEAD-STRAIGHT').observationQuality.maxTier = 'clear'; }],
  ['M2 western without Indian-gap', (c) => { delete rec(c, 'C1-WE-RING-LONG').complementsIndianGap; }],
  ['M3 self-report undisclosed', (c) => { rec(c, 'C1-IN-PALM-RAISED-GENEROUS').userFacing.observation = 'Your palm is raised.'; }],
  ['M4 absence trigger', (c) => { rec(c, 'C1-IN-PITR-KNOWLEDGE').requires[0].observation.categorical = 'absent'; }],
  ['M5 lifespan wording', (c) => { rec(c, 'C1-WE-HEART-JUPITER').userFacing.reading = 'Western palmists read this as a long life.'; }],
  ['M6 Indian term in Western', (c) => { rec(c, 'C1-WE-HEAD-SLOPING').userFacing.reading = 'Western palmists read the rekhā as imagination.'; }],
  ['M7 default mode', (c) => { c.readingModes.default = 'indian-only'; }],
  ['M8 reviewed status', (c) => { rec(c, 'C1-WE-FINGER-LONG').review.status = 'APPROVED_FOR_PERSONALISED_READING'; }],
  ['M9 excluded record re-enabled', (c) => { rec(c, 'C1-WE-INDEX-LONG').userFacing.reading = 'Western palmists read a long index finger as leadership.'; }],
  ['M10 eligible despite failed criterion', (c) => { rec(c, 'C1-WE-RING-LONG').suitability.harmfulAttributionRisk = 'fail'; }],
  ['M11 tradition preference first', (c) => { const so = c.readingModes.composition.selectionOrder; c.readingModes.composition.selectionOrder = ['tradition-preference', ...so.slice(0, -1)]; }],
  ['M12 research history dropped', (c) => { delete rec(c, 'C1-WE-ORIGIN-JOINED').researchHistory; }],
  ['M13 Western quota', (c) => { c.readingModes.composition.westernEligibility = 'feature-level-indian-gap'; }],
  ['M14 indian-only admits Western', (c) => { c.readingModes.modeBehaviour['indian-only'].traditions.push('western-19c-chiromancy'); }],
  ['M15 mode without empty-result behaviour', (c) => { c.readingModes.modeBehaviour['western-only'].emptyResult = ''; }],
  ['M16 relationships domain unmapped', (c) => { c.readingModes.domains.relationships = []; }],
  ['M17 origin gap made essential', (c) => { c.e1Planning.tiers.essential.push('E1-L5'); c.e1Planning.tiers.optionalAssisted = c.e1Planning.tiers.optionalAssisted.filter((x) => x !== 'E1-L5'); }],
  ['M18 eligible-initial record needs a later capability', (c) => { rec(c, 'C1-WE-ORIGIN-SEPARATE').eligibility.status = 'eligible-initial'; }],
  ['M19 user-skipped worded as detector miss (E1-A1)', (c) => { c.globalPolicy.notAssessedReasons.find((r) => r.code === 'user-skipped').wording = 'Not detected in the photo.'; }],
  ['M20 observed-absent reason missing (E1-A2)', (c) => { c.globalPolicy.notAssessedReasons = c.globalPolicy.notAssessedReasons.filter((r) => r.code !== 'observed-absent'); }],
  ['M21 carry-forward E1-A3 dropped', (c) => { delete c.e1Planning.carriedForwardFromI1['E1-A3']; }],
  ['M22 forecast wording', (c) => { rec(c, 'C1-IN-URDHVA-RING').userFacing.reflection = 'You are going to organise something big.'; }],
  ['M23 zone descriptor without boundary margin', (c) => { delete rec(c, 'C1-WE-HEART-JUPITER').observationQuality.boundaryMargin; }],
  ['M24 not-read wording reveals excluded meaning', (c) => { c.globalPolicy.notAssessedReasons.find((r) => r.code === 'not-read-in-this-version').wording = 'Not read in this version (it would suggest pride).'; }],
  ['M25 capability serving only an excluded record planned', (c) => { c.e1Planning.capabilities['E1-X1'] = 'index-length descriptor'; c.e1Planning.tiers.optionalAssisted.push('E1-X1'); rec(c, 'C1-WE-INDEX-LONG').e1Capabilities.push('E1-X1'); }],
];
