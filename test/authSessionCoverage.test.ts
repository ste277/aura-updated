/**
 * AURA-AUTH-SESSION-01-I2 -- static session coverage (replaces the I1 dormancy
 * guard; design §2.3, §6: "extend the REL-02-A2 scanner to the new cookie
 * names, E2 server pages and E4 MCP consent"). No database.
 *
 *   npx ts-node test/authSessionCoverage.test.ts
 *
 * Production code = apps/web/{app,pages,lib,components} and packages/STAR/src.
 * Comments are stripped before matching. Rules:
 *   C1  the v1 session API (createSessionToken / verifySessionToken /
 *       SESSION_COOKIE_NAME / SessionPayload) appears nowhere in production;
 *   C2  the legacy cookie name 'as_session' appears only in lib/authSessionToken.ts;
 *   C3  the v2 cookie names ('as_sid' / '__Host-as_sid') appear only in lib/authSessionToken.ts;
 *   C4  no production file outside lib/session.ts reads a cookie -- no
 *       `cookies().get(...)`, `req.cookies.get(...)`, `.getAll()`, no use of
 *       `activeSessionCookieName` / `readSessionCookieFromHeader` -- not even a
 *       presence check (I2-R1, 39246-04: the Plan Day bypass). Only the MCP
 *       consent files pass the raw Cookie header to lib/session.ts;
 *   C5  every getSessionFromRequest / getSessionWithUserFromRequest call is
 *       `const X = await ...(req);` immediately followed by
 *       `if (X === SESSION_UNAVAILABLE) return sessionUnavailableResponse();`;
 *   C6  every page / header helper (getSessionFromCookieStore,
 *       getSessionWithUserFromCookieStore, getSessionFromCookieHeader,
 *       sessionUserFromCookie, verifyTestSessionToken excluded) is awaited (or
 *       memoised with `??=` and awaited by its consumer);
 *   C7  every exported HTTP handler of every API route (checked per handler,
 *       TypeScript AST; I2-R1) calls a session helper itself or through a
 *       same-file function, or its file is on the explicit PUBLIC list below
 *       (with its reason) -- a new route must be classified;
 *   C8  B4: only the sign-in routes issue a session (createSignInSession /
 *       setSessionCookie / issueSessionToken); only logout clears v2 cookies;
 *   C9  no injected seam re-verifies: `getSession: () => getSessionFromRequest` is forbidden;
 *   C10 lib/session.ts does no work at import (TypeScript AST: no top-level call
 *       other than Symbol(); no pool, key or env access at module load);
 *   C11 the four I1 modules still never read process.env (I1 D2 retained);
 *   C12 every E2 server page resolves its session inside
 *       pageSessionOrUnavailable (lib/sessionPage.ts): an outage is 503 + Retry-After.
 * Negative fixtures run the same scanner over deliberately bad trees.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, note = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${note ? ' -- ' + note : ''}`);
  if (ok) passes++;
  else failures++;
}

/** Routes that authenticate by other means, or serve no user data. Reason required. */
export const PUBLIC_ROUTES: Record<string, string> = {
  'apps/web/app/api/aura-moments/[token]/response/route.ts': 'recipient response, authorised by the unguessable share token',
  'apps/web/app/api/auth/request-link/route.ts': 'requests a sign-in link (pre-authentication)',
  'apps/web/app/api/guest/state/route.ts': 'guest search state (signed short-lived guest token, no account)',
  'apps/web/app/api/guest/timing-search/route.ts': 'guest timing search (no account)',
  'apps/web/app/api/health/route.ts': 'health probe, no user data',
  'apps/web/app/api/internal/product-metrics/route.ts': 'internal, shared-secret gated (404 otherwise)',
  'apps/web/app/api/internal/reminders/dispatch/route.ts': 'daily cron, shared-secret gated (404 otherwise); runs the session cleanup',
  'apps/web/app/api/mcp/route.ts': 'MCP resource server: OAuth bearer tokens (D6: unchanged), Production reject_all',
  'apps/web/app/api/push/public-key/route.ts': 'VAPID public key, no user data',
  'apps/web/pages/api/oauth/[...oidc].ts': 'MCP authorization server; its login and consent use lib/session.ts via lib/mcpLocalOAuth.ts (E4)',
};

const SESSION_CALLERS = /\b(getSessionFromRequest|getSessionWithUserFromRequest|sessionUserFromCookie|revokeRequestSession|createSignInSession)\s*\(/;

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
    else if (/\.(ts|tsx|js|mjs)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

interface Scan {
  violations: string[];
  routeFiles: number;
  handlers: number;
  sessionCalls: number;
  publicSeen: Set<string>;
}

function productionFiles(root: string): string[] {
  const web = ['app', 'pages', 'lib', 'components'].flatMap((d) => listSource(path.join(root, 'apps', 'web', d)));
  let pkgs: string[] = [];
  try {
    pkgs = readdirSync(path.join(root, 'packages')).flatMap((p) => listSource(path.join(root, 'packages', p, 'src')));
  } catch {
    /* fixture trees may have no packages */
  }
  return [...web, ...pkgs];
}

function scan(root: string): Scan {
  const violations: string[] = [];
  let routeFiles = 0;
  let handlerCount = 0;
  let sessionCalls = 0;
  const publicSeen = new Set<string>();
  for (const file of productionFiles(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const src = stripComments(readFileSync(file, 'utf8'));
    const is = (p: string) => rel === `apps/web/${p}`;
    const isSession = is('lib/session.ts');
    const isToken = is('lib/authSessionToken.ts');

    // C1
    const v1 = src.match(/\b(createSessionToken|verifySessionToken|SESSION_COOKIE_NAME|SessionPayload)\b/);
    if (v1) violations.push(`C1 ${rel}: v1 session API "${v1[1]}"`);
    // C2 / C3
    if (!isToken && /['"`]as_session['"`]/.test(src)) violations.push(`C2 ${rel}: legacy cookie name literal`);
    if (!isToken && /['"`](__Host-)?as_sid['"`]/.test(src)) violations.push(`C3 ${rel}: v2 cookie name literal`);
    // C4 (I2-R1: no presence-check exception -- any cookie value read outside lib/session.ts)
    if (!isSession) {
      for (const m of src.matchAll(/\bcookies(\(\))?\s*\.\s*(get|getAll|has)\s*\(/g)) violations.push(`C4 ${rel}: reads a cookie (${m[0]}) outside lib/session.ts`);
      if (!isToken) for (const m of src.matchAll(/\b(activeSessionCookieName|readSessionCookieFromHeader)\b/g)) violations.push(`C4 ${rel}: uses ${m[1]} outside lib/session.ts`);
      const rawHeader = /headers\.get\(\s*['"]cookie['"]\s*\)|headers\.cookie\b/.test(src);
      const mcpConsent = is('lib/mcpLocalOAuth.ts') || is('app/api/mcp/connections/route.ts');
      if (rawHeader && !mcpConsent && rel.startsWith('apps/web/')) violations.push(`C4 ${rel}: reads the raw Cookie header outside lib/session.ts`);
    }
    // C5
    if (!isSession) {
      for (const m of src.matchAll(/\b(getSessionFromRequest|getSessionWithUserFromRequest)\s*\(/g)) {
        sessionCalls++;
        const before = src.slice(Math.max(0, m.index! - 80), m.index);
        const after = src.slice(m.index!, m.index! + 260);
        const decl = before.match(/(?:const|let)\s+(\w+)\s*=\s*await\s+$/);
        if (!decl) {
          violations.push(`C5 ${rel}: ${m[1]}(...) is not "const X = await ..."`);
          continue;
        }
        const v = decl[1];
        const guard = new RegExp(`^\\w+\\s*\\([^)]*\\)\\s*;\\s*if\\s*\\(\\s*${v}\\s*===\\s*SESSION_UNAVAILABLE\\s*\\)\\s*return\\s+sessionUnavailableResponse\\(\\)\\s*;`);
        if (!guard.test(after)) violations.push(`C5 ${rel}: ${m[1]}(...) is not followed by the SESSION_UNAVAILABLE -> 503 check`);
      }
    }
    // C6
    if (!isSession) {
      for (const m of src.matchAll(/\b(getSessionFromCookieStore|getSessionWithUserFromCookieStore|getSessionFromCookieHeader|sessionUserFromCookie)\s*\(/g)) {
        const before = src.slice(Math.max(0, m.index! - 60), m.index);
        if (/(export\s+)?(async\s+)?function\s*$/.test(before)) continue; // a definition
        // I2-R1: lib/sessionPage.ts pageSessionOrUnavailable(() => helper(...)) awaits the lookup and maps an outage to 503.
        const viaPageBoundary = /pageSessionOrUnavailable\(\s*\(\)\s*=>\s*$/.test(before);
        if (!/await\s+(\(\s*)?$/.test(before) && !/\?\?=\s*$/.test(before) && !viaPageBoundary) violations.push(`C6 ${rel}: ${m[1]}(...) is not awaited`);
      }
    }
    // C12 (I2-R1, 39246-03): an E2 server page maps a session outage to 503 through lib/sessionPage.ts.
    if (/^apps\/web\/app\/.+\/page\.tsx?$/.test(rel)) {
      for (const m of src.matchAll(/\b(getSessionFromCookieStore|getSessionWithUserFromCookieStore)\s*\(/g)) {
        const before = src.slice(Math.max(0, m.index! - 60), m.index);
        if (!/pageSessionOrUnavailable\(\s*\(\)\s*=>\s*$/.test(before)) violations.push(`C12 ${rel}: ${m[1]}(...) outside pageSessionOrUnavailable (an outage would not answer 503)`);
      }
    }
    // C7
    const isRoute = (/^apps\/web\/app\/api\/.+\/route\.(ts|js)$/.test(rel) || /^apps\/web\/pages\/api\//.test(rel));
    if (isRoute) {
      routeFiles++;
      if (PUBLIC_ROUTES[rel]) publicSeen.add(rel);
      else {
        const handlers = exportedHandlers(file);
        if (handlers.length === 0 && !SESSION_CALLERS.test(src)) violations.push(`C7 ${rel}: API route neither authenticates through lib/session.ts nor is classified PUBLIC`);
        for (const h of handlers) {
          handlerCount++;
          if (!h.authenticates) violations.push(`C7 ${rel}: handler ${h.name} neither authenticates through lib/session.ts nor is in a PUBLIC route`);
        }
      }
    }
    // C8
    const signInRoute = is('app/api/auth/verify-code/route.ts') || is('app/api/auth/verify/route.ts');
    if (!isSession && !signInRoute && /\b(createSignInSession|setSessionCookie|issueSessionToken)\s*\(/.test(src)) violations.push(`C8 ${rel}: issues a session outside sign-in (B4)`);
    if (!isSession && !is('app/api/auth/logout/route.ts') && /\bclearSessionCookies\s*\(/.test(src)) violations.push(`C8 ${rel}: clears v2 session cookies outside logout`);
    // C9
    if (/getSession\s*:\s*\(\s*\)\s*=>\s*getSession(WithUser)?FromRequest/.test(src)) violations.push(`C9 ${rel}: a seam re-verifies instead of passing the verified session`);
    // C11
    if (/^apps\/web\/lib\/(authSessionDb|authSessionStore|authSessionToken|sessionErrors)\.ts$/.test(rel) && /process\s*\.\s*env/.test(src)) violations.push(`C11 ${rel}: I1 module reads process.env`);
  }
  return { violations, routeFiles, handlers: handlerCount, sessionCalls, publicSeen };
}

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'default']);

/**
 * C7 (I2-R1): each exported HTTP handler of a route file (App Router method
 * exports, or a Pages API default export) and whether its body -- or a
 * function declared in the same file that it calls, transitively --
 * contains a lib/session.ts session call. Comments are not code (AST).
 */
function exportedHandlers(file: string): Array<{ name: string; authenticates: boolean }> {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const local = new Map<string, ts.Node>();
  const handlers: Array<{ name: string; node: ts.Node }> = [];
  const exported = (n: ts.Node) => !!(ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) {
      const isDefault = !!(ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Default);
      const name = isDefault ? 'default' : st.name?.text ?? '';
      if (st.name) local.set(st.name.text, st.body);
      if (exported(st) && HTTP_METHODS.has(name)) handlers.push({ name, node: st.body });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        local.set(d.name.text, d.initializer);
        if (exported(st) && HTTP_METHODS.has(d.name.text)) handlers.push({ name: d.name.text, node: d.initializer });
      }
    } else if (ts.isExportAssignment(st)) {
      handlers.push({ name: 'default', node: st.expression });
    }
  }
  const authenticates = (node: ts.Node, seen: Set<string>): boolean => {
    let found = false;
    const visit = (n: ts.Node) => {
      if (found) return;
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        if (SESSION_CALLERS.test(`${name}(`)) found = true;
        else if (ts.isIdentifier(callee) && local.has(name) && !seen.has(name)) {
          seen.add(name);
          if (authenticates(local.get(name)!, seen)) found = true;
        }
      }
      if (ts.isIdentifier(n) && local.has(n.text) && !seen.has(n.text) && n.parent && !ts.isCallExpression(n.parent)) {
        // a same-file function passed by reference (e.g. a wrapper's callback)
        seen.add(n.text);
        if (authenticates(local.get(n.text)!, seen)) found = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  };
  return handlers.map((h) => ({ name: h.name, authenticates: authenticates(h.node, new Set()) }));
}

/** C10 on one file: top-level statements may not evaluate calls (except Symbol()). */
function importTimeWork(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: string[] = [];
  const visitExpr = (n: ts.Node) => {
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return; // bodies are not evaluated at import
    if (ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isAwaitExpression(n) || ts.isTaggedTemplateExpression(n)) {
      const callee = ts.isCallExpression(n) || ts.isNewExpression(n) ? n.expression.getText(sf) : n.getText(sf).slice(0, 20);
      if (callee !== 'Symbol') found.push(`${callee} at line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
    }
    if (ts.isPropertyAccessExpression(n) && n.getText(sf).startsWith('process.env')) found.push(`process.env at line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
    ts.forEachChild(n, visitExpr);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st)) continue;
    if (ts.isExportDeclaration(st)) continue;
    ts.forEachChild(st, visitExpr);
  }
  return found;
}

// --- The real tree -------------------------------------------------------------------
const real = scan(ROOT);
for (const v of real.violations) console.log('     ' + v);
check('C1-C9, C11, C12: no session-coverage violation in production code', real.violations.length === 0, `${real.violations.length} violation(s)`);
check(`C5: database-backed session calls in routes were found (${real.sessionCalls})`, real.sessionCalls >= 98);
check(`C7: API routes were scanned (${real.routeFiles})`, real.routeFiles >= 85);
check(`C7: exported handlers were checked individually (${real.handlers})`, real.handlers >= 100);
const stale = Object.keys(PUBLIC_ROUTES).filter((r) => !real.publicSeen.has(r));
check('C7: every PUBLIC route still exists (the list is not stale)', stale.length === 0, stale.join(', '));
const tw = importTimeWork(path.join(ROOT, 'apps/web/lib/session.ts'));
check('C10: lib/session.ts does no work at import (no pool, key or env access at load)', tw.length === 0, tw.join('; '));
const sessionSrc = readFileSync(path.join(ROOT, 'apps/web/lib/session.ts'), 'utf8');
check('C10b: lib/session.ts reads only the active cookie name (no legacy read, no fallback)', !/LEGACY_SESSION_COOKIE_NAME\s*\)\s*\?\.value/.test(sessionSrc) && !/get\(\s*LEGACY_SESSION_COOKIE_NAME\s*\)\s*\?\./.test(sessionSrc));
check('C10c: no authentication mode switch / enforcement flag in lib/session.ts', !/process\.env\.(?!AURA_DATABASE_URL|DATABASE_URL|NODE_ENV)\w+/.test(sessionSrc));

// --- Negative fixtures ------------------------------------------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), 'aura-session-coverage-'));
function fixture(files: Record<string, string>): Scan {
  const dir = mkdtempSync(path.join(tmp, 'f-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return scan(dir);
}
const has = (s: Scan, rule: string) => s.violations.some((v) => v.startsWith(rule + ' '));
const ROUTE = 'apps/web/app/api/x/route.ts';
try {
  check('N1 (C1) a v1 verifier call is reported', has(fixture({ [ROUTE]: "import { verifySessionToken } from '../../../lib/auth'; export async function GET(req){ const s = verifySessionToken('t'); }" }), 'C1'));
  check('N2 (C2) reading as_session is reported', has(fixture({ 'apps/web/lib/x.ts': "export const n = 'as_session';" }), 'C2'));
  check('N3 (C3) a hard-coded v2 cookie name is reported', has(fixture({ 'apps/web/lib/x.ts': "export const n = '__Host-as_sid';" }), 'C3'));
  check('N4 (C4) a direct cookie read is reported', has(fixture({ 'apps/web/app/page.tsx': "import { cookies } from 'next/headers'; const t = cookies().get(name)?.value;" }), 'C4'));
  check('N5 (C4) a raw Cookie header read is reported', has(fixture({ [ROUTE]: "export async function GET(req){ const c = req.headers.get('cookie'); getSessionFromRequest }" }), 'C4'));
  check('N6 (C5) an un-awaited session call is reported', has(fixture({ [ROUTE]: 'export async function GET(req){ const session = getSessionFromRequest(req); if (!session) return 1; }' }), 'C5'));
  check(
    'N7 (C5) a missing 503 check is reported (outage would read as 401)',
    has(fixture({ [ROUTE]: 'export async function GET(req){ const session = await getSessionFromRequest(req); if (!session) return 1; }' }), 'C5')
  );
  check(
    'N8 (C5) the correct pattern is NOT reported',
    !has(fixture({ [ROUTE]: 'export async function GET(req){ const session = await getSessionFromRequest(req);\n  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();\n  if (!session) return 1; }' }), 'C5')
  );
  check('N9 (C6) an un-awaited page helper is reported', has(fixture({ 'apps/web/app/p/page.tsx': 'export default async function P(){ const s = getSessionFromCookieStore(cookies()); }' }), 'C6'));
  check('N10 (C7) an unclassified, unauthenticated route is reported', has(fixture({ [ROUTE]: 'export async function GET(){ return listEverything(); }' }), 'C7'));
  check('N11 (C8) issuing a session outside sign-in is reported', has(fixture({ [ROUTE]: 'export async function GET(req){ setSessionCookie(res, s); getSessionFromRequest }' }), 'C8'));
  check('N12 (C8) clearing v2 cookies outside logout is reported', has(fixture({ [ROUTE]: 'export async function GET(req){ clearSessionCookies(res); getSessionFromRequest }' }), 'C8'));
  check('N13 (C9) a re-verifying seam is reported', has(fixture({ [ROUTE]: 'export async function POST(req){ return h({ getSession: () => getSessionFromRequest(req) }); }' }), 'C9'));
  check('N14 (C11) an I1 module reading process.env is reported', has(fixture({ 'apps/web/lib/authSessionStore.ts': 'export const x = process.env.X;' }), 'C11'));
  check('N15 (C1) a v1 reference inside packages/ is reported', has(fixture({ 'packages/p/src/a.ts': 'export const n = SESSION_COOKIE_NAME;' }), 'C1'));
  check('N16 comments are ignored (a commented-out violation is not reported)', !has(fixture({ 'apps/web/lib/x.ts': "// verifySessionToken('x')\n/* 'as_session' */ export const a = 1;" }), 'C1'));
  // I2-R1 (39246-04): the reproduced Plan Day bypass and the per-handler gap.
  check(
    'N18 (C4) the Plan Day presence-check bypass (raw session cookie value passed to a seam) is reported',
    has(fixture({ 'apps/web/app/plan-day/page.tsx': "import { cookies } from 'next/headers'; export default async function P(){ return resolve({ getSessionToken: () => cookies().get(activeSessionCookieName())?.value }); }" }), 'C4')
  );
  check('N19 (C4) a request-cookie read of the session cookie is reported', has(fixture({ [ROUTE]: 'export async function GET(req){ const t = req.cookies.get(activeSessionCookieName())?.value; getSessionFromRequest }' }), 'C4'));
  check(
    'N20 (C7) a route whose SECOND handler does not authenticate is reported (file-level match is not enough)',
    has(fixture({ [ROUTE]: 'export async function GET(req){ const s = await getSessionFromRequest(req);\n  if (s === SESSION_UNAVAILABLE) return sessionUnavailableResponse(); }\nexport async function DELETE(req){ return dropEverything(); }' }), 'C7')
  );
  check(
    'N21 (C7) a handler authenticating through a same-file helper is NOT reported',
    !has(fixture({ [ROUTE]: 'async function auth(req){ const s = await getSessionFromRequest(req);\n  if (s === SESSION_UNAVAILABLE) return sessionUnavailableResponse(); return s; }\nexport async function GET(req){ return auth(req); }' }), 'C7')
  );
  check('N22 (C7) a session helper named only in a comment does not count', has(fixture({ [ROUTE]: 'export async function GET(req){ /* getSessionFromRequest(req) */ return listEverything(); }' }), 'C7'));
  check('N23 (C12) an E2 page awaiting the helper directly (outage -> generic error, not 503) is reported', has(fixture({ 'apps/web/app/p/page.tsx': 'export default async function P(){ const s = await getSessionFromCookieStore(cookies()); }' }), 'C12'));
  const badSession = path.join(tmp, 'bad-session.ts');
  writeFileSync(badSession, "import { createSessionPool } from './authSessionDb';\nconst pool = createSessionPool(process.env.DATABASE_URL!);\nexport const S: unique symbol = Symbol('x');\nexport function f(){ return createSessionPool('x'); }\n");
  const tw2 = importTimeWork(badSession);
  check('N17 (C10) import-time pool creation and env access are reported (and function bodies are not)', tw2.some((x) => x.startsWith('createSessionPool at line 2')) && tw2.some((x) => x.startsWith('process.env')) && !tw2.some((x) => x.includes('line 4')));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
