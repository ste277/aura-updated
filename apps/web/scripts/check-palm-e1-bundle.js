#!/usr/bin/env node
// AURA-PALM-03-E1 -- post-build guard: the development-only personalised interpretation engine and its UNREVIEWED
// interpretation catalogue must NEVER be part of a release artifact. UNCONDITIONAL: there is no flag, environment
// variable or approval state that lets them in (content approval and activation need separate authorisation and a
// change to this guard).
//
//   node scripts/check-palm-e1-bundle.js               (from apps/web, after `next build`)
//       scans EVERY file the web release ships: .next/static, .next/server, .next/standalone (including its shipped
//       node_modules) and public/. Used by CI and by vercel-build.sh (Vercel Preview and Production).
//   node scripts/check-palm-e1-bundle.js --tree <dir>
//       scans EVERY file under <dir>: the assembled Docker runtime tree (deploy/Dockerfile release-tree stage).
//
// R3: every regular file is scanned byte-wise, whatever its extension; no shipped directory is skipped. A symbolic
// link is followed only if its real path stays inside the directory being scanned; otherwise the scan fails closed,
// because the artifact could not be fully inspected. Fails (exit 1) on any sentinel, on an unreadable entry, or when
// the expected build output is missing. Like check-palm-engine-bundle.js this guard does not read or name the engine
// package; the E1 package tests verify that every SENTINELS entry occurs in the E1 source or catalogue and nowhere
// else under apps/ or packages/, so this check cannot pass vacuously.
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
const SCAN_DIRS = ['.next/static', '.next/server', '.next/standalone', 'public'];
const NEEDLES = SENTINELS.map((s) => [s, Buffer.from(s, 'utf8')]);

function scanTree(base, label, out) {
  const realBase = fs.realpathSync(base);
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { out.errors.push(`unreadable directory ${path.relative(label, dir)}: ${e.code || e.message}`); continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      let st;
      try { st = fs.lstatSync(full); } catch (e) { out.errors.push(`unreadable entry ${full}: ${e.code || e.message}`); continue; }
      let target = full;
      if (st.isSymbolicLink()) {
        let real;
        try { real = fs.realpathSync(full); } catch (e) { out.errors.push(`dangling symlink ${path.relative(label, full)}`); continue; }
        if (real !== realBase && !real.startsWith(realBase + path.sep)) { out.errors.push(`symlink leaves the scanned tree (not inspectable): ${path.relative(label, full)}`); continue; }
        if (out.seenLinks.has(real)) continue;
        out.seenLinks.add(real);
        target = real;
        st = fs.statSync(real);
      }
      if (st.isDirectory()) { stack.push(target); continue; }
      if (!st.isFile()) continue;
      let buf;
      try { buf = fs.readFileSync(target); } catch (e) { out.errors.push(`unreadable file ${path.relative(label, full)}: ${e.code || e.message}`); continue; }
      out.files++;
      for (const [s, b] of NEEDLES) if (buf.indexOf(b) !== -1) out.hits.push({ file: path.relative(label, full), sentinel: s });
    }
  }
}

/** Scan the web release outputs under `root` (apps/web). Returns { hits, errors, files, scanned }. */
function scan(root) {
  const out = { hits: [], errors: [], files: 0, scanned: [], seenLinks: new Set() };
  for (const rel of SCAN_DIRS) {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) continue;
    out.scanned.push(rel);
    scanTree(dir, root, out);
  }
  return out;
}

/** Scan every file under `dir` (an assembled release tree). */
function scanAll(dir) {
  const out = { hits: [], errors: [], files: 0, scanned: ['.'], seenLinks: new Set() };
  scanTree(dir, dir, out);
  return out;
}

function report(res, where) {
  if (res.errors.length) {
    console.error(`[palm-e1-bundle] FAIL: SCAN ERROR -- the release artifact could not be fully inspected (${res.errors.length}); failing closed:`);
    for (const e of res.errors.slice(0, 20)) console.error(`  ${e}`);
  }
  if (res.hits.length) {
    console.error('[palm-e1-bundle] FAIL: the personalised interpretation engine or its catalogue is in the release artifact:');
    for (const h of res.hits.slice(0, 20)) console.error(`  ${h.sentinel}  ->  ${h.file}`);
  }
  if (res.errors.length || res.hits.length) process.exit(1);
  console.log(`[palm-e1-bundle] OK: none of ${SENTINELS.length} E1 sentinels in ${res.files} file(s) under ${where}.`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--tree') {
    const dir = args[1] ? path.resolve(args[1]) : null;
    if (!dir || !fs.existsSync(dir)) { console.error('[palm-e1-bundle] --tree needs an existing directory.'); process.exit(1); }
    report(scanAll(dir), dir);
  } else {
    const root = args[0] ? path.resolve(args[0]) : path.resolve(__dirname, '..');
    if (!fs.existsSync(path.join(root, '.next/static'))) { console.error('[palm-e1-bundle] no .next/static found -- run `next build` first.'); process.exit(1); }
    const res = scan(root);
    report(res, res.scanned.join(', '));
  }
}

module.exports = { SENTINELS, SCAN_DIRS, scan, scanAll };
