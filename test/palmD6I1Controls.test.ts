/**
 * AURA-PALM-D6-I1 -- negative controls for the reading integration and DR-1 (in-memory source mutation through
 * test/palm04I5R1ControlPreload.cjs, real suites in subprocesses). A control is DETECTED only if the suite exits
 * non-zero AND the named checks fail (a crash is not a detection). Guard-amendment negatives (B2b one-module rule, F7
 * topic block) run inside test/palmG5I1PrivacyGate.test.ts (B2c / F7-neg).
 *
 *   npx ts-node test/palmD6I1Controls.test.ts
 */
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.join(__dirname, '..');
let passed = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) { passed++; console.log(`OK   ${name}`); } else { failures.push(name); console.log(`FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 400)}`}`); }
};
const TS_NODE = path.join(ROOT, 'node_modules/ts-node/dist/bin.js');
const PRELOAD = path.join(__dirname, 'palm04I5R1ControlPreload.cjs');
function runSuite(control: string, suite: string, jsdom: boolean): { code: number | null; failed: string[] } {
  const args = ['-r', PRELOAD, TS_NODE, ...(jsdom ? ['--project', 'tsconfig.jsdom-tests.json'] : []), suite];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PALM_I5_CONTROL: control }, timeout: 280000 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  if (/target not found|unknown control/.test(out)) throw new Error(`control ${control} did not apply: ${out.slice(0, 300)}`);
  return { code: r.status, failed: out.split('\n').filter((l) => l.startsWith('FAIL ')).map((l) => l.slice(5)) };
}
const CASES: Array<{ control: string; suite: string; jsdom?: boolean; expect: RegExp[]; why: string }> = [
  { control: 'd6-app-interpretation', suite: 'test/palmD6I1ReadingJsdom.test.ts', jsdom: true, expect: [/^R7\./], why: 'app-authored interpretation text added to a reading item' },
  { control: 'd6-stale-reading', suite: 'test/palmD6I1ReadingJsdom.test.ts', jsdom: true, expect: [/^R14\./], why: 'the reading outlives a changed confirmation' },
  { control: 'd6-keep-input', suite: 'test/palmD6I1Reading.test.ts', expect: [/^A3\./], why: 'the E1 input (with landmarks) kept after confirmation' },
  { control: 'd6-gate-bypass', suite: 'test/palmD6I1Reading.test.ts', expect: [/^A6\. gate closed \(production build\)/], why: 'the confirmed-scanner entry without its development gate' },
  { control: 'd6-synthetic-provenance', suite: 'test/palmD6I1Reading.test.ts', expect: [/^A1\./], why: 'a confirmed-scanner reading mislabelled as synthetic' },
  { control: 'd6r1-retain-landmarks', suite: 'test/palmD6I1R1RetentionJsdom.test.ts', jsdom: true, expect: [/^M5\./], why: 'R1 F1: the tracing panel keeps the 21 landmarks after confirmation' },
  { control: 'd6r1-textual-only-scan', suite: 'test/palmG5I1PrivacyGate.test.ts', expect: [/^B2c\. negative: F2 bypass/], why: 'R1 F2: the B2b scan reverted to the textual pattern that missed side-effect imports' },
  { control: 'dr1-timeout-removed', suite: 'test/palm04I5CameraAdapter.test.ts', expect: [/^K2\./], why: 'DR-1 start-up timer never armed' },
  { control: 'dr1-timeout-unguarded', suite: 'test/palm04I5CameraAdapter.test.ts', expect: [/^K5\./], why: 'a stale start-up timer may stop a newer session' },
];
for (const k of CASES) {
  const r = runSuite(k.control, k.suite, !!k.jsdom);
  const hit = k.expect.every((re) => r.failed.some((f) => re.test(f)));
  check(`${k.control} -> ${path.basename(k.suite)}: DETECTED (${k.why}; expected failing ${k.expect.map(String).join(', ')})`, r.code !== 0 && hit, { code: r.code, failed: r.failed.slice(0, 6) });
}
console.log(`\nPALM-D6-I1 controls: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
