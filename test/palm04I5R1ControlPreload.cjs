'use strict';
/**
 * AURA-PALM-04-I5-R1 / D6-I1 -- in-memory source mutation for negative controls (test tooling only). Preloaded with
 * `node -r` by test/palm04I5R1Controls.test.ts and test/palmD6I1Controls.test.ts; PALM_I5_CONTROL names one mutation. It rewrites what ts-node reads
 * for ONE source file in this process; nothing on disk changes. An unknown name or a mutation whose target text is
 * missing throws, so a control can never pass vacuously.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CAMERA = path.join(ROOT, 'apps/web/lib/palm-analysis/camera.ts');
const READING = path.join(ROOT, 'packages/palm-reading-engine/e1/src/reading.ts');
const GATE = path.join(ROOT, 'test/palmG5I1PrivacyGate.test.ts');
const UI = path.join(ROOT, 'apps/web/components/palm-scan/PalmImageInput.tsx');
// The first three are the independent reviewer's 50362 controls, verbatim.
const CONTROLS = {
  'duplicate-acquisition': [CAMERA, '(c: typeof PALM_CAMERA_CONSTRAINTS) => md.getUserMedia!(c) as Promise<PalmStreamLike>', "(c: typeof PALM_CAMERA_CONSTRAINTS) => { void md['getUserMedia']?.(c); return md.getUserMedia!(c) as Promise<PalmStreamLike>; }"],
  'nonvideo-disabled': [CAMERA, "tracks.some((t) => t.kind !== 'video')", "(false && tracks.some((t) => t.kind !== 'video'))"],
  'automatic-start': [UI, 'const unsubscribeCamera = cam.subscribe(setCamera);', "const unsubscribeCamera = cam.subscribe(setCamera); if (cam.support() === 'available') void cam.start();"],
  'preview-failure-ignored': [CAMERA, '(p as Promise<void>).then(undefined, failed);', '(p as Promise<void>).then(undefined, () => undefined);'],
  // D6-I1-R2 control (50372 F2): restore the R1 behaviour (decoded string values not scanned)
  'd6r2-no-decoded-strings': [GATE, '  const decoded = decodedStringSpecifiers(rel, text);', '  const decoded: string[] = []; void decodedStringSpecifiers;'],
  // D6-I1-R1 controls (50369 F1, F2)
  'd6r1-retain-landmarks': [UI, 'return d ? Object.freeze({ width: d.imageWidth, height: d.imageHeight }) : null;', 'return d ? (Object.freeze({ width: d.imageWidth, height: d.imageHeight, landmarks: d.landmarks }) as PanelImageSize) : null;'],
  'd6r1-textual-only-scan': [GATE, '  return [...new Set([...syntax, ...textual, ...decoded])];', "  void syntax; return [...strip(text).matchAll(/(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)['\"]([^'\"]+)['\"]/g)].map((m) => m[1]);"],
  // D6-I1 controls
  'd6-app-interpretation': [UI, '<strong>What the tradition says: </strong>{it.text.reading}</p>', '<strong>What the tradition says: </strong>{it.text.reading} This shows you will succeed.</p>'],
  'd6-stale-reading': [UI, 'const confirmedValid = !!confirmed && confirmed.key === reviewKey && !cleared;', 'const confirmedValid = !!confirmed && !cleared;'],
  'd6-keep-input': [UI, 'featureSet: deepFreeze(JSON.parse(JSON.stringify(r.featureSet))), reading, at: Date.now() }));', 'featureSet: deepFreeze(JSON.parse(JSON.stringify(r.featureSet))), reading, input: m.toFeatureSetInput({ hand, dominantHand: dominant }), at: Date.now() } as ConfirmedFeatures));'],
  'd6-gate-bypass': [READING, "  if (!confirmedScannerGateOpen()) throw new E1ErrorClass('development-only', 'confirmed-scanner readings exist only in development with the image-input gate open');\n", ''],
  'd6-synthetic-provenance': [READING, 'return readingFor(input, opts.mode, false);', 'return readingFor(input, opts.mode, true);'],
  'dr1-timeout-removed': [CAMERA, '      previewTimer = timer;\n', ''],
  'dr1-timeout-unguarded': [CAMERA, "        if (previewTimer !== timer) return; // superseded\n        previewTimer = null;\n        if (stream === s && state.epoch === epoch && state.phase === 'live' && !usableFrame(video)) release('error', 'camera-preview-timeout');", "        previewTimer = null;\n        if (state.phase === 'live' && !usableFrame(video)) release('error', 'camera-preview-timeout');"],
  'stale-playback-unguarded': [CAMERA, "if (stream === s && video === el && state.epoch === epoch && showSeq === seq && state.phase === 'live') release('error', 'camera-preview-failed');", "release('error', 'camera-preview-failed');"],
};
const name = process.env.PALM_I5_CONTROL;
const c = CONTROLS[name];
if (!c) throw new Error(`unknown control ${name}`);
const [file, from, to] = c;
const original = fs.readFileSync(file, 'utf8');
if (!original.includes(from)) throw new Error(`control ${name}: target not found in ${path.relative(ROOT, file)}`);
const mutated = original.replace(from, to);
const read = fs.readFileSync;
fs.readFileSync = function (p, ...args) {
  const data = read.call(this, p, ...args);
  if (path.resolve(String(p)) !== file) return data;
  return typeof data === 'string' ? mutated : Buffer.from(mutated);
};
module.exports = { CONTROLS };
