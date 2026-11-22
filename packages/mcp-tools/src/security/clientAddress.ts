import { isIP } from 'net';

/**
 * AURA-MCP-02-I2b (R1-L2) -- client address resolution behind trusted proxies.
 *
 * Forwarded headers are client-controlled unless a proxy we operate (or the
 * platform) OVERWRITES them. So the address source is an explicit deployment
 * choice, never inferred from the request:
 *
 *   - "socket": the TCP peer (`req.socket.remoteAddress`). Correct only when
 *     clients connect directly (local dev). Headers are ignored entirely.
 *   - "header": ONE named header that the trusted proxy in front of Aura
 *     sets from the real connection and overwrites on every request
 *     (allowlisted names below). Its value must be exactly one valid IP
 *     address -- a list, a port, garbage or an empty value yields `null`.
 *       * `x-real-ip`: nginx in deploy/nginx-aura.conf sets it from
 *         `$remote_addr` (already resolved via the real_ip module); the same
 *         header AURA-AUTH-01 trusts for sign-in limits.
 *       * `x-vercel-forwarded-for`: set by the Vercel edge.
 *   - "none": no trustworthy address (e.g. an App Router handler with no
 *     trusted proxy). Callers must then fall back to non-address limits.
 *
 * `X-Forwarded-For` and `Forwarded` are deliberately NOT accepted: proxies
 * APPEND to them, so their client-supplied prefix is attacker-controlled and
 * picking "the right" hop depends on the proxy chain. Never parse them here.
 *
 * Returned addresses are normalised (IPv4-mapped IPv6 -> IPv4, lower case),
 * so `::ffff:203.0.113.9` and `203.0.113.9` share one rate-limit bucket.
 */
export type ClientAddressSource = { kind: 'socket' } | { kind: 'header'; header: TrustedAddressHeader } | { kind: 'none' };

export const TRUSTED_ADDRESS_HEADERS = ['x-real-ip', 'x-vercel-forwarded-for'] as const;
export type TrustedAddressHeader = (typeof TRUSTED_ADDRESS_HEADERS)[number];

export interface AddressRequestLike {
  /** Header lookup (Node IncomingHttpHeaders or a Fetch Headers wrapper). */
  header(name: string): string | string[] | null | undefined;
  /** TCP peer, when the runtime exposes it. */
  socketAddress?: string | null;
}

export function normalizeIp(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v || v.length > 64) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  const candidate = mapped ? mapped[1] : v;
  return isIP(candidate) ? candidate : null;
}

/** Parses a source spec such as "socket", "none" or "header:x-real-ip". Unknown specs throw. */
export function parseClientAddressSource(spec: string | undefined): ClientAddressSource {
  const s = (spec ?? '').trim().toLowerCase();
  if (s === 'socket') return { kind: 'socket' };
  if (s === 'none' || s === '') return { kind: 'none' };
  const m = /^header:(.+)$/.exec(s);
  if (m && (TRUSTED_ADDRESS_HEADERS as readonly string[]).includes(m[1])) return { kind: 'header', header: m[1] as TrustedAddressHeader };
  throw new TypeError('unsupported client address source (allowed: socket, none, header:x-real-ip, header:x-vercel-forwarded-for)');
}

export function resolveClientAddress(req: AddressRequestLike, source: ClientAddressSource): string | null {
  if (source.kind === 'none') return null;
  if (source.kind === 'socket') return req.socketAddress ? normalizeIp(req.socketAddress) : null;
  const raw = req.header(source.header);
  // A repeated header means something other than our proxy set it.
  if (typeof raw !== 'string') return null;
  if (raw.includes(',')) return null;
  return normalizeIp(raw);
}

/** Adapters for the two request shapes Aura uses. */
export function nodeAddressRequest(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): AddressRequestLike {
  return { header: (n) => req.headers[n.toLowerCase()], socketAddress: req.socket?.remoteAddress ?? null };
}
export function fetchAddressRequest(req: { headers: { get(name: string): string | null } }): AddressRequestLike {
  return { header: (n) => req.headers.get(n), socketAddress: null };
}
