// AURA-PALM-01-P1 -- build-level exclusion of unapproved Palmistry content.
//
// The runtime gate (isPalmistryAvailable) only HIDES the guide; on its own
// the full educational text would still ship in the public page chunk. While
// the content is not approved by a qualified human reviewer, every PRODUCTION
// build (next build: CI, Vercel Preview and Production) swaps the one module
// that roots the Palmistry tree -- components/PalmistryView -- for an empty
// stand-in, so the content, sources, hand diagram and Explore card copy are
// never bundled at all. `next dev` keeps the real module for local review.
//
// Only page.tsx imports components/PalmistryView, and packages/palmistry is
// imported only through it (enforced by test/palm01I1Content.test.ts), so
// replacing that single request removes the whole subtree. Uses webpack's
// built-in NormalModuleReplacementPlugin: no dependency, no flag framework.
const path = require('path');

const REVIEW_STATUS_PATH = path.resolve(__dirname, '../../packages/palmistry/src/review-status.json');
const STUB_PATH = path.resolve(__dirname, 'components/PalmistryView.unpublished.tsx');
// Matches the request "…/components/PalmistryView" (with or without .tsx)
// and nothing else -- not PalmistryView.unpublished, not PalmHandDiagram.
const PALMISTRY_VIEW_REQUEST = /[\\/]components[\\/]PalmistryView(\.tsx)?$/;

function isPalmistryApproved() {
  // Read fresh (not require-cached) so the decision always reflects the file.
  const raw = require('fs').readFileSync(REVIEW_STATUS_PATH, 'utf8');
  return JSON.parse(raw).status === 'APPROVED';
}

function applyPalmistryExclusion(config, { dev, webpack, approved = isPalmistryApproved() }) {
  if (dev || approved) return config;
  config.plugins = config.plugins || [];
  config.plugins.push(new webpack.NormalModuleReplacementPlugin(PALMISTRY_VIEW_REQUEST, STUB_PATH));
  return config;
}

module.exports = { applyPalmistryExclusion, isPalmistryApproved, PALMISTRY_VIEW_REQUEST, STUB_PATH, REVIEW_STATUS_PATH };
