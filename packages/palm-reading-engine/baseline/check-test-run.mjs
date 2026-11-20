// AURA-PALM-G6-D0-R1.5 — test-inventory enforcement for an acceptance run (R1.5 §17).
// Usage: node check-test-run.mjs <test-inventory.json> <run log (node --test default reporter)> <exit code>
// PASS only if: the exit code is 0; every inventory test appears EXACTLY once and passed; no test outside the inventory
// ran; no test failed, was skipped, todo or cancelled; and the summary line counts equal the inventory size.
// A run that executed no tests (for example a mistyped command) therefore fails.
import fs from 'node:fs';

const [invPath, logPath, exitArg] = process.argv.slice(2);
const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
const log = fs.readFileSync(logPath, 'utf8').split('\n');
const strip = (l) => l.replace(/ \([0-9.]+m?s\)$/, '').replace(/ # (SKIP|TODO).*$/, '');
const passed = log.filter((l) => l.startsWith('✔ ')).map((l) => strip(l.slice(2)));
const failed = log.filter((l) => l.startsWith('✖ ')).map((l) => strip(l.slice(2))).filter((n) => !/^failing tests:$/.test(n));
const skipped = log.filter((l) => l.startsWith('﹣ ') || / # (SKIP|TODO)/.test(l));
const summary = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map((k) => [k, Number((log.find((l) => l.startsWith(`ℹ ${k} `)) || '').split(' ')[2])]));
const names = inv.tests.map((t) => t.name);
const count = (arr) => arr.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
const pc = count(passed);
const problems = [];
if (Number(exitArg) !== 0) problems.push(`exit code ${exitArg}`);
for (const n of names) if (pc.get(n) !== 1) problems.push(`inventory test ${pc.get(n) ? `passed ${pc.get(n)} times` : 'did not pass'}: ${n}`);
for (const n of pc.keys()) if (!names.includes(n)) problems.push(`test outside the inventory: ${n}`);
if (failed.length) problems.push(`${failed.length} failing test line(s)`);
if (skipped.length) problems.push(`${skipped.length} skipped/todo test line(s)`);
if (summary.tests !== names.length || summary.pass !== names.length || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0) problems.push(`summary ${JSON.stringify(summary)} ≠ inventory ${names.length}`);
const byOrigin = Object.fromEntries(Object.keys(inv.counts).filter((k) => k !== 'total').map((o) => [o, inv.tests.filter((t) => t.origin === o && pc.get(t.name) === 1).length]));
const out = { inventory: names.length, passedInventoryTests: names.filter((n) => pc.get(n) === 1).length, byOrigin, summary, exitCode: Number(exitArg), pass: problems.length === 0, problems };
console.log(JSON.stringify(out, null, 1));
process.exit(out.pass ? 0 : 1);
