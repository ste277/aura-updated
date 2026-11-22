/// <reference path="./oidc-provider.d.ts" />
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { CONSUMABLE_MODELS, ReplayDetectedError, type OAuthStore, type UserGrantSummary } from './oauthStore';

/**
 * AURA-MCP-02-I2a / I2b -- in-memory `oidc-provider` adapter for the LOCAL
 * authorization server and tests only.
 *
 * Every provider instance gets its own store (no module-level state), so
 * tests are isolated and nothing outlives the process. It is not usable for
 * any deployment: state is lost on restart and is not shared between
 * instances -- deployments use postgresAdapter.ts.
 *
 * Semantics follow the library's adapter contract plus the I2b store
 * contract (oauthStore.ts):
 *   - `consume` is an atomic single-use transition; a second consume of the
 *     same code / refresh token throws ReplayDetectedError and revokes the
 *     grant (F6);
 *   - `revokeByGrantId` removes every token, code and grant of a grant;
 *   - expired entries are invisible to `find*` and removed by `cleanupExpired`.
 */
export type MemoryAdapterStore = OAuthStore & { size(model?: string): number };

interface Entry {
  payload: AdapterPayload;
  expiresAt: number | null;
}

export function createMemoryAdapterStore(now: () => number = Date.now): MemoryAdapterStore {
  const models = new Map<string, Map<string, Entry>>();
  const grants = new Map<string, Set<string>>(); // grantId -> "model\0id"

  const modelStore = (name: string): Map<string, Entry> => {
    let m = models.get(name);
    if (!m) {
      m = new Map();
      models.set(name, m);
    }
    return m;
  };
  const isLive = (entry: Entry | undefined): entry is Entry => !!entry && (entry.expiresAt === null || entry.expiresAt > now());
  const live = (entry: Entry | undefined): AdapterPayload | undefined => (isLive(entry) ? entry.payload : undefined);

  const revokeGrant = (grantId: string): void => {
    const set = grants.get(grantId);
    if (set) {
      for (const key of set) {
        const [model, id] = key.split('\0');
        models.get(model)?.delete(id);
      }
      grants.delete(grantId);
    }
    // The Grant model itself is stored under its own id (the grantId).
    models.get('Grant')?.delete(grantId);
  };

  class MemoryAdapter implements Adapter {
    private readonly name: string;
    constructor(name: string) {
      this.name = name;
    }
    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
      const expiresAt = typeof expiresIn === 'number' && expiresIn > 0 ? now() + expiresIn * 1000 : null;
      modelStore(this.name).set(id, { payload: structuredClone(payload), expiresAt });
      if (typeof payload.grantId === 'string') {
        let set = grants.get(payload.grantId);
        if (!set) {
          set = new Set();
          grants.set(payload.grantId, set);
        }
        set.add(`${this.name}\0${id}`);
      }
    }
    async find(id: string): Promise<AdapterPayload | undefined> {
      const p = live(modelStore(this.name).get(id));
      return p ? structuredClone(p) : undefined;
    }
    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
      for (const entry of modelStore(this.name).values()) {
        const p = live(entry);
        if (p && p.uid === uid) return structuredClone(p);
      }
      return undefined;
    }
    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
      for (const entry of modelStore(this.name).values()) {
        const p = live(entry);
        if (p && p.userCode === userCode) return structuredClone(p);
      }
      return undefined;
    }
    async consume(id: string): Promise<void> {
      // Synchronous check-and-set: no await between the test and the write,
      // so exactly one concurrent caller wins.
      const entry = modelStore(this.name).get(id);
      if (!isLive(entry) || (CONSUMABLE_MODELS.has(this.name) && entry.payload.consumed)) {
        const grantId = entry?.payload.grantId;
        if (typeof grantId === 'string') revokeGrant(grantId);
        throw new ReplayDetectedError();
      }
      entry.payload.consumed = Math.floor(now() / 1000);
    }
    async destroy(id: string): Promise<void> {
      modelStore(this.name).delete(id);
    }
    async revokeByGrantId(grantId: string): Promise<void> {
      revokeGrant(grantId);
    }
  }

  const userGrants = (userId: string): UserGrantSummary[] => {
    const out: UserGrantSummary[] = [];
    for (const [grantId, entry] of models.get('Grant') ?? []) {
      const p = live(entry);
      if (p && p.accountId === userId && typeof p.clientId === 'string') out.push({ grantId, clientId: p.clientId, createdAt: typeof p.iat === 'number' ? p.iat : undefined });
    }
    return out;
  };

  return {
    factory: MemoryAdapter,
    async listUserGrants(userId) {
      return userGrants(userId);
    },
    async revokeUserClientGrants(userId, clientId) {
      const matching = userGrants(userId).filter((g) => g.clientId === clientId);
      for (const g of matching) revokeGrant(g.grantId);
      return matching.length;
    },
    async cleanupExpired() {
      let removed = 0;
      for (const m of models.values()) {
        for (const [id, entry] of m) {
          if (!isLive(entry)) {
            m.delete(id);
            removed += 1;
          }
        }
      }
      for (const [grantId, set] of grants) {
        for (const key of set) {
          const [model, id] = key.split('\0');
          if (!models.get(model)?.has(id)) set.delete(key);
        }
        if (set.size === 0 && !models.get('Grant')?.has(grantId)) grants.delete(grantId);
      }
      return removed;
    },
    size(model?: string) {
      if (model) return [...(models.get(model)?.values() ?? [])].filter((e) => isLive(e)).length;
      let n = 0;
      for (const m of models.values()) n += [...m.values()].filter((e) => isLive(e)).length;
      return n;
    },
  };
}
