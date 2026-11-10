#!/usr/bin/env node
// AURA-PALM-01-P1 -- post-build guard: while Palmistry content is NOT approved
// by a qualified human reviewer, a production build must contain none of it.
// Fails (exit 1) if any sentinel string from the unapproved content appears in
// the built output. Run after `next build` (CI "Next.js production build" job):
//
//   node scripts/check-palmistry-bundle.js            (from apps/web)
//
// Sentinels are verified to really exist in the source by
// test/palm01I1Content.test.ts, so this check can never pass vacuously.
// They are deliberately ASCII-only: the minifier may emit non-ASCII text as
// escape sequences (e.g. "ñ" -> "\xf1"), which a literal diacritic sentinel
// would silently fail to match (P1 review finding 1).
const fs = require('fs');
const path = require('path');
const { isPalmistryApproved } = require('../palmistry-build-exclusion');

const SENTINELS = [
  'zysk-2025', // source-register id
  'palm-line-ayurlekha', // SVG region id
  'PENDING_HUMAN_REVIEW', // review-status value
  'Palmistry is a traditional interpretive practice', // disclosure
  'Learn the lines of the hand', // Explore card copy
  'Aura does not estimate lifespan', // longevity disclosure
  'History of Science in South Asia', // source edition (Zysk 2025)
  'Western palmistry, for comparison', // detail-panel label
];

const SCAN_DIRS = ['.next/static', '.next/server', '.next/standalone'];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (name === 'node_modules') continue;
      yield* walk(full);
    } else if (/\.(js|mjs|cjs|json|html|rsc|txt)$/.test(name)) {
      yield full;
    }
  }
}

function scan(root) {
  const hits = [];
  for (const rel of SCAN_DIRS) {
    for (const file of walk(path.join(root, rel))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const s of SENTINELS) if (text.includes(s)) hits.push({ file: path.relative(root, file), sentinel: s });
    }
  }
  return hits;
}

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  if (isPalmistryApproved()) {
    console.log('[palmistry-bundle] content APPROVED -- inclusion allowed, nothing to check.');
    process.exit(0);
  }
  if (!fs.existsSync(path.join(root, '.next/static'))) {
    console.error('[palmistry-bundle] no .next/static found -- run `next build` first.');
    process.exit(1);
  }
  const hits = scan(root);
  if (hits.length > 0) {
    console.error('[palmistry-bundle] FAIL: unapproved Palmistry content found in the production build:');
    for (const h of hits.slice(0, 20)) console.error(`  ${h.sentinel}  ->  ${h.file}`);
    process.exit(1);
  }
  console.log(`[palmistry-bundle] OK: none of ${SENTINELS.length} Palmistry sentinels present in ${SCAN_DIRS.join(', ')}.`);
}

module.exports = { SENTINELS, SCAN_DIRS, scan };
