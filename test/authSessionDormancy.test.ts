/**
 * AURA-AUTH-SESSION-01-I1 -- dormancy guard (R1: syntax-aware, finding 39232-03).
 *
 *   npx ts-node test/authSessionDormancy.test.ts
 *
 * I1 adds the session store foundation WITHOUT wiring it in. Every check is
 * made on the TypeScript AST (the repository's own `typescript` package, no
 * new dependency), not on regular expressions over source text:
 *
 *   D1  no production file outside the four I1 modules has a RUNTIME
 *       reference to an I1 module: named / default / namespace / aliased /
 *       side-effect imports, re-exports (incl. `export *`), `import x =
 *       require()`, `require()` and `import()` (string or template literal).
 *       Type-only references (`import type`, `export type`, all-`type`
 *       specifiers) are not runtime and are allowed. A dynamic `import()` /
 *       `require()` whose specifier is computed and mentions an I1 module is a
 *       violation (it cannot be proven not to load it).
 *   D1b no I1 module is TRANSITIVELY reachable through runtime edges from any
 *       production entry point: every app/ and pages/ file, root-level
 *       middleware and instrumentation (.ts/.js/.mjs/.cjs, also under src/),
 *       next.config.js and capacitor.config.ts. Edges follow relative and `@/`
 *       paths anywhere in the repository (so a barrel in another directory or
 *       a package is followed).
 *   D2  an I1 module never reads process.env (property or element access).
 *   D3  an I1 module does no work at import: no call, `new` (except the inert
 *       WeakMap / WeakSet / Map / Set / RegExp / Symbol / Object.freeze),
 *       `await` or tagged template is EVALUATED at module load -- including
 *       inside top-level blocks, conditionals, loops, IIFEs, class static
 *       blocks and static property initialisers. Function, method and arrow
 *       bodies that are merely defined are not evaluated and are allowed.
 *   D4  migration 0055 contains only CREATE TABLE / CREATE INDEX for AuthSession.
 *   P   isolated import probe: each I1 module is required in a child process
 *       with an EMPTY application environment and instrumented side effects
 *       (pg Pool/Client construction, net connections, timers, env reads,
 *       key derivation, filesystem writes); none may be triggered by import.
 *
 * Negative fixtures run the same checks over deliberately bad trees. Test
 * files (test/) are not production and may import the I1 modules.
 * The cutover ticket (I2) replaces this guard with the session coverage test.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');
const I1_MODULES = ['authSessionToken', 'authSessionDb', 'authSessionStore', 'sessionErrors'];
const MIGRATION = path.join(WEB, 'prisma', 'migrations', '0055_auth_session', 'migration.sql');
const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'android', 'ios', 'public', 'cap-shell', 'prisma', 'assets', 'patches']);

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
}

// --- File discovery and resolution ----------------------------------------------
function listSource(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(listSource(p));
    else if (SOURCE_EXT.includes(path.extname(e)) && !e.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function resolveSpecifier(fromFile: string, spec: string, webRoot: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = path.join(webRoot, spec.slice(2));
  else return null; // bare package specifier: not application code
  const candidates = [base, ...SOURCE_EXT.map((x) => base + x), ...SOURCE_EXT.map((x) => path.join(base, 'index' + x))];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* next */
    }
  }
  return null;
}

const isI1File = (file: string, webRoot: string) => {
  const rel = path.relative(path.join(webRoot, 'lib'), file);
  return !rel.startsWith('..') && !rel.includes(path.sep) && I1_MODULES.includes(rel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, ''));
};

// --- AST analysis ---------------------------------------------------------------
interface Edge {
  spec: string;
  kind: string;
  runtime: boolean;
}
interface Analysis {
  edges: Edge[];
  computedDynamic: string[]; // non-literal import()/require() specifier texts
  envReads: number;
  importTimeWork: string[];
}

function parse(file: string): ts.SourceFile {
  const kind = /\.tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

const literalText = (n: ts.Node | undefined): string | null =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

const INERT_NEW = new Set(['WeakMap', 'WeakSet', 'Map', 'Set', 'RegExp']);
const isFunctionLike = (n: ts.Node) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n);

function analyse(file: string): Analysis {
  const sf = parse(file);
  const a: Analysis = { edges: [], computedDynamic: [], envReads: 0, importTimeWork: [] };

  // Module references (anywhere in the file, including inside functions).
  const visitRefs = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n)) {
      const spec = literalText(n.moduleSpecifier) ?? '';
      const c = n.importClause;
      let runtime = true;
      if (c) {
        if (c.isTypeOnly) runtime = false;
        else if (!c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)) runtime = false;
      }
      a.edges.push({ spec, kind: c ? (c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? 'namespace import' : 'import') : 'side-effect import', runtime });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      const allTypeSpecifiers = !!n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.length > 0 && n.exportClause.elements.every((e) => e.isTypeOnly);
      a.edges.push({ spec: literalText(n.moduleSpecifier) ?? '', kind: n.exportClause ? 're-export' : 'export *', runtime: !n.isTypeOnly && !allTypeSpecifiers });
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      a.edges.push({ spec: literalText(n.moduleReference.expression) ?? '', kind: 'import = require', runtime: !n.isTypeOnly });
    } else if (ts.isCallExpression(n)) {
      const isDynImport = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === 'require';
      if (isDynImport || isRequire) {
        const arg = n.arguments[0];
        const lit = literalText(arg);
        if (lit !== null) a.edges.push({ spec: lit, kind: isDynImport ? 'dynamic import' : 'require', runtime: true });
        else if (arg) a.computedDynamic.push(arg.getText(sf));
      }
    }
    // process.env / process['env']
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'process' && n.name.text === 'env') a.envReads++;
    if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'process' && literalText(n.argumentExpression) === 'env') a.envReads++;
    ts.forEachChild(n, visitRefs);
  };
  visitRefs(sf);

  // Import-time evaluation: walk only code that RUNS when the module loads.
  const evaluated = (n: ts.Node): void => {
    if (isFunctionLike(n)) return; // defined, not executed
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) {
      for (const m of n.members) {
        if (ts.isClassStaticBlockDeclaration(m)) evaluated(m.body);
        else if (ts.isPropertyDeclaration(m) && m.initializer && ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) evaluated(m.initializer);
        else if (ts.isPropertyDeclaration(m) && m.name && ts.isComputedPropertyName(m.name)) evaluated(m.name.expression);
      }
      if (n.heritageClauses) n.heritageClauses.forEach((h) => h.types.forEach((t) => evaluated(t.expression)));
      return;
    }
    if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      // An IIFE: the function body DOES run at import.
      if (ts.isParenthesizedExpression(callee) && (ts.isArrowFunction(callee.expression) || ts.isFunctionExpression(callee.expression))) {
        a.importTimeWork.push(`IIFE: ${n.getText(sf).slice(0, 60)}`);
        const fn = callee.expression;
        if (fn.body) ts.forEachChild(fn.body, evaluated);
      } else {
        const name = callee.getText(sf);
        if (!(name === 'Object.freeze' || name === 'Symbol')) a.importTimeWork.push(`call ${name}()`);
      }
    } else if (ts.isNewExpression(n)) {
      const name = n.expression.getText(sf);
      if (!INERT_NEW.has(name)) a.importTimeWork.push(`new ${name}()`);
    } else if (ts.isAwaitExpression(n)) {
      a.importTimeWork.push('top-level await');
    } else if (ts.isTaggedTemplateExpression(n)) {
      a.importTimeWork.push(`tagged template ${n.tag.getText(sf)}`);
    } else if (n.kind === ts.SyntaxKind.ImportKeyword && ts.isCallExpression(n.parent)) {
      a.importTimeWork.push('import() at load');
    }
    ts.forEachChild(n, evaluated);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue;
    if (ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
    if (ts.isExportDeclaration(st) && st.moduleSpecifier) continue; // a re-export runs the other module, which is itself checked
    evaluated(st);
  }
  return a;
}

// --- Whole-tree scan --------------------------------------------------------------
interface ScanResult {
  violations: string[];
  entries: number;
  reachable: number;
  files: number;
}

function isEntry(file: string, webRoot: string): boolean {
  const rel = path.relative(webRoot, file).split(path.sep).join('/');
  if (rel.startsWith('app/') || rel.startsWith('pages/') || rel.startsWith('src/app/') || rel.startsWith('src/pages/')) return true;
  return /^(src\/)?(middleware|instrumentation|instrumentation-client)\.(ts|tsx|js|mjs|cjs)$/.test(rel) || /^next\.config\.(js|mjs|cjs|ts)$/.test(rel) || rel === 'capacitor.config.ts';
}

function scan(webRoot: string): ScanResult {
  const files = listSource(webRoot);
  const cache = new Map<string, Analysis>();
  const get = (f: string) => {
    let x = cache.get(f);
    if (!x) cache.set(f, (x = analyse(f)));
    return x;
  };
  const violations: string[] = [];
  const nameRe = new RegExp(I1_MODULES.join('|'));
  for (const f of files) {
    const rel = path.relative(webRoot, f).split(path.sep).join('/');
    const a = get(f);
    const i1 = isI1File(f, webRoot);
    for (const e of a.edges) {
      if (!e.runtime) continue;
      const target = resolveSpecifier(f, e.spec, webRoot);
      if (target && isI1File(target, webRoot) && !i1) violations.push(`D1 ${rel}: ${e.kind} of an I1 module ('${e.spec}')`);
    }
    for (const d of a.computedDynamic) if (nameRe.test(d)) violations.push(`D1 ${rel}: computed dynamic import/require mentioning an I1 module (${d.slice(0, 60)})`);
    if (i1) {
      if (a.envReads > 0) violations.push(`D2 ${rel}: reads process.env (${a.envReads}x)`);
      for (const w of a.importTimeWork) violations.push(`D3 ${rel}: import-time ${w}`);
    }
  }
  // D1b -- transitive runtime reachability from every entry point.
  const entries = files.filter((f) => isEntry(f, webRoot));
  const seen = new Set<string>();
  const parent = new Map<string, string>();
  const queue = [...entries];
  entries.forEach((e) => seen.add(e));
  while (queue.length) {
    const f = queue.shift() as string;
    if (!SOURCE_EXT.includes(path.extname(f))) continue;
    let a: Analysis;
    try {
      a = get(f);
    } catch {
      continue;
    }
    for (const e of a.edges) {
      if (!e.runtime) continue;
      const t = resolveSpecifier(f, e.spec, webRoot);
      if (!t || seen.has(t)) continue;
      seen.add(t);
      parent.set(t, f);
      if (isI1File(t, webRoot)) {
        const chain = [t];
        let p = parent.get(t);
        while (p) chain.push(p), (p = parent.get(p));
        violations.push(`D1b I1 module reachable at runtime: ${chain.reverse().map((x) => path.relative(webRoot, x)).join(' -> ')}`);
      }
      queue.push(t);
    }
  }
  return { violations: [...new Set(violations)], entries: entries.length, reachable: seen.size, files: files.length };
}

function scanMigration(sql: string): string[] {
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return statements.filter((s) => !/^CREATE\s+(TABLE|INDEX)\s+"AuthSession/i.test(s)).map((s) => `D4 non-additive statement: ${s.slice(0, 60)}`);
}

// --- Isolated import probe ----------------------------------------------------------
const PROBE = String.raw`
const path = require('path');
const targets = JSON.parse(process.argv[1]);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const hits = [];
const inTarget = () => { const s = new Error().stack || ''; return targets.some((t) => s.includes(t)); };
const note = (what) => { if (inTarget()) hits.push(what); };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const m = origLoad.apply(this, arguments);
  if (request === 'pg' && m && !m.__probed) {
    const wrap = (C, name) => new Proxy(C, { construct(t, args) { note('new pg.' + name); return Reflect.construct(t, args); } });
    const p = Object.create(m); p.Pool = wrap(m.Pool, 'Pool'); p.Client = wrap(m.Client, 'Client'); p.__probed = true;
    return p;
  }
  return m;
};
const net = require('net');
for (const k of ['connect', 'createConnection']) { const o = net[k]; net[k] = function () { note('net.' + k); return o.apply(this, arguments); }; }
const crypto = require('crypto');
for (const k of ['hkdfSync', 'randomBytes', 'createHmac']) { const o = crypto[k]; crypto[k] = function () { note('crypto.' + k); return o.apply(this, arguments); }; }
const fs = require('fs');
for (const k of ['writeFileSync', 'writeFile', 'appendFileSync', 'mkdirSync']) { const o = fs[k]; fs[k] = function () { note('fs.' + k); return o.apply(this, arguments); }; }
for (const k of ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']) { const o = global[k]; global[k] = function () { note(k); return o.apply(this, arguments); }; }
const env = process.env;
process.env = new Proxy(env, { get(t, p) { note('process.env.' + String(p)); return t[p]; } });
const loaded = {};
for (const t of targets) { const m = require(t); loaded[path.basename(t)] = Object.keys(m).length; }
process.stdout.write(JSON.stringify({ hits, loaded, envKeys: Object.keys(env).filter((k) => !['PATH'].includes(k)) }));
`;

function importProbe(targets: string[]): { hits: string[]; loaded: Record<string, number>; envKeys: string[] } {
  const r = spawnSync(process.execPath, ['-e', PROBE, JSON.stringify(targets)], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? '' }, // cleared application environment
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.status !== 0) throw new Error(`import probe failed: ${r.stderr.slice(0, 400)}`);
  return JSON.parse(r.stdout);
}

/** Variables the OS itself adds to every child process (macOS); never application configuration. */
const OS_INJECTED_ENV = ['__CF_USER_TEXT_ENCODING'];
const APP_ENV = /^(AUTH_|AURA_|DATABASE|DB_|PG|NODE_ENV|VERCEL|NEXT_|RESEND|GEMINI|OPENCAGE)/;

// === The real tree ====================================================================
const real = scan(WEB);
check(`D1 / D1b / D2 / D3: no runtime reference, reachability, env read or import-time work (${real.files} files, ${real.entries} entry points, ${real.reachable} reachable)`, real.violations.length === 0, real.violations);
check('entry points discovered (app/, pages/, configs)', real.entries > 50, real.entries);
for (const m of I1_MODULES) check(`I1 module present: lib/${m}.ts`, existsSync(path.join(WEB, 'lib', `${m}.ts`)));
const migrationSql = readFileSync(MIGRATION, 'utf8');
check('D4: migration 0055 is additive only (CREATE TABLE / CREATE INDEX for AuthSession)', scanMigration(migrationSql).length === 0, scanMigration(migrationSql));
check('D4: migration 0055 creates exactly one table and two indexes', (migrationSql.match(/CREATE TABLE/g) ?? []).length === 1 && (migrationSql.match(/CREATE INDEX/g) ?? []).length === 2);
const probe = importProbe(I1_MODULES.map((m) => path.join(WEB, 'lib', `${m}.ts`)));
check('P import probe: all four I1 modules load with an empty application environment', Object.keys(probe.loaded).length === 4 && Object.values(probe.loaded).every((n) => n > 0) && probe.envKeys.every((k) => OS_INJECTED_ENV.includes(k)) && !probe.envKeys.some((k) => APP_ENV.test(k)), probe);
check('P import probe: importing them triggers no pool/client, connection, timer, env read, key derivation, randomness or file write', probe.hits.length === 0, probe.hits);

// === Negative fixtures ===================================================================
const tmp = mkdtempSync(path.join(tmpdir(), 'auth-session-dormancy-'));
const FIXTURE_WEB = path.join(tmp, 'apps', 'web');
function fixture(files: Record<string, string>): ScanResult {
  rmSync(FIXTURE_WEB, { recursive: true, force: true });
  mkdirSync(path.join(FIXTURE_WEB, 'lib'), { recursive: true });
  for (const m of I1_MODULES) copyFileSync(path.join(WEB, 'lib', `${m}.ts`), path.join(FIXTURE_WEB, 'lib', `${m}.ts`));
  mkdirSync(path.join(FIXTURE_WEB, 'app', 'api', 'ok'), { recursive: true });
  writeFileSync(path.join(FIXTURE_WEB, 'app', 'api', 'ok', 'route.ts'), `export async function GET() { return new Response(null); }\n`);
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(FIXTURE_WEB, rel)), { recursive: true });
    writeFileSync(path.join(FIXTURE_WEB, rel), src);
  }
  return scan(FIXTURE_WEB);
}
const has = (r: ScanResult, code: string, text: string) => r.violations.some((v) => v.startsWith(code) && v.includes(text));
const realRoute = readFileSync(path.join(WEB, 'app', 'api', 'auth', 'logout', 'route.ts'), 'utf8');
try {
  const baseline = fixture({});
  check('fixture baseline: copies of the real I1 modules + a plain route are clean', baseline.violations.length === 0, baseline.violations);

  const neg: Array<[string, Record<string, string>, string, string]> = [
    ['middleware.ts named import', { 'middleware.ts': `import { lookupAuthSession } from './lib/authSessionStore';\nexport function middleware() { void lookupAuthSession; }\n` }, 'D1', 'middleware.ts'],
    ['src/middleware.ts via @/ alias', { 'src/middleware.ts': `import { lookupAuthSession } from '@/lib/authSessionStore';\nexport function middleware() { void lookupAuthSession; }\n` }, 'D1', 'src/middleware.ts'],
    ['instrumentation.ts dynamic import', { 'instrumentation.ts': `export async function register() { await import('./lib/authSessionStore'); }\n` }, 'D1', 'instrumentation.ts'],
    ['existing route + aliased import', { 'app/api/auth/logout/route.ts': `import { revokeAuthSession as r } from '../../../../lib/authSessionStore';\n${realRoute}\nvoid r;\n` }, 'D1', 'app/api/auth/logout/route.ts'],
    ['namespace import', { 'app/api/n/route.ts': `import * as s from '../../../lib/authSessionDb';\nexport const GET = () => s;\n` }, 'D1', 'namespace import'],
    ['default import', { 'app/api/d/route.ts': `import x from '../../../lib/authSessionDb';\nexport const GET = () => x;\n` }, 'D1', 'app/api/d/route.ts'],
    ['side-effect import', { 'components/X.tsx': `import '../lib/sessionErrors';\nexport const X = 1;\n` }, 'D1', 'side-effect import'],
    ['export * re-export', { 'app/api/e/route.ts': `export * from '../../../lib/authSessionStore';\n` }, 'D1', 'export *'],
    ['named re-export', { 'lib/sub/barrel.ts': `export { lookupAuthSession } from '../authSessionStore';\n` }, 'D1', 'lib/sub/barrel.ts'],
    ['dynamic import, template literal', { 'app/api/t/route.ts': 'export async function GET() { await import(`../../../lib/authSessionStore`); return new Response(null); }\n' }, 'D1', 'dynamic import'],
    ['require, template literal', { 'app/api/q/route.ts': 'const s = require(`../../../lib/authSessionDb`);\nexport const GET = () => s;\n' }, 'D1', 'require'],
    ['import = require', { 'app/api/i/route.ts': `import s = require('../../../lib/authSessionToken');\nexport const GET = () => s;\n` }, 'D1', 'import = require'],
    ['computed dynamic import', { 'app/api/c/route.ts': `export async function GET() { await import('../../../lib/' + 'authSessionStore'); return new Response(null); }\n` }, 'D1', 'computed dynamic'],
    ['I1: pool inside a top-level if block', { 'lib/authSessionDb.ts': readFileSync(path.join(WEB, 'lib', 'authSessionDb.ts'), 'utf8') + `\nif (process.argv.length > 0) { createSessionPool('postgres://probe@127.0.0.1/x'); }\n` }, 'D3', 'createSessionPool'],
    ['I1: key derived in an IIFE', { 'lib/authSessionToken.ts': readFileSync(path.join(WEB, 'lib', 'authSessionToken.ts'), 'utf8') + `\nexport const K = (() => { return deriveSessionKey('x'.repeat(40)); })();\n` }, 'D3', 'deriveSessionKey'],
    ['I1: class static block', { 'lib/authSessionStore.ts': readFileSync(path.join(WEB, 'lib', 'authSessionStore.ts'), 'utf8') + `\nclass Boot { static { setTimeout(() => {}, 0); } }\nvoid Boot;\n` }, 'D3', 'setTimeout'],
    ['I1: conditional new Pool', { 'lib/sessionErrors.ts': readFileSync(path.join(WEB, 'lib', 'sessionErrors.ts'), 'utf8') + `\nimport { Pool } from 'pg';\nexport const P = process.argv.length > 99 ? null : new Pool();\n` }, 'D3', 'new Pool'],
    ['I1: env read inside a function', { 'lib/sessionErrors.ts': readFileSync(path.join(WEB, 'lib', 'sessionErrors.ts'), 'utf8') + `\nexport function u() { return process['env'].X; }\n` }, 'D2', 'sessionErrors'],
  ];
  for (const [label, files, code, text] of neg) {
    const r = fixture(files);
    check(`fixture rejects: ${label} (${code})`, has(r, code, text), r.violations);
  }
  // Indirect: entry -> barrel in another directory -> I1 (both the barrel edge and the reachability chain).
  const indirect = fixture({
    'lib/util/barrel.ts': `export { lookupAuthSession as l } from '../authSessionStore';\n`,
    'app/api/z/route.ts': `import { l } from '../../../lib/util/barrel';\nexport const GET = () => l;\n`,
  });
  check('fixture rejects: indirect runtime import through a barrel (D1 on the barrel, D1b chain from the route)', has(indirect, 'D1', 'lib/util/barrel.ts') && has(indirect, 'D1b', 'app/api/z/route.ts -> lib/util/barrel.ts -> lib/authSessionStore.ts'), indirect.violations);

  // Permitted forms.
  const allowed = fixture({
    'app/api/tt/route.ts': `import type { CommittedAuthSession } from '../../../lib/authSessionStore';\nimport { type SessionClock } from '../../../lib/authSessionDb';\nexport type { SessionUnavailableReason } from '../../../lib/sessionErrors';\nexport function GET(): CommittedAuthSession | SessionClock | null { return null; }\n`,
    'lib/authSessionDb.ts': readFileSync(path.join(WEB, 'lib', 'authSessionDb.ts'), 'utf8') + `\nexport function later() { return createSessionPool('postgres://x@127.0.0.1/y'); }\n`,
  });
  check('fixture allows: type-only imports / exports, and calls inside function bodies of I1 modules', allowed.violations.length === 0, allowed.violations);
  check('fixture allows: test/ files are not production (not scanned)', !listSource(FIXTURE_WEB).some((f) => f.includes(`${path.sep}test${path.sep}`)));

  // Import probe negative control: a module with an import-time side effect is caught.
  const sideFx = path.join(FIXTURE_WEB, 'lib', 'probeSideEffect.ts');
  writeFileSync(sideFx, `setTimeout(() => {}, 0);\nexport const X = process.env.HOME;\n`);
  const p2 = importProbe([sideFx]);
  check('probe control: an import-time timer and env read are recorded', p2.hits.includes('setTimeout') && p2.hits.some((h) => h.startsWith('process.env.')), p2.hits);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
