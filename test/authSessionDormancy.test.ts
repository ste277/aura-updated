/**
 * AURA-AUTH-SESSION-01-I1 -- static dormancy guard. No database.
 *
 *   npx ts-node test/authSessionDormancy.test.ts
 *
 * I1 adds the session store foundation WITHOUT wiring it in. This guard fails if:
 *   D1  anything in apps/web/{app,pages,components} or apps/web/lib (other than
 *       the four I1 modules themselves) imports an I1 module;
 *   D2  an I1 module reads process.env;
 *   D3  an I1 module creates a pool, derives a key or opens a connection at
 *       module top level (i.e. at import);
 *   D4  migration 0055 contains anything but CREATE TABLE / CREATE INDEX.
 * Negative fixtures run the same scanner over deliberately bad files.
 *
 * The cutover ticket (I2) replaces this guard with the session coverage test.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'apps', 'web');
const I1_MODULES = ['authSessionToken', 'authSessionDb', 'authSessionStore', 'sessionErrors'];
const MIGRATION = path.join(WEB, 'prisma', 'migrations', '0055_auth_session', 'migration.sql');

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? ` -- ${JSON.stringify(detail)}` : ''}`);
}

function listSource(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(listSource(p));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

/** Top-level code only: drops every brace-enclosed block (functions, classes, objects). */
function topLevel(src: string): string {
  let depth = 0;
  let out = '';
  for (const ch of src) {
    if (ch === '{') depth++;
    if (depth === 0) out += ch;
    if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return out;
}

function scan(webRoot: string): string[] {
  const violations: string[] = [];
  const importRe = new RegExp(`(from\\s+|require\\(\\s*|import\\(\\s*)['"][^'"]*/(${I1_MODULES.join('|')})['"]`);
  for (const dir of ['app', 'pages', 'components', 'lib']) {
    for (const file of listSource(path.join(webRoot, dir))) {
      const rel = path.relative(webRoot, file).split(path.sep).join('/');
      const base = path.basename(file).replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '');
      const isI1 = rel.startsWith('lib/') && I1_MODULES.includes(base) && rel.split('/').length === 2;
      const src = stripComments(readFileSync(file, 'utf8'));
      if (!isI1 && importRe.test(src)) violations.push(`D1 ${rel}: imports an I1 module`);
      if (isI1) {
        if (/process\s*\.\s*env/.test(src)) violations.push(`D2 ${rel}: reads process.env`);
        const top = topLevel(src);
        // Calls only -- a `function name(` declaration is not work at import.
        if (/new\s+Pool\s*\(|(?<!function\s+)\b(createSessionPool|deriveSessionKey|hkdfSync)\s*\(|\.connect\s*\(/.test(top)) {
          violations.push(`D3 ${rel}: does work at import`);
        }
      }
    }
  }
  return violations;
}

function scanMigration(sql: string): string[] {
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = statements.filter((s) => !/^CREATE\s+(TABLE|INDEX)\s+"AuthSession/i.test(s) && !/^CREATE\s+INDEX\s+"AuthSession_/i.test(s));
  return bad.map((s) => `D4 non-additive statement: ${s.slice(0, 60)}`);
}

// --- The real tree -------------------------------------------------------------
const real = scan(WEB);
check('D1-D3: no application import of I1 modules; no env read or import-time work in them', real.length === 0, real);
for (const m of I1_MODULES) {
  let exists = false;
  try {
    exists = statSync(path.join(WEB, 'lib', `${m}.ts`)).isFile();
  } catch {
    exists = false;
  }
  check(`I1 module present: lib/${m}.ts`, exists);
}
const migrationSql = readFileSync(MIGRATION, 'utf8');
const migrationViolations = scanMigration(migrationSql);
check('D4: migration 0055 is additive only (CREATE TABLE / CREATE INDEX for AuthSession)', migrationViolations.length === 0, migrationViolations);
check('D4: migration 0055 creates exactly one table and two indexes', (migrationSql.match(/CREATE TABLE/g) ?? []).length === 1 && (migrationSql.match(/CREATE INDEX/g) ?? []).length === 2);

// --- Negative fixtures -------------------------------------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), 'auth-session-dormancy-'));
try {
  for (const d of ['app/api/x', 'components', 'lib', 'pages/api']) mkdirSync(path.join(tmp, d), { recursive: true });
  writeFileSync(path.join(tmp, 'app/api/x/route.ts'), `import { lookupAuthSession } from '../../../lib/authSessionStore';\n`);
  writeFileSync(path.join(tmp, 'components/Thing.tsx'), `const e = require('../lib/sessionErrors');\n`);
  writeFileSync(path.join(tmp, 'pages/api/y.ts'), `export default async () => { await import('../../lib/authSessionToken'); };\n`);
  writeFileSync(path.join(tmp, 'lib/session.ts'), `import { createSessionPool } from './authSessionDb';\n`);
  writeFileSync(path.join(tmp, 'lib/authSessionDb.ts'), `const pool = new Pool({ connectionString: process.env.DATABASE_URL });\nexport function f() {}\n`);
  writeFileSync(path.join(tmp, 'lib/authSessionToken.ts'), `export const KEY = deriveSessionKey('x');\n`);
  writeFileSync(path.join(tmp, 'lib/authSessionStore.ts'), `export function createSessionPool(s: string) { return s; }\nexport function ok() { const p = createSessionPool('x'); return p; }\n`);
  const v = scan(tmp);
  const has = (prefix: string, file: string) => v.some((x) => x.startsWith(prefix) && x.includes(file));
  check('fixture: route import is caught (D1)', has('D1', 'app/api/x/route.ts'));
  check('fixture: component require is caught (D1)', has('D1', 'components/Thing.tsx'));
  check('fixture: dynamic import in pages is caught (D1)', has('D1', 'pages/api/y.ts'));
  check('fixture: lib/session.ts import is caught (D1)', has('D1', 'lib/session.ts'));
  check('fixture: env read in an I1 module is caught (D2)', has('D2', 'lib/authSessionDb.ts'));
  check('fixture: top-level pool creation is caught (D3)', has('D3', 'lib/authSessionDb.ts'));
  check('fixture: top-level key derivation is caught (D3)', has('D3', 'lib/authSessionToken.ts'));
  check('fixture: a declaration, and pool creation inside a function, are allowed', !has('D3', 'lib/authSessionStore.ts'));
  check('fixture: a non-additive migration statement is caught (D4)', scanMigration('CREATE TABLE "AuthSession" (x int);\nALTER TABLE "User" ADD COLUMN y int;\nDROP TABLE "Goal";').length === 2);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
