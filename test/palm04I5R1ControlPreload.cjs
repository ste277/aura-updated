'use strict';
/**
 * AURA-PALM-04-I5-R1 -- in-memory source mutation for negative controls (test tooling only). Preloaded with
 * `node -r` by test/palm04I5R1Controls.test.ts; PALM_I5_CONTROL names one mutation. It rewrites what ts-node reads
 * for ONE source file in this process; nothing on disk changes. An unknown name or a mutation whose target text is
 * missing throws, so a control can never pass vacuously.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CAMERA = path.join(ROOT, 'apps/web/lib/palm-analysis/camera.ts');
const UI = path.join(ROOT, 'apps/web/components/palm-scan/PalmImageInput.tsx');
// The first three are the independent reviewer's 50362 controls, verbatim.
const CONTROLS = {
  'duplicate-acquisition': [CAMERA, '(c: typeof PALM_CAMERA_CONSTRAINTS) => md.getUserMedia!(c) as Promise<PalmStreamLike>', "(c: typeof PALM_CAMERA_CONSTRAINTS) => { void md['getUserMedia']?.(c); return md.getUserMedia!(c) as Promise<PalmStreamLike>; }"],
  'nonvideo-disabled': [CAMERA, "tracks.some((t) => t.kind !== 'video')", "(false && tracks.some((t) => t.kind !== 'video'))"],
  'automatic-start': [UI, 'const unsubscribeCamera = cam.subscribe(setCamera);', "const unsubscribeCamera = cam.subscribe(setCamera); if (cam.support() === 'available') void cam.start();"],
  'preview-failure-ignored': [CAMERA, '(p as Promise<void>).then(undefined, failed);', '(p as Promise<void>).then(undefined, () => undefined);'],
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
