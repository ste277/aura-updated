// AURA-PALM-G5-I1-R2 (R1-F3) -- build-level exclusion of palm IMAGE INPUT,
// independent of Palmistry content approval.
//
// Three decisions are deliberately separate:
//   - Palmistry educational content approved  (packages/palmistry review-status.json,
//     handled by palmistry-build-exclusion.js)  -> does NOT imply image input;
//   - image input enabled for local development (`next dev` +
//     NEXT_PUBLIC_AURA_PALM_IMAGE_INPUT=g5-i1-dev, lib/palm-analysis/gate.ts)
//     -> does NOT imply production release;
//   - camera input (AURA-PALM-04-I5, lib/palm-analysis/camera.ts, development only)
//     -> does NOT imply release; it is removed with the rest of lib/palm-analysis.
//
// Production release of image input is NOT authorised. So every production
// build (next build: CI, Vercel Preview/Production, Docker) unconditionally:
//   1. swaps components/palm-scan/PalmImageInput for an empty stand-in, which
//      removes the upload UI and, with it, every import of lib/palm-analysis;
//   2. resolves `@mediapipe/tasks-vision` to an empty module (webpack alias
//      `false`), so no MediaPipe code or dynamic-import chunk can be emitted
//      even if some other module tried to import it.
// There is deliberately no flag or environment variable that turns this off:
// releasing image input requires a reviewed change to this file and to
// scripts/check-palmistry-bundle.js (which checks the result on every build,
// whatever the content-approval state). `next dev` is unaffected.
const path = require('path');

const IMAGE_INPUT_STUB_PATH = path.resolve(__dirname, 'components/palm-scan/PalmImageInput.excluded.tsx');
// Matches the request ".../palm-scan/PalmImageInput" (with or without .tsx)
// and nothing else -- not PalmImageInput.excluded.
const IMAGE_INPUT_REQUEST = /[\\/]palm-scan[\\/]PalmImageInput(\.tsx)?$/;
const MEDIAPIPE_PACKAGES = ['@mediapipe/tasks-vision'];
const CACHE_KEY = 'palm-image-input:excluded-r2';

function applyPalmImageInputExclusion(config, { dev, webpack }) {
  if (dev) return config;
  // A restored webpack cache from a build without this exclusion must never
  // be reused.
  if (config.cache && typeof config.cache === 'object') {
    config.cache.version = `${config.cache.version || ''}|${CACHE_KEY}`;
  }
  config.plugins = config.plugins || [];
  config.plugins.push(new webpack.NormalModuleReplacementPlugin(IMAGE_INPUT_REQUEST, IMAGE_INPUT_STUB_PATH));
  config.resolve = config.resolve || {};
  const alias = { ...(config.resolve.alias || {}) };
  for (const pkg of MEDIAPIPE_PACKAGES) alias[pkg] = false;
  config.resolve.alias = alias;
  return config;
}

module.exports = { applyPalmImageInputExclusion, IMAGE_INPUT_REQUEST, IMAGE_INPUT_STUB_PATH, MEDIAPIPE_PACKAGES, CACHE_KEY };
