/**
 * AURA-PALM-G5-I1-R4.3 -- ZIP recognition (R42-IV-F1) and nested-entry trust
 * (R42-IV-F2).
 *
 * F1: a ZIP that stock Info-ZIP `unzip` reads through its absolute-offset
 * fallback ("Compensating") must never yield a clean exit with zero archives
 * inspected. F2: a nested-archive exemption may only come from a STRICTLY
 * VALIDATED entry of the top-level archive (the one at the last EOCD).
 *
 * Runs the REAL scanner CLI (or PALM_SCANNER_UNDER_TEST) in throwaway trees
 * and its exported inspectArtifacts API (archive counts, reasons). Every F1
 * case logs: fixture sha256, stock `unzip -t` result (when unzip exists),
 * scanner exit, archives inspected and the reason. Synthetic benign fixtures
 * (test/palmG5I1R43Fixtures.ts); where a detection is required the payload is
 * a slice of the installed MediaPipe JS bundle, as in R4-R4.2. Nothing is
 * extracted or executed. No network. No real images.
 *
 * Run: npx ts-node test/palmG5I1R43ZipRecognition.test.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync, spawn, spawnSync } from 'child_process';
import * as F from './palmG5I1R43Fixtures';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps/web');
const SCANNER = process.env.PALM_SCANNER_UNDER_TEST || path.join(WEB, 'scripts/check-palmistry-bundle.js');
const MJS = fs.readFileSync(path.join(WEB, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'));
const SIG_AT = Math.max(0, MJS.indexOf(Buffer.from('odml.pa.googleapis.com')));
const RT = MJS.subarray(Math.max(0, SIG_AT - 20000), SIG_AT + 20000);
const HIT = /odml\.pa\.googleapis\.com|HandLandmarkerGraph|_mediapipeLoggerGetEncodedApiKey/;
const ABS = /absolute-offset fallback|reachable only through an absolute/;
const OUTSIDE = /outside the validated entries of the top-level archive/;

let passed = 0;
let failed = 0;
const notRun: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`OK   ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? `  -- ${detail}` : ''}`); }
}
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const hasTool = (t: string) => spawnSync('/usr/bin/which', [t], { encoding: 'utf8' }).status === 0;
const UNZIP = hasTool('unzip');

function makeTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r43-'));
  const web = path.join(tmp, 'apps/web');
  fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'packages/palmistry/src'), { recursive: true });
  fs.copyFileSync(SCANNER, path.join(web, 'scripts/check-palmistry-bundle.js'));
  fs.copyFileSync(path.join(WEB, 'palmistry-build-exclusion.js'), path.join(web, 'palmistry-build-exclusion.js'));
  fs.writeFileSync(path.join(tmp, 'packages/palmistry/src/review-status.json'), '{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}');
  fs.mkdirSync(path.join(web, '.next/static/chunks'), { recursive: true });
  fs.writeFileSync(path.join(web, '.next/static/chunks/main.js'), 'console.log("app")');
  fs.mkdirSync(path.join(web, 'public'), { recursive: true });
  return { tmp, web };
}
const cleanup = (tmp: string) => { if (path.basename(tmp).startsWith('palm-r43-') && path.dirname(tmp) === os.tmpdir()) fs.rmSync(tmp, { recursive: true, force: true }); };

/** Scanner child process; RSS sampled with `ps` every 25 ms; SIGKILL above `ceilingMiB` or after 120 s. */
function scanWithWatchdog(name: string, data: Buffer, ceilingMiB: number): Promise<{ code: number | null; killed: boolean; maxRssMiB: number; ms: number; out: string }> {
  const t = makeTree();
  fs.writeFileSync(path.join(t.web, 'public', name), data);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(t.web, 'scripts/check-palmistry-bundle.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let max = 0;
    let killed = false;
    const iv = setInterval(() => {
      try {
        const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim());
        if (kb > max) max = kb;
        if (kb / 1024 > ceilingMiB && !killed) { killed = true; child.kill('SIGKILL'); }
      } catch { /* exited */ }
    }, 25);
    const hard = setTimeout(() => { if (!killed) { killed = true; child.kill('SIGKILL'); } }, 120000);
    child.on('exit', (code) => { clearInterval(iv); clearTimeout(hard); cleanup(t.tmp); resolve({ code, killed, maxRssMiB: +(max / 1024).toFixed(1), ms: Date.now() - t0, out }); });
  });
}
interface Run { exit: number | null; archives: number; errors: string[]; hits: string[]; reason: string }
/** One file through the CLI (exit status) and the API (archives inspected, errors, hits), optional limit overrides. */
function run(name: string, data: Buffer, limits: Record<string, number> = {}): Run {
  const t = makeTree();
  try {
    fs.writeFileSync(path.join(t.web, 'public', name), data);
    const scannerPath = path.join(t.web, 'scripts/check-palmistry-bundle.js');
    const r = Object.keys(limits).length ? null : spawnSync(process.execPath, [scannerPath], { encoding: 'utf8', timeout: 120000 });
    const mod = require(scannerPath);
    const api = mod.inspectArtifacts(t.web, { ...mod.INSPECTION_LIMITS, ...limits });
    delete require.cache[require.resolve(scannerPath)];
    const errors = api.errors.map((e: any) => e.error);
    const hits = [...new Set<string>(api.hits.map((h: any) => h.sentinel))];
    const exit = r ? r.status : (errors.length || hits.length ? 1 : 0);
    return { exit, archives: api.stats.archives, errors, hits, reason: (errors[0] || hits[0] || '').replace('archive not fully inspectable: ', '') };
  } finally { cleanup(t.tmp); }
}
function unzipT(name: string, data: Buffer): string {
  if (!UNZIP) return 'NOT RUN (unzip absent)';
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r43-'));
  try {
    const f = path.join(d, name); fs.writeFileSync(f, data);
    const r = spawnSync('/usr/bin/unzip', ['-t', f], { encoding: 'utf8' });
    const o = (r.stdout || '') + (r.stderr || '');
    return `rc=${r.status}${/No errors detected/.test(o) ? ' "No errors detected"' : ''}${/Compensating/.test(o) ? ' (Compensating)' : ''}`;
  } finally { cleanup(d); }
}
const info = (id: string, name: string, data: Buffer, r: Run) => console.log(`INFO ${id} sha256=${sha(data)} unzip-t=[${unzipT(name, data)}] scanner exit=${r.exit} archivesInspected=${r.archives} reason="${r.reason.slice(0, 140)}"`);
/** F1-style: must fail closed (exit 1, >= 1 archive inspected), never a clean zero-archive pass. */
function mustFailClosed(id: string, label: string, name: string, data: Buffer, re: RegExp) {
  const r = run(name, data);
  info(id, name, data, r);
  check(`${id}. ${label} -> FAIL closed (not a clean zero-archive pass)`, r.exit === 1 && r.archives >= 1 && re.test(r.reason), `exit=${r.exit} archives=${r.archives} reason=${r.reason}`);
}
function mustPass(id: string, label: string, name: string, data: Buffer, archives: number) {
  const r = run(name, data);
  info(id, name, data, r);
  check(`${id}. ${label} -> PASS (${archives} archive(s) inspected)`, r.exit === 0 && r.archives === archives, `exit=${r.exit} archives=${r.archives} reason=${r.reason}`);
}

async function main(): Promise<void> {
  // ================================================================ F1: ZIP recognition (R42-IV-F1)
  const C = F.reviewerC().buf;
  check('R1a. fixture C is byte-identical to the R4.2 reviewer fixture', sha(C) === 'cad8cc801e437c82f8bd872cac45c83a321342abe526c32b6e0f16a8fb79a62b', sha(C));
  if (UNZIP) check('R1b. stock unzip reads fixture C ("Compensating", "No errors detected")', /No errors detected/.test(unzipT('c.zip', C)) && /Compensating/.test(unzipT('c.zip', C)), unzipT('c.zip', C)); else notRun.push('R1b');
  mustFailClosed('R1', '[R42-IV-F1 original] absolute offsets, cdSize +64, implausible local header', 'c.zip', C, ABS);
  const B = F.reviewerB().buf;
  check('R2a. fixture B is byte-identical to the R4.2 reviewer fixture', sha(B) === 'b6867a50936db5ea2ad4d693f2d1a011caefacff2dc9444bcdc57b76dcfa80eb');
  mustFailClosed('R2', 'same layout with a plausible local header (no longer depends on plausibility)', 'b.zip', B, ABS);
  for (const d of [1, 64, 4096, -10]) {
    const z = F.buildZip([{ name: 'hello.txt', data: F.HELLO, lver: 0xff }], { prefix: Buffer.alloc(64, 0x4a), absolute: true, cdSizeDelta: d }).buf;
    mustFailClosed(`R3.${d}`, `directory-size mutation ${d > 0 ? '+' : ''}${d} with absolute offsets`, 'm.zip', z, ABS);
  }
  for (const pre of [0, 1, 512]) {
    const z = F.buildZip([{ name: 'hello.txt', data: F.HELLO, lver: 0xff }], { prefix: Buffer.alloc(pre, 0x4a), absolute: true, cdSizeDelta: 33 }).buf;
    mustFailClosed(`R4.${pre}`, `absolute-offset fallback with a ${pre}-byte prefix`, 'p.zip', z, ABS);
  }
  mustFailClosed('R5', 'fixture C plus 100 trailing bytes', 't.zip', Buffer.concat([C, Buffer.alloc(100, 0x54)]), ABS);
  for (const v of [0, 20, 45, 63, 64, 0xff]) {
    const z = F.buildZip([{ name: 'hello.txt', data: F.HELLO, lver: v }], { prefix: Buffer.alloc(64, 0x4a), absolute: true, cdSizeDelta: 64 }).buf;
    mustFailClosed(`R6.${v}`, `local-header version byte ${v} (plausible or not, same outcome)`, 'v.zip', z, ABS);
  }
  { const z = F.buildZip([{ name: 'a.js', data: RT, lver: 0xff }], { prefix: Buffer.alloc(64, 0x4a), absolute: true, cdSizeDelta: 64 }).buf;
    mustFailClosed('R7', 'absolute-offset fallback ZIP whose entry is the deflated runtime (fails closed before inflation)', 'rt.zip', z, ABS); }
  mustFailClosed('R8', 'one EOCD, two central-directory candidates (relative -> a.txt, absolute -> b.txt)', 'two.zip', F.twoCdCandidates(Buffer.from('second\n')).buf, /relative and absolute offsets disagree/);
  { const c = Buffer.from(C); c.fill(0xff, 126 + 4, 126 + 46); mustFailClosed('R9', 'ambiguous: absolute CD record present but corrupt', 'k.zip', c, ABS); }
  mustFailClosed('R10', 'embedded: valid outer ZIP storing fixture C (nested recognition)', 'n.zip', F.buildZip([{ name: 'inner.zip', data: C, method: 0 }]).buf, ABS);
  mustFailClosed('R11', 'embedded: fixture C in a gzip FEXTRA field', 'x.gz', F.gzipWithExtra(Buffer.from('ok\n'), C), ABS);
  mustFailClosed('R12', 'embedded: fixture C as a tar entry', 'x.tar', F.tar([{ name: 'inner.zip', data: C }]), ABS);
  { const z = F.buildZip([{ name: 'hello.txt', data: F.HELLO, lver: 0xff }], { absolute: true, cdSizeDelta: 64, base: 512 }).buf;
    const t = F.tar([{ name: 'inner.bin', data: z }]);
    if (UNZIP) check('R13a. stock unzip reads the TAR file itself as a ZIP ("Compensating")', /No errors detected/.test(unzipT('ca.tar', t)), unzipT('ca.tar', t)); else notRun.push('R13a');
    mustFailClosed('R13', 'tar whose raw bytes are an absolute-offset ZIP (container coordinates)', 'ca.tar', t, ABS); }
  { const z = F.buildZip([{ name: 'hello.txt', data: F.HELLO, lver: 0xff }], { absolute: true, cdSizeDelta: 64, base: 12 }).buf;
    const g = F.gzipWithExtra(Buffer.from('ok\n'), z);
    if (UNZIP) check('R14a. stock unzip reads the GZIP file itself as a ZIP ("Compensating")', /No errors detected/.test(unzipT('ca.gz', g)), unzipT('ca.gz', g)); else notRun.push('R14a');
    mustFailClosed('R14', 'gzip whose raw bytes are an absolute-offset ZIP (container coordinates)', 'ca.gz', g, ABS); }
  { // >64 MiB path (largeFileHasPlausibleZip), exercised with a reduced maxArchiveBytes.
    const r = run('big.zip', C, { maxArchiveBytes: 100 });
    check('R15. archive-too-large path also fails closed for fixture C', r.errors.some((e) => /archive too large to inspect/.test(e)), JSON.stringify(r.errors)); }
  // False-positive controls
  mustPass('R16', 'standard ZIP', 's.zip', F.buildZip([{ name: 'hello.txt', data: F.HELLO }]).buf, 1);
  mustPass('R17', 'SFX-style prefix with relative offsets (valid)', 'sfx.zip', F.buildZip([{ name: 'hello.txt', data: F.HELLO }], { prefix: Buffer.alloc(64, 0x4a) }).buf, 1);
  mustPass('R18', 'prefix with consistent absolute offsets (zip -A style, valid)', 'abs.zip', F.buildZip([{ name: 'hello.txt', data: F.HELLO }], { prefix: Buffer.alloc(64, 0x4a), absolute: true }).buf, 1);
  for (const seed of [1, 2, 3]) mustPass(`R19.${seed}`, `signature-dense non-archive binary (seed ${seed}: 64 EOCD/CD signature bytes)`, 'noise.bin', F.signatureNoise(65536, seed), 0);
  mustPass('R20', 'plain text containing "PK"', 'a.txt', Buffer.from('PK PK\x05\x06 not an archive\n'), 0);
  { const mod = require(SCANNER); let n = 0; for (let s = 1; s <= 400; s++) if (mod.detectArchiveInBuffer(F.signatureNoise(16384 + (s % 7) * 4096, s * 2654435761 >>> 0))) n++;
    check('R21. 400 signature-dense random buffers: none classified as an archive', n === 0, `classified=${n}`); }

  { // R4.3 resource bound: 4,096 EOCDs whose relative AND absolute locations reach one 10,000-record chain.
    const rec = (lho: number) => { const r = Buffer.alloc(47); r.writeUInt32LE(0x02014b50, 0); r.writeUInt16LE(1, 28); r[46] = 0x61; r.writeUInt32LE(lho, 42); return r; };
    const chain = Buffer.concat(Array.from({ length: 10000 }, () => rec(0)));
    const eocds = Array.from({ length: 4096 }, (_, i) => { const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(10000, 8); e.writeUInt16LE(10000, 10); e.writeUInt32LE(chain.length + i * 22, 12); e.writeUInt32LE(47 * (i % 9000), 16); return e; });
    const w1 = Buffer.concat([chain, ...eocds]);
    const r = await scanWithWatchdog('w1.bin', w1, 512);
    console.log(`INFO R22 sha256=${sha(w1)} code=${r.code} killed=${r.killed} maxRSS=${r.maxRssMiB} MiB ms=${r.ms}`);
    check('R22. 4,096 EOCDs x 10,000-record chain: fails closed at the per-buffer record budget, bounded (< 200 MiB, < 30 s)', !r.killed && r.code === 1 && /too many ZIP central-directory records/.test(r.out) && r.maxRssMiB < 200 && r.ms < 30000, `code=${r.code} killed=${r.killed} rss=${r.maxRssMiB} ms=${r.ms} ${r.out.slice(0, 200)}`);
    const many = F.buildZip(Array.from({ length: 4000 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x'), method: 0 })));
    const rm = await scanWithWatchdog('many.zip', many.buf, 512);
    console.log(`INFO R23 entries=4000 code=${rm.code} maxRSS=${rm.maxRssMiB} MiB ms=${rm.ms}`);
    check('R23. a legitimate 4,000-entry ZIP still passes (the record budget does not block it; the pre-existing 4,096-signature cap is the effective entry limit)', !rm.killed && rm.code === 0, `code=${rm.code} ${rm.out.slice(0, 200)}`); }

  // ================================================================ F2: nested-entry trust (R42-IV-F2)
  const inner = F.buildZip([{ name: 'hello.txt', data: F.HELLO }]).buf;
  mustPass('T1', 'ZIP storing a valid ZIP inside a validated entry (recursively inspected)', 'n.zip', F.buildZip([{ name: 'inner.zip', data: inner, method: 0 }]).buf, 2);
  { const r = run('n.zip', F.buildZip([{ name: 'inner.zip', data: F.buildZip([{ name: 'a.js', data: RT }]).buf, method: 0 }]).buf);
    check('T2. legitimate nested ZIP holding the runtime: inner archive is inspected (hit)', r.exit === 1 && r.archives === 2 && r.hits.some((h) => HIT.test(h)), JSON.stringify(r)); }
  { const d = F.f2Decoy(Buffer.from('competing archive\n'.repeat(8))).buf; if (UNZIP) check('T3a. stock unzip reads the COMPETING archive of the decoy fixture', /No errors detected/.test(unzipT('d.zip', d))); else notRun.push('T3a');
    mustFailClosed('T3', '[R42-IV-F2] competing ZIP "nested" only inside an UNVALIDATED decoy entry claiming a huge size (Z2 appended)', 'd.zip', d, OUTSIDE); }
  { const d = F.f2Decoy(Buffer.from('competing archive\n'.repeat(8)), { z2LocalsInside: true }).buf; if (UNZIP) check('T4a. stock unzip reads the COMPETING archive (locals inside the stored entry)', /No errors detected/.test(unzipT('d2.zip', d))); else notRun.push('T4a');
    mustFailClosed('T4', '[R42-IV-F2] same, Z2 local header inside the top archive\'s stored entry (exemption decision reached)', 'd2.zip', d, OUTSIDE); }
  { const z = F.buildZip([{ name: 'x.txt', data: Buffer.from('nested\n') }]); const locals = z.buf.subarray(0, z.facts.cdAt), tail = z.buf.subarray(z.facts.cdAt);
    mustFailClosed('T5', 'nested ZIP crossing a validated entry boundary (locals in entry 1, CD+EOCD in entry 2)', 'x.zip', F.buildZip([{ name: 'p1.bin', data: locals, method: 0 }, { name: 'p2.bin', data: tail, method: 0 }]).buf, OUTSIDE); }
  mustFailClosed('T6', 'nested ZIP inside a DIRECTORY entry (not a validated file entry)', 'dir.zip', F.buildZip([{ name: 'd/', data: inner, method: 0, attr: 0o040755 }]).buf, OUTSIDE);
  { // False entry-size claim: CD csize covers an inner ZIP placed after the real data; the local header disagrees.
    const realData = Buffer.from('small\n');
    const z = F.buildZip([{ name: 'e.bin', data: realData, method: 0, csizeOverride: realData.length + inner.length }], { between: inner });
    mustFailClosed('T7', 'false entry-size claim in the central directory (local header disagrees)', 'fc.zip', z.buf, /disagrees with central directory|size mismatch|unreferenced/); }
  { const realData = Buffer.from('small\n');
    const z = F.buildZip([{ name: 'e.bin', data: realData, method: 0, lcsize: realData.length + inner.length }], { between: inner });
    mustFailClosed('T8', 'conflicting sizes: local header claims more than the central directory', 'fl.zip', z.buf, /disagrees with central directory|unreferenced/); }
  { const z = F.buildZip([{ name: 'inner.zip', data: inner, method: 0, flags: 8, descriptor: Buffer.from('BADDESCRIPTOR!!!') }]);
    mustFailClosed('T9', 'enclosing entry with an invalid data descriptor', 'dd.zip', z.buf, /data descriptor|disagrees/); }
  { const z = F.buildZip([{ name: 'inner.zip', data: inner, method: 0, csizeOverride: inner.length + 40, lcsize: inner.length + 40 }]);
    mustFailClosed('T10', 'truncated enclosing entry (claimed data runs into the central directory)', 'tr.zip', z.buf, /truncated ZIP entry|malformed|size mismatch/); }
  { const d2 = F.buildZip([{ name: 'l2.zip', data: inner, method: 0 }]).buf;
    mustPass('T11', 'stored nesting at the depth limit (3 levels)', 'd3.zip', F.buildZip([{ name: 'l1.zip', data: d2, method: 0 }]).buf, 3);
    const r = run('d4.zip', F.buildZip([{ name: 'l0.zip', data: F.buildZip([{ name: 'l1.zip', data: d2, method: 0 }]).buf, method: 0 }]).buf);
    check('T12. stored nesting beyond the depth limit (4 levels) fails closed', r.exit === 1 && /nested archive beyond the depth limit/.test(r.reason), JSON.stringify(r)); }
  if (hasTool('zip')) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'palm-r43-'));
    try {
      fs.writeFileSync(path.join(d, 'hello.txt'), F.HELLO);
      execFileSync('zip', ['-q', 'inner.zip', 'hello.txt'], { cwd: d });
      execFileSync('zip', ['-q', 'outer.zip', 'inner.zip'], { cwd: d });
      const o = fs.readFileSync(path.join(d, 'outer.zip'));
      if (UNZIP) check('T13a. stock unzip -t accepts the stock nested archive', /No errors detected/.test(unzipT('outer.zip', o))); else notRun.push('T13a');
      mustPass('T13', 'stock `zip outer.zip inner.zip` (stored member) is recursively inspected', 'outer.zip', o, 2);
    } finally { cleanup(d); }
  } else { notRun.push('T13'); console.log('NOT RUN T13 (zip not available)'); }

  console.log(`\n${passed} passed, ${failed} failed${notRun.length ? `, ${notRun.length} NOT RUN (${notRun.join(', ')})` : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
