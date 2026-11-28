/// <reference path="./oidc-provider.d.ts" />
import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { OAuthStore } from './oauthStore';

/**
 * AURA-AUTH-SESSION-01-I2-R2 (39250, Rev 4 B3) -- session-bound consent
 * finalization for MCP grants.
 *
 * A Grant in the OAuth store is necessary but NOT sufficient: it is usable
 * only while the Aura database holds a finalization for that exact grant,
 * account and client whose authorization covers every item the grant now
 * carries. The finalization is written by one Aura-database statement that
 * is conditional on the approving Aura session being live (FOR SHARE), so it
 * is ordered against logout inside one database (the linearization point).
 *
 * Every enabled path that issues or uses an authorization loads the grant
 * through `provider.Grant.find` (oidc-provider 9.13.3: consent resume via
 * loadExistingGrant, code redemption and refresh via validateGrant, and the
 * MCP resource check in verifyAccessToken), which reads this store's Grant
 * model -- so the check lives there, once.
 *
 * The package never touches the Aura database: the host injects the hooks.
 * Hooks THROW (e.g. StoreUnavailableError) when the Aura database cannot
 * answer: an outage fails closed as 503, never as "no grant", and nothing is
 * revoked.
 */
export interface ConsentFinalizationHooks {
  /**
   * Finalizes a freshly saved grant against the approving Aura session of
   * `req`. 'finalized' only on a CONFIRMED commit; 'refused' when the session
   * is no longer live (revoked, expired, mismatched) or the grant was already
   * finalized. Throws when unavailable or when the commit is ambiguous.
   */
  finalize(input: { req: unknown; grantId: string; accountId: string; clientId: string; authorization: readonly string[]; grantLifetimeSeconds: number }): Promise<'finalized' | 'refused'>;
  /** True only for a live finalization of this grant/account/client covering `authorization`. Throws when unavailable. */
  isFinalized(input: { grantId: string; accountId: string; clientId: string; authorization: readonly string[] }): Promise<boolean>;
}

/**
 * The canonical authorization items a Grant payload carries: every OIDC
 * scope, OIDC claim and resource scope. null = something this check cannot
 * bind (rich authorization details, malformed fields): never covered.
 */
export function grantAuthorizationItems(payload: { openid?: unknown; resources?: unknown; rar?: unknown } | null | undefined): string[] | null {
  if (!payload) return null;
  if (payload.rar !== undefined && payload.rar !== null && !(Array.isArray(payload.rar) && payload.rar.length === 0)) return null;
  const items = new Set<string>();
  const words = (v: unknown) => (typeof v === 'string' ? v.split(' ').filter(Boolean) : null);
  if (payload.openid !== undefined && payload.openid !== null) {
    if (typeof payload.openid !== 'object') return null;
    const { scope, claims } = payload.openid as { scope?: unknown; claims?: unknown };
    if (scope !== undefined) {
      const s = words(scope);
      if (!s) return null;
      for (const x of s) items.add(`oidc:${x}`);
    }
    if (claims !== undefined) {
      if (!Array.isArray(claims) || claims.some((c) => typeof c !== 'string')) return null;
      for (const c of claims as string[]) items.add(`claim:${c}`);
    }
  }
  if (payload.resources !== undefined && payload.resources !== null) {
    if (typeof payload.resources !== 'object') return null;
    for (const [resource, value] of Object.entries(payload.resources as Record<string, unknown>)) {
      const s = words(value);
      if (!s) return null;
      for (const x of s) items.add(`res:${resource} ${x}`);
    }
  }
  return [...items].sort();
}

/** Every item of `current` is in `finalized` (no expansion). */
export function authorizationCovered(current: readonly string[], finalized: readonly string[]): boolean {
  const allowed = new Set(finalized);
  return current.every((x) => allowed.has(x));
}

/**
 * Wraps a store so that its Grant model only returns finalized grants.
 * Everything else (writes, other models, listing, revocation) is delegated.
 */
export function withConsentFinalization(store: OAuthStore, hooks: ConsentFinalizationHooks): OAuthStore {
  const Inner = store.factory;
  class FinalizedGrantAdapter implements Adapter {
    private readonly inner: Adapter;
    constructor(private readonly name: string) {
      this.inner = new Inner(name);
    }
    upsert(id: string, payload: AdapterPayload, expiresIn: number) {
      return this.inner.upsert(id, payload, expiresIn);
    }
    async find(id: string): Promise<AdapterPayload | undefined> {
      const found = await this.inner.find(id);
      if (this.name !== 'Grant' || !found) return found;
      const p = found as unknown as { accountId?: unknown; clientId?: unknown; openid?: unknown; resources?: unknown; rar?: unknown };
      const authorization = grantAuthorizationItems(p);
      if (!authorization || typeof p.accountId !== 'string' || typeof p.clientId !== 'string') return undefined;
      return (await hooks.isFinalized({ grantId: id, accountId: p.accountId, clientId: p.clientId, authorization })) ? found : undefined;
    }
    findByUid(uid: string) {
      return this.inner.findByUid(uid);
    }
    findByUserCode(userCode: string) {
      return this.inner.findByUserCode(userCode);
    }
    consume(id: string) {
      return this.inner.consume(id);
    }
    destroy(id: string) {
      return this.inner.destroy(id);
    }
    revokeByGrantId(grantId: string) {
      return this.inner.revokeByGrantId(grantId);
    }
  }
  const wrapped: OAuthStore = {
    factory: FinalizedGrantAdapter,
    listUserGrants: (userId) => store.listUserGrants(userId),
    revokeUserClientGrants: (userId, clientId) => store.revokeUserClientGrants(userId, clientId),
    cleanupExpired: () => store.cleanupExpired(),
    size: (model) => store.size(model),
  };
  if (store.beginIssuedActivation) wrapped.beginIssuedActivation = (model, id) => store.beginIssuedActivation!(model, id);
  return wrapped;
}
