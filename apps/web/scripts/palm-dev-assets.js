#!/usr/bin/env node
// AURA-PALM-G5-I1 -- install the self-hosted MediaPipe runtime + hand model
// for LOCAL DEVELOPMENT ONLY, verifying every file against pinned SHA-256s.
//
//   node scripts/palm-dev-assets.js --model /path/to/hand_landmarker.task
//   node scripts/palm-dev-assets.js --verify
//   node scripts/palm-dev-assets.js --remove
//
// Destination: apps/web/public/palm-dev-assets/mediapipe-1.2.0/ -- gitignored
// (apps/web/.gitignore) and excluded from Docker builds (.dockerignore), so no
// deployed origin can ever serve these files. The WASM runtime is copied from
// the pinned npm package (node_modules/@mediapipe/tasks-vision, exact 1.2.0);
// the model file is NOT downloaded by this script (no network access): pass a
// local copy whose hash matches the pin (e.g. the G4-A research copy).
// Refuses to run in CI, on Vercel, or with NODE_ENV=production.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.2.0';
const WEB_ROOT = path.resolve(__dirname, '..');
const DEST = path.join(WEB_ROOT, 'public', 'palm-dev-assets', `mediapipe-${VERSION}`);
const PKG = path.join(WEB_ROOT, 'node_modules', '@mediapipe', 'tasks-vision');

// Pinned hashes. WASM files are byte-identical to the G4-A vendored copies
// (models/ASSET_SHA256SUMS in the G4-A research worktree).
const PINNED = {
  'hand_landmarker.task': 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  'wasm/vision_wasm_internal.js': '85c1a342be70427987f900969a5f26e17557351111364e6585e97fb03e93e108',
  'wasm/vision_wasm_internal.wasm': 'bcc13df22d3d69ec8cbe8e280989356d844ae00f4523eb82072d2484f44134dc',
  'wasm/vision_wasm_module_internal.js': '60384c9014750321c0fc1d489b3329e5eaed0fcf3c328d404ecb1a6c75e89d17',
  'wasm/vision_wasm_module_internal.wasm': '2e326b9d9584ac22e230c263f47e6fe694a7df1ce22a8546c72df0e5c0fc1066',
  'wasm/vision_wasm_nosimd_internal.js': 'e9b2b799e0f1078f5538b300a57835b823742c37e2646308a03f0f25b39fdcdc',
  'wasm/vision_wasm_nosimd_internal.wasm': 'ed5e5e5812490bd90d6a440290845ff9e4c516f696847a28a0c0e0573470d469',
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function refuseOutsideDev(env = process.env) {
  if (env.CI || env.VERCEL || env.VERCEL_ENV || env.NODE_ENV === 'production') {
    return 'refusing: palm dev assets are for local development only (CI/VERCEL/NODE_ENV=production detected)';
  }
  return null;
}

function verify(dest = DEST) {
  const problems = [];
  for (const [rel, want] of Object.entries(PINNED)) {
    const f = path.join(dest, rel);
    if (!fs.existsSync(f)) problems.push(`missing ${rel}`);
    else if (sha256(f) !== want) problems.push(`hash mismatch ${rel}`);
  }
  return problems;
}

function install(modelPath, dest = DEST) {
  if (!modelPath || !fs.existsSync(modelPath)) throw new Error('pass --model <local path to hand_landmarker.task>');
  if (sha256(modelPath) !== PINNED['hand_landmarker.task']) throw new Error('model hash does not match the pinned SHA-256');
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  if (pkgVersion !== VERSION) throw new Error(`@mediapipe/tasks-vision ${pkgVersion} installed, ${VERSION} required`);
  fs.mkdirSync(path.join(dest, 'wasm'), { recursive: true });
  for (const rel of Object.keys(PINNED)) {
    const src = rel === 'hand_landmarker.task' ? modelPath : path.join(PKG, rel);
    if (sha256(src) !== PINNED[rel]) throw new Error(`source hash mismatch for ${rel}`);
    fs.copyFileSync(src, path.join(dest, rel));
  }
  const problems = verify(dest);
  if (problems.length) throw new Error(problems.join('; '));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const refusal = refuseOutsideDev();
  if (refusal) { console.error(`[palm-dev-assets] ${refusal}`); process.exit(1); }
  try {
    if (args.includes('--remove')) {
      fs.rmSync(path.join(WEB_ROOT, 'public', 'palm-dev-assets'), { recursive: true, force: true });
      console.log('[palm-dev-assets] removed');
    } else if (args.includes('--verify')) {
      const problems = verify();
      if (problems.length) { console.error(`[palm-dev-assets] FAIL: ${problems.join('; ')}`); process.exit(1); }
      console.log(`[palm-dev-assets] OK: ${Object.keys(PINNED).length}/${Object.keys(PINNED).length} files match pinned SHA-256`);
    } else {
      const i = args.indexOf('--model');
      install(i >= 0 ? args[i + 1] : process.env.PALM_HAND_MODEL);
      console.log(`[palm-dev-assets] installed and verified ${Object.keys(PINNED).length} files in ${path.relative(WEB_ROOT, DEST)}`);
    }
  } catch (err) {
    console.error(`[palm-dev-assets] FAIL: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { PINNED, DEST, VERSION, verify, install, refuseOutsideDev };
