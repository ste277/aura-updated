// AURA-PALM-G6-D0-R1.5 — coverage-contract checker (fails closed; the authority is re-execution, not the report).
// Usage: node check-coverage-contract.mjs <contract.json> <candidate prototype> <R1.1 prototype> <campaign-dir> [--reverify=all|none]
//   <campaign-dir> holds <id>.report.json, <id>.records.ndjson, <id>.stderr.log, <id>.attestation.json per campaign
//   (written by baseline/run-campaign.mjs). The verification logic is imported from THIS package
//   (../prototype/test/campaign-verify.mjs, campaign-core.mjs, independent-oracle.mjs, coverage.mjs) — never from the
//   directories under verification. Both engines are loaded from the given directories after their file hashes are
//   recorded; the contract requires those hashes (and the harness and fixture hashes) to equal the expected identity
//   named in the contract. Every case is regenerated from the CONTRACT's seed / fixture set and (default
//   --reverify=all) re-evaluated by both engines with the independent oracle. Prints JSON; exit 0 only on PASS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const [contractPath, candidate, baseline, dir] = args.filter((a) => !a.startsWith('--'));
const mode = opt('reverify') || 'all';
if (!contractPath || !candidate || !baseline || !dir || !['all', 'none'].includes(mode)) { console.error('usage: check-coverage-contract.mjs <contract> <candidate> <R1.1> <campaign-dir> [--reverify=all|none]'); process.exit(2); }
const T0 = Date.now();
const here = path.dirname(fileURLToPath(import.meta.url));
const own = (f) => import(pathToFileURL(path.join(here, '..', 'prototype', 'test', f)).href);
const K = await own('campaign-core.mjs'); const V = await own('campaign-verify.mjs'); const C = await own('coverage.mjs');
const O = await own('oracle.mjs'); const I = await own('independent-oracle.mjs');
const selfTests = { oracle: O.oracleSelfTest(), independent: I.independentSelfTest() }; // R1.5 (review F1): re-run, never read from reports
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const identity = JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(contractPath)), contract.identity), 'utf8'));
const cand = path.resolve(candidate), base = path.resolve(baseline);
const imp = (d, f) => import(pathToFileURL(path.join(d, f)).href);
const engines = { E11: await imp(base, 'src/engine.mjs'), EC: await imp(cand, 'src/engine.mjs'), G: await imp(cand, 'src/geometry.mjs') };
const F = await imp(cand, 'fixtures/synthetic-fixtures.mjs');
const FIX = JSON.parse(fs.readFileSync(path.join(cand, 'fixtures', 'r1-3-constructed-boundary-fixtures.json'), 'utf8'));
const scriptOf = { random: path.join(here, 'differential.mjs'), fixture: path.join(here, 'fixture-campaigns.mjs') };

const loadErrors = []; const reports = {};
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.report.json')).sort() : [];
if (!fs.existsSync(dir)) loadErrors.push({ check: 'campaign-dir', problem: `${dir} does not exist` });
for (const fname of files) {
  const stem = fname.slice(0, -'.report.json'.length); const p = (ext) => path.join(dir, `${stem}.${ext}`);
  const e = { files: { report: fname }, actual: { reportSha256: K.fileSha256(p('report.json')), recordsSha256: fs.existsSync(p('records.ndjson')) ? K.fileSha256(p('records.ndjson')) : null, stderrSha256: fs.existsSync(p('stderr.log')) ? K.fileSha256(p('stderr.log')) : null } };
  try { e.report = JSON.parse(fs.readFileSync(p('report.json'), 'utf8')); } catch (err) { e.reportError = `unreadable report (${err.message})`; }
  try { e.attestation = JSON.parse(fs.readFileSync(p('attestation.json'), 'utf8')); } catch (err) { e.attestationError = fs.existsSync(p('attestation.json')) ? `unreadable attestation (${err.message})` : 'no attestation file'; }
  if (fs.existsSync(p('records.ndjson'))) {
    try { const txt = fs.readFileSync(p('records.ndjson'), 'utf8'); if (txt.length && !txt.endsWith('\n')) throw new Error('records file does not end with a newline (truncated?)'); e.records = txt.split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
    catch (err) { e.recordsError = `unreadable records (${err.message})`; }
  } else e.recordsError = 'no records file';
  const id = e.report?.campaign ?? stem;
  if (id !== stem) loadErrors.push({ campaign: id, check: 'report-filename', problem: `${fname} claims campaign ${id}` });
  if (reports[id]) { loadErrors.push({ campaign: id, check: 'duplicate-campaign', problem: `${fname} duplicates campaign ${id}` }); continue; }
  reports[id] = e;
}
const perCampaign = {};
for (const req of contract.campaigns) {
  const e = reports[req.id]; if (!e) continue;
  e.expectedIdentity = { ...identity, harness: identity.harness?.[req.kind] };
  e.provenanceActual = K.provenanceOf({ candidate: cand, baseline: base, scripts: [scriptOf[req.kind]] });
  if (e.attestation && e.attestation.scriptSha256 !== e.expectedIdentity.harness?.[`baseline/${path.basename(scriptOf[req.kind])}`]) loadErrors.push({ campaign: req.id, check: 'harness-identity', problem: 'attested script hash differs from the expected identity' });
  if (!e.records) continue;
  const ctx = { F, FIX, C, protoDir: cand, fixtureCount: req.kind === 'fixture' ? K.fixtureSet(req.id, cand).length : null };
  const t = Date.now();
  try { e.verification = V.verifyCampaign(req, e.records, ctx, engines, mode); }
  catch (err) { loadErrors.push({ campaign: req.id, check: 'seed-regeneration', problem: `verification threw: ${err.message}` }); }
  perCampaign[req.id] = { records: e.records.length, regenerated: e.verification?.regen.generated, reverified: e.verification?.reverify.checked, evaluations: e.verification?.reverify.evaluations, ms: Date.now() - t };
}
const res = V.checkCampaignEvidence(contract, { loadErrors, reports, selfTests });
const out = { contract: contract.id, reverify: mode, selfTests, campaignsFound: Object.keys(reports), perCampaign, durationMs: Date.now() - T0, pass: res.pass, failures: res.failures };
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
