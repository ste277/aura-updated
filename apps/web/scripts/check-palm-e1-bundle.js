#!/usr/bin/env node
// AURA-PALM-03-E1 -- post-build guard: the development-only personalised interpretation engine and its UNREVIEWED
// interpretation catalogue must NEVER be part of a production build. UNCONDITIONAL: there is no flag, environment
// variable or approval state that lets them in (content approval and activation need separate authorisation and a
// change to this guard). Run after `next build` (CI "Next.js production build" job):
//
//   node scripts/check-palm-e1-bundle.js            (from apps/web)
//
// Fails (exit 1) if any sentinel appears in the built output. Like check-palm-engine-bundle.js this guard does not read
// or name the engine package. The E1 package's own tests verify that every SENTINELS entry occurs in the E1 source or
// catalogue and nowhere else under apps/ or packages/, so this check cannot pass vacuously.
const fs = require('fs');
const path = require('path');

const SENTINELS = [
  'aura.palm.e1-reading', // E1 engine identity
  'e1-zone-descriptor@', // E1 descriptor contract version
  'palm-03-c1-library@0.4.0-draft', // interpretation catalogue version
  'suitable-additional-coverage', // catalogue selection policy
  'C1-IN-PITR-KNOWLEDGE', // catalogue record id (Indian)
  'C1-WE-HEART-JUPITER', // catalogue record id (Western)
];
const SCAN_DIRS = ['.next/static', '.next/server', '.next/standalone'];
function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) { if (name !== 'node_modules') yield* walk(full); }
    else if (/\.(js|mjs|cjs|json|html|rsc|txt|map)$/.test(name)) yield full;
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
  if (!fs.existsSync(path.join(root, '.next/static'))) { console.error('[palm-e1-bundle] no .next/static found -- run `next build` first.'); process.exit(1); }
  const hits = scan(root);
  if (hits.length > 0) {
    console.error('[palm-e1-bundle] FAIL: the personalised interpretation engine or its catalogue is in the production build:');
    for (const h of hits.slice(0, 20)) console.error(`  ${h.sentinel}  ->  ${h.file}`);
    process.exit(1);
  }
  console.log(`[palm-e1-bundle] OK: none of ${SENTINELS.length} E1 sentinels present in ${SCAN_DIRS.join(', ')}.`);
}

module.exports = { SENTINELS, SCAN_DIRS, scan };
