/**
 * AURA-PALM-04-I2 -- the tracing overlay's image geometry (lib/palm-analysis/tracingGeometry.ts) against an
 * independent oracle, plus the static development-isolation checks for the overlay.
 *
 *   A. object-fit: contain geometry across stage sizes, image aspect ratios and offsets; exact round trips
 *   B. stroke capture helpers (spacing, resampling) keep within I1's point limit without judging the trace
 *   C. negative control: a stretching transform and a container-relative transform fail section A
 *   D. development isolation and privacy (static): one importer, no route, sentinels, no new dependency, CI wiring
 *
 *   npx ts-node test/palm04I2TracingGeometry.test.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { clientToImage, containRect, imageToClient, resampleStroke, spaceStroke, TRACE_POINT_LIMITS, TRACING_LINE_NAMES, type Rect } from '../apps/web/lib/palm-analysis/tracingGeometry';
import { PALM_LINE_IDENTITY, TRACE_LIMITS } from '../apps/web/lib/palm-analysis/features';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 400)}`}`); }
}

// ---------------------------------------------------------------- oracle (written independently of the module)
function oracle(box: Rect, w: number, h: number): Rect {
  const s = Math.min(box.width / w, box.height / h);
  return { left: box.left + (box.width - w * s) / 2, top: box.top + (box.height - h * s) / 2, width: w * s, height: h * s };
}
const BOXES: Rect[] = [];
for (const [bw, bh] of [[360, 460], [328, 240], [740, 223], [1280, 560], [768, 560], [1, 1], [333.3, 517.7]]) for (const [l, t] of [[0, 0], [16, 120.5], [-40, 300]]) BOXES.push({ left: l, top: t, width: bw, height: bh });
const IMAGES: Array<[number, number]> = [[960, 1280], [1280, 960], [1000, 1000], [600, 1400], [1600, 900], [1280, 721], [3, 7]];
const SAMPLES = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 0.5 }, { x: 0.38, y: 0.45 }, { x: 0.999, y: 0.001 }, { x: 0.123456, y: 0.987654 }];

type Impl = { name: string; contain: (b: Rect, w: number, h: number) => Rect | null; toImage: (cx: number, cy: number, box: Rect, content: Rect) => { x: number; y: number } | null };
const REAL: Impl = { name: 'real', contain: containRect, toImage: (cx, cy, _box, content) => clientToImage(cx, cy, content) };
const STRETCH: Impl = { name: 'stretch', contain: (b) => ({ ...b }), toImage: (cx, cy, _box, content) => clientToImage(cx, cy, content) };
const CONTAINER: Impl = { name: 'container', contain: containRect, toImage: (cx, cy, box) => clientToImage(cx, cy, box) };

/** Section A against one implementation; returns the failing case names. */
function geometryCases(impl: Impl): { total: number; bad: string[] } {
  const bad: string[] = [];
  let total = 0;
  for (const box of BOXES) for (const [w, h] of IMAGES) {
    const want = oracle(box, w, h);
    const got = impl.contain(box, w, h);
    total++;
    const tol = 1e-9 * Math.max(1, box.width, box.height);
    if (!got || Math.abs(got.left - want.left) > tol || Math.abs(got.top - want.top) > tol || Math.abs(got.width - want.width) > tol || Math.abs(got.height - want.height) > tol) { bad.push(`contain ${JSON.stringify(box)} ${w}x${h}`); continue; }
    for (const p of SAMPLES) {
      total++;
      const client = { x: want.left + p.x * want.width, y: want.top + p.y * want.height }; // where the oracle draws p
      const back = impl.toImage(client.x, client.y, box, got);
      if (!back || Math.abs(back.x - p.x) > 1e-9 || Math.abs(back.y - p.y) > 1e-9) bad.push(`roundtrip ${JSON.stringify(box)} ${w}x${h} ${JSON.stringify(p)}`);
    }
  }
  return { total, bad };
}

// ============================================================ A
const real = geometryCases(REAL);
check(`A1. contain geometry and pointer round trip equal the oracle in all ${real.total} cases (${BOXES.length} stages x ${IMAGES.length} aspect ratios x ${SAMPLES.length} points)`, real.bad.length === 0, real.bad.slice(0, 5));
{
  const box = { left: 10, top: 20, width: 300, height: 600 };
  const c = containRect(box, 1280, 960)!;
  check('A2. a landscape photo in a portrait stage is letterboxed top and bottom, centred, undistorted', c.left === 10 && c.width === 300 && Math.abs(c.height - 225) < 1e-9 && Math.abs(c.top - (20 + 187.5)) < 1e-9 && Math.abs(c.width / c.height - 1280 / 960) < 1e-12);
  const d = containRect({ left: 0, top: 0, width: 800, height: 300 }, 960, 1280)!;
  check('A3. a portrait photo in a landscape stage is letterboxed left and right', d.top === 0 && d.height === 300 && Math.abs(d.width - 225) < 1e-9 && Math.abs(d.left - 287.5) < 1e-9);
  check('A4. imageToClient is the exact inverse of clientToImage', SAMPLES.every((p) => { const q = imageToClient(p, c); const r = clientToImage(q.x, q.y, c)!; return Math.abs(r.x - p.x) < 1e-12 && Math.abs(r.y - p.y) < 1e-12; }));
  const lb = clientToImage(c.left + c.width / 2, c.top - 5, c)!;
  const out = clientToImage(c.left + c.width + 30, c.top + 10, c)!;
  check('A5. positions in the letterbox or beyond the photo are reported outside and NOT clamped', !lb.inside && lb.y < 0 && !out.inside && out.x > 1 && clientToImage(c.left, c.top, c)!.inside && clientToImage(c.left + c.width, c.top + c.height, c)!.inside);
  check('A6. device pixel ratio cannot enter the mapping: the API takes CSS-pixel boxes and positions only (no DPR parameter or global)', !/devicePixelRatio|window|document/.test(read('apps/web/lib/palm-analysis/tracingGeometry.ts').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('A7. degenerate sizes give no geometry (no division by zero)', containRect({ left: 0, top: 0, width: 0, height: 100 }, 10, 10) === null && containRect({ left: 0, top: 0, width: 10, height: 10 }, 0, 10) === null && containRect({ left: NaN, top: 0, width: 10, height: 10 }, 10, 10) === null && clientToImage(NaN, 1, c) === null);
  // resizing: the same normalised point lands at the oracle position for every stage size (confirmed traces keep their place)
  const p = { x: 0.62, y: 0.64 };
  check('A8. a stored normalised point is re-drawn at the correct place after any resize or rotation', BOXES.every((b) => { const k = containRect(b, 960, 1280)!; const o = oracle(b, 960, 1280); const q = imageToClient(p, k); return Math.abs(q.x - (o.left + p.x * o.width)) < 1e-9 && Math.abs(q.y - (o.top + p.y * o.height)) < 1e-9; }));
}

// ============================================================ B
{
  const W = 960, H = 1280;
  const raw = Array.from({ length: 400 }, (_, i) => ({ x: 0.3 + (0.35 * i) / 399, y: 0.6 + 0.02 * Math.sin(i / 30) }));
  const spaced = spaceStroke(raw, W, H, 7.68);
  const res = resampleStroke(spaced, 24, W, H);
  check('B1. a long stroke is reduced to at most 24 points (I1 allows 64), keeping its exact first and last point', res.length === 24 && res[0].x === raw[0].x && res[0].y === raw[0].y && res[23].x === raw[399].x && res[23].y === raw[399].y);
  const seg = res.slice(1).map((q, i) => Math.hypot((q.x - res[i].x) * W, (q.y - res[i].y) * H));
  check('B2. resampled points are evenly spaced along the stroke (within 5%)', Math.max(...seg) / Math.min(...seg) < 1.05, seg.map((v) => v.toFixed(2)));
  check('B3. a short stroke is passed through unchanged (no invented points)', JSON.stringify(resampleStroke([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], 24, W, H)) === JSON.stringify([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }]));
  check('B4. spacing drops jitter below the step but always keeps the end', spaceStroke([{ x: 0.5, y: 0.5 }, { x: 0.5001, y: 0.5 }, { x: 0.5002, y: 0.5 }], W, H, 5).length === 2);
  check('B5. off-photo stroke points are kept as they are (I1 judges them; nothing is clamped)', resampleStroke([{ x: 0.5, y: 0.5 }, { x: 1.2, y: 0.5 }], 24, W, H)[1].x === 1.2);
  check('B6. the overlay re-exports I1 values read-only (line names and point limits are the frozen I1 ones)', TRACING_LINE_NAMES === PALM_LINE_IDENTITY && TRACE_POINT_LIMITS.min === TRACE_LIMITS.minPoints && TRACE_POINT_LIMITS.max === TRACE_LIMITS.maxPoints && Object.isFrozen(TRACE_POINT_LIMITS));
  check('B7. the geometry module never decides validity (no placement, bounds or I1 builder use)', !/buildPalmFeatureSet|placeTrace|bounds|xMin|trace-/.test(read('apps/web/lib/palm-analysis/tracingGeometry.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
}

// ============================================================ C. negative controls
for (const impl of [STRETCH, CONTAINER]) {
  const r = geometryCases(impl);
  check(`C. negative control (${impl.name} transform): section A detects it -- ${r.bad.length} of ${r.total} cases fail`, r.bad.length > r.total / 4, r.bad.length);
}

// ============================================================ D. static isolation
{
  const web = path.join(ROOT, 'apps/web');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (['node_modules', '.next', '.next-dev', 'public', 'android', 'ios'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx|js|mjs)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = walk(web).map((f) => path.relative(ROOT, f));
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const mentions = (re: RegExp) => files.filter((f) => re.test(strip(read(f))));
  check('D1. the tracing overlay is defined and used only in components/palm-scan/PalmImageInput.tsx (swapped for a stub in production)', JSON.stringify(mentions(/PalmTracingPanel/)) === JSON.stringify(['apps/web/components/palm-scan/PalmImageInput.tsx']));
  check('D2. the geometry module is reached only through the palm-analysis index', JSON.stringify(mentions(/tracingGeometry['"]/)) === JSON.stringify(['apps/web/lib/palm-analysis/index.ts']));
  check('D3. no scanner route or navigation entry: no app/palm* directory, and page.tsx does not reference the scanner', !fs.readdirSync(path.join(web, 'app')).some((n) => /palm|scan|trac/i.test(n)) && !/palm-scan|palm-analysis|PalmImageInput|Tracing/.test(read('apps/web/app/page.tsx')));
  check('D4. the production stand-in still renders nothing and imports nothing', !/import /.test(strip(read('apps/web/components/palm-scan/PalmImageInput.excluded.tsx'))) && /return null;/.test(read('apps/web/components/palm-scan/PalmImageInput.excluded.tsx')));
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scanner = require('../apps/web/scripts/check-palmistry-bundle');
  const ui = read('apps/web/components/palm-scan/PalmImageInput.tsx');
  const sentinels = ['palm-04-tracing-ui@0.1.0', 'Aura does not find palm lines for you. It only checks that the shape and position of your trace can be used.'];
  check('D5. the bundle scanner treats the overlay\'s two runtime strings as image-input sentinels, and both are used at runtime', sentinels.every((s) => scanner.IMAGE_INPUT_SENTINELS.includes(s) && strip(ui).includes(s)) && /data-version=\{PALM_TRACING_UI_VERSION\}/.test(ui));
  check('D6. the harness and browser test live in test/ only and nothing in apps/web imports them', mentions(/palm04I2/).length === 0 && fs.existsSync(path.join(ROOT, 'test/palm04I2Harness.tsx')));
  const show = (ref: string, f: string) => { try { return execFileSync('git', ['show', `${ref}:${f}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  const deps = (t: string | null) => { if (!t) return null; const j = JSON.parse(t); return JSON.stringify({ d: j.dependencies ?? {}, dd: j.devDependencies ?? {} }); };
  const base = '38b7fa6f587fd7c1eac0687eb153ac11514ede1f';
  const baseOk = show(base, 'package.json') !== null;
  check('D7. no new dependency: root and apps/web package.json dependencies are identical to main 38b7fa6', !baseOk || (deps(show(base, 'package.json')) === deps(read('package.json')) && deps(show(base, 'apps/web/package.json')) === deps(read('apps/web/package.json'))), baseOk ? undefined : 'base commit unavailable (shallow clone): skipped');
  const ci = read('.github/workflows/ci.yml');
  check('D8. CI runs the three P4-I2 suites in the G5 job', ['test/palm04I2TracingGeometry.test.ts', 'test/palm04I2TracingUiJsdom.test.ts', 'test/palm04I2TracingBrowser.test.ts'].every((t) => ci.includes(t)));
  check('D9. the overlay source uses no persistence, network, logging or image encoding API', !/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|console\.|toDataURL|toBlob|FileReader/.test(strip(ui)));
}

console.log(`\nPALM-04-I2 geometry: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
