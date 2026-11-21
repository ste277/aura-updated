/// <reference path="./oidc-provider.d.ts" />
import type { Adapter, AdapterPayload } from 'oidc-provider';

/**
 * AURA-MCP-02-I2a -- in-memory `oidc-provider` adapter for the LOCAL
 * authorization server and tests only.
 *
 * Every provider instance gets its own store (no module-level state), so
 * tests are isolated and nothing outlives the process. It is not usable for
 * any deployment: state is lost on restart and is not shared between
 * instances. The durable Postgres adapter (D2 section 2.4, `OidcPayload`
 * table) needs a migration and is deferred to a separately approved ticket.
 *
 * Semantics follow the library's adapter contract:
 *   - `consume` marks a payload consumed (single-use authorization codes;
 *     the provider detects and rejects code replay);
 *   - `revokeByGrantId` removes every token, code and grant of a grant;
 *   - expired entries are invisible to `find*`.
 */
export interface MemoryAdapterStore {
  /** Factory passed to the provider's `adapter` configuration. */
  factory: new (name: string) => Adapter;
  /** Number of live entries, per model (diagnostics for tests). */
  size(model?: string): number;
}

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
  const live = (entry: Entry | undefined): AdapterPayload | undefined => {
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) return undefined;
    return entry.payload;
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
      const entry = modelStore(this.name).get(id);
      if (entry) entry.payload.consumed = Math.floor(now() / 1000);
    }
    async destroy(id: string): Promise<void> {
      modelStore(this.name).delete(id);
    }
    async revokeByGrantId(grantId: string): Promise<void> {
      const set = grants.get(grantId);
      if (!set) return;
      for (const key of set) {
        const [model, id] = key.split('\0');
        models.get(model)?.delete(id);
      }
      grants.delete(grantId);
      // The Grant model itself is stored under its own id (the grantId).
      models.get('Grant')?.delete(grantId);
    }
  }

  return {
    factory: MemoryAdapter,
    size(model?: string) {
      if (model) return [...(models.get(model)?.values() ?? [])].filter((e) => live(e)).length;
      let n = 0;
      for (const m of models.values()) n += [...m.values()].filter((e) => live(e)).length;
      return n;
    },
  };
}
