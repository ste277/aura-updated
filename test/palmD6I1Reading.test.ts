/**
 * AURA-PALM-D6-I1 -- the confirmed-scanner reading entry point and the browser-compatible loader, in Node, SYNTHETIC
 * fixtures only (the four P4-I4 preview fixtures, produced by the real tracing model from the synthetic hand):
 *   A1  exact reading-output parity with the synthetic entry point (every field equal; only `synthetic` differs, false),
 *       for every fixture and mode;
 *   A6  the confirmed-scanner entry refuses outside development / with the gate closed / without its own declaration /
 *       with a synthetic declaration / unknown options / invalid input; the synthetic entry is unchanged;
 *   A3  the scanner keeps only E1's output (source rules); loader fingerprint for the browser parity check.
 * This file is one of the two explicitly listed E1 reading consumers (privacy gate B2b).
 *
 *   npx ts-node test/palmD6I1Reading.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { generateConfirmedScannerReading, generateSyntheticReading } from '../packages/palm-reading-engine/e1/src/reading';

const ROOT = path.join(__dirname, '..');
let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`); }
};
const FIX = path.join(ROOT, 'packages/palm-reading-engine/e1/preview/fixtures');
const fixtures = fs.readdirSync(FIX).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f, ...JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')) }));
const setGate = (nodeEnv: string | undefined, flag: string | undefined) => {
  const env = process.env as Record<string, string | undefined>;
  if (nodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = nodeEnv;
  if (flag === undefined) delete env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT; else env.NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT = flag;
};
const refusedWith = (fn: () => unknown, code: string) => { try { fn(); return false; } catch (e: any) { return e?.code === code; } };

/** The loader fingerprint the browser test compares against (sha256 over the validated library's catalogue and schema). */
export function libraryFingerprint(lib: { catalogue: unknown; schema?: unknown }): string {
  return crypto.createHash('sha256').update(JSON.stringify(lib.catalogue)).update('|').update(JSON.stringify(lib.schema ?? null)).digest('hex');
}

async function run() {
  check('S0. the four synthetic scanner-journey fixtures are present and declared synthetic', fixtures.length === 4 && fixtures.every((f) => f.synthetic === true && f.source === 'synthetic-scanner-journey'));
  // ---------------------------------------------------------------- A1 parity
  setGate('development', 'g5-i1-dev');
  for (const f of fixtures) {
    for (const mode of ['combined', 'indian-only', 'western-only'] as const) {
      const syn = generateSyntheticReading(f.input, { synthetic: true, mode }) as any;
      const con = generateConfirmedScannerReading(f.input, { confirmedScanner: true, mode }) as any;
      const same = JSON.stringify({ ...con, synthetic: true }) === JSON.stringify(syn);
      check(`A1. ${f.scenario} (${mode}): the confirmed-scanner reading equals the synthetic reading field for field; only "synthetic" differs (false)`, same && con.synthetic === false && syn.synthetic === true && Object.isFrozen(con) && JSON.stringify(Object.keys(con)) === JSON.stringify(Object.keys(syn)));
    }
  }
  const allLines = fixtures.find((f) => f.scenario === 'all-lines-confirmed')!;
  const sample = generateConfirmedScannerReading(allLines.input, { confirmedScanner: true }) as any;
  check('A1b. the confirmed reading keeps E1 policy: tentative ceiling, unreviewed content, not approved for publication, the pinned frame', sample.tierCeiling === 'tentative' && sample.contentStatus === 'UNREVIEWED_RESEARCH_CONTENT' && sample.publicationApproved === false && /not a scientific assessment and not a prediction/.test(sample.frame));
  check('A1c. the all-lines fixture yields interpretation items (the journey has something to show)', sample.sections.reduce((n: number, s: any) => n + s.items.length, 0) > 0, sample.sections.map((s: any) => s.category));
  check('A1d. every reflection is a question (life direction never forecasts)', [...sample.sections.flatMap((s: any) => s.items), ...sample.moreFromYourReading].every((it: any) => it.text.reflection.trimEnd().endsWith('?')));
  check('A1e. the reading output carries no landmarks, image size or trace points', !/landmarks|imageWidth|imageHeight|palmPoints|"points"/.test(JSON.stringify(sample)));

  // ---------------------------------------------------------------- A6 refusals
  const I = allLines.input;
  for (const [env, flag, why] of [['production', 'g5-i1-dev', 'production build'], ['test', 'g5-i1-dev', 'test runtime'], ['development', undefined, 'flag unset'], ['development', 'yes', 'wrong flag value'], [undefined, undefined, 'nothing set']] as Array<[string | undefined, string | undefined, string]>) {
    setGate(env, flag);
    check(`A6. gate closed (${why}): the confirmed-scanner entry refuses with development-only`, refusedWith(() => generateConfirmedScannerReading(I, { confirmedScanner: true }), 'development-only'));
    check(`A6. gate closed (${why}): the synthetic entry still works unchanged`, (() => { try { const r = generateSyntheticReading(I, { synthetic: true }) as any; return r.synthetic === true && JSON.stringify(r) === JSON.stringify(generateSyntheticReading(I, { synthetic: true })); } catch { return false; } })());
  }
  setGate('development', 'g5-i1-dev');
  const inherited = Object.create({ confirmedScanner: true });
  const accessor = Object.defineProperty({}, 'confirmedScanner', { get: () => true, enumerable: true });
  const bad: Array<[string, unknown]> = [['no options', undefined], ['empty', {}], ['false', { confirmedScanner: false }], ['string', { confirmedScanner: 'true' }], ['boxed', { confirmedScanner: new Boolean(true) }], ['inherited', inherited], ['accessor', accessor], ['array', [true]]];
  for (const [why, opts] of bad) check(`A6. declaration refused: ${why}`, refusedWith(() => generateConfirmedScannerReading(I, opts as any), 'confirmed-scanner-required'));
  check('A6. a synthetic declaration cannot be combined with the confirmed-scanner one', refusedWith(() => generateConfirmedScannerReading(I, { confirmedScanner: true, synthetic: true } as any), 'confirmed-scanner-required'));
  check('A6. unknown options are refused', refusedWith(() => generateConfirmedScannerReading(I, { confirmedScanner: true, library: {} } as any), 'invalid-option'));
  check('A6. an unknown mode is refused', refusedWith(() => generateConfirmedScannerReading(I, { confirmedScanner: true, mode: 'other' as any }), 'invalid-option'));
  check('A6. the synthetic entry does not accept the confirmed-scanner declaration (not a bypass in either direction)', refusedWith(() => generateSyntheticReading(I, { confirmedScanner: true } as any), 'synthetic-required'));
  check('A6. invalid input is refused by the same pipeline (not an object; malformed lines)', refusedWith(() => generateConfirmedScannerReading(null as any, { confirmedScanner: true }), 'invalid-input') && refusedWith(() => generateConfirmedScannerReading({ ...I, lines: undefined } as any, { confirmedScanner: true }), 'invalid-input'));
  check('A6. a construction-relevant input change gives a reading of the CHANGED input (no cached result)', JSON.stringify(generateConfirmedScannerReading({ ...I, lines: (I.lines as any[]).slice(1) }, { confirmedScanner: true })) !== JSON.stringify(sample));

  // ---------------------------------------------------------------- A3 / B: source rules for the scanner
  const ui = fs.readFileSync(path.join(ROOT, 'apps/web/components/palm-scan/PalmImageInput.tsx'), 'utf8');
  check('A3. the reading is made once, at confirmation, from the confirmed tracing input, and only E1 output + the I1 feature set are kept', /const out = generateConfirmedScannerReading\(m\.toFeatureSetInput\(\{ hand, dominantHand: dominant \}\), \{ confirmedScanner: true \}\);/.test(ui) && /setConfirmed\(Object\.freeze\(\{ key: reviewKey, featureSet: deepFreeze\(JSON\.parse\(JSON\.stringify\(r\.featureSet\)\)\), reading, at: Date\.now\(\) \}\)\);/.test(ui) && (ui.match(/generateConfirmedScannerReading\(/g) ?? []).length === 1 && (ui.match(/toFeatureSetInput\(/g) ?? []).length === 1);
  check('A3b. the confirmed record type holds only key, featureSet, reading and at', /type ConfirmedFeatures = \{ readonly key: string; readonly featureSet: unknown; readonly reading: E1Reading \| null; readonly at: number \};/.test(ui));
  check('A3c. the reading view renders only E1 text fields for interpretations', /\{it\.text\.observation\}/.test(ui) && /\{it\.text\.reading\}/.test(ui) && /\{it\.text\.reflection\}/.test(ui) && /\{reading\.frame\}/.test(ui));

  // ---------------------------------------------------------------- A8 production inclusion is still detected (negative controls)
  {
    const os = require('os');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const imageScanner = require('../apps/web/scripts/check-palmistry-bundle');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const e1Guard = require('../apps/web/scripts/check-palm-e1-bundle.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd6-scan-'));
    try {
      fs.mkdirSync(path.join(tmp, '.next/static/chunks'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.next/static/chunks/clean.js'), 'console.log("clean")');
      const clean = imageScanner.scanImageInput(tmp);
      const contentPath = path.join(ROOT, 'packages/palm-reading-engine/e1/library/packaged-content.mjs');
      fs.writeFileSync(path.join(tmp, '.next/static/chunks/leak.js'), `var v={version:"palm-d6-reading-ui@0.1.0"};${fs.readFileSync(contentPath, 'utf8').slice(0, 4000)}`);
      const leak = imageScanner.scanImageInput(tmp);
      check('A8. the image-input bundle scanner flags a build containing the reading view, and passes a clean one', clean.length === 0 && leak.some((x: any) => x.sentinel === 'palm-d6-reading-ui@0.1.0'), { clean, leak: leak.slice(0, 3) });
      const e1Dir = path.join(ROOT, 'packages/palm-reading-engine/e1');
      const shipped = ['src', 'library'].flatMap((d) => fs.readdirSync(path.join(e1Dir, d)).filter((f) => /\.(m?[jt]s|json)$/.test(f)).map((f) => fs.readFileSync(path.join(e1Dir, d, f), 'utf8'))).join('\n');
      const e1Hits = e1Guard.SENTINELS.filter((sv: string) => shipped.includes(sv));
      check('A8b. the unconditional E1 bundle guard\'s sentinels are still carried by the shipped E1 code (an E1 leak through the app import would be flagged)', e1Hits.length === e1Guard.SENTINELS.length, { missing: e1Guard.SENTINELS.filter((x: string) => !e1Hits.includes(x)) });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    const exclusion = fs.readFileSync(path.join(ROOT, 'apps/web/palm-image-input-build-exclusion.js'), 'utf8');
    check('A8c. the production build still swaps the scanner (the only E1 importer) for its stub, unconditionally', /NormalModuleReplacementPlugin\(IMAGE_INPUT_REQUEST, IMAGE_INPUT_STUB_PATH\)/.test(exclusion) && /if \(dev\) return config;/.test(exclusion) && !/palm-reading-engine|e1\/src/.test(fs.readFileSync(path.join(ROOT, 'apps/web/components/palm-scan/PalmImageInput.excluded.tsx'), 'utf8')));
  }

  // ---------------------------------------------------------------- loader fingerprint (compared in Chrome by the browser test)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const packaged = require('../packages/palm-reading-engine/e1/src/packaged.mjs');
  const fp = libraryFingerprint(packaged.pinnedLibrary());
  check('L1. Node loads the pinned library through the browser-compatible loader (fingerprint for the Chrome parity check)', /^[0-9a-f]{64}$/.test(fp));
}

run().then(() => {
  console.log(`\nPALM-D6-I1 reading (Node): ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}).catch((e) => { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); });
