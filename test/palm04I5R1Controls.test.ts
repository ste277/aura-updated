/**
 * AURA-PALM-04-I5-R1 -- negative controls for the 50362 findings, on the fast suites (no browser). Each control mutates
 * one source file IN MEMORY (test/palm04I5R1ControlPreload.cjs) and runs a real suite in a subprocess; the control is
 * DETECTED only if that suite exits non-zero AND the specific checks named below fail. (The browser-level controls,
 * including preview-failure-ignored and stale-playback-unguarded in Chrome, are in test/palm04I5CameraBrowser.test.ts.)
 *
 *   npx ts-node test/palm04I5R1Controls.test.ts
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
  { control: 'duplicate-acquisition', suite: 'test/palmG5I1PrivacyGate.test.ts', expect: [/^A4c-6\./], why: 'F2: a disguised second browser acquisition per start (reviewer control)' },
  { control: 'duplicate-acquisition', suite: 'test/palm04I5CameraAdapter.test.ts', expect: [/^H3\./], why: 'F2: the same, in the adapter suite' },
  { control: 'nonvideo-disabled', suite: 'test/palmG5I1PrivacyGate.test.ts', expect: [/^A4c-9\./], why: 'F2: the mixed video/audio refusal disabled (reviewer control)' },
  { control: 'nonvideo-disabled', suite: 'test/palm04I5CameraAdapter.test.ts', expect: [/^E1\./, /^H6\./], why: 'F2: the same, in the adapter suite' },
  { control: 'automatic-start', suite: 'test/palm04I5CameraJsdom.test.ts', jsdom: true, expect: [/^J21\./], why: 'F3: the camera started automatically on mount when supported (reviewer control)' },
  { control: 'preview-failure-ignored', suite: 'test/palm04I5CameraAdapter.test.ts', expect: [/^G1-reject\./], why: 'F1: a rejected preview playback ignored' },
  { control: 'preview-failure-ignored', suite: 'test/palm04I5CameraJsdom.test.ts', jsdom: true, expect: [/^J28\./], why: 'F1: the same, in the component' },
  { control: 'stale-playback-unguarded', suite: 'test/palm04I5CameraAdapter.test.ts', expect: [/^G5\./], why: 'F1: an older stream\'s late playback failure allowed to stop the newer stream' },
];
for (const k of CASES) {
  const r = runSuite(k.control, k.suite, !!k.jsdom);
  const hit = k.expect.every((re) => r.failed.some((f) => re.test(f)));
  check(`${k.control} -> ${path.basename(k.suite)}: DETECTED (${k.why}; expected failing ${k.expect.map(String).join(', ')})`, r.code !== 0 && hit, { code: r.code, failed: r.failed.slice(0, 6) });
}
console.log(`\nPALM-04-I5-R1 controls: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
