#!/usr/bin/env node
'use strict';
/**
 * AURA-MCP-02-I1.5-D -- database identity guard for Vercel builds that run
 * migrations (VERCEL_ENV=production). Implements the reviewed staging design
 * (AURA_MCP_02_I1_5_C_ISOLATED_STAGING_DESIGN.md section 3.3) plus the I1.5-D
 * preflight amendment: the runtime pool (apps/web/lib/db.ts) prefers
 * AURA_DATABASE_URL over DATABASE_URL, while `prisma migrate deploy` uses
 * DATABASE_URL only (prisma/schema.prisma), so BOTH must resolve to the same
 * approved staging database.
 *
 * Called by scripts/vercel-build.sh immediately before `prisma migrate deploy`.
 * Exits 0 to allow the migration, 1 to refuse it (the build then fails under
 * `set -e`, and Vercel never promotes the deployment).
 *
 * Policy, fail closed (every missing, unknown or unparsable input refuses):
 *   1. VERCEL_ENV != production       -> nothing to guard (no migration runs).
 *   2. VERCEL_PROJECT_ID missing      -> REFUSED.
 *   0. STAGING_PROJECT_IDS containing the Production ID -> REFUSED.
 *   3. Aura Production project        -> allowed; once STAGING_DB_HOST_SHA256
 *      is pinned, refused if either URL resolves to the staging database.
 *   4. Any other project must be pinned in STAGING_PROJECT_IDS, and then:
 *      - AURA_STAGING_EXPECTED_DB_HOST / _NAME / _USER and
 *        AURA_STAGING_FORBIDDEN_DB_HOSTS must all be set;
 *      - the expected host must be pinned in STAGING_DB_HOST_SHA256;
 *      - DATABASE_URL (migrations) must parse, carry credentials, and match
 *        the expected host, database and role;
 *      - AURA_DATABASE_URL (runtime), when set, must parse, carry credentials
 *        and resolve to the SAME database (host, port, database) as
 *        DATABASE_URL, with the expected role (or
 *        AURA_STAGING_EXPECTED_RUNTIME_DB_USER when that is set);
 *      - neither URL may point at a forbidden host.
 *
 * Identity is never raw string equality. Each URL is parsed with WHATWG URL;
 * the host is lowercased, and Neon's pooled endpoint label
 * (`ep-<id>-pooler.<region>.aws.neon.tech`) is folded onto its direct
 * endpoint (`ep-<id>.<region>.aws.neon.tech`), which names the same compute
 * endpoint and therefore the same database. Only *.neon.tech hosts are
 * folded; any other host must match exactly. Connection-string parameters
 * that can redirect `pg`/libpq to another server or database (host, hostaddr,
 * port, dbname, user, service, options, ...) are rejected outright, via an
 * allowlist of harmless parameters.
 *
 * Output is a single line naming the outcome and a reason code. It never
 * includes a URL, host, user, database name or password.
 */

const crypto = require('crypto');

/** The Aura Production project (`aura-updated`). Not a secret. */
const PRODUCTION_PROJECT_ID = 'prj_iY4xteQOWUNsV85NnbyIylBAba6t';

/**
 * Staging project IDs allowed to migrate under this guard (staging design
 * section 3.4 step 7). Every other non-Production project is refused.
 *   prj_0wR8cnuX0dphdd3ExRGOT0AqcuEa  aura-staging (team aura-56a1), created
 *   2026-11-21, Vercel Authentication on all deployments.
 */
const STAGING_PROJECT_IDS = Object.freeze(['prj_0wR8cnuX0dphdd3ExRGOT0AqcuEa']);

/**
 * SHA-256 of the normalised host of the approved STAGING database endpoint
 * (see normalizeHost: lowercase, Neon `-pooler` label folded), so the staging
 * database identity is pinned in reviewed code, not only in env vars.
 * Compute with:  node apps/web/scripts/check-db-identity.js --hash-host
 * (reads the host on stdin, prints only the digest).
 *
 * While EMPTY: every staging build is refused (STAGING_DB_NOT_PINNED), and
 * Production builds are not inspected (behaviour unchanged).
 * Once pinned: a staging build must target exactly this database, and a
 * Production build whose DATABASE_URL / AURA_DATABASE_URL resolves to it is
 * refused (PRODUCTION_DB_IS_STAGING).
 */
const STAGING_DB_HOST_SHA256 = Object.freeze([]);

/** Connection-string parameters that cannot change which server/database/role is used. */
const ALLOWED_URL_PARAMS = new Set(['sslmode', 'channel_binding', 'connect_timeout', 'application_name', 'pgbouncer', 'connection_limit', 'pool_timeout']);

const NEON_SUFFIX = '.neon.tech';

function refuse(code) {
  return { ok: false, code };
}

function normalizeHost(rawHost) {
  let host = String(rawHost).trim().toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.endsWith(NEON_SUFFIX)) {
    const dot = host.indexOf('.');
    const label = host.slice(0, dot);
    if (label.endsWith('-pooler')) host = `${label.slice(0, -'-pooler'.length)}${host.slice(dot)}`;
  }
  return host;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Parses a Postgres connection URL. Returns { ok, conn } or { ok:false, reason } without ever echoing input. */
function parseConnection(raw) {
  if (typeof raw !== 'string' || raw.trim() === '' || raw !== raw.trim()) return { ok: false, reason: 'MALFORMED' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return { ok: false, reason: 'MALFORMED' };
  if (!url.hostname || url.hostname.includes(',')) return { ok: false, reason: 'MALFORMED' };
  if (url.hash) return { ok: false, reason: 'MALFORMED' };
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_URL_PARAMS.has(key.toLowerCase())) return { ok: false, reason: 'MALFORMED' };
  }
  let database;
  let user;
  let password;
  try {
    const segments = url.pathname.replace(/^\//, '');
    if (!segments || segments.includes('/')) return { ok: false, reason: 'MALFORMED' };
    database = decodeURIComponent(segments);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!database) return { ok: false, reason: 'MALFORMED' };
  if (!user || !password) return { ok: false, reason: 'CREDENTIALS_MISSING' };
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'MALFORMED' };
  return { ok: true, conn: { host: normalizeHost(url.hostname), port, database, user } };
}

/** Comma-separated normalised hostnames and/or SHA-256 hex digests of normalised hostnames. */
function parseForbidden(raw) {
  const entries = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return entries.map((entry) => (/^[0-9a-f]{64}$/i.test(entry) ? { hash: entry.toLowerCase() } : { host: normalizeHost(entry) }));
}

function isForbidden(host, forbidden) {
  const digest = sha256(host);
  return forbidden.some((f) => (f.hash ? f.hash === digest : f.host === host));
}

/** Host of a connection URL, normalised, without the strict staging checks. Null if unparsable. */
function hostOf(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
    return url.hostname ? normalizeHost(url.hostname) : null;
  } catch {
    return null;
  }
}

/**
 * Pure policy evaluation. `options.stagingProjectIds` / `options.stagingDbHostSha256`
 * exist for tests only; builds always use the pinned constants.
 */
function evaluate(env, options = {}) {
  const stagingProjectIds = options.stagingProjectIds || STAGING_PROJECT_IDS;
  const stagingDbHashes = (options.stagingDbHostSha256 || STAGING_DB_HOST_SHA256).map((h) => String(h).toLowerCase());
  if (env.VERCEL_ENV !== 'production') return { ok: true, code: 'NOT_PRODUCTION_BUILD' };

  // The staging allowlist can never contain the Production project.
  if (stagingProjectIds.includes(PRODUCTION_PROJECT_ID)) return refuse('GUARD_MISCONFIGURED');

  const projectId = typeof env.VERCEL_PROJECT_ID === 'string' ? env.VERCEL_PROJECT_ID.trim() : '';
  if (!projectId) return refuse('PROJECT_ID_MISSING');
  if (projectId === PRODUCTION_PROJECT_ID) {
    // Reverse check, active only once the staging database is pinned: the
    // Production project must never migrate (or run) against it. A missing
    // URL is left to Prisma, exactly as before this guard existed.
    if (stagingDbHashes.length > 0) {
      for (const [key, code] of [['DATABASE_URL', 'MIGRATION'], ['AURA_DATABASE_URL', 'RUNTIME']]) {
        const raw = env[key];
        if (raw === undefined || raw === '') continue;
        const host = hostOf(raw);
        if (!host) return refuse(`PRODUCTION_${code}_URL_UNVERIFIABLE`);
        if (stagingDbHashes.includes(sha256(host))) return refuse('PRODUCTION_DB_IS_STAGING');
      }
    }
    return { ok: true, code: 'PRODUCTION_PROJECT' };
  }
  if (!stagingProjectIds.includes(projectId)) return refuse('PROJECT_NOT_ALLOWLISTED');

  const expectedHostRaw = (env.AURA_STAGING_EXPECTED_DB_HOST || '').trim();
  const expectedName = (env.AURA_STAGING_EXPECTED_DB_NAME || '').trim();
  const expectedUser = (env.AURA_STAGING_EXPECTED_DB_USER || '').trim();
  const forbiddenRaw = (env.AURA_STAGING_FORBIDDEN_DB_HOSTS || '').trim();
  if (!expectedHostRaw || !expectedName || !expectedUser || !forbiddenRaw) return refuse('STAGING_IDENTITY_MISSING');
  const forbidden = parseForbidden(forbiddenRaw);
  if (forbidden.length === 0) return refuse('STAGING_IDENTITY_MISSING');
  const expectedHost = normalizeHost(expectedHostRaw);
  if (isForbidden(expectedHost, forbidden)) return refuse('STAGING_IDENTITY_FORBIDDEN');
  // The expected staging database must also be pinned in reviewed code.
  if (!stagingDbHashes.includes(sha256(expectedHost))) return refuse('STAGING_DB_NOT_PINNED');
  const runtimeUserOverride = (env.AURA_STAGING_EXPECTED_RUNTIME_DB_USER || '').trim();
  const allowedRuntimeUsers = new Set([runtimeUserOverride || expectedUser]);

  // Migrations: prisma/schema.prisma reads DATABASE_URL only.
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === '') return refuse('MIGRATION_URL_MISSING');
  const migration = parseConnection(env.DATABASE_URL);
  if (!migration.ok) return refuse(`MIGRATION_URL_${migration.reason}`);
  const m = migration.conn;
  if (isForbidden(m.host, forbidden)) return refuse('MIGRATION_URL_FORBIDDEN_HOST');
  if (m.host !== expectedHost || m.database !== expectedName) return refuse('MIGRATION_DB_MISMATCH');
  if (m.user !== expectedUser) return refuse('MIGRATION_ROLE_MISMATCH');

  // Runtime: lib/db.ts uses `AURA_DATABASE_URL || DATABASE_URL`, so an empty
  // AURA_DATABASE_URL falls back to the (already verified) DATABASE_URL.
  if (env.AURA_DATABASE_URL === undefined || env.AURA_DATABASE_URL === '') return { ok: true, code: 'STAGING_VERIFIED' };
  const runtime = parseConnection(env.AURA_DATABASE_URL);
  if (!runtime.ok) return refuse(`RUNTIME_URL_${runtime.reason}`);
  const r = runtime.conn;
  if (isForbidden(r.host, forbidden)) return refuse('RUNTIME_URL_FORBIDDEN_HOST');
  if (r.host !== m.host || r.port !== m.port || r.database !== m.database) return refuse('RUNTIME_DB_MISMATCH');
  if (!allowedRuntimeUsers.has(r.user)) return refuse('RUNTIME_ROLE_MISMATCH');
  return { ok: true, code: 'STAGING_VERIFIED' };
}

/** `--hash-host`: read one hostname on stdin, print only SHA-256(normalizeHost(host)). */
function hashHostFromStdin() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => (input += chunk));
  process.stdin.on('end', () => {
    const host = input.trim();
    if (!host || /[\s/@:?#]/.test(host)) {
      console.error('[check-db-identity] hash mode: expected one bare DNS name on stdin (no scheme, credentials, port or path)');
      process.exit(1);
    }
    const digest = sha256(normalizeHost(host));
    console.log(digest);
  });
}

function main() {
  if (process.argv[2] === '--hash-host') return hashHostFromStdin();
  let result;
  try {
    result = evaluate(process.env);
  } catch {
    result = refuse('GUARD_ERROR');
  }
  if (result.ok) {
    const label = result.code === 'STAGING_VERIFIED' ? 'DB identity verified (staging)' : `DB identity check passed (${result.code})`;
    console.log(`[vercel-build] ${label}`);
    process.exit(0);
  }
  console.error(`[vercel-build] DB identity REFUSED: ${result.code}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { evaluate, normalizeHost, parseConnection, PRODUCTION_PROJECT_ID, STAGING_PROJECT_IDS, STAGING_DB_HOST_SHA256 };
