/**
 * AURA-PALM-04-I4 -- the complete SYNTHETIC feature-to-reading journey, end to end, without any app-to-E1 import:
 *
 *   scanner journey (P4-I1 construction context + tracing model, driven exactly as the UI does: trace, confirm,
 *   skip, cannot-see; explicit hand answers)  ->  confirmed synthetic input (toFeatureSetInput)  ->  fixture JSON
 *   (packages/palm-reading-engine/e1/preview/fixtures)  ->  standalone E1 preview harness, run as a separate process
 *   (preview/render.ts)  ->  reading.
 *
 * This file never imports the E1 reading interface (G5 privacy gate B2b allows exactly one test consumer); it runs
 * the harness as a subprocess and reads its JSON. Scenarios cover confirmed, skipped, cannot-see, not-requested,
 * uncertain and unavailable features.
 *
 *   npx ts-node test/palm04I4FeatureToReading.test.ts            (verify fixtures are reproducible, then replay)
 *   npx ts-node test/palm04I4FeatureToReading.test.ts --write    (regenerate the fixtures)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { createConstructionContext } from '../apps/web/lib/palm-analysis/construction';
import { createTracingModel } from '../apps/web/lib/palm-analysis/tracing';
import { makeHand } from './palmG5I1Fixtures';

const ROOT = path.join(__dirname, '..');
const PREVIEW = path.join(ROOT, 'packages/palm-reading-engine/e1/preview');
const FIXTURES = path.join(PREVIEW, 'fixtures');
const KIND = 'palm-04-e1-preview-fixture@0.1.0';
const WRITE = process.argv.includes('--write');
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 400)}`}`); }
}

type Step = { line: 'heart' | 'head' | 'life' | 'upward'; do: 'trace' | 'user-skipped' | 'user-cannot-see' };
interface Scenario { id: string; description: string; qualityIssues: string[]; hand: 'left' | 'right'; dominant: 'left' | 'right' | 'unknown'; steps: Step[] }
const TRACES: Record<string, Array<[number, number]>> = {
  heart: [[0.67, 0.555], [0.6, 0.545], [0.52, 0.54], [0.44, 0.525]],
  head: [[0.37, 0.56], [0.45, 0.6], [0.54, 0.62], [0.62, 0.64]],
  life: [[0.36, 0.57], [0.37, 0.66], [0.4, 0.74], [0.45, 0.81]],
  upward: [[0.52, 0.82], [0.52, 0.72], [0.515, 0.62], [0.51, 0.5]],
};
const SCENARIOS: Scenario[] = [
  { id: 'all-lines-confirmed', description: 'Heart, head and life traced and confirmed; upward line not requested; accepted photo.', qualityIssues: [], hand: 'left', dominant: 'right', steps: [{ line: 'heart', do: 'trace' }, { line: 'head', do: 'trace' }, { line: 'life', do: 'trace' }] },
  { id: 'skipped-and-cannot-see', description: 'Heart confirmed; head skipped; life marked as not visible; upward not requested.', qualityIssues: [], hand: 'right', dominant: 'unknown', steps: [{ line: 'heart', do: 'trace' }, { line: 'head', do: 'user-skipped' }, { line: 'life', do: 'user-cannot-see' }] },
  { id: 'uncertain-photo', description: 'A dark photo: measurements uncertain; heart and head confirmed; life skipped; upward confirmed.', qualityIssues: ['too-dark'], hand: 'left', dominant: 'left', steps: [{ line: 'heart', do: 'trace' }, { line: 'head', do: 'trace' }, { line: 'life', do: 'user-skipped' }, { line: 'upward', do: 'trace' }] },
  { id: 'unavailable-measurements', description: 'Hand cut off: no measurement is available; heart confirmed; head and life not visible.', qualityIssues: ['hand-cut-off'], hand: 'right', dominant: 'right', steps: [{ line: 'heart', do: 'trace' }, { line: 'head', do: 'user-cannot-see' }, { line: 'life', do: 'user-cannot-see' }] },
];

/** Drive the real tracing model exactly as the scanner UI does, and return the confirmed synthetic input. */
function journey(s: Scenario) {
  const made = createConstructionContext({ imageWidth: 1280, imageHeight: 960, landmarks: makeHand() as any, handednessLabel: 'Left', rotationDeg: 0, qualityIssues: s.qualityIssues as any }, 1, () => true)!;
  const m = createTracingModel(made.context);
  for (const st of s.steps) {
    if (st.do === 'trace') {
      m.start(st.line);
      m.setTrace(st.line, TRACES[st.line].map(([x, y]) => ({ x, y })));
      const r = m.confirm(st.line);
      if (!r.ok) throw new Error(`${s.id}: ${st.line} not placeable (${r.reason})`);
    } else m.skip(st.line, st.do);
  }
  const lines = m.lines();
  // the P4-I3 confirmation precondition: no draft, every primary line decided
  const decided = lines.every((v) => v.status !== 'tracing') && ['heart', 'head', 'life'].every((id) => lines.find((v) => v.line === id)!.status !== 'not-started');
  return { decided, input: m.toFeatureSetInput({ hand: s.hand, dominantHand: s.dominant }), featureSet: m.buildFeatureSet({ hand: s.hand, dominantHand: s.dominant }) };
}

const harness = (args: string[]) => spawnSync('npx', ['ts-node', path.join(PREVIEW, 'render.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });

function run() {
  if (WRITE) fs.mkdirSync(FIXTURES, { recursive: true });
  for (const s of SCENARIOS) {
    const j = journey(s);
    const file = path.join(FIXTURES, `${s.id}.json`);
    const fixture = { kind: KIND, synthetic: true, source: 'synthetic-scanner-journey', scenario: s.id, description: s.description, input: j.input };
    const text = JSON.stringify(fixture, null, 2) + '\n';
    if (WRITE) fs.writeFileSync(file, text);
    check(`R0 [${s.id}] the scanner journey reaches a confirmable state (no draft, every primary line decided)`, j.decided);
    check(`R1 [${s.id}] the committed fixture is exactly what the scanner journey produces (reproducible, synthetic)`, fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text);
    const out = harness([file, '--format', 'json']);
    let reading: any = null;
    try { reading = JSON.parse(out.stdout); } catch { /* reported below */ }
    check(`R2 [${s.id}] the standalone harness (separate process) produces a reading`, out.status === 0 && !!reading, out.stderr.slice(0, 300));
    if (!reading || !j.featureSet.ok) continue;
    const fsx = j.featureSet.featureSet;
    check(`R3 [${s.id}] the reading is marked synthetic, unreviewed research content and not approved for publication`, reading.synthetic === true && reading.contentStatus === 'UNREVIEWED_RESEARCH_CONTENT' && reading.publicationApproved === false);
    // lines: confirmed ones may be observed; everything else is reported as not assessed with its own reason, never observed
    const observedLines = new Set(reading.observed.filter((o: any) => o.feature.startsWith('lines.')).map((o: any) => o.feature.slice(6)));
    const notAssessed = new Map<string, any>(reading.notAssessed.map((n: any) => [n.feature, n]));
    const lineOk = (['heart', 'head', 'life', 'upward'] as const).every((id) => {
      const l = fsx.lines[id];
      if (l.provenance === 'user-confirmed') return observedLines.has(id); // E1 may add a note (e.g. a boundary) for a confirmed line
      return !observedLines.has(id) && notAssessed.has(`lines.${id}`) && ['user-skipped', 'user-cannot-see', 'not-requested'].includes(notAssessed.get(`lines.${id}`).detail);
    });
    check(`R4 [${s.id}] confirmed lines are observed; every skipped, not-visible or not-requested line is reported as not assessed with its reason and never observed`, lineOk, { observed: [...observedLines], notAssessed: [...notAssessed.keys()] });
    const skipDetail = (id: string) => notAssessed.get(`lines.${id}`)?.detail;
    check(`R5 [${s.id}] the reading keeps the user's exact choice per line (skipped vs cannot-see vs not requested)`, (['heart', 'head', 'life', 'upward'] as const).every((id) => { const l = fsx.lines[id]; return l.provenance === 'user-confirmed' || skipDetail(id) === (l as any).reason; }));
    // measurements: uncertain or unavailable ones are never presented as observed facts
    const measObserved = reading.observed.filter((o: any) => o.feature.startsWith('measurements.')).map((o: any) => o.feature.slice(13));
    const usedMeasured = measObserved.every((id: string) => (fsx.measurements.measurements as any)[id]?.status === 'measured');
    check(`R6 [${s.id}] only measured proportions (status measured) appear as observed; uncertain/unavailable ones never do (set: ${fsx.measurements.status})`, usedMeasured, measObserved);
    check(`R7 [${s.id}] the reading's photo check matches the scanner's (${fsx.frame.qualityStatus})`, reading.quality.accepted === (fsx.frame.qualityStatus === 'accepted'));
    if (s.id === 'unavailable-measurements') check('R8 [unavailable-measurements] no measurement is available, and none is observed in the reading', fsx.measurements.status === 'unavailable' && measObserved.length === 0);
    if (s.id === 'uncertain-photo') check('R9 [uncertain-photo] measurements are uncertain and the reading does not present them as observed', fsx.measurements.status === 'uncertain' && measObserved.length === 0);
    // HTML preview
    const html = harness([file, '--format', 'html']);
    check(`R10 [${s.id}] the HTML preview is self-contained (no script, no external resource) and shows the synthetic / unreviewed banner and every not-assessed item`, html.status === 0 && !/<script|https?:\/\/|src=/i.test(html.stdout) && /SYNTHETIC INPUT · UNREVIEWED_RESEARCH_CONTENT/.test(html.stdout) && reading.notAssessed.every((n: any) => html.stdout.includes(`data-code="${n.code}"`)));
  }

  // refusals and escaping
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p4i4-'));
  try {
    const base = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'all-lines-confirmed.json'), 'utf8'));
    const write = (name: string, obj: unknown) => { const f = path.join(tmp, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
    const refused = (f: string) => { const r = harness([f]); return r.status === 2 && /refused/.test(r.stderr) && r.stdout.trim() === ''; };
    check('R11 the harness refuses a fixture not declared synthetic, a wrong kind, a wrong source, and invalid JSON (exit 2, no reading)', refused(write('a.json', { ...base, synthetic: false })) && refused(write('b.json', { ...base, synthetic: 'true' })) && refused(write('c.json', { ...base, kind: 'other' })) && refused(write('d.json', { ...base, source: 'camera' })) && refused(write('e.json', '{not json')));
    const evil = write('evil.json', { ...base, description: '<script>alert(1)</script><img src=x onerror=1>' });
    const h = harness([evil, '--format', 'html']);
    check('R12 the HTML preview escapes fixture text (no injected markup)', h.status === 0 && !h.stdout.includes('<script>alert') && h.stdout.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !h.stdout.includes('<img src=x'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // isolation (static)
  const renderSrc = fs.readFileSync(path.join(PREVIEW, 'render.ts'), 'utf8');
  check('R13 the harness lives outside apps/web, imports only the E1 reading interface, and uses no network, storage or logging API', !/lib\/palm-analysis|apps\/web/.test(renderSrc.replace(/\/\*[\s\S]*?\*\//g, '')) && /from '\.\.\/src\/reading'/.test(renderSrc) && !/fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|console\./.test(renderSrc));
  let appRefs = '';
  try { appRefs = execFileSync('git', ['grep', '-l', '-e', 'e1/preview', '-e', 'preview/render', '--', 'apps/web'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { appRefs = ''; } // git grep exits 1 when nothing matches
  check('R14 no app module references the preview harness (no app-to-E1 import)', appRefs === '');
  check('R15 this test never imports the E1 reading interface (it runs the harness as a separate process)', !/from '[^']*e1\/src\/reading'|require\([^)]*e1\/src\/reading/.test(fs.readFileSync(__filename, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
}

try { run(); } catch (e: any) { console.log(`FAIL (uncaught) ${e?.stack ?? e}`); process.exit(1); }
console.log(`\nPALM-04-I4 feature-to-reading: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
