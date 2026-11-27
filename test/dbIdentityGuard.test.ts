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
  evaluate: (env: Record<string, string | undefined>, options?: { stagingProjectIds?: string[]; stagingDbHostSha256?: string[] }) => { ok: boolean; code: string };
  normalizeHost: (host: string) => string;
  PRODUCTION_PROJECT_ID: string;
  STAGING_PROJECT_IDS: readonly string[];
  STAGING_DB_HOST_SHA256: readonly string[];
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
// Synthetic pins for the policy tests: a synthetic staging project and its synthetic DB host.
const PIN: { stagingProjectIds?: string[]; stagingDbHostSha256?: string[] } = { stagingProjectIds: [STAGING_PROJECT], stagingDbHostSha256: [sha(STG_HOST)] };

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
check('A7c. pooler folding applies to Neon hosts only (db-pooler.example.com != db.example.com)', is(stagingEnv({ AURA_STAGING_EXPECTED_DB_HOST: 'db.example.com', AURA_STAGING_FORBIDDEN_DB_HOSTS: 'prod.example.com', DATABASE_URL: url('stg_owner', STG_PASS, 'db-pooler.example.com', 'aura_staging') }), 'MIGRATION_DB_MISMATCH', { stagingProjectIds: [STAGING_PROJECT], stagingDbHostSha256: [sha('db.example.com')] }));
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
check('A13b. the committed staging allowlist is exactly the aura-staging project (see section E)', Array.isArray(guard.STAGING_PROJECT_IDS) && guard.STAGING_PROJECT_IDS.length === 1 && guard.STAGING_PROJECT_IDS[0] === 'prj_0wR8cnuX0dphdd3ExRGOT0AqcuEa' && Object.isFrozen(guard.STAGING_PROJECT_IDS));
check('A13c. with the committed allowlist, any other (synthetic) staging project is still refused', guard.evaluate(stagingEnv()).code === 'PROJECT_NOT_ALLOWLISTED');
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
    // Stub PALM-03-E1 exclusion guard (covered by palm03E1ReleaseGuards.test.ts); records that it ran.
    fs.writeFileSync(path.join(web, 'scripts/check-palm-e1-bundle.js'), `require('fs').appendFileSync(${JSON.stringify(log)}, 'e1-scanner\\n');\n`);
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
check('C2. ... migration, then next build, then the E1 and guide scanners (migration still first)', prod.calls.join('|') === 'npx prisma migrate deploy|next build|e1-scanner|scanner');
check('C3. ... and the guard reported a pass without disclosing anything', /DB identity check passed \(PRODUCTION_PROJECT\)/.test(prod.out) && !SECRET_FRAGMENTS.some((s) => prod.out.includes(s)));

const noId = runBuild({ VERCEL_ENV: 'production', DATABASE_URL: PROD_URL });
check('C4. migrating build without VERCEL_PROJECT_ID: build FAILS', typeof noId.status === 'number' && noId.status !== 0);
check('C5. ... before any migration or build ran', noId.calls.length === 0 && /REFUSED: PROJECT_ID_MISSING/.test(noId.out));

const stagingToProd = runBuild(stagingEnv({ DATABASE_URL: PROD_URL, AURA_DATABASE_URL: PROD_URL }));
check('C6. non-Production project pointing at Production: build FAILS before `prisma migrate deploy`', typeof stagingToProd.status === 'number' && stagingToProd.status !== 0 && stagingToProd.calls.length === 0);
check('C7. ... output discloses no credential', !SECRET_FRAGMENTS.some((s) => stagingToProd.out.includes(s)));

const stagingGood = runBuild(stagingEnv({ AURA_DATABASE_URL: STG_POOLED }));
check('C8. correctly configured but UNPINNED project is refused (no migration, no build)', typeof stagingGood.status === 'number' && stagingGood.status !== 0 && stagingGood.calls.length === 0 && /PROJECT_NOT_ALLOWLISTED/.test(stagingGood.out));

const preview = runBuild({ VERCEL_ENV: 'preview' });
check('C9. Preview without any DB credentials: build exits 0, no guard, no migration (unchanged)', preview.status === 0 && preview.calls.join('|') === 'next build|e1-scanner|scanner' && !/DB identity/.test(preview.out));

// ============================================================
// E. aura-staging pin, staging DB pin, and Production reverse check
// ============================================================
const REAL_STAGING = 'prj_0wR8cnuX0dphdd3ExRGOT0AqcuEa';
const DB_PIN = { stagingDbHostSha256: [sha(STG_HOST)] }; // committed project allowlist + a synthetic DB pin
const realStagingEnv = (o: Record<string, string | undefined> = {}) => stagingEnv({ VERCEL_PROJECT_ID: REAL_STAGING, ...o });
const evc = (env: Record<string, string | undefined>, opts: { stagingProjectIds?: string[]; stagingDbHostSha256?: string[] } = {}) => guard.evaluate(env, opts);

// 1. Correct staging project ID is recognized
check('E1. the real aura-staging project ID is recognized (pinned DB, direct migration + pooled runtime) -> PASS', evc(realStagingEnv({ AURA_DATABASE_URL: STG_POOLED }), DB_PIN).code === 'STAGING_VERIFIED');
check('E1b. ... and is never treated as Production', evc(realStagingEnv(), DB_PIN).code !== 'PRODUCTION_PROJECT' && REAL_STAGING !== guard.PRODUCTION_PROJECT_ID);
// 2. Correct Production project ID remains recognized
check('E2. the Production project ID is still recognized with the committed constants', evc({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, DATABASE_URL: PROD_URL }).code === 'PRODUCTION_PROJECT');
check('E2b. ... and with the staging DB pinned, a Production DB that is not staging still passes (direct and pooled)', evc({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, DATABASE_URL: PROD_URL, AURA_DATABASE_URL: url('prod_owner', PROD_PASS, PROD_POOLED_HOST, 'neondb') }, DB_PIN).code === 'PRODUCTION_PROJECT');
// 3. Unknown project ID is rejected
check('E3. unknown project ID is rejected even with perfect staging configuration', evc(stagingEnv({ VERCEL_PROJECT_ID: 'prj_unknown_project_x' }), DB_PIN).code === 'PROJECT_NOT_ALLOWLISTED');
check('E3b. a project ID differing only in case is rejected', evc(realStagingEnv({ VERCEL_PROJECT_ID: REAL_STAGING.toLowerCase() }), DB_PIN).code === 'PROJECT_NOT_ALLOWLISTED');
// 4. Staging project with Production database identity is rejected
check('E4. aura-staging migrating against the Production DB -> FAIL', evc(realStagingEnv({ DATABASE_URL: PROD_URL }), DB_PIN).code === 'MIGRATION_URL_FORBIDDEN_HOST');
check('E4b. aura-staging running against the Production DB (pooled) -> FAIL', evc(realStagingEnv({ AURA_DATABASE_URL: url('prod_owner', PROD_PASS, PROD_POOLED_HOST, 'neondb') }), DB_PIN).code === 'RUNTIME_URL_FORBIDDEN_HOST');
check('E4c. aura-staging whose EXPECTED host was switched to an unpinned DB -> FAIL (env alone cannot re-point staging)', evc(realStagingEnv({ AURA_STAGING_EXPECTED_DB_HOST: OTHER_HOST, DATABASE_URL: url('stg_owner', STG_PASS, OTHER_HOST, 'aura_staging') }), DB_PIN).code === 'STAGING_DB_NOT_PINNED');
check('E4d. with the committed DB pin, aura-staging targeting any other (synthetic) host is refused before migrating', evc(realStagingEnv()).code === 'STAGING_DB_NOT_PINNED');
check('E4e. a pooled expected host matches a pin computed from the direct host', evc(realStagingEnv({ AURA_STAGING_EXPECTED_DB_HOST: STG_POOLED_HOST, DATABASE_URL: STG_POOLED }), DB_PIN).code === 'STAGING_VERIFIED');
// 5. Production project with staging database identity is rejected
const prodEnv = (o: Record<string, string | undefined>) => ({ VERCEL_ENV: 'production', VERCEL_PROJECT_ID: PROD_PROJECT, ...o });
check('E5. Production migrating against the staging DB (direct) -> FAIL', evc(prodEnv({ DATABASE_URL: STG_DIRECT }), DB_PIN).code === 'PRODUCTION_DB_IS_STAGING');
check('E5b. Production migrating against the staging DB (pooled) -> FAIL', evc(prodEnv({ DATABASE_URL: STG_POOLED }), DB_PIN).code === 'PRODUCTION_DB_IS_STAGING');
check('E5c. Production runtime (AURA_DATABASE_URL) against the staging DB -> FAIL', evc(prodEnv({ DATABASE_URL: PROD_URL, AURA_DATABASE_URL: STG_POOLED }), DB_PIN).code === 'PRODUCTION_DB_IS_STAGING');
check('E5d. Production with an unparsable URL while the staging DB is pinned -> FAIL (unverifiable)', evc(prodEnv({ DATABASE_URL: 'not-a-url' }), DB_PIN).code === 'PRODUCTION_MIGRATION_URL_UNVERIFIABLE' && evc(prodEnv({ DATABASE_URL: PROD_URL, AURA_DATABASE_URL: 'mysql://x' }), DB_PIN).code === 'PRODUCTION_RUNTIME_URL_UNVERIFIABLE');
// 6. Missing required identity variables fail closed
for (const key of ['AURA_STAGING_EXPECTED_DB_HOST', 'AURA_STAGING_EXPECTED_DB_NAME', 'AURA_STAGING_EXPECTED_DB_USER', 'AURA_STAGING_FORBIDDEN_DB_HOSTS']) {
  check(`E6. aura-staging missing ${key} -> FAIL`, evc(realStagingEnv({ [key]: undefined }), DB_PIN).code === 'STAGING_IDENTITY_MISSING');
}
check('E6b. aura-staging missing DATABASE_URL -> FAIL', evc(realStagingEnv({ DATABASE_URL: undefined, AURA_DATABASE_URL: STG_POOLED }), DB_PIN).code === 'MIGRATION_URL_MISSING');
check('E6c. aura-staging missing VERCEL_PROJECT_ID -> FAIL', evc(realStagingEnv({ VERCEL_PROJECT_ID: undefined }), DB_PIN).code === 'PROJECT_ID_MISSING');
// 7. Existing Production migration behaviour preserved
check('E7. with the committed pin, Production on a non-staging DB still passes (direct + pooled runtime)', evc(prodEnv({ DATABASE_URL: PROD_URL, AURA_DATABASE_URL: url('prod_owner', PROD_PASS, PROD_POOLED_HOST, 'neondb') })).code === 'PRODUCTION_PROJECT');
check('E7b. a Production build without DATABASE_URL is still left to Prisma, pinned or not', evc(prodEnv({})).code === 'PRODUCTION_PROJECT' && evc(prodEnv({}), DB_PIN).code === 'PRODUCTION_PROJECT');
// Misconfiguration: the staging list can never contain the Production project
check('E8. a staging allowlist containing the Production ID refuses every migrating build', evc(prodEnv({ DATABASE_URL: PROD_URL }), { stagingProjectIds: [REAL_STAGING, PROD_PROJECT] }).code === 'GUARD_MISCONFIGURED' && evc(realStagingEnv(), { stagingProjectIds: [PROD_PROJECT], ...DB_PIN }).code === 'GUARD_MISCONFIGURED');
check('E8b. committed constants are frozen; the DB pin list holds only SHA-256 hex', Object.isFrozen(guard.STAGING_DB_HOST_SHA256) && guard.STAGING_DB_HOST_SHA256.every((h) => /^[0-9a-f]{64}$/.test(h)));
// --hash-host helper
const hashCli = (input: string) => spawnSync(process.execPath, [GUARD, '--hash-host'], { input, encoding: 'utf8', env: { PATH: process.env.PATH } });
const hDirect = hashCli(`${STG_HOST}\n`);
const hPooled = hashCli(STG_POOLED_HOST.toUpperCase());
check('E9. --hash-host prints exactly SHA-256(normalised host), and pooled/uppercase hosts give the same digest', hDirect.status === 0 && hDirect.stdout.trim() === sha(STG_HOST) && hPooled.stdout.trim() === sha(STG_HOST));
check('E9b. --hash-host never echoes the host', !hDirect.stdout.includes(STG_HOST) && !hDirect.stderr.includes(STG_HOST));
const hUrl = hashCli(STG_DIRECT);
check('E9c. --hash-host refuses a full connection URL (exit 1) without echoing it', hUrl.status === 1 && !`${hUrl.stdout}${hUrl.stderr}`.includes(STG_PASS) && !`${hUrl.stdout}${hUrl.stderr}`.includes(STG_HOST));
const realStagingBuild = runBuild(realStagingEnv({ AURA_DATABASE_URL: STG_POOLED }));
check('E10. the real vercel-build.sh refuses aura-staging before any migration while its DB is unpinned', typeof realStagingBuild.status === 'number' && realStagingBuild.status !== 0 && realStagingBuild.calls.length === 0 && /REFUSED: STAGING_DB_NOT_PINNED/.test(realStagingBuild.out) && !SECRET_FRAGMENTS.some((x) => realStagingBuild.out.includes(x)));

// ============================================================
// F. The committed staging DB pin (falling-glade-02684214)
// ============================================================
const COMMITTED_STAGING_DIGEST = 'c5b70ccce850d80ebe0a714327fa546adef5296e031ad848e4664c12e73e8ba7';
check('F1. STAGING_DB_HOST_SHA256 is exactly the verified aura-staging digest', guard.STAGING_DB_HOST_SHA256.length === 1 && guard.STAGING_DB_HOST_SHA256[0] === COMMITTED_STAGING_DIGEST && Object.isFrozen(guard.STAGING_DB_HOST_SHA256));
const guardText = fs.readFileSync(GUARD, 'utf8');
check('F2. the only SHA-256 digest committed in the guard is the staging one (the Production digest is never committed)', JSON.stringify([...new Set(guardText.match(/\b[0-9a-f]{64}\b/g) || [])]) === JSON.stringify([COMMITTED_STAGING_DIGEST]));
check('F3. no Neon hostname is committed in the guard (only digests)', !/ep-[a-z0-9-]+\.[a-z0-9.-]*neon\.tech/.test(guardText));
// Real-host checks need the hostname, which is never committed. Run locally with
//   AURA_TEST_STAGING_DB_HOST=<staging direct host> npx ts-node test/dbIdentityGuard.test.ts
const realHost = (process.env.AURA_TEST_STAGING_DB_HOST || '').trim();
if (realHost) {
  const pooledReal = realHost.replace(/^([^.]+)/, '$1-pooler');
  const rURL = (h: string) => url('neondb_owner', STG_PASS, h, 'neondb');
  const rEnv = (o: Record<string, string | undefined> = {}) => realStagingEnv({ AURA_STAGING_EXPECTED_DB_HOST: realHost, AURA_STAGING_EXPECTED_DB_NAME: 'neondb', AURA_STAGING_EXPECTED_DB_USER: 'neondb_owner', DATABASE_URL: rURL(realHost), ...o });
  check('F4. [local] the real staging host hashes to the committed digest', sha(guard.normalizeHost(realHost)) === COMMITTED_STAGING_DIGEST);
  check('F5. [local] committed constants: aura-staging on its direct host is ACCEPTED', guard.evaluate(rEnv()).code === 'STAGING_VERIFIED');
  check('F6. [local] ... with the pooled host for runtime (and as expected host) it is ACCEPTED too', guard.evaluate(rEnv({ AURA_DATABASE_URL: rURL(pooledReal) })).code === 'STAGING_VERIFIED' && guard.evaluate(rEnv({ AURA_STAGING_EXPECTED_DB_HOST: pooledReal, DATABASE_URL: rURL(pooledReal) })).code === 'STAGING_VERIFIED');
  check('F7. [local] committed constants: Production migrating against the real staging host (direct or pooled) is REFUSED', guard.evaluate(prodEnv({ DATABASE_URL: rURL(realHost) })).code === 'PRODUCTION_DB_IS_STAGING' && guard.evaluate(prodEnv({ DATABASE_URL: PROD_URL, AURA_DATABASE_URL: rURL(pooledReal) })).code === 'PRODUCTION_DB_IS_STAGING');
} else {
  console.log('SKIP F4-F7 (set AURA_TEST_STAGING_DB_HOST locally to run the real-host checks; never commit the host)');
}

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
