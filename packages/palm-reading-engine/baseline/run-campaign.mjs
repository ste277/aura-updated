// AURA-PALM-G6-D0-R1.5 — campaign runner with exit-status attestation (R1.4-RV-01: "missing exit-status evidence").
// Usage: node run-campaign.mjs <R1.1 prototype> <candidate prototype> <out-dir> <campaign-id> [--target=N] [--quick]
//                               [--seed=S]   (forgery experiments only: run seed S under label <campaign-id>)
//   random-<seed>  → baseline/differential.mjs (target default 6000)     fixtures-*  → baseline/fixture-campaigns.mjs
// Writes <out-dir>/<campaign-id>.{report.json,records.ndjson,stderr.log,attestation.json}. The attestation binds the
// exact command, the child's exit code/signal and the sha256 of the three output files; the contract requires it and
// re-checks every hash. Exits with the child's exit code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k) => (args.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const [p11, pc, outDir, id] = args.filter((a) => !a.startsWith('--'));
if (!p11 || !pc || !outDir || !id) { console.error('usage: run-campaign.mjs <R1.1> <candidate> <out-dir> <campaign-id> [--target=N] [--quick] [--seed=S]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(outDir, { recursive: true });
const f = (ext) => path.join(outDir, `${id}.${ext}`);
let script, argv;
if (id.startsWith('random-')) {
  const seed = opt('seed') || id.slice('random-'.length);
  script = path.join(here, 'differential.mjs');
  argv = [p11, pc, opt('target') || '6000', seed, `--records=${f('records.ndjson')}`, `--campaign=${id}`, ...(args.includes('--quick') ? ['--quick'] : [])];
} else if (id.startsWith('fixtures-')) {
  script = path.join(here, 'fixture-campaigns.mjs');
  argv = [p11, pc, id, `--records=${f('records.ndjson')}`];
} else { console.error(`unknown campaign kind: ${id}`); process.exit(2); }
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null);
const startedAt = new Date().toISOString();
const res = spawnSync(process.execPath, [script, ...argv], { encoding: 'buffer', maxBuffer: 1 << 30 });
fs.writeFileSync(f('report.json'), res.stdout || Buffer.alloc(0));
fs.writeFileSync(f('stderr.log'), res.stderr || Buffer.alloc(0));
const attestation = { schema: 'r1.5-campaign-attestation/1', campaign: id, script: path.basename(script), scriptSha256: sha(script), argv: argv.map((a) => (a.startsWith('--records=') ? `--records=${id}.records.ndjson` : a)),
  exitCode: res.status, signal: res.signal, error: res.error ? String(res.error) : null, startedAt, finishedAt: new Date().toISOString(), node: process.version,
  reportSha256: sha(f('report.json')), reportBytes: fs.statSync(f('report.json')).size, recordsSha256: sha(f('records.ndjson')), stderrSha256: sha(f('stderr.log')) };
fs.writeFileSync(f('attestation.json'), JSON.stringify(attestation, null, 1) + '\n');
console.log(`${id} exit=${res.status} signal=${res.signal}`);
process.exit(res.status ?? 1);
