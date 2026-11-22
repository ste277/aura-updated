/// <reference path="./oidc-provider.d.ts" />
import { createHash } from 'crypto';
import type { Adapter, AdapterPayload } from 'oidc-provider';
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
 *   - Expiry is enforced on read (expired rows are invisible) and rows are
 *     removed by `cleanupExpired` (bounded batches; opportunistic, see
 *     `cleanupEvery`).
 *
 * The adapter takes an injected `query` function (a `pg` Pool satisfies it),
 * so this package does not import a database driver.
 */
export interface PgQueryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface PostgresAdapterOptions {
  db: PgQueryable;
  /** Run cleanupExpired about once every N writes (default 200; 0 disables). */
  cleanupEvery?: number;
  /** Max rows a single cleanup deletes (default 500). */
  cleanupBatch?: number;
}

const TABLE = '"McpOAuthPayload"';

/** Storage key for any provider id (never stored in clear). */
export function storageKey(id: string): string {
  return createHash('sha256').update(`aura-mcp-oauth-v1:${id}`).digest('hex');
}

function toPayload(row: { payload: AdapterPayload; consumedAt: Date | null }, id: string): AdapterPayload {
  const payload: AdapterPayload = { ...row.payload, jti: id };
  if (row.consumedAt) payload.consumed = Math.floor(row.consumedAt.getTime() / 1000);
  return payload;
}

export function createPostgresAdapterStore(options: PostgresAdapterOptions): OAuthStore {
  const { db } = options;
  const cleanupEvery = options.cleanupEvery ?? 200;
  const cleanupBatch = options.cleanupBatch ?? 500;
  let writes = 0;

  async function cleanupExpired(): Promise<number> {
    const r = await db.query(
      `DELETE FROM ${TABLE} WHERE ctid IN (SELECT ctid FROM ${TABLE} WHERE "expiresAt" IS NOT NULL AND "expiresAt" < now() LIMIT $1)`,
      [cleanupBatch],
    );
    return r.rowCount ?? 0;
  }

  async function revokeGrant(grantId: string): Promise<void> {
    await db.query(`DELETE FROM ${TABLE} WHERE "grantId" = $1`, [grantId]);
  }

  class PostgresAdapter implements Adapter {
    private readonly name: string;
    constructor(name: string) {
      this.name = name;
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
      const stored: AdapterPayload = { ...payload };
      delete stored.jti;
      delete stored.consumed;
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
        [this.name, storageKey(id), JSON.stringify(stored), grantId, accountId, clientId, uid, userCode, ttl],
      );
      writes += 1;
      if (cleanupEvery > 0 && writes % cleanupEvery === 0) {
        // Opportunistic; never fails the request.
        cleanupExpired().catch(() => undefined);
      }
    }

    private async findWhere(column: 'id' | 'uid' | 'userCode', value: string): Promise<{ id: string; row: { payload: AdapterPayload; consumedAt: Date | null } } | undefined> {
      const key = column === 'id' ? storageKey(value) : value;
      const r = await db.query<{ payload: AdapterPayload; consumedAt: Date | null; id: string }>(
        `SELECT "payload", "consumedAt", "id" FROM ${TABLE}
         WHERE "model" = $1 AND "${column}" = $2 AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1`,
        [this.name, key],
      );
      const row = r.rows[0];
      return row ? { id: row.id, row } : undefined;
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
      const hit = await this.findWhere('id', id);
      return hit ? toPayload(hit.row, id) : undefined;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      // Sessions are looked up by uid; the session id (its jti) is the
      // cookie value, which is only known to the caller that presents it.
      const hit = await this.findWhere('uid', uid);
      if (!hit) return undefined;
      const payload = { ...hit.row.payload };
      if (hit.row.consumedAt) payload.consumed = Math.floor(hit.row.consumedAt.getTime() / 1000);
      return payload;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      const hit = await this.findWhere('userCode', userCode);
      return hit ? { ...hit.row.payload } : undefined;
    }

    async consume(id: string): Promise<void> {
      const key = storageKey(id);
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
    async size(model?: string): Promise<number> {
      const r = model
        ? await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE} WHERE "model" = $1 AND ("expiresAt" IS NULL OR "expiresAt" > now())`, [model])
        : await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE} WHERE "expiresAt" IS NULL OR "expiresAt" > now()`);
      return Number(r.rows[0]?.n ?? 0);
    },
  };
}
