/**
 * AURA-MCP-02-I1.5-D -- database identity guard (apps/web/scripts/check-db-identity.js)
 * and its wiring into apps/web/scripts/vercel-build.sh.
 *
 * Synthetic URLs and fixtures only: no database connection, no migration, no
 * network, no Vercel credentials. Section C runs the REAL vercel-build.sh in a
 * temp tree with fake `npx`/`next` and a stub Palmistry scanner, recording
 * which commands would have run.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const guard = require('../apps/web/scripts/check-db-identity.js') as {
  evaluate: (env: Record<string, string | undefined>, options?: { stagingProjectIds?: string[] }) => { ok: boolean; code: string };
  normalizeHost: (host: string) => string;
  PRODUCTION_PROJECT_ID: string;
  STAGING_PROJECT_IDS: readonly string[];
};

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'apps/web/scripts/check-db-identity.js');
const BUILD = path.join(ROOT, 'apps/web/scripts/vercel-build.sh');

// ---------- synthetic fixtures (never real hosts or credentials) ----------
const PROD_PROJECT = 'prj_iY4xteQOWUNsV85NnbyIylBAba6t';
const STAGING_PROJECT = 'prj_SYNTHETIC_STAGING_0001';
const PIN = { stagingProjectIds: [STAGING_PROJECT] };

const STG_HOST = 'ep-quiet-sky-a1b2c3.us-east-1.aws.neon.tech';
const STG_POOLED_HOST = 'ep-quiet-sky-a1b2c3-pooler.us-east-1.aws.neon.tech';
const PROD_HOST = 'ep-prod-zz9y8x.us-east-1.aws.neon.tech';
const PROD_POOLED_HOST = 'ep-prod-zz9y8x-pooler.us-east-1.aws.neon.tech';
const OTHER_HOST = 'ep-other-q7w8e9.us-east-1.aws.neon.tech';

const STG_PASS = 'SynthStg_Passw0rd_7781';
const RT_PASS = 'SynthRuntime_Passw0rd_3321';
const PROD_PASS = 'SynthProd_Passw0rd_9902';

const url = (user: string, pass: string, host: string, db: string, extra = '?sslmode=require') => `postgresql://${user}:${pass}@${host}/${db}${extra}`;
const STG_DIRECT = url('stg_owner', STG_PASS, STG_HOST, 'aura_staging');
const STG_POOLED = url('stg_owner', STG_PASS, STG_POOLED_HOST, 'aura_staging');
const PROD_URL = url('prod_owner', PROD_PASS, PROD_HOST, 'neondb');

const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function stagingEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const base: Record<string, string | undefined> = {
    VERCEL_ENV: 'production',
    VERCEL_PROJECT_ID: STAGING_PROJECT,
    AURA_STAGING_EXPECTED_DB_HOST: STG_HOST,
    AURA_STAGING_EXPECTED_DB_NAME: 'aura_staging',
    AURA_STAGING_EXPECTED_DB_USER: 'stg_owner',
    AURA_STAGING_FORBIDDEN_DB_HOSTS: sha(PROD_HOST),
    DATABASE_URL: STG_DIRECT,
  };
  const env = { ...base, ...overrides };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}
const ev = (env: Record<string, string | undefined>, opts = PIN) => guard.evaluate(env, opts);
const is = (env: Record<string, string | undefined>, code: string, opts = PIN) => {
  const r = ev(env, opts);
  return r.code === code && r.ok === (code === 'STAGING_VERIFIED' || code === 'PRODUCTION_PROJECT' || code === 'NOT_PRODUCTION_BUILD');
};

// ============================================================
// A. Policy (the ticket's scenario table, then edge cases)
// ============================================================
check('A1. both URLs match the approved staging DB -> PASS', is(stagingEnv({ AURA_DATABASE_URL: STG_POOLED }), 'STAGING_VERIFIED'));
check('A2. only DATABASE_URL configured and valid -> PASS (runtime falls back to it)', is(stagingEnv(), 'STAGING_VERIFIED'));
check('A3. only AURA_DATABASE_URL configured -> FAIL (migrations require DATABASE_URL)', is(stagingEnv({ DATABASE_URL: undefined, AURA_DATABASE_URL: STG_DIRECT }), 'MIGRATION_URL_MISSING'));
check('A4. runtime URL points to Production -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: PROD_URL }), 'RUNTIME_URL_FORBIDDEN_HOST'));
check('A4b. ... also via Production\'s pooled endpoint (normalised before hashing)', is(stagingEnv({ AURA_DATABASE_URL: url('prod_owner', PROD_PASS, PROD_POOLED_HOST, 'neondb') }), 'RUNTIME_URL_FORBIDDEN_HOST'));
check('A5. migration URL points to Production -> FAIL', is(stagingEnv({ DATABASE_URL: PROD_URL }), 'MIGRATION_URL_FORBIDDEN_HOST'));
check('A5b. ... also via Production\'s pooled endpoint', is(stagingEnv({ DATABASE_URL: url('prod_owner', PROD_PASS, PROD_POOLED_HOST, 'neondb') }), 'MIGRATION_URL_FORBIDDEN_HOST'));
check('A6. runtime and migration identities differ (other host) -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: url('stg_owner', STG_PASS, OTHER_HOST, 'aura_staging') }), 'RUNTIME_DB_MISMATCH'));
check('A6b. ... (same host, other database) -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: url('stg_owner', STG_PASS, STG_HOST, 'aura_other') }), 'RUNTIME_DB_MISMATCH'));
check('A6c. ... (same host and database, other port) -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: url('stg_owner', STG_PASS, `${STG_HOST}:6543`, 'aura_staging') }), 'RUNTIME_DB_MISMATCH'));
check('A7. pooled migration URL + direct runtime URL for the same staging DB -> PASS', is(stagingEnv({ DATABASE_URL: STG_POOLED, AURA_DATABASE_URL: STG_DIRECT }), 'STAGING_VERIFIED'));
check('A7b. pooled expected host + direct URLs -> PASS (expected host is normalised too)', is(stagingEnv({ AURA_STAGING_EXPECTED_DB_HOST: STG_POOLED_HOST, AURA_DATABASE_URL: STG_POOLED }), 'STAGING_VERIFIED'));
check('A7c. pooler folding applies to Neon hosts only (db-pooler.example.com != db.example.com)', is(stagingEnv({ AURA_STAGING_EXPECTED_DB_HOST: 'db.example.com', AURA_STAGING_FORBIDDEN_DB_HOSTS: 'prod.example.com', DATABASE_URL: url('stg_owner', STG_PASS, 'db-pooler.example.com', 'aura_staging') }), 'MIGRATION_DB_MISMATCH'));
check('A7d. host comparison ignores case and a trailing dot', is(stagingEnv({ DATABASE_URL: url('stg_owner', STG_PASS, `${STG_HOST.toUpperCase()}.`, 'aura_staging') }), 'STAGING_VERIFIED'));

const malformed: [string, string][] = [
  ['not a url', 'not-a-url'],
  ['wrong scheme', `mysql://stg_owner:${STG_PASS}@${STG_HOST}/aura_staging`],
  ['no database path', `postgresql://stg_owner:${STG_PASS}@${STG_HOST}/`],
  ['nested path', `postgresql://stg_owner:${STG_PASS}@${STG_HOST}/aura_staging/x`],
  ['multi-host authority', `postgresql://stg_owner:${STG_PASS}@${STG_HOST},${PROD_HOST}/aura_staging`],
  ['?host= redirect', `${STG_DIRECT}&host=${PROD_HOST}`],
  ['?hostaddr= redirect', `${STG_DIRECT}&hostaddr=10.0.0.9`],
  ['?dbname= redirect', `${STG_DIRECT}&dbname=neondb`],
  ['?user= override', `${STG_DIRECT}&user=prod_owner`],
  ['?options= injection', `${STG_DIRECT}&options=-csearch_path%3Dx`],
  ['surrounding whitespace', ` ${STG_DIRECT}`],
  ['fragment', `${STG_DIRECT}#x`],
  ['bad port', `postgresql://stg_owner:${STG_PASS}@${STG_HOST}:99999/aura_staging`],
];
for (const [label, value] of malformed) {
  check(`A8. malformed migration URL (${label}) -> FAIL`, is(stagingEnv({ DATABASE_URL: value }), 'MIGRATION_URL_MALFORMED'));
  check(`A8. malformed runtime URL (${label}) -> FAIL`, is(stagingEnv({ AURA_DATABASE_URL: value }), 'RUNTIME_URL_MALFORMED'));
}
check('A8b. whitespace-only AURA_DATABASE_URL (truthy in lib/db.ts) -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: '   ' }), 'RUNTIME_URL_MALFORMED'));
check('A8c. empty AURA_DATABASE_URL falls back to DATABASE_URL (as lib/db.ts does) -> PASS', is(stagingEnv({ AURA_DATABASE_URL: '' }), 'STAGING_VERIFIED'));

for (const key of ['AURA_STAGING_EXPECTED_DB_HOST', 'AURA_STAGING_EXPECTED_DB_NAME', 'AURA_STAGING_EXPECTED_DB_USER', 'AURA_STAGING_FORBIDDEN_DB_HOSTS']) {
  check(`A9. missing ${key} -> FAIL`, is(stagingEnv({ [key]: undefined }), 'STAGING_IDENTITY_MISSING'));
  check(`A9. blank ${key} -> FAIL`, is(stagingEnv({ [key]: '  ' }), 'STAGING_IDENTITY_MISSING'));
}
check('A9b. forbidden list of only separators -> FAIL', is(stagingEnv({ AURA_STAGING_FORBIDDEN_DB_HOSTS: ' , ,' }), 'STAGING_IDENTITY_MISSING'));
check('A9c. expected staging host is itself forbidden -> FAIL', is(stagingEnv({ AURA_STAGING_FORBIDDEN_DB_HOSTS: sha(STG_HOST) }), 'STAGING_IDENTITY_FORBIDDEN'));
check('A9d. plaintext forbidden entries are also honoured', is(stagingEnv({ AURA_STAGING_FORBIDDEN_DB_HOSTS: `x.example.com, ${PROD_POOLED_HOST}`, DATABASE_URL: PROD_URL }), 'MIGRATION_URL_FORBIDDEN_HOST'));

check('A10. migration URL without password -> FAIL', is(stagingEnv({ DATABASE_URL: `postgresql://stg_owner@${STG_HOST}/aura_staging` }), 'MIGRATION_URL_CREDENTIALS_MISSING'));
check('A10. migration URL without user -> FAIL', is(stagingEnv({ DATABASE_URL: `postgresql://:${STG_PASS}@${STG_HOST}/aura_staging` }), 'MIGRATION_URL_CREDENTIALS_MISSING'));
check('A10. runtime URL without password -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: `postgresql://stg_owner@${STG_HOST}/aura_staging` }), 'RUNTIME_URL_CREDENTIALS_MISSING'));
check('A10b. migration role differs from the expected role -> FAIL', is(stagingEnv({ DATABASE_URL: url('someone_else', STG_PASS, STG_HOST, 'aura_staging') }), 'MIGRATION_ROLE_MISMATCH'));
check('A10c. runtime role differs -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: url('aura_runtime', RT_PASS, STG_HOST, 'aura_staging') }), 'RUNTIME_ROLE_MISMATCH'));
check('A10d. runtime role allowed when AURA_STAGING_EXPECTED_RUNTIME_DB_USER names it -> PASS', is(stagingEnv({ AURA_STAGING_EXPECTED_RUNTIME_DB_USER: 'aura_runtime', AURA_DATABASE_URL: url('aura_runtime', RT_PASS, STG_POOLED_HOST, 'aura_staging') }), 'STAGING_VERIFIED'));
check('A10e. percent-encoded database name compares by decoded value', is(stagingEnv({ AURA_STAGING_EXPECTED_DB_NAME: 'aura staging', DATABASE_URL: url('stg_owner', STG_PASS, STG_HOST, 'aura%20staging') }), 'STAGING_VERIFIED'));

check('A11. Production project with no staging configuration -> allowed (behaviour unchanged)', is({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, DATABASE_URL: PROD_URL }, 'PRODUCTION_PROJECT'));
check('A11b. Production project is never subjected to staging identity rules (even with AURA_DATABASE_URL set elsewhere)', is({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, DATABASE_URL: PROD_URL, AURA_DATABASE_URL: url('aura_runtime', RT_PASS, PROD_POOLED_HOST, 'neondb') }, 'PRODUCTION_PROJECT'));
check('A11c. Production project without DATABASE_URL is not newly blocked by the guard (Prisma reports it, as before)', is({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT }, 'PRODUCTION_PROJECT'));
check('A12. VERCEL_PROJECT_ID missing in a migrating build -> FAIL', is(stagingEnv({ VERCEL_PROJECT_ID: undefined }), 'PROJECT_ID_MISSING'));
check('A12b. VERCEL_PROJECT_ID blank -> FAIL', is(stagingEnv({ VERCEL_PROJECT_ID: '  ' }), 'PROJECT_ID_MISSING'));
check('A13. perfectly configured but UNPINNED staging project -> FAIL', is(stagingEnv({ AURA_DATABASE_URL: STG_POOLED }), 'PROJECT_NOT_ALLOWLISTED', { stagingProjectIds: [] }));
check('A13b. the committed staging allowlist is empty (pinned by a later PR before the first staging build)', Array.isArray(guard.STAGING_PROJECT_IDS) && guard.STAGING_PROJECT_IDS.length === 0 && Object.isFrozen(guard.STAGING_PROJECT_IDS));
check('A13c. so with the committed allowlist, a staging project is refused today', guard.evaluate(stagingEnv()).code === 'PROJECT_NOT_ALLOWLISTED');
check('A13d. committed Production project ID is the aura-updated project', guard.PRODUCTION_PROJECT_ID === PROD_PROJECT);
check('A14. Preview build -> not guarded (no migration runs)', is(stagingEnv({ VERCEL_ENV: 'preview', DATABASE_URL: undefined }), 'NOT_PRODUCTION_BUILD'));
check('A14b. unset VERCEL_ENV -> not guarded', is({}, 'NOT_PRODUCTION_BUILD'));
check('A15. normalizeHost folds the Neon pooler label only', guard.normalizeHost(STG_POOLED_HOST) === STG_HOST && guard.normalizeHost('a-pooler.example.com') === 'a-pooler.example.com');

// ============================================================
// B. CLI: exit codes and no credential disclosure
// ============================================================
const SECRET_FRAGMENTS = [STG_PASS, RT_PASS, PROD_PASS, STG_HOST, STG_POOLED_HOST, PROD_HOST, PROD_POOLED_HOST, OTHER_HOST, 'stg_owner', 'prod_owner', 'aura_runtime', 'aura_staging', 'neondb', 'postgres'];
function runGuard(env: Record<string, string | undefined>) {
  const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const res = spawnSync(process.execPath, [GUARD], { env: clean, encoding: 'utf8' });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}
const cliCases: [string, Record<string, string | undefined>, number][] = [
  ['production project', { VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, DATABASE_URL: PROD_URL, AURA_DATABASE_URL: PROD_URL }, 0],
  ['project id missing', stagingEnv({ VERCEL_PROJECT_ID: undefined, AURA_DATABASE_URL: PROD_URL }), 1],
  ['unpinned staging, migration -> prod', stagingEnv({ DATABASE_URL: PROD_URL }), 1],
  ['unpinned staging, runtime -> prod', stagingEnv({ AURA_DATABASE_URL: PROD_URL }), 1],
  ['unpinned staging, malformed', stagingEnv({ DATABASE_URL: `${STG_DIRECT}&host=${PROD_HOST}` }), 1],
  ['preview', { VERCEL_ENV: 'preview', DATABASE_URL: PROD_URL }, 0],
];
for (const [label, env, expected] of cliCases) {
  const r = runGuard(env);
  const leaked = SECRET_FRAGMENTS.filter((s) => r.out.toLowerCase().includes(s.toLowerCase()));
  check(`B1. CLI (${label}) exits ${expected}`, r.status === expected);
  check(`B2. CLI (${label}) prints exactly one line, with no URL, host, role, database or password`, r.out.trim().split('\n').length === 1 && leaked.length === 0);
}
check('B3. a refusal names a reason code', /DB identity REFUSED: [A-Z_]+$/.test(runGuard(stagingEnv({ DATABASE_URL: PROD_URL })).out.trim()));
// Refusal output for EVERY policy refusal, evaluated in-process with the pin, contains only the code.
const refusalCodes = [
  ev(stagingEnv({ AURA_DATABASE_URL: PROD_URL })),
  ev(stagingEnv({ DATABASE_URL: `postgresql://stg_owner@${STG_HOST}/aura_staging` })),
  ev(stagingEnv({ DATABASE_URL: `${STG_DIRECT}&host=${PROD_HOST}` })),
].map((r) => r.code);
check('B4. reason codes are fixed identifiers (never derived from input)', refusalCodes.every((c) => /^[A-Z_]+$/.test(c) && !SECRET_FRAGMENTS.some((s) => c.toLowerCase().includes(s.toLowerCase()))));
const guardSource = fs.readFileSync(GUARD, 'utf8');
check('B5. guard source never prints env values (console output uses only fixed strings and result.code)', !/console\.(log|error)\([^)]*(env\.|process\.env|raw|url\b|conn|host|user|password)/i.test(guardSource));

// ============================================================
// C. The real vercel-build.sh: ordering and fail-closed wiring
// ============================================================
function runBuild(env: Record<string, string | undefined>) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-identity-guard-'));
  try {
    const web = path.join(tmp, 'apps/web');
    fs.mkdirSync(path.join(web, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
    fs.copyFileSync(BUILD, path.join(web, 'scripts/vercel-build.sh'));
    fs.copyFileSync(GUARD, path.join(web, 'scripts/check-db-identity.js'));
    const log = path.join(tmp, 'calls.log');
    // Stub Palmistry scanner (covered by palm01P4VercelGuard.test.ts); records that it ran.
    fs.writeFileSync(path.join(web, 'scripts/check-palmistry-bundle.js'), `require('fs').appendFileSync(${JSON.stringify(log)}, 'scanner\\n');\n`);
    fs.writeFileSync(path.join(tmp, 'bin/next'), `#!/bin/sh\necho "next $*" >> "${log}"\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(tmp, 'bin/npx'), `#!/bin/sh\necho "npx $*" >> "${log}"\nexit 0\n`, { mode: 0o755 });
    const childEnv: NodeJS.ProcessEnv = { PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}` };
    for (const [k, v] of Object.entries(env)) if (v !== undefined) childEnv[k] = v;
    const res = spawnSync('sh', ['scripts/vercel-build.sh'], { cwd: web, env: childEnv, encoding: 'utf8' });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { status: res.status, out: `${res.stdout}${res.stderr}`, calls };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const prod = runBuild({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, DATABASE_URL: PROD_URL });
check('C1. Production project: build exits 0', prod.status === 0);
check('C2. ... migration, then next build, then scanner (order unchanged)', prod.calls.join('|') === 'npx prisma migrate deploy|next build|scanner');
check('C3. ... and the guard reported a pass without disclosing anything', /DB identity check passed \(PRODUCTION_PROJECT\)/.test(prod.out) && !SECRET_FRAGMENTS.some((s) => prod.out.includes(s)));

const noId = runBuild({ VERCEL_ENV: 'production', DATABASE_URL: PROD_URL });
check('C4. migrating build without VERCEL_PROJECT_ID: build FAILS', typeof noId.status === 'number' && noId.status !== 0);
check('C5. ... before any migration or build ran', noId.calls.length === 0 && /REFUSED: PROJECT_ID_MISSING/.test(noId.out));

const stagingToProd = runBuild(stagingEnv({ DATABASE_URL: PROD_URL, AURA_DATABASE_URL: PROD_URL }));
check('C6. non-Production project pointing at Production: build FAILS before `prisma migrate deploy`', typeof stagingToProd.status === 'number' && stagingToProd.status !== 0 && stagingToProd.calls.length === 0);
check('C7. ... output discloses no credential', !SECRET_FRAGMENTS.some((s) => stagingToProd.out.includes(s)));

const stagingGood = runBuild(stagingEnv({ AURA_DATABASE_URL: STG_POOLED }));
check('C8. correctly configured staging project is still refused until its ID is pinned (no migration, no build)', typeof stagingGood.status === 'number' && stagingGood.status !== 0 && stagingGood.calls.length === 0 && /PROJECT_NOT_ALLOWLISTED/.test(stagingGood.out));

const preview = runBuild({ VERCEL_ENV: 'preview' });
check('C9. Preview without any DB credentials: build exits 0, no guard, no migration (unchanged)', preview.status === 0 && preview.calls.join('|') === 'next build|scanner' && !/DB identity/.test(preview.out));

// ============================================================
// D. Static wiring
// ============================================================
const script = fs.readFileSync(BUILD, 'utf8');
const code = script.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const iGuard = code.indexOf('node "$SCRIPT_DIR/check-db-identity.js"');
const iMigrate = code.indexOf('npx prisma migrate deploy');
const iDir = code.indexOf('SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"');
check('D1. the guard runs immediately before `prisma migrate deploy`', iGuard >= 0 && iMigrate === iGuard + 1);
check('D2. SCRIPT_DIR is defined before the guard uses it', iDir >= 0 && iDir < iGuard);
check('D3. the guard call is not exit-code-swallowed', !/check-db-identity\.js"?\s*(\|\||;|&)/.test(script));
check('D4. vercel-build.sh still never references a database URL itself', !/DATABASE_URL/.test(code.join('\n')) && !/postgres(ql)?:\/\//.test(script));
const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
check('D5. this test is wired into CI', /run: npx ts-node test\/dbIdentityGuard\.test\.ts/.test(ci));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('SOME DB IDENTITY GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DB IDENTITY GUARD CHECKS PASSED');
