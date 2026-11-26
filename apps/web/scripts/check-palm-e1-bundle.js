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
// because the artifact could not be fully inspected. Like check-palm-engine-bundle.js this guard does not read or name
// the engine package; the E1 package tests verify that every SENTINELS entry occurs in the E1 source or catalogue and
// nowhere else under apps/ or packages/, so this check cannot pass vacuously.
//
// R4: POSITIVE ARTIFACT VERIFICATION. Before scanning, the guard checks that the expected release artifact is
// actually there (REQUIRED below, per build target): a valid build id, the build's own static manifest under that
// id, non-empty chunk and server output, the standalone server and its Next runtime, parseable manifests, the public
// web manifest and, for the Docker tree, every migration. Missing, empty, unreadable, malformed or inconsistent
// required output fails closed (exit 1), so an empty or partial tree can never "pass" a scan of nothing. This is a
// structural check, not a file count.
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

const BUILD_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
/**
 * Required artifact structure per build target. `{B}` is the build id read from BUILD_ID.
 *   web-build            apps/web after `next build` (output: 'standalone'): CI web-build job, vercel-build.sh
 *                        (every Vercel Preview and Production build) and the Docker build stage.
 *   docker-release-tree  the assembled runtime tree /app (Docker release-tree stage), exactly what the image ships.
 */
const REQUIRED = Object.freeze({
  'web-build': Object.freeze({
    buildId: '.next/BUILD_ID',
    sameBuildId: ['.next/standalone/.next/BUILD_ID'],
    files: ['.next/static/{B}/_buildManifest.js', '.next/server/webpack-runtime.js', '.next/standalone/server.js', '.next/standalone/node_modules/next/package.json'],
    json: ['.next/server/app-paths-manifest.json', '.next/server/pages-manifest.json', '.next/standalone/package.json', 'public/manifest.json'],
    dirs: [['.next/static/chunks', '.js'], ['.next/server/app', ''], ['.next/standalone/.next/server/app', '']],
    migrations: null,
  }),
  'docker-release-tree': Object.freeze({
    buildId: '.next/BUILD_ID',
    sameBuildId: [],
    files: ['server.js', '.next/static/{B}/_buildManifest.js', '.next/server/webpack-runtime.js', 'node_modules/next/package.json'],
    json: ['package.json', '.next/server/app-paths-manifest.json', '.next/server/pages-manifest.json', 'public/manifest.json'],
    dirs: [['.next/static/chunks', '.js'], ['.next/server/app', '']],
    migrations: 'migrations',
  }),
});

/** Verify the required structure of `root` for `target`. Returns a list of problems (empty when complete). */
function checkStructure(root, target) {
  const spec = REQUIRED[target];
  if (!spec) return [`unknown build target ${target}`];
  const errs = [];
  const readFile = (rel) => {
    const full = path.join(root, rel);
    let st;
    try { st = fs.statSync(full); } catch (e) { errs.push(`missing ${rel}`); return null; }
    if (!st.isFile()) { errs.push(`not a regular file: ${rel}`); return null; }
    let buf;
    try { buf = fs.readFileSync(full); } catch (e) { errs.push(`unreadable ${rel}: ${e.code || e.message}`); return null; }
    if (buf.length === 0 || !buf.toString('utf8').trim()) { errs.push(`empty ${rel}`); return null; }
    return buf.toString('utf8');
  };
  const idText = readFile(spec.buildId);
  const id = idText === null ? null : idText.trim();
  if (id !== null && !BUILD_ID_RE.test(id)) errs.push(`malformed build id in ${spec.buildId}`);
  for (const rel of spec.sameBuildId) { const t = readFile(rel); if (t !== null && id !== null && t.trim() !== id) errs.push(`${rel} does not match ${spec.buildId}`); }
  for (const rel of spec.files) { if (rel.includes('{B}') && (id === null || !BUILD_ID_RE.test(id))) { errs.push(`cannot locate ${rel} without a valid build id`); continue; } readFile(rel.replace('{B}', id)); }
  for (const rel of spec.json) {
    const t = readFile(rel);
    if (t === null) continue;
    let v;
    try { v = JSON.parse(t); } catch { errs.push(`malformed JSON ${rel}`); continue; }
    if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length === 0) errs.push(`empty or non-object JSON ${rel}`);
  }
  for (const [rel, ext] of spec.dirs) {
    const dir = path.join(root, rel);
    let found = false;
    const stack = [dir];
    try {
      if (!fs.statSync(dir).isDirectory()) { errs.push(`not a directory: ${rel}`); continue; }
      while (stack.length && !found) {
        const d = stack.pop();
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, ent.name);
          if (ent.isDirectory()) stack.push(full);
          else if (ent.isFile() && ent.name.endsWith(ext) && fs.statSync(full).size > 0) { found = true; break; }
        }
      }
    } catch (e) { errs.push(`missing or unreadable ${rel}: ${e.code || e.message}`); continue; }
    if (!found) errs.push(`no non-empty ${ext || 'output'} file under ${rel}`);
  }
  if (spec.migrations) {
    const dir = path.join(root, spec.migrations);
    let subs = [];
    try { subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch (e) { errs.push(`missing or unreadable ${spec.migrations}: ${e.code || e.message}`); }
    if (!errs.some((e) => e.includes(spec.migrations)) && subs.length === 0) errs.push(`no migrations under ${spec.migrations}`);
    for (const sub of subs) readFile(path.join(spec.migrations, sub.name, 'migration.sql'));
  }
  return errs;
}

/** Scan the web release outputs under `root` (apps/web). Returns { hits, errors, files, scanned }. */
function scan(root) {
  const out = { hits: [], errors: checkStructure(root, 'web-build').map((e) => `incomplete artifact: ${e}`), files: 0, scanned: [], seenLinks: new Set() };
  for (const rel of SCAN_DIRS) {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) { out.errors.push(`incomplete artifact: missing ${rel}`); continue; }
    out.scanned.push(rel);
    scanTree(dir, root, out);
  }
  return out;
}

/** Scan every file under `dir` (the assembled Docker release tree). */
function scanAll(dir) {
  const out = { hits: [], errors: checkStructure(dir, 'docker-release-tree').map((e) => `incomplete artifact: ${e}`), files: 0, scanned: ['.'], seenLinks: new Set() };
  scanTree(dir, dir, out);
  return out;
}

function report(res, where) {
  if (res.errors.length) {
    console.error(`[palm-e1-bundle] FAIL: SCAN ERROR -- the release artifact is incomplete or could not be fully inspected (${res.errors.length}); failing closed:`);
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
    if (!fs.existsSync(path.join(root, '.next/static'))) { console.error('[palm-e1-bundle] FAIL: no .next/static found -- run `next build` first.'); process.exit(1); }
    const res = scan(root);
    report(res, res.scanned.join(', '));
  }
}

module.exports = { SENTINELS, SCAN_DIRS, REQUIRED, checkStructure, scan, scanAll };
