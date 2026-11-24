/// <reference path="./oidc-provider.d.ts" />
import { errors, type Adapter } from 'oidc-provider';
import type { HeldCommitOutcome } from '../security/deadline';

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

/** I2b-S10: a prepared, uncommitted activation of one authorization code (see OAuthStore). */
export interface IssuedActivation {
  commit(): Promise<HeldCommitOutcome>;
  abort(): void;
}

export interface OAuthStore {
  /** Adapter class passed to the provider's `adapter` configuration. */
  factory: new (name: string) => Adapter;
  /**
   * I2b-S4 / S10 (S3-1), optional: stores that can fail part-way through a
   * request write new authorization codes as PENDING (not findable, not
   * consumable, so not redeemable on any instance).
   *
   * `beginIssuedActivation` prepares the activation of one pending code and
   * resolves null if that live, pending row does not exist (then the code
   * must not be delivered). The authorization server calls it BEFORE writing
   * the response and then exactly one of:
   *   - `commit()` -- only after the complete response carrying the code
   *     has been handed to the runtime ("issued"; receipt by the client is
   *     NOT proven and not claimed). Never throws:
   *       'committed'      the code is now redeemable;
   *       'not_committed'  it stays pending (never redeemable);
   *       'unknown'        COMMIT outcome not confirmed: the code may or may
   *                        not be redeemable -- both are safe, because the
   *                        response had already been handed off;
   *   - `abort()` -- for every other outcome ("abandoned"). Synchronous,
   *     idempotent, never throws, and performs NO write: the activation is
   *     simply never committed, so the code stays pending everywhere even if
   *     the database is unreachable.
   * Stores without this method (the per-process memory store) write codes
   * already active.
   */
  beginIssuedActivation?(model: string, id: string): Promise<IssuedActivation | null>;
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
