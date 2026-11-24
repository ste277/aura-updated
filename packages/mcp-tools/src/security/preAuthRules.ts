import { createHmac, randomInt } from 'crypto';
import { rateLimitAddressKey, UNRESOLVED_ADDRESS_KEY } from './clientAddress';
import type { RateLimitRule } from './rateLimit';

/**
 * AURA-MCP-02-I2b-S2 (I2b-1, I2b-R-3) -- pre-authentication rate-limit rules
 * shared by the authorization server and /api/mcp.
 *
 * Each unauthenticated request is checked (all-or-nothing) against:
 *   - its address bucket, `<ns>:addr:<v4:a.b.c.d | v6:<prefix>::/64 | unresolved>`
 *     with the per-address limit. A request without a usable trusted address
 *     goes to the ONE shared `unresolved` bucket: bounded, never global-only;
 *   - ONE shard of the global ceiling, `<ns>:global:<k>`.
 *
 * Global sharding (I2b-1): one global row serialised every unauthenticated
 * decision on every instance. The ceiling G is split into N rows whose
 * limits SUM TO EXACTLY G (floor(G/N), the first G mod N shards get one
 * more), so the aggregate allowance is never larger than the unsharded
 * ceiling. Each shard is exact under its row lock, so no concurrency
 * pattern can admit more than G per window in total:
 *   admitted(window) = sum_k admitted_k <= sum_k limit_k = G.
 * Fixed windows start per shard; over any interval one window long, each
 * shard admits at most 2 * limit_k, so the total is <= 2G -- the same burst
 * bound as a single fixed-window row.
 *
 * The shard is chosen uniformly at random (crypto), not from the address, so
 * no client can aim its traffic at one shard to starve the users mapped to
 * it. A request can be refused by a full shard while others still have room
 * (slight under-admission near the ceiling; errs toward deny). N defaults to
 * floor(G / 100) clamped to 1..16, so small ceilings stay a single exact row
 * (G = 6000 -> 16 shards of 375).
 */
export const MAX_GLOBAL_SHARDS = 64;
const DEFAULT_MAX_SHARDS = 16;
const MIN_SHARD_LIMIT = 100;

export interface PreAuthLimits {
  perAddress: number;
  global: number;
  /** Number of global shards (default: floor(global / 100), clamped to 1..16). */
  globalShards?: number;
}

export function defaultGlobalShards(global: number): number {
  return Math.max(1, Math.min(DEFAULT_MAX_SHARDS, Math.floor(global / MIN_SHARD_LIMIT)));
}

/** Per-shard limits; their sum is exactly `global`. */
export function globalShardLimits(global: number, shards: number): number[] {
  if (!Number.isInteger(global) || global < 1) throw new TypeError('global must be a positive integer');
  if (!Number.isInteger(shards) || shards < 1 || shards > MAX_GLOBAL_SHARDS || shards > global) throw new TypeError(`globalShards must be an integer in 1..min(${MAX_GLOBAL_SHARDS}, global)`);
  const base = Math.floor(global / shards);
  const extra = global % shards;
  return Array.from({ length: shards }, (_, k) => base + (k < extra ? 1 : 0));
}

export function validatePreAuthLimits(limits: PreAuthLimits): void {
  if (!(Number.isInteger(limits.perAddress) && Number.isInteger(limits.global) && limits.global >= limits.perAddress && limits.perAddress >= 1)) {
    throw new TypeError('preAuthLimits.global must be >= perAddress >= 1 (integers)');
  }
  globalShardLimits(limits.global, limits.globalShards ?? defaultGlobalShards(limits.global));
}

/**
 * I2b-S8 (S3-6): client addresses must not sit in clear in
 * `McpRateLimitWindow.key`. A bucket hasher replaces the address part with a
 * keyed HMAC (truncated to 128 bits), so the table holds no address. Every
 * instance that shares the limiter must use the SAME key, or per-address
 * limits would be counted per instance; the deployment derives it from the
 * configured audit key (see `deriveBucketKey`). The shared `unresolved`
 * bucket is not an address and stays readable.
 */
export type BucketHasher = (bucket: string) => string;

export function createBucketHasher(key: Buffer | string): BucketHasher {
  const k = typeof key === 'string' ? Buffer.from(key, 'utf8') : key;
  if (k.length < 32) throw new TypeError('bucket hash key must be at least 32 bytes');
  return (bucket) => (bucket === UNRESOLVED_ADDRESS_KEY ? bucket : `h:${createHmac('sha256', k).update(`aura-mcp-preauth-bucket-v1\0${bucket}`).digest('hex').slice(0, 32)}`);
}

/** Bucket key derived from a configured secret (label-separated, so it is independent of the secret's other uses). */
export function deriveBucketKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('aura-mcp-preauth-bucket-key-v1').digest();
}

export function buildPreAuthRules(
  namespace: 'preauth-as' | 'preauth-mcp',
  clientAddress: string | null | undefined,
  limits: PreAuthLimits,
  pickShard: (shards: number) => number = (n) => randomInt(n),
  hashBucket?: BucketHasher,
): RateLimitRule[] {
  validatePreAuthLimits(limits);
  const shards = limits.globalShards ?? defaultGlobalShards(limits.global);
  const shardLimits = globalShardLimits(limits.global, shards);
  const k = pickShard(shardLimits.length);
  if (!Number.isInteger(k) || k < 0 || k >= shardLimits.length) throw new TypeError('shard index out of range');
  const bucket = rateLimitAddressKey(clientAddress);
  return [
    // I2b-S8 (S3-7): the shard key names the ceiling and shard count it was
    // sized for, so instances configured differently never share a row with
    // different per-row limits (which could let one row exceed its share).
    // While a change of G or N rolls out, the two configurations count in
    // separate rows: the aggregate is bounded by G_old + G_new for as long
    // as both serve traffic. Change limits with a full restart to keep G.
    { key: `${namespace}:global:g${limits.global}n${shards}:${k}`, limit: shardLimits[k] },
    { key: `${namespace}:addr:${hashBucket ? hashBucket(bucket) : bucket}`, limit: limits.perAddress },
  ];
}
