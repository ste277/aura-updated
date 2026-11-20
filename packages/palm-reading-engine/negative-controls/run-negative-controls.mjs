// AURA-PALM-G6-D0-R1.5 — negative-control harness: the 59 R1.4 controls (re-anchored where R1.5 moved the code they
// mutate; every re-anchoring is noted inline) plus the R1.5 controls. Modes:
//   tests        mutate a disposable copy of the prototype; run r1-, r1-1-, r1-2-, r1-3-, r1-4- and r1-5-hardening;
//                detection = every EXPECTED (intended) test fails.
//   differential mutate a disposable copy of prototype/ + baseline/; run the quick campaign (seed 7, target 300) with
//                baseline/run-campaign.mjs in the copy, then the FROZEN checker (quick contract, full re-verification)
//                on its output; detection = non-zero exit AND every expected check (campaign or contract) fails.
//   contract     forge COPIES of a genuine quick campaign set (seeds 7/8/9 at target 300 + the three fixture
//                campaigns, generated at the start of the run by the frozen runner) — or produce genuine but wrong
//                campaigns — and run the FROZEN checker with the quickset contract; detection = non-zero exit AND
//                every expected contract check fails. Control NC-C0 (the unforged set) must PASS.
// // Usage: node run-negative-controls.mjs <empty-scratch-dir>   Writes only inside <scratch>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const R1_PROTO = path.resolve(here, '..', 'prototype');
const G6 = path.resolve(here, '..', 'vendor', 'AURA_PALM_G6_D0_READING_ENGINE_DESIGN'); // G6-I1: hash-pinned vendored copy
const ADAPTER = path.resolve(here, '..', 'adapter');
const VENDOR = path.resolve(here, '..', 'vendor');
const scratch = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(scratch) || fs.readdirSync(scratch).length) { console.error('usage: node run-negative-controls.mjs <existing EMPTY scratch dir>'); process.exit(2); }

const treeHash = (dir) => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
  walk(dir);
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(path.relative(dir, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  return h.digest('hex');
};

const CONTROLS = [
  // ---- R1 controls (anchors adapted where R1.1 changed the surrounding line) ----
  { id: 'NC-1', finding: 'R1-F1 unsafe crease identifier handling', desc: 'finalize() lints every string again (identifiers included), as in G6-D0.',
    file: 'src/engine.mjs', from: "if (typeof v === 'string') { if (USER_TEXT_KEYS.has(key)) hits.push(...lintText(v, key)); }", to: "if (typeof v === 'string') { hits.push(...lintText(v, key)); }",
    expect: ['R1-F1: identifier "death"'] },
  { id: 'NC-1b', finding: 'R1-F1 reserved identifiers', desc: 'Remove the reserved-id check.',
    file: 'src/schema.mjs', from: "&& !RESERVED_IDS.includes(id.toLowerCase());", to: ';', also: { from: "else if (RESERVED_IDS.includes(c.id.toLowerCase())) err(", to: 'else if (false) err(' },
    expect: ['R1-F1: duplicate ids are rejected; reserved ids', 'R1-F1: conflict ids are identifier-checked'] },
  { id: 'NC-1c', finding: 'R1-F1 non-total entry point (R1.1: the protection now lives in snapshotInput)', desc: 'Remove the try/catch in snapshotInput (adapted: R1 targeted the try/catch around validateFeatures, which the snapshot now precedes).',
    file: 'src/snapshot.mjs', from: "  try { value = copy(input, INPUT_SHAPE, '$', err); }\n  catch { err('$', 'unreadable-input', 'The feature payload could not be read.'); }", to: "  value = copy(input, INPUT_SHAPE, '$', err);",
    expect: ['HOSTILE: Proxies with throwing traps'] },
  { id: 'NC-2', finding: 'R1-F2 unsafe detector-name lookup', desc: 'ownLookup() becomes a plain bracket lookup and registries get Object.prototype again.',
    file: 'src/schema.mjs', from: "export const ownLookup = (table, key) => (typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);", to: 'export const ownLookup = (table, key) => table[key];',
    also: { from: 'export const safeTable = (entries) => Object.freeze(Object.assign(Object.create(null), entries));', to: 'export const safeTable = (entries) => Object.freeze({ ...entries });' },
    expect: ['R1-F2: prototype-property detector names', 'R1-F2: registries are null-prototype'] },
  { id: 'NC-3', finding: 'R1-F3 gapsBridged interpreted as breaks', desc: 'F-TC-BREAKS value restored to G6-D0: breaks + (gapsBridged >= 2 ? 1 : 0).',
    file: 'src/rules.mjs', from: '    value: (c) => c.breaks.TC, margin: 0,', to: '    value: (c) => c.crease.TC.continuity.breaks + (c.crease.TC.continuity.gapsBridged >= 2 ? 1 : 0), margin: 0,',
    expect: ['R1-F3: gapsBridged = 0, 1, 2', 'R1-F3: no rule reads gapsBridged'] },
  { id: 'NC-4', finding: 'R1-F4 unknown orientation producing unsupported "clear"', desc: 'Frame gating and the palm-side cap disabled (anchor adapted: R1.1 added the axis term to the same line).',
    file: 'src/engine.mjs', from: "  const frameReasons = [...(family.frame.direction ? frame.directionReasons : []), ...(family.frame.scale ? frame.scaleReasons : []), ...(family.frame.axis ? frame.axisReasons : [])];", to: '  const frameReasons = [];',
    also: { from: "  if (frame.palmSideCap) frameCaps.push('orientation-unconfirmed');", to: '' },
    expect: ['R1-F4: unknown handedness declines', 'R1-F4: unknown orientation (palmFacing null)', 'R1-F4: both unknown', 'R1-F4: research-detector cap and threshold'] },
  { id: 'NC-5', finding: 'R1-F5 incorrect point-order handling', desc: 'Polyline plausibility disabled and endpoint ties never ambiguous (anchors adapted to the R1.1 comparison helpers).',
    file: 'src/schema.mjs', from: "  if (below(len, GEOMETRY_CONTRACT.minLength)) return 'degenerate';", to: "  if (below(len, GEOMETRY_CONTRACT.minLength)) return 'degenerate';\n  return null;",
    also: { file: 'src/geometry.mjs', from: '  if (atMost(Math.abs(b - a), TIE)) return', to: '  if (false) return' },
    expect: ['R1-F5: unordered, doubling-back', 'R1-F5: ambiguous endpoints decline'] },
  // ---- R1.1 controls ----
  { id: 'NC-6', finding: 'R1-RV-02 re-reading caller-owned input', desc: 'After snapshotting, the engine works on the raw argument again.',
    file: 'src/engine.mjs', from: '  const input = snap.value;', to: '  const input = rawInput;',
    expect: ['R1-RV-02: the engine reads the caller object once', 'R1-RV-02: the engine never consults the raw argument'] },
  { id: 'NC-7', finding: 'R1-RV-02 unsafe accessor / Proxy handling', desc: 'readOwn() reads through [[Get]] (invoking getters) instead of own data descriptors.',
    file: 'src/snapshot.mjs', from: '  const d = Reflect.getOwnPropertyDescriptor(o, k);\n  if (d === undefined) return { present: false };', to: '  if (!Object.prototype.hasOwnProperty.call(o, k)) return { present: false };\n  const d = { value: o[k], enumerable: true };',
    expect: ['HOSTILE: accessors are rejected without being invoked'] },
  { id: 'NC-8', finding: 'R1-RV-01 reversal-dependent verticality', desc: 'Restore the R1 formula (signed atan2 from first/last) and gate on the 4-dp rounded value.',
    file: 'src/geometry.mjs', from: '  return (Math.atan2(Math.abs(last.x - first.x), Math.abs(last.y - first.y)) * 180) / Math.PI;', to: '  return Math.abs(90 - Math.abs((Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI));',
    also: { file: 'src/engine.mjs', from: '    .filter(({ c }) => atMost(verticalDeviation(c.geometry.points), GEOMETRY_CONTRACT.centralMaxVerticalDeviationDeg)) // raw value, inclusive', to: '    .filter(({ d }) => d.verticalDeviationDeg <= 30)' },
    expect: ['R1-RV-01: the reviewer counterexample'] },
  { id: 'NC-9', finding: 'R1-RV-03 inconsistent endpoint comparison', desc: 'Endpoint tie compared with a bare IEEE <= 0.01 (no shared eps rule).',
    file: 'src/geometry.mjs', from: '  if (atMost(Math.abs(b - a), TIE)) return', to: '  if (Math.abs(b - a) <= TIE) return',
    expect: ['R1-RV-03: nominal 0.01 endpoint gaps'] },
  { id: 'NC-10a', finding: 'R1-RV-04 incorrect point-order acceptance (over-acceptance)', desc: 'The doubling-back (turn) check is removed.',
    file: 'src/schema.mjs', from: "    if (above((Math.acos(cos) * 180) / Math.PI, GEOMETRY_CONTRACT.maxTurnDeg)) return 'doubles-back';", to: '    void cos;',
    expect: ['R1-F5: unordered, doubling-back', 'R1-RV-03: the same comparison rule applies'] }, // strong zig-zags are ALSO caught by tortuosity/self-crossing, so the R1-RV-04 rejection test stays green
  { id: 'NC-10b', finding: 'R1-RV-04 policy B (over-rejection)', desc: 'An arbitrary smoothness threshold (60° turns) rejects legitimate gentle zig-zags and staircases.',
    file: 'src/schema.mjs', from: "    if (above((Math.acos(cos) * 180) / Math.PI, GEOMETRY_CONTRACT.maxTurnDeg)) return 'doubles-back';", to: "    if (above((Math.acos(cos) * 180) / Math.PI, 60)) return 'doubles-back';",
    expect: ['R1-RV-04: smooth curves, reversed curves, mild zig-zags'] },
  { id: 'NC-11', finding: 'R1-RV-05 ignored rotation conflict', desc: 'The axis frame requirement is ignored (fate-line rule evaluated despite conflicting rotation) and rotation conflict is not recorded.',
    file: 'src/engine.mjs', from: ', ...(family.frame.axis ? frame.axisReasons : [])];', to: '];',
    also: { from: "  if (rotatedFlag !== rotatedAngle) axisReasons.push('rotation-conflict');\n  else if (rotatedAngle) axisReasons.push('rotation-out-of-range');", to: '' },
    expect: ['R1-RV-05: conflicting or out-of-range rotation'] },
  { id: 'NC-12', finding: 'R1-RV-07 hypothesis cap not traced (sixth MINOR)', desc: 'Remove the hypothesis-capped trace push.',
    file: 'src/engine.mjs', from: " if (!caps.includes('hypothesis-capped')) caps.push('hypothesis-capped'); }", to: ' }',
    expect: ['R1-RV-07: every hypothesis family'] },
  { id: 'NC-13', finding: 'G6-D0 RV-09 / RV-10 open schema', desc: 'Unknown fields are silently skipped instead of rejected.',
    file: 'src/snapshot.mjs', from: "    if (!known && !marker) { err(`${path}.${k.length > 40 ? `${k.slice(0, 40)}…` : k}`, 'unknown-field', 'This field is not part of the feature contract.'); continue; }", to: '    if (!known && !marker) continue;',
    expect: ['RV-10: unknown keys', 'RV-09: the input hash'] },
  // ---- R1.2 controls ----
  { id: 'NC-14', finding: 'R1.1-RV-01 order-dependent fate-line centre', desc: 'describe() works on the supplied order (no canonical sequence) and the centre gate checks only one order.',
    file: 'src/geometry.mjs', from: '  const pts = canonicalSequence(collapseDuplicates(points));', to: '  const pts = collapseDuplicates(points);',
    also: { file: 'src/engine.mjs', from: 'const byOrder = [inCentre(xs[0]), inCentre(xs[xs.length - 1])];', to: 'const byOrder = [inCentre(m.d.centroid.x), inCentre(m.d.centroid.x)];' }, // R1.3: anchor adapted to the rewritten centre gate
    expect: ['R1.1-RV-01(a): the fate-line centre counterexample', 'R1.3 REVERSAL'] },
  { id: 'NC-15', finding: 'R1.1-RV-01 order-dependent length', desc: 'describe() works on the supplied order and the length tie values are ignored.',
    file: 'src/geometry.mjs', from: '  const pts = canonicalSequence(collapseDuplicates(points));', to: '  const pts = collapseDuplicates(points);',
    also: { file: 'src/engine.mjs', from: '  const tv = family.tieValues ? family.tieValues(c) : null;', to: '  const tv = null;' },
    expect: ['R1.1-RV-01(b): the PTC length counterexample', 'TIE RULE: PTC-length reviewer case'] },
  { id: 'NC-15b', finding: 'Owner condition: no upgrade over R1.1 (tie rule removed, canonical order kept)', desc: 'The conservative length tie rule is disabled; only the canonical order decides (the rejected design).',
    file: 'src/engine.mjs', from: '  const tv = family.tieValues ? family.tieValues(c) : null;', to: '  const tv = null;',
    expect: ['TIE RULE: PTC-length reviewer case'] },
  { id: 'NC-16', finding: 'R1.1-RV-03 error cap removed', desc: 'Every error is kept and listed.',
    file: 'src/snapshot.mjs', from: '    if (errors.length < MAX_REPORTED_ERRORS) errors.push({ path, code, msg });', to: '    errors.push({ path, code, msg });',
    also: { file: 'src/engine.mjs', from: '  const listed = allErrors.slice(0, MAX_REPORTED_ERRORS);', to: '  const listed = allErrors.slice(0);' },
    expect: ['R1.1-RV-03: error output is capped'] },
  { id: 'NC-17', finding: 'R1.1-RV-03 truncation reporting removed', desc: 'The errors-truncated marker is dropped (the list silently looks complete).',
    file: 'src/engine.mjs', from: "  const errors = omitted > 0 ? [...listed, { path: '$', code: 'errors-truncated', msg: 'Further validation errors were found but are not listed.', omitted }] : listed;", to: '  const errors = listed;',
    expect: ['R1.1-RV-03: error output is capped'] },
  { id: 'NC-18', finding: 'R1.1-RV-03 invalid input accepted after reaching the cap', desc: 'Validity decided on the capped list: more errors than the cap no longer invalidate the input.',
    file: 'src/engine.mjs', from: '  if (errorCount > 0) return invalidReading([...snap.errors, ...v.errors], errorCount, hash);', to: '  if (errorCount > 0 && errorCount <= MAX_REPORTED_ERRORS) return invalidReading([...snap.errors, ...v.errors], errorCount, hash);',
    expect: ['R1.1-RV-03: invalid input stays invalid when truncated'] },
  { id: 'NC-19', finding: 'R1.1-RV-04 rotation-conflict decline removed', desc: 'A disagreement between the hand-rotated flag and the angle no longer makes the axis unreliable.',
    file: 'src/engine.mjs', from: "  if (rotatedFlag !== rotatedAngle) axisReasons.push('rotation-conflict');\n  else if (rotatedAngle) axisReasons.push('rotation-out-of-range');", to: "  if (rotatedFlag && rotatedAngle) axisReasons.push('rotation-out-of-range');",
    expect: ['R1.1-RV-04: runtime agrees with the spec at 45° boundaries'] },
  { id: 'NC-20', finding: 'Unsupported confidence upgrade', desc: 'The tentative cap is raised to the clear threshold (research/uncalibrated/hypothesis evidence can reach "clear").',
    file: 'src/policy.mjs', from: 'export const TENTATIVE_CAP = 0.74;', to: 'export const TENTATIVE_CAP = 0.75;',
    expect: ['PRESERVED: thresholds, tentative cap and the 0.49996 boundary'] },

  // ---- R1.3 controls (ticket §14 items 1–16) ----
  { id: 'NC-21', finding: '§14.1 drop a competing candidate before conflict detection', desc: 'Only candidates passing in BOTH orders compete (the R1.2 defect).',
    file: 'src/engine.mjs', from: '  const competitors = considered.filter((m) => m.passEither);', to: '  const competitors = considered.filter((m) => m.passBoth);',
    expect: ['R1.3 RV-01: competing creases', 'R1.3 NO-UPGRADE'] },
  { id: 'NC-22', finding: '§14.2 emit a claim when only one order qualifies (centre)', desc: 'A sole candidate passing in one order only is identified.',
    file: 'src/engine.mjs', from: '  else if (!sole.passBoth) state.CENTRAL_LONGITUDINAL', to: '  else if (false) state.CENTRAL_LONGITUDINAL',
    expect: ['R1.3 NO-UPGRADE', 'R1.3 RV-01: competing creases'] },
  { id: 'NC-23', finding: '§14.3 emit tentative instead of no claim (length)', desc: 'Readings from the two orders are unioned (the R1.2 rule) instead of intersected.',
    file: 'src/engine.mjs', from: '      const common = ids1.filter((id) => ids2.includes(id));', to: '      const common = [...new Set([...ids1, ...ids2])];',
    expect: ['R1.3 NO-UPGRADE', 'R1.3 RV-02: the decision-table rows'] },
  { id: 'NC-24', finding: '§14.4 accept validity from only the canonical order', desc: 'polylineProblem checks the canonical order only (the R1.2 defect).',
    file: 'src/schema.mjs', from: '  return problemInOrder(c) ?? problemInOrder([...c].reverse());', to: '  return problemInOrder(c);',
    expect: ['R1.3 NO-UPGRADE', 'R1.3 RV-03'] },
  { id: 'NC-25', finding: '§14.5 skip one reversal direction', desc: 'The "other order" used for tie detection is the same order (ties never detected).',
    file: 'src/geometry.mjs', from: '  const other = [...pts].reverse();', to: '  const other = pts;',
    expect: ['R1.3 FIXTURES', 'R1.3 NO-UPGRADE'] },
  { id: 'NC-26', finding: '§14.6 upgrade tentative to clear', desc: 'A tie whose orders differ only in ambiguity keeps the less ambiguous (clear) tier.',
    file: 'src/engine.mjs', from: "      ambiguous = true; caps.push('order-tie');\n      orderTie = { values: [...tv], selections, resolution: 'common-reading-tentative' };", to: "      ambiguous = s1.ambiguous && s2.ambiguous; caps.push('order-tie');\n      orderTie = { values: [...tv], selections, resolution: 'common-reading-tentative' };",
    expect: ['R1.3 NO-UPGRADE'] },
  { id: 'NC-27', finding: '§14.7 ignore claim presence during comparison', desc: 'The oracle stops flagging no-claim → claim.',
    file: 'test/oracle.mjs', from: "      out.push({ kind: 'claim-presence-upgrade', family: fam, to: it.tier });", to: '      void 0;',
    expect: ['R1.3 ORACLE'] },
  { id: 'NC-28', finding: '§14.8 ignore invalid-to-valid transitions', desc: 'The oracle stops flagging invalid → valid.',
    file: 'test/oracle.mjs', from: "  if (candidate.valid && !baseline.valid) out.push({ kind: 'invalid-to-valid' });", to: '',
    expect: ['R1.3 ORACLE'] },
  { id: 'NC-29', finding: '§14.9 use the defective RNG', desc: 'The differential uses the R1.2 floating-point LCG.', mode: 'differential', target: 1000,
    file: 'test/campaign-core.mjs', from: 'const rnd = mulberry32(SEED);', to: 'let __s = SEED; const rnd = () => { __s = (__s * 1103515245 + 12345) % 2147483648; return __s / 2147483648; };', // R1.5: generator moved verbatim to test/campaign-core.mjs
    expect: ['targetReached'] },
  { id: 'NC-30', finding: '§14.10 misreport generated cases as distinct', desc: 'The reported distinct count is the generated count.', mode: 'differential',
    file: 'baseline/differential.mjs', from: 'counts.canonicalDistinct = seenCanon.size;', to: 'counts.canonicalDistinct = counts.generated;', // R1.4: anchor re-pointed to the canonical counter
    expect: ['distinctAudit'] },
  { id: 'NC-31', finding: '§14.11 omit constructed tie cases', desc: 'No constructed ties are injected.', mode: 'differential',
    file: 'test/campaign-core.mjs', from: 'const INJECT = { lengthTie: true, centreAndFateTie: true,', to: 'const INJECT = { lengthTie: false, centreAndFateTie: false,', // R1.5: moved to campaign-core
    expect: ['min-outcomeRelevantTies'] }, // R1.4: coverage floors moved to the contract (quick contract applied)
  { id: 'NC-32', finding: '§14.12 omit competing-crease cases', desc: 'No competing creases are injected.', mode: 'differential',
    file: 'test/campaign-core.mjs', from: ' competitor: true, validity: true };', to: ' competitor: false, validity: true };', // R1.5: moved to campaign-core
    expect: ['min-competingConflicts'] }, // R1.4: coverage floors moved to the contract (quick contract applied)
  { id: 'NC-33', finding: '§14.13 suppress a conflict trace', desc: 'The centre-order-tie trace is dropped from conflict results.',
    file: 'src/engine.mjs', from: "detail: 'Several vertical minor creases compete.', ...tieTrace };", to: "detail: 'Several vertical minor creases compete.' };",
    expect: ['R1.3 RV-01: competing creases'] },
  { id: 'NC-34', finding: '§14.14 disable the error truncation marker', desc: 'The errors-truncated entry is dropped.',
    file: 'src/engine.mjs', from: "  const errors = omitted > 0 ? [...listed, { path: '$', code: 'errors-truncated', msg: 'Further validation errors were found but are not listed.', omitted }] : listed;", to: '  const errors = listed;',
    expect: ['R1.1-RV-03: error output is capped', 'R1.3 RV-03'] },
  { id: 'NC-35', finding: '§14.15 change a policy threshold', desc: 'The clear threshold drops from 0.75 to 0.7.',
    file: 'src/policy.mjs', from: '  clear: 0.75,', to: '  clear: 0.7,',
    expect: ['R1.3 PRESERVED', 'PRESERVED: thresholds'] },
  { id: 'NC-36', finding: '§14.16 detector pin drift (pin check must catch it)', desc: 'The D3-B registry pin changes from D3B-C to D3B-D.',
    file: 'src/schema.mjs', from: "    versions: Object.freeze(['D3B-C']), status: 'research-experimental',", to: "    versions: Object.freeze(['D3B-D']), status: 'research-experimental',",
    expect: ['R1.3 PRESERVED'] },
  // ---- R1.4 controls ----
  { id: 'NC-37', finding: 'R1.3-RV-03 / §17.1 intersection→union oracle weakening (the R1.3 reviewer\'s M2)', desc: 'The meet unites rule sets across orientations instead of intersecting them.',
    file: 'test/oracle.mjs', from: '.reduce((a, b) => a.filter((x) => b.includes(x)));', to: '.reduce((a, b) => [...new Set([...a, ...b])]);',
    expect: ['R1.3 ORACLE', 'R1.4 RV-03: the oracle self-test'] },
  { id: 'NC-38', finding: '§17.2 missing comparison floor', desc: 'The contract stops checking the minimum orientation comparisons.',
    file: 'test/coverage.mjs', from: "    if (!(c.orientationComparisons >= req.minOrientationComparisons)) fail(req.id, 'min-orientation-comparisons', `${c.orientationComparisons} < ${req.minOrientationComparisons}`);", to: '',
    expect: ['R1.4 RV-03: the coverage contract rejects'] },
  { id: 'NC-39', finding: '§17.3 missing campaign', desc: 'The contract silently skips a missing campaign.',
    file: 'test/coverage.mjs', from: "    if (!r) { fail(req.id, 'campaign-present', 'report missing'); continue; }", to: '    if (!r) continue;',
    expect: ['R1.4 RV-03: the coverage contract rejects'] },
  { id: 'NC-40', finding: '§17.4 duplicate-only campaign', desc: 'The contract stops checking for a duplicate-only campaign.',
    file: 'test/coverage.mjs', from: "    if (!(c.canonicalDistinct > 0) || c.canonicalDistinct * 2 < (req.minCanonicalDistinct || 1)) fail(req.id, 'not-duplicate-only', 'no distinct cases');", to: '',
    expect: ['R1.4 RV-03: the coverage contract rejects'] },
  { id: 'NC-41', finding: '§17.5 reversal double-counting', desc: 'canonicalInputKey stops canonicalising point order (a reversed copy counts as new).',
    file: 'test/coverage.mjs', from: '  for (const c of g?.creases?.items || []) if (Array.isArray(c?.geometry?.points)) c.geometry.points = canonicalOrientation(c.geometry.points);', to: '',
    expect: ['R1.4 RV-02: an input and its full or partial point-order reversal count once', 'R1.4 RV-02: canonical keys are deterministic'] },
  { id: 'NC-42', finding: '§17.6 harmless tie counted as outcome-relevant', desc: 'Every reconciled family is treated as decided by the tie (R1.1 agreement ignored).',
    file: 'test/coverage.mjs', from: '    const disagree = new Set(states).size > 1;', to: '    const disagree = true;',
    expect: ['R1.4 RV-01: tie categories'] },
  { id: 'NC-43', finding: '§17.7 always-true assertion', desc: 'The fixture disagreement-consistency check always returns no violations.',
    file: 'test/coverage.mjs', from: 'export function checkFixtureDisagreementConsistency(fixtures, readingOf, describe) {\n  const out = [];', to: 'export function checkFixtureDisagreementConsistency(fixtures, readingOf, describe) {\n  return [];\n  const out = [];',
    expect: ['R1.3 FIXTURES'] },
  { id: 'NC-44', finding: '§17.8 canonical-only validity (engine mutation, isolated copy)', desc: 'polylineProblem checks the canonical order only.',
    file: 'src/schema.mjs', from: '  return problemInOrder(c) ?? problemInOrder([...c].reverse());', to: '  return problemInOrder(c);',
    expect: ['R1.5 NC-44 LOOP CONTROL'] }, // R1.5 (R1.4-SF-01): the intended loop-specific control; R1.4 attributed this to the R1.4 loop tests, which do not catch it
  { id: 'NC-44b', finding: 'R1.4-SF-01 reverse-only validity (engine mutation, isolated copy)', desc: 'polylineProblem checks the reversed canonical order only.',
    file: 'src/schema.mjs', from: '  return problemInOrder(c) ?? problemInOrder([...c].reverse());', to: '  return problemInOrder([...c].reverse());',
    expect: ['R1.5 NC-44 LOOP CONTROL'] },
  { id: 'NC-45', finding: '§17.9 invalid-to-valid upgrade (engine mutation, isolated copy)', desc: 'The tortuosity limit is no longer enforced.',
    file: 'src/schema.mjs', from: "  if (above(len / chord, GEOMETRY_CONTRACT.maxTortuosity)) return 'tortuous';", to: '',
    expect: ['R1.4 RV-04: loop fixtures never upgrade', 'R1.4 RV-04: a loop invalid in either order is invalid'] },
  { id: 'NC-46', finding: '§17.10 reversal-dependent error code (engine mutation, isolated copy)', desc: 'Validity checks both orders but reports the SUPPLIED order\'s problem first.',
    file: 'src/schema.mjs', from: '  const c = canonicalSequence(collapseDuplicates(points));\n  return problemInOrder(c)', to: '  const c = collapseDuplicates(points);\n  return problemInOrder(c)',
    expect: ['R1.4 RV-04: a loop invalid in either order is invalid'] },
  { id: 'NC-47', finding: '§7.1 one campaign omitted', desc: 'The random-8 campaign files are missing from the set.', mode: 'contract', contract: (h) => h.remove('random-8'), expect: ['campaign-present'] }, // R1.5: re-pointed to the quickset
  { id: 'NC-48', finding: '§7.2 a campaign below the required comparisons', desc: 'random-8 is genuinely run with target 299 (one eligible case short).', mode: 'contract', contract: (h) => h.runGenuine('random-8', { target: 299 }), expect: ['min-eligible', 'target-binding'] }, // R1.5: a genuinely short run (an edited report is now caught earlier, see NC-60)
  { id: 'NC-49', finding: '§7.3 point-order comparison disabled', desc: 'The candidate is evaluated on the forward variant only (no reversal comparison).', mode: 'differential',
    file: 'test/campaign-core.mjs', from: '  const rc = c.vars.map(({ input }) => EC.generateReading(input));', to: '  const rc = [c.vars[0]].map(({ input }) => EC.generateReading(input));', // R1.5: evaluation moved to campaign-core
    expect: ['variantCoverage'] },
  { id: 'NC-50', finding: '§7.4 only one orientation evaluated', desc: 'Only the forward orientation variant is enumerated (both engines).', mode: 'differential',
    file: 'baseline/differential.mjs', from: '  const vars = c.vars;', to: '  const vars = c.vars.slice(0, 1);', // R1.5: re-anchored to the new differential
    expect: ['variantCoverage'] },
  { id: 'NC-51', finding: '§7.5 duplicate cases replace distinct cases', desc: 'The generator returns the same case every time.', mode: 'differential',
    file: 'baseline/differential.mjs', from: '  const c = stream.next().value; counts.generated++;', to: '  const c = (globalThis.__fixedCase ||= stream.next().value); counts.generated++;', // R1.5: re-anchored
    expect: ['distinctAudit', 'records-unique'] }, // R1.5: the repeated case bypasses the stream's de-duplication, so the audit (not the target) catches it
  { id: 'NC-52', finding: '§7.6 the run terminates early', desc: 'The generation cap is cut to a third of the target.', mode: 'differential',
    file: 'baseline/differential.mjs', from: 'const cap = TARGET * 6;', to: 'const cap = Math.floor(TARGET / 3);',
    expect: ['targetReached'] },
  { id: 'NC-53', finding: '§7.5 duplicate-only campaign (contract)', desc: 'random-9 records are one case repeated (totals and hashes rewritten).', mode: 'contract', contract: (h) => { const r = h.records('random-9'); h.setRecords('random-9', r.map((_, j) => ({ ...r[0], j }))); h.recount('random-9'); h.reseal('random-9'); }, expect: ['records-unique', 'seed-regeneration'] },
  { id: 'NC-54', finding: '§7.6 truncated run (contract)', desc: 'random-7 reports completed: false (hashes rewritten).', mode: 'contract', contract: (h) => { h.edit('random-7', (r) => { r.completed = false; }); h.reseal('random-7'); }, expect: ['report-completed'] },
  { id: 'NC-55', finding: '§7.2 orientation comparisons below floor (contract)', desc: 'random-8 reports 1,000 orientation comparisons (hashes rewritten).', mode: 'contract', contract: (h) => { h.edit('random-8', (r) => { r.counts.orientationComparisons = 1000; }); h.reseal('random-8'); }, expect: ['counts-match-records'] },
  // ---- R1.5 controls ----
  // R1.4-RV-03: summarize()-level oracle weakenings must be caught by the oracle's OWN self-test (intended control)
  { id: 'NC-56', finding: 'R1.4-RV-03 summarize ignores confidence', desc: 'summarize() records every claim as tentative.',
    file: 'test/oracle.mjs', from: '      items.set(it.familyId, { tier: it.tier,', to: "      items.set(it.familyId, { tier: 'tentative',", // R2-F1: re-anchored (summarize() now validates first)
    expect: ['R1.5 ORACLE SELF-TEST'] },
  { id: 'NC-56d', finding: 'R1.4-RV-03 summarize ignores confidence (campaign level)', desc: 'As NC-56, run as a campaign.', mode: 'differential',
    file: 'test/oracle.mjs', from: '      items.set(it.familyId, { tier: it.tier,', to: "      items.set(it.familyId, { tier: 'tentative',", // R2-F1: re-anchored (summarize() now validates first)
    expect: ['oracleSelfTest', 'report-checks'] },
  { id: 'NC-57', finding: 'R1.4-RV-03 summarize ignores validity', desc: 'summarize() treats an invalid-input reading as valid.',
    file: 'test/oracle.mjs', from: "  if (!r || r.status === 'invalid-input') return { valid: false,", to: "  if (!r || r.status === 'invalid-input') return { valid: true,",
    expect: ['R1.5 ORACLE SELF-TEST'] },
  { id: 'NC-58', finding: 'R1.4-RV-03 summarize collapses rule sets', desc: 'summarize() reports one placeholder rule for every claim.',
    file: 'test/oracle.mjs', from: 'rules: rules.sort() });', to: "rules: ['ANY'] });", // R2-F1: re-anchored
    expect: ['R1.5 ORACLE SELF-TEST'] },
  { id: 'NC-59', finding: 'R1.4-RV-03 summarize drops declines', desc: 'summarize() ignores declined families (conflict abstentions vanish).',
    file: 'test/oracle.mjs', from: '    for (const d of s.declined) declined.set(d.familyId, d.reason);', to: '',
    expect: ['R1.5 ORACLE SELF-TEST'] },
  // R1.4-RV-01/02 (§9): forged or failing campaign evidence must be rejected by the contract for the intended reason
  { id: 'NC-C0', finding: 'positive control', desc: 'The genuine, unforged quick campaign set must PASS the contract.', mode: 'contract', contract: () => {}, expectPass: true, expect: [] },
  { id: 'NC-60', finding: '§9.1 inflated comparison count', desc: 'random-7 reports 50,000 more orientation comparisons (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.edit('random-7', (r) => { r.counts.orientationComparisons += 50000; }); h.reseal('random-7'); }, expect: ['counts-match-records'] },
  { id: 'NC-61', finding: '§9.2 reduced comparison count', desc: 'One random-8 record loses an orientation; totals recomputed and hashes rewritten.', mode: 'contract',
    contract: (h) => { const r = h.records('random-8'); const x = r.find((q) => q.variants > 2); x.variants--; x.masks.pop(); h.setRecords('random-8', r); h.recount('random-8'); h.reseal('random-8'); }, expect: ['seed-regeneration'] },
  { id: 'NC-62', finding: '§9.3 duplicated comparison records', desc: 'random-9 appends copies of 20 records; totals recomputed and hashes rewritten.', mode: 'contract',
    contract: (h) => { const r = h.records('random-9'); h.setRecords('random-9', [...r, ...r.slice(0, 20).map((x, i) => ({ ...x, j: r.length + i }))]); h.recount('random-9'); h.reseal('random-9'); }, expect: ['records-unique', 'seed-regeneration'] },
  { id: 'NC-63', finding: '§9.4 missing campaign records', desc: 'The random-7 evidence-record file is deleted.', mode: 'contract', contract: (h) => h.removeFile('random-7', 'records.ndjson'), expect: ['records-present'] },
  { id: 'NC-64', finding: '§9.5 truncated campaign output', desc: 'The random-8 report file is cut to half its length.', mode: 'contract', contract: (h) => h.truncate('random-8', 'report.json'), expect: ['report-parse'] },
  { id: 'NC-64b', finding: '§9.5 truncated campaign output (records)', desc: 'The random-9 records file is cut mid-line.', mode: 'contract', contract: (h) => h.truncate('random-9', 'records.ndjson'), expect: ['records-present'] },
  { id: 'NC-65', finding: '§9.6 incorrect total', desc: 'fixtures-boundary reports one fewer canonical-distinct case (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.edit('fixtures-boundary', (r) => { r.counts.canonicalDistinct -= 1; }); h.reseal('fixtures-boundary'); }, expect: ['counts-match-records'] },
  { id: 'NC-66', finding: '§9.7 failed campaign marked successful', desc: 'fixtures-loop is genuinely run on an engine copy without the tortuosity limit (invalid-to-valid upgrades), then its verdict, checks, upgrade counts, record upgrade kinds, provenance, exit status and hashes are all forged.', mode: 'contract',
    contract: (h) => { h.runGenuine('fixtures-loop', { mutate: { file: 'src/schema.mjs', from: "  if (above(len / chord, GEOMETRY_CONTRACT.maxTortuosity)) return 'tortuous';", to: '' } });
      const before = h.report('fixtures-loop'); if (!(before.upgrades['invalid-to-valid'] > 0)) throw new Error('NC-66 setup: the mutated run did not fail');
      h.setRecords('fixtures-loop', h.records('fixtures-loop').map((x) => ({ ...x, upgrades: [] })));
      h.edit('fixtures-loop', (r) => { r.pass = true; for (const k of Object.keys(r.checks)) r.checks[k] = true; r.provenance = h.genuineProvenance('fixtures-loop'); });
      h.recount('fixtures-loop'); h.editAttest('fixtures-loop', (a) => { a.exitCode = 0; a.scriptSha256 = h.genuineScriptHash('fixtures-loop'); }); h.reseal('fixtures-loop'); },
    expect: ['record-reverify'] },
  { id: 'NC-67', finding: '§9.8 one seed relabelled as multiple campaigns', desc: 'Seed 7 is run under the labels random-8 and random-9; report seeds and attested commands are forged to 8 and 9.', mode: 'contract',
    contract: (h) => { for (const [id, s] of [['random-8', 8], ['random-9', 9]]) { h.runGenuine(id, { seed: 7 }); h.edit(id, (r) => { r.seed = s; }); h.editAttest(id, (a) => { a.argv = a.argv.map((x) => (x === '7' ? String(s) : x)); }); h.reseal(id); } },
    expect: ['seed-regeneration', 'distinct-case-sets'] },
  { id: 'NC-67b', finding: '§8 repeated seed identity', desc: 'Seed 7 is run under the label random-8 without forging the seed field.', mode: 'contract', contract: (h) => h.runGenuine('random-8', { seed: 7 }), expect: ['seed-binding', 'distinct-seeds', 'attestation-seed'] },
  { id: 'NC-68', finding: '§9.9 missing exit-status evidence', desc: 'The random-9 attestation file is deleted.', mode: 'contract', contract: (h) => h.removeFile('random-9', 'attestation.json'), expect: ['attestation-present'] },
  { id: 'NC-68b', finding: '§8 a campaign that exits unsuccessfully', desc: 'The random-7 attestation records exit code 1.', mode: 'contract', contract: (h) => h.editAttest('random-7', (a) => { a.exitCode = 1; }), expect: ['exit-status'] },
  { id: 'NC-69', finding: '§9.10 wrong harness identity', desc: 'random-8 is genuinely run by a differential.mjs that differs by one comment line.', mode: 'contract',
    contract: (h) => h.runGenuine('random-8', { mutateScript: { file: 'baseline/differential.mjs', from: '// AURA-PALM-G6-D0-R1.5 — random differential', to: '// (modified) AURA-PALM-G6-D0-R1.5 — random differential' } }), expect: ['harness-identity'] },
  { id: 'NC-69b', finding: '§9.10 wrong harness identity (recorded provenance)', desc: 'random-9 provenance names a different coverage.mjs hash (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.edit('random-9', (r) => { r.provenance.harness['test/coverage.mjs'] = '0'.repeat(64); }); h.reseal('random-9'); }, expect: ['harness-identity'] },
  { id: 'NC-70', finding: '§8 repeated campaign identifier / duplicated report files', desc: 'A second copy of the random-7 files is added under another file name.', mode: 'contract', contract: (h) => h.copyAs('random-7', 'random-7-copy'), expect: ['duplicate-campaign'] },
  { id: 'NC-71', finding: '§8 unexpected campaign', desc: 'A genuine random-10 campaign is added to the set.', mode: 'contract', contract: (h) => h.runGenuine('random-10', {}), expect: ['unexpected-campaign'] },
  { id: 'NC-72', finding: '§8 incomplete campaign', desc: 'random-7 records are cut by 10; totals recomputed and hashes rewritten.', mode: 'contract',
    contract: (h) => { h.setRecords('random-7', h.records('random-7').slice(0, -10)); h.recount('random-7'); h.reseal('random-7'); }, expect: ['stop-rule'] },
  { id: 'NC-73', finding: '§8 a campaign containing failed checks', desc: 'random-9 reports checks.variantCoverage = false (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.edit('random-9', (r) => { r.checks.variantCoverage = false; }); h.reseal('random-9'); }, expect: ['report-checks'] },
  // R1.4-RV-04 (§14): tier-lowered tie coverage
  { id: 'NC-74', finding: '§14.1 missing tier-lowered tie coverage (records)', desc: 'The tierLowered field is removed from every fixtures-boundary record and count (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.setRecords('fixtures-boundary', h.records('fixtures-boundary').map((x) => { const t = { ...x.ties }; delete t.tierLowered; return { ...x, ties: t }; })); h.edit('fixtures-boundary', (r) => { delete r.counts.tierLoweredTies; }); h.reseal('fixtures-boundary'); },
    expect: ['records-schema', 'counts-match-records'] },
  { id: 'NC-74h', finding: '§14.1 missing tier-lowered tie coverage (harness)', desc: 'classifyTies never sets tierLowered.',
    file: 'test/coverage.mjs', from: `    if (r13Items.get(f)?.tier === 'tentative' && states.some((x) => x.startsWith('["clear"'))) tierLowered = true;`, to: '',
    expect: ['R1.5 TIES', 'R1.4 RV-01: tie categories'] },
  { id: 'NC-74d', finding: '§14.1 missing tier-lowered tie coverage (campaign level)', desc: 'As NC-74h, run as a campaign.', mode: 'differential',
    file: 'test/coverage.mjs', from: `    if (r13Items.get(f)?.tier === 'tentative' && states.some((x) => x.startsWith('["clear"'))) tierLowered = true;`, to: '',
    expect: ['min-tierLoweredTies'] },
  { id: 'NC-75', finding: '§14.2 incorrect tier-lowered count', desc: 'fixtures-boundary reports two more tier-lowered ties (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.edit('fixtures-boundary', (r) => { r.counts.tierLoweredTies += 2; }); h.reseal('fixtures-boundary'); }, expect: ['counts-match-records'] },
  { id: 'NC-76', finding: '§14.3 outcome-relevant tie misclassified as harmless', desc: 'Every outcome-relevant fixtures-boundary record is relabelled harmless; totals recomputed and hashes rewritten.', mode: 'contract',
    contract: (h) => { h.setRecords('fixtures-boundary', h.records('fixtures-boundary').map((x) => (x.ties.outcomeRelevant ? { ...x, ties: { ...x.ties, outcomeRelevant: false, abstention: false, tierLowered: false, harmless: true, outcomeUnchanged: x.ties.reconciledInTrace } } : x))); h.recount('fixtures-boundary'); h.reseal('fixtures-boundary'); },
    expect: ['record-reverify'] },
  { id: 'NC-77', finding: '§14.4 missing point-order comparison for relevant ties', desc: 'Every outcome-relevant fixtures-boundary record keeps only the forward orientation; totals recomputed and hashes rewritten.', mode: 'contract',
    contract: (h) => { h.setRecords('fixtures-boundary', h.records('fixtures-boundary').map((x) => (x.ties.outcomeRelevant ? { ...x, variants: 1, masks: [0] } : x))); h.recount('fixtures-boundary'); h.reseal('fixtures-boundary'); },
    expect: ['tie-point-order', 'seed-regeneration'] },
  // the contract checker's own rules are guarded by the R1.5 unit tests
  { id: 'NC-78', finding: 'contract checker ignores the campaign verdict', desc: "checkCampaignEvidence stops checking the report's pass field.",
    file: 'test/campaign-verify.mjs', from: "    if (r.pass !== true) fail(req.id, 'report-pass', 'the campaign reported failure');", to: '',
    expect: ['R1.5 CONTRACT: forged, failing, relabelled'] },
  { id: 'NC-79', finding: 'contract checker skips seed regeneration', desc: 'A sequence mismatch is no longer reported.',
    file: 'test/campaign-verify.mjs', from: "    if (v.regen.mismatch) fail(req.id, 'seed-regeneration', v.regen.mismatch);", to: '',
    expect: ['R1.5 CONTRACT: forged, failing, relabelled'] },
  { id: 'NC-80', finding: 'contract checker skips re-evaluation', desc: 'Re-evaluation mismatches are no longer reported.',
    file: 'test/campaign-verify.mjs', from: "    if (v.reverify.mismatches.length) fail(req.id, 'record-reverify',", to: "    if (false) fail(req.id, 'record-reverify',",
    expect: ['R1.5 CONTRACT: forged, failing, relabelled', 'R1.5 CONTRACT: a genuinely failing campaign'] },
  { id: 'NC-81', finding: 'independent oracle weakened', desc: 'The independent re-check ignores confidence upgrades.',
    file: 'test/independent-oracle.mjs', from: "      if (bs.some((b) => TIER[claim.tier] > TIER[b.claims[fam].tier])) kinds.add('confidence-upgrade');", to: '',
    expect: ['R1.5 INDEPENDENT ORACLE'] },
  // R1.5 review F1: properties the contract must re-derive, not read from reports
  { id: 'NC-82', finding: 'review F1: tie consistency taken from the report', desc: 'checkCampaignEvidence stops requiring zero noop-changed ties from the records.',
    file: 'test/campaign-verify.mjs', from: "    if (k.noopChangedTies !== 0) fail(req.id, 'tie-consistency',", to: "    if (false) fail(req.id, 'tie-consistency',",
    expect: ['R1.5 CONTRACT: tie consistency, recorded R1.1 readings'] },
  { id: 'NC-83', finding: 'review F1: recorded R1.1 readings not re-derived', desc: 'The recorded-vs-live R1.1 comparison from re-evaluation is no longer reported.',
    file: 'test/campaign-verify.mjs', from: "    if (v.reverify.mismatches.some((m) => m.fields?.includes('recordedR11'))) fail(", to: "    if (false) fail(",
    expect: ['R1.5 CONTRACT: tie consistency, recorded R1.1 readings'] },
  { id: 'NC-84', finding: 'review F1: oracle self-test not re-run by the checker', desc: "The checker ignores its own re-run of the oracle self-test.",
    file: 'test/campaign-verify.mjs', from: "    if (!Array.isArray(ev.selfTests.oracle) || ev.selfTests.oracle.length) fail(", to: "    if (false) fail(",
    expect: ['R1.5 CONTRACT: tie consistency, recorded R1.1 readings'] },
  { id: 'NC-85', finding: 'review F1: independent-oracle self-test not re-run by the checker', desc: "The checker ignores its own re-run of the independent oracle's self-test.",
    file: 'test/campaign-verify.mjs', from: "    if (!Array.isArray(ev.selfTests.independent) || ev.selfTests.independent.length) fail(", to: "    if (false) fail(",
    expect: ['R1.5 CONTRACT: tie consistency, recorded R1.1 readings'] },
  { id: 'NC-86', finding: 'review F1: forged report-level tie consistency', desc: 'random-9 reports tieConsistencyFailures = 5 while its records have none (hashes rewritten).', mode: 'contract',
    contract: (h) => { h.edit('random-9', (r) => { r.tieConsistencyFailures = 5; }); h.reseal('random-9'); }, expect: ['tie-consistency'] },
  // G6-I1: adapter-specific controls (mutations of adapter/feature-adapter.mjs in the scratch copy)
  { id: 'NC-87', finding: 'G6-I1 B2 landmark coordinates forwarded', desc: 'The adapter forwards the frame landmark points in the landmarks block.',
    file: 'adapter/feature-adapter.mjs', from: "    landmarks: { present: true, source: { detector: frame.landmarks.source.detector, version: frame.landmarks.source.version } },", to: "    landmarks: { present: true, source: { detector: frame.landmarks.source.detector, version: frame.landmarks.source.version }, items: frame.landmarks.points },",
    expect: ['G6-I1 B2'] },
  { id: 'NC-88', finding: 'G6-I1 B3 track resampled', desc: 'The adapter drops every second interior point (decimation).',
    file: 'adapter/feature-adapter.mjs', from: '    const pts = c.points.map((p) => toPalm(pf, p));', to: '    const pts = c.points.filter((_, k) => k === 0 || k === c.points.length - 1 || k % 2 === 0).map((p) => toPalm(pf, p));',
    expect: ['G6-I1 B3'] },
  { id: 'NC-89', finding: 'G6-I1 B3 track re-ordered', desc: 'The adapter sorts each track by x.',
    file: 'adapter/feature-adapter.mjs', from: '    const pts = c.points.map((p) => toPalm(pf, p));', to: '    const pts = [...c.points].sort((a, b) => a.x - b.x).map((p) => toPalm(pf, p));',
    expect: ['G6-I1 B3'] },
  { id: 'NC-90', finding: 'G6-I1 B5 breaks derived from gapsBridged', desc: 'The adapter reports gapsBridged as breaks.',
    file: 'adapter/feature-adapter.mjs', from: '      continuity: { gapsBridged: c.gapsBridged, breaks: null },', to: '      continuity: { gapsBridged: c.gapsBridged, breaks: c.gapsBridged },',
    expect: ['G6-I1 B4/B5'] },
  { id: 'NC-91', finding: 'G6-I1 64-point limit by truncation', desc: 'The adapter truncates a long track to 64 points instead of declining it.',
    file: 'adapter/feature-adapter.mjs', from: "    if (c.points.length > MAX_POINTS) { declined.push({ candidate: i, id, reason: 'too-many-points' }); return; }", to: '    if (c.points.length > MAX_POINTS) c.points = c.points.slice(0, MAX_POINTS);',
    expect: ['G6-I1 B6'] },
  { id: 'NC-92', finding: 'G6-I1 out-of-frame points clipped', desc: 'The adapter clips points to the frame bounds instead of declining the crease.',
    file: 'adapter/feature-adapter.mjs', from: '    const pts = c.points.map((p) => toPalm(pf, p));', to: '    const pts = c.points.map((p) => toPalm(pf, p)).map((p) => ({ x: Math.min(FRAME_BOUNDS.xMax, Math.max(FRAME_BOUNDS.xMin, p.x)), y: Math.min(FRAME_BOUNDS.yMax, Math.max(FRAME_BOUNDS.yMin, p.y)) }));',
    expect: ['G6-I1 B6'] },
  { id: 'NC-93', finding: 'G6-I1 raw score mapped (calibration claim)', desc: 'The adapter squashes unbounded raw scores into [0, 1] instead of declining.',
    file: 'adapter/feature-adapter.mjs', from: "    if (!num01(c.score)) { declined.push({ candidate: i, id, reason: 'score-not-normalised' }); return; }", to: '    if (!num01(c.score)) c.score = c.score / (c.score + 1000);',
    expect: ['G6-I1 B6', 'G6-I1 end to end'] },
  { id: 'NC-94', finding: 'G6-I1 calibrated scan confidence accepted', desc: "The adapter accepts a 'calibrated' scan-confidence basis.",
    file: 'adapter/feature-adapter.mjs', from: "  if (sc.basis !== 'uncalibrated-detector-score') fail(", to: "  if (sc.basis !== 'uncalibrated-detector-score' && sc.basis !== 'calibrated') fail(",
    expect: ['G6-I1 identity and confidence'] },
  { id: 'NC-95', finding: 'G6-I1 identity default not unclassified', desc: "Unlabelled candidates are emitted as user-confirmed MINOR creases.",
    file: 'adapter/feature-adapter.mjs', from: ": { anatomicalClass: 'unclassified', classConfidence: 0, classSource: 'none' },", to: ": { anatomicalClass: 'MINOR', classConfidence: 0.9, classSource: 'user-confirmed' },",
    expect: ['G6-I1 identity and confidence', 'G6-I1 end to end'] },
  { id: 'NC-96', finding: 'G6-I1 non-synthetic identity accepted', desc: 'The adapter accepts an identity source not marked synthetic.',
    file: 'adapter/feature-adapter.mjs', from: "  if (identity.synthetic !== true) fail(", to: "  if (false) fail(",
    expect: ['G6-I1 identity and confidence'] },
  { id: 'NC-97', finding: 'G6-I1 B7 ids renumbered after declines', desc: 'Forwarded creases are renumbered consecutively, so ids are not stable across declines.',
    file: 'adapter/feature-adapter.mjs', from: "  const features = {", to: "  items.forEach((it, k) => { it.id = `cand${k + 1}`; });\n  const features = {",
    expect: ['G6-I1 B7'] },
  { id: 'NC-98', finding: 'G6-I1 B1 accessor inputs accepted', desc: 'The plain-JSON check no longer rejects accessor properties and reads values through getters.',
    // G6-I1 run 1: the first version only removed the accessor check; the getter-less value was still rejected as
    // non-JSON (an equivalent mutant), so the control now also reads values through the getter, which is a real weakening.
    file: 'adapter/feature-adapter.mjs', from: "    if (!d || !('value' in d)) fail('not-plain-json', `${where}.${k}: accessor property`);", to: "    if (!d) continue;",
    also: { from: '    assertPlainJson(d.value, `${where}.${k}`, depth + 1, seen);', to: '    assertPlainJson(v[k], `${where}.${k}`, depth + 1, seen);' },
    expect: ['G6-I1 B1'] },
  { id: 'NC-99', finding: 'G6-I1 B6 frame not mirrored to the hand', desc: 'The frame y-axis ignores which side the wrist is on (mirrored/rotated images map differently).',
    file: 'adapter/feature-adapter.mjs', from: '  if (wristSide < 0) ey = { x: -ey.x, y: -ey.y };', to: '',
    expect: ['G6-I1 determinism and orientation'] },
  { id: 'NC-100', finding: 'G6-I1 unpinned detector accepted', desc: 'The adapter accepts any registered detector, including the synthetic fixture source.',
    file: 'adapter/feature-adapter.mjs', from: "  if (!own(RESEARCH_DETECTORS, String(detection.detector)) || RESEARCH_DETECTORS[detection.detector] !== detection.version || !regEntry", to: "  if (!regEntry",
    expect: ['G6-I1 B1'] },
];

const PKG = path.resolve(here, '..');
const BASELINE = path.join(PKG, 'baseline');
const CHECKER = path.join(BASELINE, 'check-coverage-contract.mjs');
const RUNNER = path.join(BASELINE, 'run-campaign.mjs');
const QUICK = path.join(BASELINE, 'coverage-contract-quick.json');
const QUICKSET = path.join(BASELINE, 'coverage-contract-quickset.json');
const R11PKG = path.resolve(here, '..', 'vendor', 'AURA_PALM_G6_D0_R1_1_INPUT_AND_GEOMETRY_HARDENING'); // G6-I1: vendored
const R11 = path.join(R11PKG, 'prototype');
const fileHash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const node = (args, opts = {}) => { try { return { out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts }), code: 0 }; } catch (e) { return { out: String(e.stdout || ''), code: e.status ?? 1 }; } };
const before = { r1: treeHash(R1_PROTO), g6: treeHash(G6), baseline: treeHash(BASELINE), r11: treeHash(R11PKG), adapter: treeHash(ADAPTER) };

// ---- genuine quick campaign set for contract mode (frozen runner, frozen candidate) ----
const QS = path.join(scratch, '_quickset');
const QS_IDS = ['random-7', 'random-8', 'random-9', 'fixtures-boundary', 'fixtures-competing', 'fixtures-loop'];
for (const id of QS_IDS) { const r = node([RUNNER, R11, R1_PROTO, QS, id, ...(id.startsWith('random-') ? ['--target=300'] : [])]); if (r.code !== 0) throw new Error(`quickset ${id} failed`); }
const qsHash = treeHash(QS);
const K = await import(new URL('../prototype/test/campaign-core.mjs', import.meta.url).href);

function contractHelpers(dir, root) {
  const f = (id, ext) => path.join(dir, `${id}.${ext}`);
  const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const h = {
    report: (id) => readJ(f(id, 'report.json')),
    edit: (id, fn) => { const r = h.report(id); fn(r); fs.writeFileSync(f(id, 'report.json'), JSON.stringify(r, null, 1)); },
    editAttest: (id, fn) => { const a = readJ(f(id, 'attestation.json')); fn(a); fs.writeFileSync(f(id, 'attestation.json'), JSON.stringify(a, null, 1)); },
    records: (id) => fs.readFileSync(f(id, 'records.ndjson'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    setRecords: (id, recs) => fs.writeFileSync(f(id, 'records.ndjson'), recs.map((x) => JSON.stringify(x)).join('\n') + '\n'),
    /** recompute every self-reported count from the (forged) records — what a careful forger would do */
    recount: (id) => { const recs = h.records(id); const d = K.countsFromRecords(recs); h.edit(id, (r) => { Object.assign(r.counts, d.counts); r.upgrades = d.upgrades; r.reversalMismatches = d.counts.reversalMismatches; r.tieConsistencyFailures = d.counts.noopChangedTies; r.records.count = recs.length; r.records.caseSetDigest = K.caseSetDigest(recs); }); },
    /** rewrite every hash so the forged files are mutually consistent (report → records → attestation) */
    reseal: (id) => {
      if (fs.existsSync(f(id, 'records.ndjson'))) h.edit(id, (r) => { r.records.sha256 = fileHash(f(id, 'records.ndjson')); });
      if (fs.existsSync(f(id, 'attestation.json'))) h.editAttest(id, (a) => { a.reportSha256 = fileHash(f(id, 'report.json')); a.recordsSha256 = fs.existsSync(f(id, 'records.ndjson')) ? fileHash(f(id, 'records.ndjson')) : null; a.stderrSha256 = fileHash(f(id, 'stderr.log')); });
    },
    remove: (id) => { for (const ext of ['report.json', 'records.ndjson', 'stderr.log', 'attestation.json']) fs.rmSync(f(id, ext), { force: true }); },
    removeFile: (id, ext) => fs.rmSync(f(id, ext)),
    truncate: (id, ext) => { const b = fs.readFileSync(f(id, ext)); fs.writeFileSync(f(id, ext), b.subarray(0, Math.floor(b.length / 2))); },
    copyAs: (id, stem) => { for (const ext of ['report.json', 'records.ndjson', 'stderr.log', 'attestation.json']) fs.copyFileSync(f(id, ext), f(stem, ext)); },
    genuineProvenance: (id) => readJ(path.join(QS, `${id}.report.json`)).provenance,
    genuineScriptHash: (id) => readJ(path.join(QS, `${id}.attestation.json`)).scriptSha256,
    /** a GENUINE run (optionally with another seed/target, a mutated engine copy, or a mutated campaign script) */
    runGenuine: (id, { seed, target, mutate, mutateScript } = {}) => {
      h.remove(id);
      let proto = R1_PROTO, runner = RUNNER;
      if (mutate || mutateScript) {
        const alt = path.join(root, `alt-${id}`); fs.cpSync(R1_PROTO, path.join(alt, 'prototype'), { recursive: true }); fs.cpSync(BASELINE, path.join(alt, 'baseline'), { recursive: true }); fs.cpSync(ADAPTER, path.join(alt, 'adapter'), { recursive: true }); fs.symlinkSync(VENDOR, path.join(alt, 'vendor')); execFileSync('chmod', ['-R', 'u+w', alt]);
        for (const m of [mutate, mutateScript].filter(Boolean)) { const p = m.file.startsWith('baseline/') || m.file.startsWith('adapter/') ? path.join(alt, m.file) : path.join(alt, 'prototype', m.file); const s = fs.readFileSync(p, 'utf8'); if (s.split(m.from).length !== 2) throw new Error(`runGenuine: anchor not found once in ${m.file}`); fs.writeFileSync(p, s.replace(m.from, () => m.to)); }
        proto = path.join(alt, 'prototype'); runner = path.join(alt, 'baseline', 'run-campaign.mjs');
      }
      const t = target ?? (id.startsWith('random-') ? 300 : null);
      node([runner, R11, proto, dir, id, ...(t ? [`--target=${t}`] : []), ...(seed != null ? [`--seed=${seed}`] : [])]);
    },
  };
  return h;
}

const results = [];
for (const c of CONTROLS) {
  const root = path.join(scratch, c.id);
  fs.mkdirSync(path.join(root, 'R1'), { recursive: true });
  fs.symlinkSync(VENDOR, path.join(root, 'R1', 'vendor')); // G6-I1: read-only vendored references (R1.1 baseline, G6 rules, D1 evidence)
  const proto = path.join(root, 'R1', 'prototype');
  fs.cpSync(R1_PROTO, proto, { recursive: true });
  fs.cpSync(BASELINE, path.join(root, 'R1', 'baseline'), { recursive: true });
  fs.cpSync(ADAPTER, path.join(root, 'R1', 'adapter'), { recursive: true });
  execFileSync('chmod', ['-R', 'u+w', path.join(root, 'R1')]); // R1-RV-06: copies must be writable even if the source tree is read-only
  const applied = [];
  if (c.swapG6Src) {
    fs.rmSync(path.join(proto, 'src'), { recursive: true });
    fs.cpSync(path.join(G6, 'prototype', 'src'), path.join(proto, 'src'), { recursive: true });
    applied.push('src/ replaced with G6-D0 src/');
  } else if (c.file) { // R1.4 fix: contract-mode controls transform reports only and have no source mutation
    for (const m of [{ file: c.file, from: c.from, to: c.to }, ...(c.also ? [{ file: c.also.file || c.file, ...c.also }] : [])]) {
      if (typeof m.from !== 'string' || typeof m.to !== 'string') throw new Error(`${c.id}: mutation from/to must both be strings`); // R1.5 fix (post-freeze, NC run 1)
      const p = m.file.startsWith('baseline/') || m.file.startsWith('adapter/') ? path.join(root, 'R1', m.file) : path.join(proto, m.file); const s = fs.readFileSync(p, 'utf8');
      if (s.split(m.from).length !== 2) throw new Error(`${c.id}: mutation anchor not found exactly once in ${m.file}`);
      // R1.1: function replacer — a plain replacement string would expand `$'` and similar patterns.
      fs.writeFileSync(p, s.replace(m.from, () => m.to)); applied.push(`${m.file}: ${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`);
    }
  } else if (c.mode !== 'contract') throw new Error(`${c.id}: no mutation defined`);
  let out = '', failed = [], passCount = null, exitCode = 0;
  if (c.mode === 'contract') {
    const dir = path.join(root, 'campaigns'); fs.cpSync(QS, dir, { recursive: true });
    await c.contract(contractHelpers(dir, root)); applied.push(c.desc);
    ({ out, code: exitCode } = node([CHECKER, QUICKSET, R1_PROTO, R11, dir]));
    let rep = {}; try { rep = JSON.parse(out); } catch { rep = { failures: [{ check: 'checker-output-unreadable' }] }; }
    failed = [...new Set((rep.failures || []).map((f) => f.check))];
    if (exitCode === 0) failed = [];
  } else if (c.mode === 'differential') {
    const dir = path.join(root, 'campaigns');
    const run = node([path.join(root, 'R1', 'baseline', 'run-campaign.mjs'), R11, proto, dir, 'random-7', `--target=${c.target || 300}`, '--quick']);
    let rep = {}; try { rep = JSON.parse(fs.readFileSync(path.join(dir, 'random-7.report.json'), 'utf8')); } catch { rep = { checks: {} }; }
    failed = Object.entries(rep.checks || {}).filter(([, ok]) => !ok).map(([k]) => k);
    exitCode = run.code;
    // the FROZEN checker (quick contract, full regeneration + re-evaluation against the frozen candidate)
    const chk = node([CHECKER, QUICK, R1_PROTO, R11, dir]);
    if (chk.code !== 0) { exitCode = exitCode || chk.code; try { failed.push(...new Set(JSON.parse(chk.out).failures.map((f) => f.check))); } catch { failed.push('contract-unreadable'); } }
    out = chk.out;
    if (exitCode === 0) failed = []; // detection requires a non-zero exit (campaign or contract)
  } else {
    try { out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'test/r1-hardening.test.mjs', 'test/r1-1-hardening.test.mjs', 'test/r1-2-hardening.test.mjs', 'test/r1-3-hardening.test.mjs', 'test/r1-4-hardening.test.mjs', 'test/r1-5-hardening.test.mjs', 'test/r2-f1-oracle-validation.test.mjs', 'test/g6-i1-adapter.test.mjs'], { cwd: proto, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }); }
    catch (e) { out = String(e.stdout || ''); exitCode = e.status ?? 1; }
    failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1].trim()).filter((n) => !/^test\/.+\.test\.mjs$/.test(n));
    passCount = Number((out.match(/^# pass (\d+)/m) || [])[1]);
  }
  const detectedList = c.expect.map((e) => [e, failed.some((f) => f.startsWith(e))]);
  const detected = c.expectPass ? exitCode === 0 && failed.length === 0 : exitCode !== 0 && detectedList.every(([, ok]) => ok);
  results.push({ id: c.id, finding: c.finding, desc: c.desc, mode: c.mode || 'tests', applied, exitCode, failedCount: failed.length, passCount, failed, expected: detectedList, expectPass: !!c.expectPass, detected });
  console.error(`${c.id} ${detected ? 'detected' : 'NOT DETECTED'} (${c.mode || 'tests'})`);
  fs.rmSync(root, { recursive: true, force: true });
}
const after = { r1: treeHash(R1_PROTO), g6: treeHash(G6), baseline: treeHash(BASELINE), r11: treeHash(R11PKG), adapter: treeHash(ADAPTER) };
const summary = { before, after, quicksetHash: qsHash, quicksetUnchanged: treeHash(QS) === qsHash, r1Unchanged: before.r1 === after.r1, g6Unchanged: before.g6 === after.g6, baselineUnchanged: before.baseline === after.baseline, r11Unchanged: before.r11 === after.r11, adapterUnchanged: before.adapter === after.adapter,
  controls: results.length, detected: results.filter((r) => r.detected).length, allDetected: results.every((r) => r.detected), results };
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.allDetected && summary.r1Unchanged && summary.g6Unchanged && summary.baselineUnchanged && summary.r11Unchanged && summary.adapterUnchanged && summary.quicksetUnchanged ? 0 : 1);
