// AURA-ANDROID-REL-04 R4 evidence tool: runs the `npx ts-node` test commands of the given CI jobs
// exactly as listed in .github/workflows/ci.yml (step env included), one at a time, and writes
// per-command logs plus a manifest (head SHA, tree state, node version, command, env, exit, duration, log sha256).
// Usage: node test/evidence-tools/runSweep.mjs <outDir> <job>[,<job>...] [KEY=VALUE ...extra env]
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [outDir, jobsArg, ...extra] = process.argv.slice(2);
const jobs = new Set(jobsArg.split(','));
const extraEnv = Object.fromEntries(extra.map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
const steps = execSync('python3 test/evidence-tools/ciCommands.py', { encoding: 'utf8' }).trim().split('\n').map((l) => JSON.parse(l)).filter((s) => jobs.has(s.job));
const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain --untracked-files=no -- apps packages test .github package.json package-lock.json', { encoding: 'utf8' }).trim();
const manifest = { head, codeTreeClean: dirty === '', node: process.version, startedAt: new Date().toISOString(), jobs: [...jobs], extraEnvKeys: Object.keys(extraEnv), commands: [], skipped: [] };
let n = 0;
for (const s of steps) {
  if (!/^npx ts-node /.test(s.run) || s.run.includes('\n')) { manifest.skipped.push({ job: s.job, name: s.name, run: s.run.split('\n')[0] }); continue; }
  n++;
  const log = path.join('logs', `${String(n).padStart(3, '0')}-${s.run.split(' ').pop().replace(/[^A-Za-z0-9.]+/g, '_')}.log`);
  const t0 = Date.now();
  const r = spawnSync('sh', ['-c', s.run], { env: { ...process.env, ...extraEnv, ...s.env }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 900_000 });
  const text = `$ ${s.run}\n# job=${s.job} step=${s.name} env=${JSON.stringify(s.env)}\n${r.stdout ?? ''}${r.stderr ?? ''}\n# exit=${r.status} signal=${r.signal ?? ''}\n`;
  fs.writeFileSync(path.join(outDir, log), text);
  manifest.commands.push({ n, job: s.job, name: s.name, run: s.run, env: s.env, exit: r.status, signal: r.signal, ms: Date.now() - t0, log, logSha256: createHash('sha256').update(text).digest('hex') });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
manifest.finishedAt = new Date().toISOString();
manifest.summary = { run: manifest.commands.length, passed: manifest.commands.filter((c) => c.exit === 0).length, failed: manifest.commands.filter((c) => c.exit !== 0).map((c) => `${c.n} ${c.run}`) };
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest.summary, null, 2));
