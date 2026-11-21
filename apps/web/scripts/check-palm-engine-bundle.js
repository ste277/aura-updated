#!/usr/bin/env node
// G6-I1 (detector-to-engine adapter milestone) -- post-build guard: the synthetic palm interpretation engine and its test-only
// detector adapter (the synthetic engine package under packages/) must NEVER be part of a production build.
// Unlike check-palmistry-bundle.js this guard is UNCONDITIONAL (there is no approval state that
// allows the engine in). Run after `next build` (CI "Next.js production build" job):
//
//   node scripts/check-palm-engine-bundle.js            (from apps/web)
//
// Fails (exit 1) if any sentinel string appears in the built output. This guard deliberately does not
// read or name the engine package (production code must not reference it). The engine package's own
// test suite ("G6-I1 bundle guard") verifies that every SENTINELS entry below really occurs in the
// engine/adapter source and nowhere else under apps/ or packages/, so this check cannot pass vacuously.
const fs = require('fs');
const path = require('path');

const SENTINELS = [
  'aura.palm.features', // feature schema id (engine + adapter)
  'palm-normalized-v1', // coordinate frame id (engine + adapter)
  'uncalibrated-detector-score', // confidence basis (engine + adapter)
  'creases-directional-d3b', // detector registry key (engine + adapter)
  'landmark-crease-conflation', // engine validation code
  'no-interpretable-creases', // engine decline reason
  'g6-i1-feature-adapter', // adapter version id
];
const SCAN_DIRS = ['.next/static', '.next/server', '.next/standalone'];
function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) { if (name !== 'node_modules') yield* walk(full); }
    else if (/\.(js|mjs|cjs|json|html|rsc|txt)$/.test(name)) yield full;
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
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  if (!fs.existsSync(path.join(root, '.next/static'))) { console.error('[palm-engine-bundle] no .next/static found -- run `next build` first.'); process.exit(1); }
  const hits = scan(root);
  if (hits.length > 0) {
    console.error('[palm-engine-bundle] FAIL: the synthetic palm reading engine or adapter is in the production build:');
    for (const h of hits.slice(0, 20)) console.error(`  ${h.sentinel}  ->  ${h.file}`);
    process.exit(1);
  }
  console.log(`[palm-engine-bundle] OK: none of ${SENTINELS.length} engine/adapter sentinels present in ${SCAN_DIRS.join(', ')}.`);
}

module.exports = { SENTINELS, SCAN_DIRS, scan };
