/// <reference path="./oidc-provider.d.ts" />
import { createHash } from 'crypto';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { createFieldSealer, FieldSealError, type FieldSealer } from './fieldSeal';
import { boundedMs, boundedStatement, singleFlight, withDeadline, type BoundedPool } from '../security/deadline';
import { CONSUMABLE_MODELS, ReplayDetectedError, type OAuthStore, type UserGrantSummary } from './oauthStore';

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
 *   - I2b-S4 (S3-1): a new AuthorizationCode is written PENDING and is
 *     invisible to `find` until the authorization server activates it after
 *     the response that delivers it succeeded (`activateIssued`); a failed
 *     response revokes it (`revokeIssued`). If even that fails, a code whose
 *     activation never committed stays pending and unredeemable until it
 *     expires.
 *   - I2b-S6: `revokeIssued` deletes the code whether pending or active,
 *     because an activation reported as failed may still have committed.
 *     The DELETE waits on the row lock of an in-flight activation, so it is
 *     ordered after a late COMMIT.
 *   - I2b-S8 (S3-1 residual): when the authorization server could not
 *     revoke a code (`holdUnrevoked`), this instance (a) refuses the code in
 *     `find`/`consume` until it expires, and (b) keeps retrying the DELETE
 *     in the background with backoff until it succeeds or the code's TTL
 *     has passed. Other instances learn of it only once a retry lands; the
 *     code never left the server, so redeeming it there needs the 256-bit
 *     code value (see the S8 report).
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
  /** I2b-S8: background revocation retry delays, ms (default 1s, 2s, 4s, 8s, 16s, 30s). Test hook. */
  revocationRetryDelaysMs?: readonly number[];
  /** I2b-S8: how long an unrevoked code is held locally, ms (default 65 s: code TTL 60 s + margin). */
  unrevokedHoldMs?: number;
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
      : { query: <R,>(text: string, params?: unknown[]) => withDeadline(options.db.query<R>(text, params), queryDeadlineMs) };
  let writes = 0;

  /**
   * I2b-S8 (S3-1 residual): storage keys of codes the server decided NOT to
   * deliver but could not revoke, with the local hold deadline. Bounded: an
   * entry lives at most `unrevokedHoldMs`, and the map is capped.
   */
  const unrevoked = new Map<string, number>();
  const UNREVOKED_MAX = 10_000;
  const retryDelays = options.revocationRetryDelaysMs ?? [1000, 2000, 4000, 8000, 16_000, 30_000];
  const holdMs = boundedMs('unrevokedHoldMs', options.unrevokedHoldMs, 65_000, 1000, 600_000);
  const isHeld = (model: string, key: string): boolean => {
    if (!PENDING_ON_WRITE.has(model)) return false;
    const until = unrevoked.get(key);
    if (until === undefined) return false;
    if (until > Date.now()) return true;
    unrevoked.delete(key);
    return false;
  };
  const deleteIssued = (model: string, key: string) => db.query(`DELETE FROM ${TABLE} WHERE "model" = $1 AND "id" = $2`, [model, key]);

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
      // I2b-S8: a code this instance failed to revoke is refused locally.
      if (column === 'id' && isHeld(this.name, key)) return undefined;
      const r = await db.query<{ payload: AdapterPayload; consumedAt: Date | null; id: string }>(
        `SELECT "payload", "consumedAt", "id" FROM ${TABLE}
         WHERE "model" = $1 AND "${column}" = $2 AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1`,
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
      if (isHeld(this.name, key)) throw new ReplayDetectedError();
      const r = await db.query<{ grantId: string | null }>(
        `UPDATE ${TABLE} SET "consumedAt" = now()
         WHERE "model" = $1 AND "id" = $2 AND "consumedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())
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
    async activateIssued(model: string, id: string): Promise<boolean> {
      if (!PENDING_ON_WRITE.has(model)) return false;
      const r = await db.query(
        `UPDATE ${TABLE} SET "payload" = "payload" - '${PENDING_FIELD}'
         WHERE "model" = $1 AND "id" = $2 AND "payload" ? '${PENDING_FIELD}' AND "consumedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
        [model, storageKey(id)],
      );
      return (r.rowCount ?? 0) === 1;
    },
    async revokeIssued(model: string, id: string): Promise<void> {
      if (!PENDING_ON_WRITE.has(model)) return;
      // Pending OR activated: an activation reported as failed may have committed (I2b-S6).
      await deleteIssued(model, storageKey(id));
    },
    holdUnrevoked(model: string, id: string): void {
      if (!PENDING_ON_WRITE.has(model)) return;
      const key = storageKey(id);
      if (unrevoked.size >= UNREVOKED_MAX) {
        // Drop expired holds first; if still full, evict the oldest (it is the closest to its own expiry).
        for (const [k, until] of unrevoked) if (until <= Date.now()) unrevoked.delete(k);
        if (unrevoked.size >= UNREVOKED_MAX) unrevoked.delete(unrevoked.keys().next().value as string);
      }
      const until = Date.now() + holdMs;
      unrevoked.set(key, until);
      let i = 0;
      const retry = () => {
        if (Date.now() >= until) {
          unrevoked.delete(key);
          return;
        }
        deleteIssued(model, key).then(
          () => unrevoked.delete(key),
          () => {
            i += 1;
            if (i < retryDelays.length) schedule();
          },
        );
      };
      const schedule = () => {
        const t = setTimeout(retry, retryDelays[i]);
        (t as { unref?: () => void }).unref?.();
      };
      if (retryDelays.length > 0) schedule();
    },
    pendingRevocations(): number {
      for (const [k, until] of unrevoked) if (until <= Date.now()) unrevoked.delete(k);
      return unrevoked.size;
    },
    async size(model?: string): Promise<number> {
      const r = model
        ? await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE} WHERE "model" = $1 AND ("expiresAt" IS NULL OR "expiresAt" > now())`, [model])
        : await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE} WHERE "expiresAt" IS NULL OR "expiresAt" > now()`);
      return Number(r.rows[0]?.n ?? 0);
    },
  };
}
