/**
 * Constructor Decision Intelligence -- O5 PRE-P4b: the SCHEDULING-PATH Date-mutator guard (architecture, pure).
 *
 * WHY THIS EXISTS. The scheduling path aliases Date instances on purpose and for good reason (no copies on the hot path):
 *
 *   ProposedItem.start / .end        ===  the very Date objects of the selected candidate (deriveExactInterval returns candidate.start)
 *   FixedPlacementConstraint.start   ===  the request's own fixedStart Date
 *   excludedIntervals / blockedIntervals share the blocker Dates; normalized blockers reuse window Dates
 *
 * Nothing in the construction path ever MUTATES a Date, so the aliasing is harmless today. A future second scheduling pass (P4b's
 * counterfactual) may reuse baseline-derived objects; a single `setHours` / `setTime` / `setUTCDate` ... call anywhere in the path
 * would then silently rewrite the baseline through an alias. This guard pins the current invariant BEFORE any such infrastructure
 * exists: no instance Date mutator appears in the audited scheduling path.
 *
 * SCOPE IS AUDITED, NOT A BLIND REPOSITORY SCAN. (1) An explicit list of the modules that form the construction / decision-
 * intelligence / policy-input path (below) must contain ZERO mutators and ZERO exceptions. (2) As a completeness check the guard
 * computes the local VALUE-import closure of the scheduling entry points and requires that the only setter-bearing file inside it is
 * exactly `timezone.ts`, whose single call -- `addDaysToDateStr`'s `date.setUTCDate(...)` -- is verified STRUCTURALLY to act on a
 * Date created inside that same function and never returned (the function returns a string), so it cannot alias any scheduling
 * object. Every other known setter lives outside the path (planFormatting.ts, prisma-db.ts, streak.ts, PastActivityModal.tsx) and is
 * deliberately not scanned; if one is ever imported into the path the closure rule fails it.
 *
 * WHAT IT DOES NOT PROVE. It does not prove a future `ConstructionBasis` (P4b1) is detached or frozen -- that slice must prove it
 * separately. It is a prerequisite, not a substitute.
 *
 * DETECTION is source inspection (the repository's architecture-test convention) over a small character scanner that blanks
 * comments and string contents, keeps template-literal `${...}` expressions as code, and then looks for the mutator IDENTIFIERS
 * anywhere in code -- so a call on any object name, an optional-chained call, a method reference, a destructured binding and
 * `Date.prototype` access are all caught, while a comment or a string that merely mentions `.setHours(` is not. Computed access
 * `x['setHours']` is caught on the comment-stripped text. Non-mutating and static Date use (`new Date(...)`, `getTime()`,
 * `getUTCDay()`, `Date.UTC`, `Date.parse`, `toISOString()`) is never flagged.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

// ============================================================
// The scanner
// ============================================================
/** Every instance Date mutator (local, UTC and the legacy `setYear`). `setUTCMilliseconds` etc. are listed explicitly. */
const MUTATORS = ['setTime', 'setMilliseconds', 'setSeconds', 'setMinutes', 'setHours', 'setDate', 'setMonth', 'setFullYear', 'setYear', 'setUTCMilliseconds', 'setUTCSeconds', 'setUTCMinutes', 'setUTCHours', 'setUTCDate', 'setUTCMonth', 'setUTCFullYear'] as const;
const MUTATOR_IDENT = new RegExp(`\\b(${MUTATORS.join('|')})\\b`);
const MUTATOR_COMPUTED = new RegExp(`\\[\\s*(['"\`])(${MUTATORS.join('|')})\\1\\s*\\]`);
/** Replacing or extending the Date class itself would also mutate every Date: `Date.prototype` is never referenced in the path. */
const DATE_PROTOTYPE = /\bDate\s*\.\s*prototype\b|\bDate\s*\[\s*(['"`])prototype\1\s*\]/;

/**
 * Returns the source with comments removed and string / template-text contents blanked to spaces (length-preserving), keeping
 * template `${ ... }` expressions as live code. `keepStrings` retains string contents (comments still removed) -- used only to
 * detect computed member access by a string literal.
 */
function scan(src: string, keepStrings = false): string {
  let out = '';
  const stack: Array<'code' | 'template'> = ['code'];
  const braces: number[] = []; // brace depth per open template expression
  let depth = 0;
  for (let i = 0; i < src.length; i += 1) {
    const state = stack[stack.length - 1];
    const c = src[i]; const n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i += 1; } out += '\n'; continue; }
      if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i += 1; } out += '  '; i += 1; continue; }
      if (c === '\'' || c === '"') {
        out += c; i += 1;
        while (i < src.length && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { out += keepStrings ? src[i] + (src[i + 1] ?? '') : '  '; i += 2; continue; } out += keepStrings ? src[i] : ' '; i += 1; } // a quoted string never spans a line: bounds any desync caused by a quote inside a regex literal to the rest of that line
        if (src[i] === '\n') { out += '\n'; continue; }
        out += c; continue;
      }
      if (c === '`') { out += c; stack.push('template'); continue; }
      if (c === '{') { depth += 1; out += c; continue; }
      if (c === '}') {
        if (braces.length && braces[braces.length - 1] === depth) { braces.pop(); stack.pop(); out += c; continue; } // end of a ${ } expression: back to template text
        depth -= 1; out += c; continue;
      }
      out += c; continue;
    }
    // template text
    if (c === '\\') { out += keepStrings ? c + (n ?? '') : '  '; i += 1; continue; }
    if (c === '`') { out += c; stack.pop(); continue; }
    if (c === '$' && n === '{') { out += '${'; i += 1; braces.push(depth); stack.push('code'); continue; }
    out += keepStrings ? c : (c === '\n' ? '\n' : ' ');
  }
  return out;
}

interface Hit { kind: 'mutator' | 'computed' | 'date-prototype'; text: string }
function findMutations(src: string): Hit[] {
  const hits: Hit[] = [];
  const code = scan(src);
  for (const m of code.matchAll(new RegExp(MUTATOR_IDENT.source, 'g'))) hits.push({ kind: 'mutator', text: m[1] });
  for (const m of scan(src, true).matchAll(new RegExp(MUTATOR_COMPUTED.source, 'g'))) hits.push({ kind: 'computed', text: m[2] });
  if (DATE_PROTOTYPE.test(scan(src, true))) hits.push({ kind: 'date-prototype', text: 'Date.prototype' });
  return hits;
}

// ============================================================
// The audited scheduling path
// ============================================================
/** Modules that form the construction / decision-intelligence / policy-input path. Zero mutators, zero exceptions. */
const PROTECTED: Array<{ file: string; role: string }> = [
  { file: 'apps/web/lib/dayConstructor.ts', role: 'Constructor: placement, FIXED reservation, ProposedItem aliasing of candidate Dates' },
  { file: 'apps/web/lib/dayCapacity.ts', role: 'capacity and blocker normalization (reuses window / blocker Dates)' },
  { file: 'apps/web/lib/dayIntent.ts', role: 'intent normalization and the overload precedence comparator' },
  { file: 'apps/web/lib/contentionTrace.ts', role: 'P3a contention trace' },
  { file: 'apps/web/lib/dayConstructorOrchestrator.ts', role: 'orchestration: candidate hand-off, excludedIntervals, replenishment, FIXED constraint from request.fixedStart' },
  { file: 'apps/web/lib/dayConstructorPreviewRequest.ts', role: 'preview boundary hand-off to the orchestrator' },
  { file: 'packages/recommendation/src/timingSearch.ts', role: 'timing search hand-off (searchWindow / excludedIntervals in, candidates out)' },
  { file: 'packages/panchang/src/localDate.ts', role: 'local civil date / time to UTC conversion used for windows' },
  { file: 'packages/panchang/src/windows.ts', role: 'interval primitives used by the search' },
  { file: 'apps/web/lib/planBlockerLifecycle.ts', role: 'which persisted plans block (the blocker Dates)' },
  { file: 'apps/web/lib/availabilityContext.ts', role: 'availability periods and gap blockers' },
  { file: 'apps/web/lib/decisionFacts.ts', role: 'decision facts transport' },
  { file: 'apps/web/lib/decisionEvidence.ts', role: 'immutable decision evidence' },
  { file: 'apps/web/lib/decisionFactPreparation.ts', role: 'fact / evidence preparation' },
  { file: 'apps/web/lib/decisionPressure.ts', role: 'pressure deriver' },
  { file: 'apps/web/lib/opportunityProjection.ts', role: 'opportunity projection over blockers and availability' },
  { file: 'apps/web/lib/opportunityDecisionFacts.ts', role: 'opportunity fact enrichment' },
  { file: 'apps/web/lib/opportunityRangeAdapter.ts', role: 'range adapter and the shared range-bounds helper' },
  { file: 'apps/web/lib/opportunityRangeRealDeps.ts', role: 'live range wiring' },
  { file: 'apps/web/lib/decisionSchedulingContext.ts', role: 'P2d coherent context and its derivations' },
  { file: 'apps/web/lib/decisionSchedulingContextLoader.ts', role: 'P2d snapshot loader' },
  { file: 'apps/web/lib/durationContext.ts', role: 'duration assembly' },
  { file: 'apps/web/lib/goalDecisionFactsProvider.ts', role: 'recurrence fact provider' },
  { file: 'apps/web/lib/goalActivityRhythm.ts', role: 'Rhythm week arithmetic' },
  { file: 'apps/web/lib/goalDemandCandidates.ts', role: 'canonical Goal demand candidates' },
  { file: 'apps/web/lib/abovePressurePrecedence.ts', role: 'above-pressure comparison primitive' },
  { file: 'apps/web/lib/shadowPressureEvaluation.ts', role: 'P3b shadow evaluator' },
  { file: 'apps/web/lib/shadowPressureObservation.ts', role: 'P3b diagnostics boundary' },
  { file: 'apps/web/lib/constructionBasis.ts', role: 'P4b1 immutable construction basis (owns every Date it holds)' },
  { file: 'apps/web/lib/promotionInput.ts', role: 'P4a promotion input assembler' },
  { file: 'apps/web/lib/promotionInputPreparation.ts', role: 'P4a promotion preparation boundary' },
];
/** The scheduling entry points whose value-import closure is checked for completeness. */
const ENTRY_POINTS = ['apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/promotionInputPreparation.ts', 'apps/web/lib/decisionSchedulingContextLoader.ts', 'apps/web/lib/shadowPressureObservation.ts'];
/** The ONE exception, by exact file and call, with the reason mutation cannot reach scheduling state. */
const EXCEPTION = {
  file: 'apps/web/lib/timezone.ts',
  call: 'date.setUTCDate(date.getUTCDate() + days)',
  reason: '`addDaysToDateStr` builds its own `new Date(Date.UTC(...))`, mutates only that local instance and returns a string -- the mutated Date never escapes the function, so no scheduling Date can be aliased to it',
};
const KNOWN_EXCLUDED = ['apps/web/lib/planFormatting.ts', 'apps/web/lib/prisma-db.ts', 'apps/web/lib/streak.ts', 'apps/web/components/PastActivityModal.tsx'];

function localValueImports(file: string, srcOf: (f: string) => string | undefined): string[] {
  const code = scan(srcOf(file) ?? '', true);
  const out: string[] = [];
  for (const m of code.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.[^']*)'/gms)) {
    const base = path.normalize(path.join(path.dirname(file), m[1]));
    for (const ext of ['.ts', '.tsx', '/index.ts']) if (srcOf(base + ext) !== undefined) { out.push(base + ext); break; }
  }
  return out;
}
function closure(entries: string[], srcOf: (f: string) => string | undefined): string[] {
  const seen = new Set<string>(); const stack = [...entries];
  while (stack.length) { const f = stack.pop()!; if (seen.has(f)) continue; seen.add(f); localValueImports(f, srcOf).forEach((d) => stack.push(d)); }
  return [...seen].sort();
}
function fnBody(src: string, header: string): string {
  const start = src.indexOf(header);
  if (start < 0) return '';
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) { if (src[i] === '{') depth += 1; else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(start, i + 1); } }
  return '';
}

/** The whole guard as a pure function of a file map: returns `RULE:file:detail` violations. */
function audit(files: Map<string, string>): string[] {
  const v: string[] = [];
  const srcOf = (f: string) => files.get(f);
  for (const { file } of PROTECTED) {
    const src = srcOf(file);
    if (src === undefined) { v.push(`D0:protected-module-missing:${file}`); continue; }
    findMutations(src).forEach((h) => v.push(`D1:date-mutator-in-protected-module:${file}:${h.kind}:${h.text}`));
  }
  // completeness: every setter-bearing file in the scheduling closure is the one named exception
  for (const f of closure(ENTRY_POINTS, srcOf)) {
    if (PROTECTED.some((p) => p.file === f)) continue;
    const hits = findMutations(srcOf(f) ?? '');
    if (hits.length === 0) continue;
    if (f !== EXCEPTION.file) { v.push(`D2:date-mutator-in-scheduling-closure:${f}:${hits.map((h) => h.text).join(',')}`); continue; }
    const body = fnBody(scan(srcOf(f)!), 'export function addDaysToDateStr');
    const exact = /const date = new Date\(Date\.UTC\(year, month - 1, day\)\);\s*date\.setUTCDate\(date\.getUTCDate\(\) \+ days\);\s*return date\.toISOString\(\)\.slice\(0, 10\);/.test(body);
    if (hits.length !== 1 || hits[0].text !== 'setUTCDate' || !exact) v.push(`D3:exception-no-longer-matches-its-justification:${f}`);
  }
  return v;
}
const realFiles = new Map<string, string>();
const loadAll = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((e) => {
  const rel = path.join(dir, e.name);
  if (e.isDirectory()) { if (e.name !== 'node_modules' && !e.name.startsWith('.')) loadAll(rel); } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) realFiles.set(rel, read(rel));
});
['apps/web/lib', 'packages'].forEach(loadAll);
const withEdit = (file: string, fn: (s: string) => string): Map<string, string> => { const m = new Map(realFiles); m.set(file, fn(m.get(file)!)); return m; };
const flagged = (violations: string[], prefix: string, file?: string) => violations.some((x) => x.startsWith(prefix) && (file === undefined || x.includes(`:${file}:`) || x.endsWith(`:${file}`)));

// ============================================================
console.log('=== the scanner: real mutations are found, comments / strings / non-mutating use are not ===');
const kinds = (src: string) => findMutations(src).map((h) => h.text).join();
check('LOCAL setters are found whatever the receiver is called: `someDate.setMinutes(1)`, `interval.start.setHours(0)`, `x.setTime(0)`, `d.setDate(1)`, `d.setMonth(0)`, `d.setFullYear(2020)`, `d.setSeconds(0)`, `d.setMilliseconds(0)`', ['someDate.setMinutes(1)', 'interval.start.setHours(0, 0, 0, 0)', 'x.setTime(0)', 'd.setDate(1)', 'd.setMonth(0)', 'd.setFullYear(2020)', 'd.setSeconds(0)', 'd.setMilliseconds(0)'].every((c) => findMutations(`function f(){ ${c}; }`).length === 1));
check('UTC setters are found: `d.setUTCHours(0)`, `d.setUTCMinutes`, `d.setUTCSeconds`, `d.setUTCMilliseconds`, `d.setUTCDate`, `d.setUTCMonth`, `d.setUTCFullYear`, and the legacy `d.setYear`', ['setUTCHours(0)', 'setUTCMinutes(0)', 'setUTCSeconds(0)', 'setUTCMilliseconds(0)', 'setUTCDate(1)', 'setUTCMonth(0)', 'setUTCFullYear(2020)', 'setYear(99)'].every((c) => findMutations(`const x = (d: Date) => d.${c};`).length === 1));
check('indirect forms are found: optional chaining `d?.setHours(1)`, a method reference `const f = d.setHours`, a destructured binding `const { setTime } = d`, `Date.prototype.setHours.call(d, 1)`, and computed access `d[\'setMinutes\'](1)` / d["setDate"](1)', findMutations('d?.setHours(1)').length === 1 && findMutations('const f = d.setHours;').length === 1 && findMutations('const { setTime } = d;').length === 1 && findMutations('Date.prototype.setHours.call(d, 1);').length >= 1 && findMutations("d['setMinutes'](1);").length === 1 && findMutations('d["setDate"](1);').length === 1 && findMutations('Date.prototype.setHours = () => 0;').some((h) => h.kind === 'date-prototype'));
check('a mutator inside a template-literal EXPRESSION is code and is found: `${d.setHours(1)}`; the surrounding template text is not', findMutations('const s = `at ${d.setHours(1)} ok`;').length === 1 && kinds('const s = `at ${d.getHours()} .setHours( ok`;') === '');
check('COMMENTS do not count: line, block and JSDoc comments mentioning `.setHours(` / `setUTCDate` are ignored', kinds('// d.setHours(1)\nconst a = 1;') === '' && kinds('/* d.setUTCDate(2) */ const a = 1;') === '' && kinds('/**\n * never call .setTime( on an aliased Date\n */\nexport const a = 1;') === '');
check('STRINGS do not count: single-, double-quoted and template strings mentioning a mutator are ignored (escaped quotes included)', kinds("const a = '.setHours(1)';") === '' && kinds('const a = ".setMinutes(1)";') === '' && kinds('const a = `.setDate(1)`;') === '' && kinds("const a = 'it\\'s .setTime(1)'; const b = 2;") === '' && kinds("const a = 'x'; // .setFullYear(1)") === '');
check('NON-MUTATING and STATIC Date use is never flagged: `new Date(x)`, `getTime()`, `getHours()`, `getUTCDay()`, `toISOString()`, `Date.UTC(...)`, `Date.parse(...)`, `Date.now()`, `.setOf` / `Map.set(` / a property merely named `settings`', kinds('const a = new Date(x.getTime() + 60000); const b = a.getHours() + a.getUTCDay(); const c = a.toISOString(); const d = Date.UTC(2026, 9, 9); const e = Date.parse(c); const f = Date.now();') === '' && kinds('m.set(k, v); const settings = {}; settings.timeout = 1; obj.setOf = 1;') === '');
check('a mutation AFTER a string containing a quote-like comment marker is still found (the scanner does not lose its place): `const u = "http://x"; d.setHours(1);`', kinds('const u = "http://x"; d.setHours(1);') === 'setHours');

console.log('=== the audited path conforms ===');
const baseline = audit(realFiles);
check(`THE REAL SCHEDULING PATH HAS ZERO DATE-MUTATOR VIOLATIONS (${PROTECTED.length} protected modules, ${closure(ENTRY_POINTS, (f) => realFiles.get(f)).length} files in the entry-point import closure)${baseline.length ? ': ' + baseline.join(', ') : ''}`, baseline.length === 0);
check('every protected module exists and is non-empty (a rename cannot silently shrink the guard)', PROTECTED.every(({ file }) => (realFiles.get(file) ?? '').length > 100));
check('ZERO EXCEPTIONS in the protected modules: none contains any mutator identifier, computed mutator access or `Date.prototype` reference', PROTECTED.every(({ file }) => findMutations(realFiles.get(file)!).length === 0));
const closureFiles = closure(ENTRY_POINTS, (f) => realFiles.get(f));
const settersInClosure = closureFiles.filter((f) => findMutations(realFiles.get(f)!).length > 0);
check(`COMPLETENESS: of the ${closureFiles.length} files the scheduling entry points can reach through value imports, the only one containing a Date mutator is exactly ${EXCEPTION.file}`, JSON.stringify(settersInClosure) === JSON.stringify([EXCEPTION.file]));
check(`THE ONE EXCEPTION IS VERIFIED, NOT TRUSTED: ${EXCEPTION.call} sits in \`addDaysToDateStr\`, on a Date created inside that function by \`new Date(Date.UTC(...))\`, and the function returns a string. Reason: ${EXCEPTION.reason}`, !flagged(audit(realFiles), 'D3:') && (() => { const body = fnBody(scan(realFiles.get(EXCEPTION.file)!), 'export function addDaysToDateStr'); return count(/\bsetUTCDate\b/g, body) === 1 && /return date\.toISOString\(\)\.slice\(0, 10\);/.test(body) && /Promise<|=> Date/.test(body) === false; })());
check(`the known setter modules outside the path are named and excluded -- not wildcarded: ${KNOWN_EXCLUDED.join(', ')} (each really contains a mutator, none is in the scheduling closure)`, KNOWN_EXCLUDED.every((f) => findMutations(read(f)).length > 0 && !closureFiles.includes(f)));
function count(re: RegExp, s: string) { return (s.match(re) ?? []).length; }

console.log('=== INJECTED VIOLATIONS (on the real sources, in memory): each class is detected for the intended reason ===');
const SAMPLE = 'apps/web/lib/dayCapacity.ts';
check('LOCAL SETTER injected into a protected module (`someDate.setMinutes(...)`) -> D1, naming the mutator and the file', flagged(audit(withEdit(SAMPLE, (s) => `${s}\nexport const injected = (someDate: Date) => someDate.setMinutes(5);\n`)), 'D1:date-mutator-in-protected-module', SAMPLE) && audit(withEdit(SAMPLE, (s) => `${s}\nexport const injected = (someDate: Date) => someDate.setMinutes(5);\n`)).some((x) => x.endsWith(':mutator:setMinutes')));
check('UTC SETTER injected into the Constructor and into the orchestrator -> D1 for each', ['apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayConstructorOrchestrator.ts'].every((f) => audit(withEdit(f, (s) => `${s}\nexport const injected = (d: Date) => d.setUTCHours(0);\n`)).some((x) => x.startsWith('D1:') && x.includes(f) && x.endsWith(':setUTCHours'))));
check('every protected module is guarded: a setter appended to EACH of them is detected', PROTECTED.every(({ file }) => flagged(audit(withEdit(file, (s) => `${s}\nconst injected = (d: Date) => d.setTime(0);\n`)), 'D1:', file)));
check('aliasing-flavoured injection is detected: mutating a ProposedItem / candidate / blocker Date in place (`item.start.setHours(0)`, `candidate.end.setTime(1)`, `blocker.start.setUTCDate(1)`)', ['item.start.setHours(0)', 'candidate.end.setTime(1)', 'blocker.start.setUTCDate(1)'].every((c) => flagged(audit(withEdit('apps/web/lib/dayConstructor.ts', (s) => `${s}\nfunction injected(item: any, candidate: any, blocker: any) { ${c}; }\n`)), 'D1:', 'apps/web/lib/dayConstructor.ts')));
check('a computed-access and an optional-chained mutation are detected in a protected module', flagged(audit(withEdit(SAMPLE, (s) => `${s}\nexport const a = (d: any) => d['setHours'](1);\n`)), 'D1:', SAMPLE) && flagged(audit(withEdit(SAMPLE, (s) => `${s}\nexport const b = (d: any) => d?.setDate(1);\n`)), 'D1:', SAMPLE));
check('a mutator newly IMPORTED INTO the path is detected by the closure rule: a setter in a file the Constructor can reach but that is not on the protected list -> D2', flagged(audit(withEdit('apps/web/lib/dailyAgenda.ts', (s) => `${s}\nexport const injected = (d: Date) => d.setDate(1);\n`)), 'D2:', 'apps/web/lib/dailyAgenda.ts'));
check('the named exception cannot grow: a second setter in timezone.ts, or the setter no longer acting on the local Date, -> D3', flagged(audit(withEdit(EXCEPTION.file, (s) => `${s}\nexport const injected = (d: Date) => d.setUTCHours(0);\n`)), 'D3:') && flagged(audit(withEdit(EXCEPTION.file, (s) => s.replace('date.setUTCDate(date.getUTCDate() + days);\n  return date.toISOString().slice(0, 10);', 'date.setUTCDate(date.getUTCDate() + days);\n  return date as unknown as string;'))), 'D3:'));
check('a protected module that disappears fails (D0) rather than silently shrinking the guard', (() => { const m = new Map(realFiles); m.delete(SAMPLE); return flagged(audit(m), 'D0:', SAMPLE); })());

console.log('=== FALSE-POSITIVE CONTROLS (on the real sources): allowed Date use and mere mentions stay green ===');
check('a COMMENT mentioning `.setHours(` / `.setUTCDate(` added to a protected module is NOT a violation', audit(withEdit(SAMPLE, (s) => `// never call someDate.setHours(0) or d.setUTCDate(1) on an aliased Date\n/* d.setTime( */\n${s}`)).length === 0);
check('a STRING / template literal mentioning a mutator added to a protected module is NOT a violation', audit(withEdit(SAMPLE, (s) => `${s}\nexport const note = '.setHours(1) .setUTCDate(2)';\nexport const note2 = \`.setTime(\${1})\`;\n`)).length === 0);
check('NON-MUTATING / STATIC Date operations added to a protected module are NOT violations: `new Date(...)`, `getTime()`, `getHours()`, `Date.UTC(...)`, `Date.parse(...)`, `toISOString()`', audit(withEdit(SAMPLE, (s) => `${s}\nexport const ok = (d: Date) => [new Date(d.getTime() + 1), d.getHours(), Date.UTC(2026, 0, 1), Date.parse('2026-01-01'), d.toISOString()];\n`)).length === 0);
check('the injected mutations above were applied to in-memory copies only: the real tree still has zero violations afterwards', audit(realFiles).length === 0);

console.log('=== wiring and honest scope ===');
const workflow = read('.github/workflows/ci.yml').split('\n');
let currentJob = ''; let inJobs = false;
const stepJob = new Map<string, string>();
for (const line of workflow) {
  if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
  const job = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
  if (inJobs && job) currentJob = job[1];
  const run = line.match(/^\s+run: npx ts-node (test\/[A-Za-z0-9_]+\.test\.ts)\s*$/);
  if (run && currentJob) stepJob.set(run[1], currentJob);
}
check('both pre-P4b protections (the real-pipeline anomaly regression and this Date-mutator guard) run in the required PURE job', stepJob.get('test/precedenceAnomalyRealPipeline.test.ts') === 'math-core-tests' && stepJob.get('test/schedulingDateMutatorArchitecture.test.ts') === 'math-core-tests');
check('this guard is a pure function over source text: no database, network, clock, randomness or environment is read by the guard itself', !/\bfetch\(|process\.env|Math\.random|Date\.now\(|new Date\(\)|setTimeout|setInterval|\bpool\b/.test(scan(fs.readFileSync(__filename, 'utf8').split("console.log('=== wiring and honest scope ===');")[0])));
check('SCOPE STATEMENT: the guard does not claim a future ConstructionBasis is detached or frozen (P4b1 must prove that separately); it pins only that the audited path contains no Date mutator', /does not prove a future `ConstructionBasis`/.test(read('test/schedulingDateMutatorArchitecture.test.ts')));

if (!allPassed) {
  console.error('SOME SCHEDULING DATE-MUTATOR ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL SCHEDULING DATE-MUTATOR ARCHITECTURE CHECKS PASSED');
