/// <reference path="./oidc-provider.d.ts" />
import { errors, type Adapter } from 'oidc-provider';

/**
 * AURA-MCP-02-I2b -- storage contract for the Aura authorization server.
 *
 * Two implementations:
 *   - memoryAdapter.ts: per-instance, process-local (local dev and tests);
 *   - postgresAdapter.ts: durable, shared by every instance (F6).
 *
 * Both MUST implement `consume` as an atomic, single-use transition:
 * exactly one caller can move a payload from "unconsumed" to "consumed".
 * `oidc-provider` reads a code / refresh token with `find`, validates it and
 * only then calls `consume`, so two concurrent redemptions can both pass the
 * library's own `consumed` check. The loser of the atomic transition gets
 * {@link ReplayDetectedError} (an `invalid_grant` OAuth error), and the
 * grant behind it is revoked -- the same outcome the library applies when it
 * sees an already-consumed code or refresh token (RFC 9700 s4.14 replay
 * detection).
 */
export interface UserGrantSummary {
  grantId: string;
  clientId: string;
  /** Epoch seconds the grant was created (iat), when known. */
  createdAt?: number;
}

export interface OAuthStore {
  /** Adapter class passed to the provider's `adapter` configuration. */
  factory: new (name: string) => Adapter;
  /**
   * I2b-S4 (S3-1), optional: stores that can fail part-way through a request
   * write new authorization codes as PENDING (not findable, so not
   * redeemable). The authorization server activates a code only once the
   * response that delivers it has succeeded; otherwise it revokes it.
   * `activateIssued` resolves true only if exactly that live, pending row
   * was activated.
   * I2b-S6: `revokeIssued` deletes that code whether pending OR already
   * activated -- an activation whose outcome the server could not confirm
   * (lost COMMIT acknowledgement, timeout) may have committed.
   */
  activateIssued?(model: string, id: string): Promise<boolean>;
  revokeIssued?(model: string, id: string): Promise<void>;
  /**
   * I2b-S8 (S3-1 residual), optional: the server decided NOT to deliver this
   * code but every `revokeIssued` attempt failed. The store refuses the code
   * on this instance until it expires and keeps retrying the revocation in
   * the background. Synchronous and never throws.
   */
  holdUnrevoked?(model: string, id: string): void;
  /** I2b-S8: number of codes currently held by `holdUnrevoked` (monitoring/tests). */
  pendingRevocations?(): number;
  /** Grants a user currently holds (connected assistants). */
  listUserGrants(userId: string): Promise<UserGrantSummary[]>;
  /** Revokes every grant (and its codes and tokens) a user holds for a client. Returns the number of grants revoked. */
  revokeUserClientGrants(userId: string, clientId: string): Promise<number>;
  /** Deletes expired entries (bounded batch). Returns rows removed. */
  cleanupExpired(): Promise<number>;
  /** Live entries per model (diagnostics/tests; may be approximate for durable stores). */
  size(model?: string): Promise<number> | number;
}

/** Thrown by `consume` when another request already consumed the payload. */
export class ReplayDetectedError extends errors.InvalidGrant {
  constructor() {
    super('grant already consumed');
  }
}

/** Models whose payloads are single-use and therefore consumed atomically. */
export const CONSUMABLE_MODELS: ReadonlySet<string> = new Set(['AuthorizationCode', 'RefreshToken', 'DeviceCode', 'BackchannelAuthenticationRequest', 'PushedAuthorizationRequest']);
