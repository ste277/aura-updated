/// <reference path="./oidc-provider.d.ts" />
import { createHash } from 'crypto';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { createFieldSealer, FieldSealError, type FieldSealer } from './fieldSeal';
import { boundedMs, boundedStatement, budgetedDeadlineMs, heldStatement, singleFlight, StoreUnavailableError, withDeadline, type BoundedPool, type HeldCommitOutcome } from '../security/deadline';
import { CONSUMABLE_MODELS, ReplayDetectedError, type IssuedActivation, type OAuthStore, type UserGrantSummary } from './oauthStore';

/**
 * AURA-MCP-02-I2b (F6) -- durable, shared `oidc-provider` adapter on the
 * existing Aura Postgres database (table "McpOAuthPayload", migration
 * 0052_mcp_oauth_state).
 *
 * Security properties:
 *   - Atomic single use: `consume` is ONE conditional UPDATE
 *     (`... WHERE "consumedAt" IS NULL AND not expired RETURNING`). Postgres
 *     row locking guarantees exactly one concurrent caller sees a row, on any
 *     number of instances. The loser throws ReplayDetectedError (invalid_grant)
 *     and the whole grant is revoked (replay detection).
 *   - No bearer secrets at rest: the primary key is SHA-256(id), and the
 *     payload is stored WITHOUT its `jti`. Opaque access tokens, refresh
 *     tokens, authorization codes and session ids therefore cannot be read
 *     back out of the database; `find` restores `jti` from the value the
 *     caller presented.
 *   - I2b-R1 / I2b-RR1 (I2b-R-1, I2b-RR-1): `oidc-provider` also copies
 *     identifiers INTO other payloads. Before storage:
 *       Interaction `session.cookie` (the session id = `_session` cookie
 *         value) is DROPPED -- the library never reads it back;
 *       Interaction `returnTo` (the resume URL; contains the interaction
 *         uid = the `_interaction` / `_interaction_resume` cookie value),
 *       Session `state.secret` (the xsrf secret of the account-switch form)
 *         and
 *       Session `state.postLogoutRedirectUri` (written by resume.js on the
 *         account-switch path; also the resume URL with the live uid)
 *         are read back by the library, so they are ENCRYPTED with
 *         AES-256-GCM (fieldSeal.ts), bound to their model, row and field.
 *     Fail closed: a sealed field that is present but not a valid seal
 *     (plaintext, non-string, malformed, unknown key, tampered or moved)
 *     makes the record read as NOT FOUND. Interaction `returnTo` is always
 *     written by the library, so a record WITHOUT it also reads as not found
 *     (I2b-RR-2). The Session `state.*` fields are optional (normal sessions
 *     carry no `state`), so their absence is accepted.
 *     Not sealed (deferred, I2b-RRC-2): Interaction `deviceCode` / `parJti`
 *     are unset while device flow and PAR stay disabled; they need a
 *     storage-protection review before either feature is enabled.
 *   - Expiry is enforced on read (expired rows are invisible) and rows are
 *     removed by `cleanupExpired` (bounded batches; opportunistic, see
 *     `cleanupEvery`; I2b-S2: at most one opportunistic cleanup in flight).
 *   - I2b-S2 / S4 (I2b-R-2, S3-2) bounded execution: every query has a
 *     client-side deadline (`queryDeadlineMs`, default 3000, covering pool
 *     checkout and execution). A timeout or ANY database error throws
 *     StoreUnavailableError (security/deadline.ts: 503, generic body), never
 *     "not found" and never a driver message. With a real pool each
 *     statement runs in its own transaction with server-side
 *     `statement_timeout` / `lock_timeout` and is committed only if the
 *     deadline has not answered failure (`boundedStatement`), so a write
 *     reported as failed cannot land later and overwrite newer state (the
 *     only exception is a lost COMMIT acknowledgement).
 *   - I2b-S4 / S10 (S3-1): a new AuthorizationCode is written PENDING and
 *     is invisible to `find` (and refused by `consume`) until it is
 *     ACTIVATED. I2b-S10: activation is a held transaction
 *     (`beginIssuedActivation`): the conditional UPDATE that clears the
 *     pending marker runs BEFORE the response is written (so a code is
 *     never delivered unless its live pending row exists), but it is
 *     COMMITTED only after the authorization server has handed the
 *     complete response to the runtime. Any failure before that point --
 *     error response, disconnect, partial write, process crash or freeze,
 *     database outage -- leaves the transaction uncommitted, and the
 *     server rolls it back (dropped connection or
 *     `idle_in_transaction_session_timeout`): the code stays PENDING on
 *     every instance without any further write. No instance-local memory,
 *     deny list or revocation write is involved. Pending rows expire with
 *     the code TTL and are removed by `cleanupExpired`.
 *     A lookup of a pending-capable model by id uses `FOR SHARE`, so a
 *     redemption that races an in-flight activation waits (bounded by
 *     `lock_timeout`) for its COMMIT or rollback instead of reading a
 *     half-decided row.
 *
 * The adapter takes an injected `query` function (a `pg` Pool satisfies it),
 * so this package does not import a database driver.
 */
export interface PgQueryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface PostgresAdapterOptions {
  db: PgQueryable;
  /**
   * Keys for sealing recoverable identifiers (I2b-R1): the configured OAuth
   * cookie keys (first seals, all open). Required -- the store refuses to
   * start without them.
   */
  fieldKeys: readonly string[];
  /** Run cleanupExpired about once every N writes (default 200; 0 disables). */
  cleanupEvery?: number;
  /** Max rows a single cleanup deletes (default 500). */
  cleanupBatch?: number;
  /** I2b-S2: deadline per query (checkout + execution), ms (default 3000). */
  queryDeadlineMs?: number;
  /** I2b-S4: server-side `SET LOCAL statement_timeout` per statement, ms (default 1500). */
  statementTimeoutMs?: number;
  /** I2b-S4: server-side `SET LOCAL lock_timeout` per statement, ms (default 1000). */
  lockTimeoutMs?: number;
  /**
   * I2b-S10: longest an activation transaction may stay open waiting for the
   * response hand-off, ms (default 2000). Past it the activation is aborted
   * (the code stays pending). Server-side backstop:
   * `idle_in_transaction_session_timeout` = this + 1000.
   */
  activationHoldMs?: number;
  /** I2b-S10: bound for the activation COMMIT round trip after hand-off, ms (default 1500). */
  activationCommitMs?: number;
}

/**
 * I2b-S4 (S3-1): models whose new rows are written PENDING and must be
 * activated by the authorization server once delivered (see OAuthStore).
 */
const PENDING_ON_WRITE: ReadonlySet<string> = new Set(['AuthorizationCode']);
const PENDING_FIELD = 'auraIssuePending';

const TABLE = '"McpOAuthPayload"';

/** Storage key for any provider id (never stored in clear). */
export function storageKey(id: string): string {
  return createHash('sha256').update(`aura-mcp-oauth-v1:${id}`).digest('hex');
}

/**
 * Fields protected per model (I2b-R1, I2b-RR-1).
 *  - Interaction.returnTo: resume URL embedding the interaction uid.
 *  - Session.state.secret: account-switch confirmation (xsrf) secret.
 *  - Session.state.postLogoutRedirectUri: written by oidc-provider
 *    `actions/authorization/resume.js` on the account-switch path; it is the
 *    resume URL and so embeds the live interaction uid.
 */
const SEALED_FIELDS: Record<string, readonly string[]> = {
  Interaction: ['returnTo'],
  Session: ['state.secret', 'state.postLogoutRedirectUri'],
};
/**
 * Sealed fields the library always sets on that model (I2b-RR-2): a stored
 * record without them is corrupt and reads as not found (the existing
 * "request expired, start again" page), never as a half-valid record.
 */
const REQUIRED_SEALED: Record<string, readonly string[]> = { Interaction: ['returnTo'] };
const DROPPED_FIELDS: Record<string, readonly string[]> = { Interaction: ['session.cookie'] };

function getPath(obj: Record<string, unknown>, path: string): { parent: Record<string, unknown>; key: string } | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts.slice(0, -1)) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (!cur || typeof cur !== 'object') return undefined;
  return { parent: cur as Record<string, unknown>, key: parts[parts.length - 1] };
}

/** Returns a deep copy of `payload` with dropped fields removed and sealed fields encrypted. */
export function protectPayload(sealer: FieldSealer, model: string, rowKey: string, payload: AdapterPayload): AdapterPayload {
  const out = structuredClone(payload) as AdapterPayload;
  for (const path of DROPPED_FIELDS[model] ?? []) {
    const at = getPath(out, path);
    if (at) delete at.parent[at.key];
  }
  for (const path of SEALED_FIELDS[model] ?? []) {
    const at = getPath(out, path);
    if (at && typeof at.parent[at.key] === 'string') at.parent[at.key] = sealer.seal(at.parent[at.key] as string, `${model}\0${rowKey}\0${path}`);
  }
  return out;
}

/** Reverses protectPayload; throws FieldSealError for a missing, malformed or tampered seal. */
export function unprotectPayload(sealer: FieldSealer, model: string, rowKey: string, payload: AdapterPayload): AdapterPayload {
  const out = structuredClone(payload) as AdapterPayload;
  for (const path of SEALED_FIELDS[model] ?? []) {
    const at = getPath(out, path);
    if (!at || at.parent[at.key] === undefined) {
      if (REQUIRED_SEALED[model]?.includes(path)) throw new FieldSealError('required protected field missing');
      continue;
    }
    const value = at.parent[at.key];
    if (!sealer.isSealed(value)) throw new FieldSealError('protected field stored without a seal');
    at.parent[at.key] = sealer.open(value, `${model}\0${rowKey}\0${path}`);
  }
  return out;
}

function withConsumed(payload: AdapterPayload, consumedAt: Date | null): AdapterPayload {
  if (consumedAt) payload.consumed = Math.floor(consumedAt.getTime() / 1000);
  return payload;
}

export function createPostgresAdapterStore(options: PostgresAdapterOptions): OAuthStore {
  // Fail closed: no keys, no store.
  const sealer = createFieldSealer(options.fieldKeys);
  const cleanupEvery = options.cleanupEvery ?? 200;
  const cleanupBatch = options.cleanupBatch ?? 500;
  const queryDeadlineMs = boundedMs('queryDeadlineMs', options.queryDeadlineMs, 3000, 50, 60_000);
  const statementTimeoutMs = boundedMs('statementTimeoutMs', options.statementTimeoutMs, 1500, 50, 60_000);
  const lockTimeoutMs = boundedMs('lockTimeoutMs', options.lockTimeoutMs, 1000, 10, 60_000);
  // Every statement is bounded; failures surface only as StoreUnavailableError.
  // I2b-S4 (S3-2): with a real pool, each statement runs in its own short
  // transaction with server-side timeouts and is committed only if the
  // deadline has not already answered failure (boundedStatement). A plain
  // `query`-only db (tests, fakes) keeps the client-side deadline only.
  const raw = options.db as PgQueryable & Partial<BoundedPool>;
  const db: PgQueryable =
    typeof raw.connect === 'function'
      ? { query: <R,>(text: string, params?: unknown[]) => boundedStatement<R>(raw as BoundedPool, text, params, { deadlineMs: queryDeadlineMs, statementTimeoutMs, lockTimeoutMs }) }
      : {
          query: <R,>(text: string, params?: unknown[]) => {
            // I2b-S10: shortened to the request budget; nothing is sent once it is spent.
            const ms = budgetedDeadlineMs(queryDeadlineMs);
            return ms <= 0 ? Promise.reject(new StoreUnavailableError('timeout')) : withDeadline(options.db.query<R>(text, params), ms);
          },
        };
  let writes = 0;

  const activationHoldMs = boundedMs('activationHoldMs', options.activationHoldMs, 2000, 50, 30_000);
  const activationCommitMs = boundedMs('activationCommitMs', options.activationCommitMs, 1500, 50, 30_000);
  const pool = typeof raw.connect === 'function' ? (raw as BoundedPool) : undefined;
  const ACTIVATE_SQL = `UPDATE ${TABLE} SET "payload" = "payload" - '${PENDING_FIELD}'
         WHERE "model" = $1 AND "id" = $2 AND "payload" ? '${PENDING_FIELD}' AND "consumedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())`;

  async function cleanupExpired(): Promise<number> {
    const r = await db.query(
      `DELETE FROM ${TABLE} WHERE ctid IN (SELECT ctid FROM ${TABLE} WHERE "expiresAt" IS NOT NULL AND "expiresAt" < now() LIMIT $1)`,
      [cleanupBatch],
    );
    return r.rowCount ?? 0;
  }

  const backgroundCleanup = singleFlight(cleanupExpired);

  async function revokeGrant(grantId: string): Promise<void> {
    await db.query(`DELETE FROM ${TABLE} WHERE "grantId" = $1`, [grantId]);
  }

  class PostgresAdapter implements Adapter {
    private readonly name: string;
    constructor(name: string) {
      this.name = name;
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
      const key = storageKey(id);
      const stored: AdapterPayload = protectPayload(sealer, this.name, key, payload);
      delete stored.jti;
      delete stored.consumed;
      // I2b-S4 (S3-1): a new code is not redeemable until activated.
      if (PENDING_ON_WRITE.has(this.name)) (stored as Record<string, unknown>)[PENDING_FIELD] = true;
      // The Grant row is part of its own grant (so revokeByGrantId removes it).
      const grantId = this.name === 'Grant' ? id : typeof payload.grantId === 'string' ? payload.grantId : null;
      const accountId = typeof payload.accountId === 'string' ? payload.accountId : null;
      const clientId = typeof payload.clientId === 'string' ? payload.clientId : null;
      const uid = typeof payload.uid === 'string' ? payload.uid : null;
      const userCode = typeof payload.userCode === 'string' ? payload.userCode : null;
      const ttl = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : null;
      await db.query(
        `INSERT INTO ${TABLE} ("model", "id", "payload", "grantId", "accountId", "clientId", "uid", "userCode", "expiresAt")
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, CASE WHEN $9::int IS NULL THEN NULL ELSE now() + make_interval(secs => $9::int) END)
         ON CONFLICT ("model", "id") DO UPDATE SET
           "payload" = EXCLUDED."payload", "grantId" = EXCLUDED."grantId", "accountId" = EXCLUDED."accountId",
           "clientId" = EXCLUDED."clientId", "uid" = EXCLUDED."uid", "userCode" = EXCLUDED."userCode",
           "expiresAt" = EXCLUDED."expiresAt"`,
        [this.name, key, JSON.stringify(stored), grantId, accountId, clientId, uid, userCode, ttl],
      );
      writes += 1;
      if (cleanupEvery > 0 && writes % cleanupEvery === 0) {
        // Opportunistic; never fails the request.
        backgroundCleanup().catch(() => undefined);
      }
    }

    private async findWhere(column: 'id' | 'uid' | 'userCode', value: string): Promise<{ id: string; row: { payload: AdapterPayload; consumedAt: Date | null } } | undefined> {
      const key = column === 'id' ? storageKey(value) : value;
      // I2b-S10: wait for an in-flight activation of this code (row lock) instead of reading it half-decided.
      const lock = column === 'id' && PENDING_ON_WRITE.has(this.name) ? ' FOR SHARE' : '';
      const r = await db.query<{ payload: AdapterPayload; consumedAt: Date | null; id: string }>(
        `SELECT "payload", "consumedAt", "id" FROM ${TABLE}
         WHERE "model" = $1 AND "${column}" = $2 AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1${lock}`,
        [this.name, key],
      );
      const row = r.rows[0];
      // I2b-S4 (S3-1): a pending (not yet delivered) code does not exist for readers.
      if (row && (row.payload as Record<string, unknown>)?.[PENDING_FIELD] === true) return undefined;
      return row ? { id: row.id, row } : undefined;
    }

    /** Opens protected fields; a record that fails to open is treated as missing (fail closed). */
    private open(hit: { id: string; row: { payload: AdapterPayload; consumedAt: Date | null } }): AdapterPayload | undefined {
      try {
        return withConsumed(unprotectPayload(sealer, this.name, hit.id, hit.row.payload), hit.row.consumedAt);
      } catch (err) {
        if (err instanceof FieldSealError) return undefined;
        throw err;
      }
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const hit = await this.findWhere('id', id);
      const payload = hit ? this.open(hit) : undefined;
      return payload ? { ...payload, jti: id } : undefined;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      // Sessions are looked up by uid; the session id (its jti) is the
      // cookie value, which is only known to the caller that presents it.
      const hit = await this.findWhere('uid', uid);
      return hit ? this.open(hit) : undefined;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const hit = await this.findWhere('userCode', userCode);
      return hit ? this.open(hit) : undefined;
    }

    async consume(id: string): Promise<void> {
      const key = storageKey(id);
      // I2b-S10: a pending (never activated) code can never be consumed (DB-enforced, not only via find).
      const notPending = PENDING_ON_WRITE.has(this.name) ? ` AND NOT ("payload" ? '${PENDING_FIELD}')` : '';
      const r = await db.query<{ grantId: string | null }>(
        `UPDATE ${TABLE} SET "consumedAt" = now()
         WHERE "model" = $1 AND "id" = $2 AND "consumedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())${notPending}
         RETURNING "grantId"`,
        [this.name, key],
      );
      if ((r.rowCount ?? 0) === 1) return;
      if (CONSUMABLE_MODELS.has(this.name)) {
        // Lost the race (or already used / expired): revoke the grant behind it.
        const prior = await db.query<{ grantId: string | null }>(`SELECT "grantId" FROM ${TABLE} WHERE "model" = $1 AND "id" = $2`, [this.name, key]);
        const grantId = prior.rows[0]?.grantId;
        if (grantId) await revokeGrant(grantId);
      }
      throw new ReplayDetectedError();
    }

    async destroy(id: string): Promise<void> {
      await db.query(`DELETE FROM ${TABLE} WHERE "model" = $1 AND "id" = $2`, [this.name, storageKey(id)]);
    }

    async revokeByGrantId(grantId: string): Promise<void> {
      await revokeGrant(grantId);
    }
  }

  return {
    factory: PostgresAdapter,
    async listUserGrants(userId: string): Promise<UserGrantSummary[]> {
      const r = await db.query<{ grantId: string; clientId: string; createdAt: Date }>(
        `SELECT "grantId", "clientId", "createdAt" FROM ${TABLE}
         WHERE "model" = 'Grant' AND "accountId" = $1 AND ("expiresAt" IS NULL OR "expiresAt" > now())
         ORDER BY "createdAt"`,
        [userId],
      );
      return r.rows.map((row) => ({ grantId: row.grantId, clientId: row.clientId, createdAt: Math.floor(new Date(row.createdAt).getTime() / 1000) }));
    },
    async revokeUserClientGrants(userId: string, clientId: string): Promise<number> {
      const r = await db.query<{ grantId: string; model: string }>(
        `WITH g AS (SELECT "grantId" FROM ${TABLE} WHERE "model" = 'Grant' AND "accountId" = $1 AND "clientId" = $2)
         DELETE FROM ${TABLE} WHERE "grantId" IN (SELECT "grantId" FROM g) RETURNING "grantId", "model"`,
        [userId, clientId],
      );
      return new Set(r.rows.filter((row) => row.model === 'Grant').map((row) => row.grantId)).size;
    },
    cleanupExpired,
    async beginIssuedActivation(model: string, id: string): Promise<IssuedActivation | null> {
      if (!PENDING_ON_WRITE.has(model)) return null;
      const params = [model, storageKey(id)];
      if (pool) {
        // Held: the UPDATE runs (and locks the row) now; COMMIT only after hand-off.
        const held = await heldStatement(pool, ACTIVATE_SQL, params, {
          deadlineMs: queryDeadlineMs,
          statementTimeoutMs,
          lockTimeoutMs,
          idleInTransactionTimeoutMs: activationHoldMs + 1000,
          holdMs: activationHoldMs,
        });
        if ((held.result.rowCount ?? 0) !== 1) {
          held.abort();
          return null;
        }
        return { commit: () => held.commit(activationCommitMs), abort: () => held.abort() };
      }
      // Query-only db (tests, fakes): no held transaction. Check now, write the
      // single autocommit UPDATE only after hand-off; nothing is written before.
      const live = await db.query(`SELECT 1 FROM ${TABLE} WHERE "model" = $1 AND "id" = $2 AND "payload" ? '${PENDING_FIELD}' AND "consumedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())`, params);
      if ((live.rowCount ?? live.rows.length) !== 1) return null;
      let decided = false;
      return {
        abort: () => {
          decided = true;
        },
        commit: async (): Promise<HeldCommitOutcome> => {
          if (decided) return 'not_committed';
          decided = true;
          try {
            const r = await withDeadline(options.db.query(ACTIVATE_SQL, params), activationCommitMs);
            return (r.rowCount ?? 0) === 1 ? 'committed' : 'not_committed';
          } catch {
            return 'unknown';
          }
        },
      };
    },
    async size(model?: string): Promise<number> {
      const r = model
        ? await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE} WHERE "model" = $1 AND ("expiresAt" IS NULL OR "expiresAt" > now())`, [model])
        : await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE} WHERE "expiresAt" IS NULL OR "expiresAt" > now()`);
      return Number(r.rows[0]?.n ?? 0);
    },
  };
}
