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
 *     address -- a list, a port, garbage or an empty value is "unresolved".
 *       * `x-real-ip`: nginx in deploy/nginx-aura.conf sets it from
 *         `$remote_addr` (already resolved via the real_ip module); the same
 *         header AURA-AUTH-01 trusts for sign-in limits.
 *       * `x-vercel-forwarded-for`: set by the Vercel edge.
 *     Whether the platform edge really overwrites a client-supplied value is
 *     a deployment property that must be verified on staging before header
 *     mode is relied on (I2b-S2 staging condition); this code cannot prove it.
 *   - "none": no trustworthy address (e.g. an App Router handler with no
 *     trusted proxy).
 *
 * `X-Forwarded-For` and `Forwarded` are deliberately NOT accepted: proxies
 * APPEND to them, so their client-supplied prefix is attacker-controlled and
 * picking "the right" hop depends on the proxy chain. Never parse them here.
 *
 * I2b-S2 (I2b-R-3) -- canonical addresses and rate-limit grouping:
 *   - `parseIp` is a strict, dependency-free parser. IPv4 must be a plain
 *     dotted quad (no leading zeros); IPv6 is parsed into 8 hextets and
 *     printed in RFC 5952 form (lower case, no leading zeros, longest zero
 *     run compressed). Zone ids (`%eth0`), brackets, ports, lists, prefixes,
 *     whitespace or control characters inside, and values over 45
 *     characters are rejected.
 *   - Both IPv4-mapped IPv6 spellings (`::ffff:203.0.113.9` and
 *     `::ffff:cb00:7109`) become the IPv4 address, so they share its bucket.
 *   - `rateLimitAddressKey` groups IPv4 by /32 (`v4:a.b.c.d`) and IPv6 by
 *     /64 (`v6:<first 64 bits>::/64`): a /64 is normally one subscriber, so
 *     rotating addresses inside it gains nothing.
 *   - `resolveClientAddressDetailed` reports WHY an address is unusable, so
 *     callers put such requests in one bounded shared bucket
 *     (`UNRESOLVED_ADDRESS_KEY`) with an audit event, instead of silently
 *     dropping to the global ceiling only.
 */
export type ClientAddressSource = { kind: 'socket' } | { kind: 'header'; header: TrustedAddressHeader } | { kind: 'none' };

export const TRUSTED_ADDRESS_HEADERS = ['x-real-ip', 'x-vercel-forwarded-for'] as const;
export type TrustedAddressHeader = (typeof TRUSTED_ADDRESS_HEADERS)[number];

/** Shared pre-auth bucket for requests without a usable trusted address. */
export const UNRESOLVED_ADDRESS_KEY = 'unresolved';
const MAX_ADDRESS_LENGTH = 45;
/** Raw header value bound checked before any parsing (address + up to 19 OWS characters). */
const MAX_RAW_LENGTH = 64;

export interface AddressRequestLike {
  /** Header lookup (Node IncomingHttpHeaders or a Fetch Headers wrapper). */
  header(name: string): string | string[] | null | undefined;
  /** TCP peer, when the runtime exposes it. */
  socketAddress?: string | null;
}

export type ParsedIp = { family: 4; address: string } | { family: 6; address: string; hextets: readonly number[] };

function parseIpv4(v: string): number[] | null {
  const parts = v.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function parseHextets(groups: string[], allowTrailingIpv4: boolean): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    if (allowTrailingIpv4 && i === groups.length - 1 && g.includes('.')) {
      const v4 = parseIpv4(g);
      if (!v4) return null;
      out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function parseIpv6(v: string): number[] | null {
  if (!/^[0-9a-f:.]+$/.test(v)) return null;
  const halves = v.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const all = parseHextets(v.split(':'), true);
    return all && all.length === 8 ? all : null;
  }
  const [left, right] = halves;
  const head = left === '' ? [] : parseHextets(left.split(':'), false);
  const tail = right === '' ? [] : parseHextets(right.split(':'), true);
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** RFC 5952 text form of 8 hextets. */
export function formatIpv6(h: readonly number[]): string {
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (h[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && h[j] === 0) j += 1;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = h.map((x) => x.toString(16));
  if (bestLen < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

/** Strict parse to a canonical address; null for anything that is not exactly one IP address. */
export function parseIp(value: string): ParsedIp | null {
  if (typeof value !== 'string') return null;
  // I2b-S8 (S3-5): bound the input BEFORE any regex. The trim regex is
  // quadratic on a long blank run (64,000 blanks blocked the event loop for
  // 2.5 s); no valid address plus a little surrounding OWS is this long.
  if (value.length > MAX_RAW_LENGTH) return null;
  // Optional surrounding blanks only (HTTP OWS); nothing else is stripped.
  const v = value.replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase();
  if (v.length === 0 || v.length > MAX_ADDRESS_LENGTH) return null;
  if (!v.includes(':')) {
    const v4 = parseIpv4(v);
    return v4 ? { family: 4, address: v4.join('.') } : null;
  }
  const h = parseIpv6(v);
  if (!h) return null;
  // IPv4-mapped (::ffff:0:0/96), whichever way it was written.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return { family: 4, address: [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.') };
  }
  return { family: 6, address: formatIpv6(h), hextets: h };
}

/** Canonical text form, or null. */
export function normalizeIp(value: string): string | null {
  return parseIp(value)?.address ?? null;
}

/**
 * Rate-limit bucket for an address: IPv4 /32 (`v4:203.0.113.9`), IPv6 /64
 * (`v6:2001:db8:1:2::/64`). Unparseable input gets the shared unresolved
 * bucket, never a bucket of its own.
 */
export function rateLimitAddressKey(address: string | null | undefined): string {
  const ip = address ? parseIp(address) : null;
  if (!ip) return UNRESOLVED_ADDRESS_KEY;
  if (ip.family === 4) return `v4:${ip.address}`;
  return `v6:${formatIpv6([...ip.hextets.slice(0, 4), 0, 0, 0, 0])}/64`;
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

export type AddressUnresolvedReason = 'no_source' | 'missing' | 'repeated' | 'list' | 'invalid';
export type ClientAddressResolution = { kind: 'resolved'; address: string } | { kind: 'unresolved'; reason: AddressUnresolvedReason };

/** Resolves the trusted address, or says why there is none (the reason is a fixed code, never the value). */
export function resolveClientAddressDetailed(req: AddressRequestLike, source: ClientAddressSource): ClientAddressResolution {
  if (source.kind === 'none') return { kind: 'unresolved', reason: 'no_source' };
  if (source.kind === 'socket') {
    if (!req.socketAddress) return { kind: 'unresolved', reason: 'missing' };
    const a = normalizeIp(req.socketAddress);
    return a ? { kind: 'resolved', address: a } : { kind: 'unresolved', reason: 'invalid' };
  }
  const raw = req.header(source.header);
  if (raw === null || raw === undefined) return { kind: 'unresolved', reason: 'missing' };
  // A repeated header means something other than our proxy set it.
  if (typeof raw !== 'string') return { kind: 'unresolved', reason: 'repeated' };
  if (raw.includes(',')) return { kind: 'unresolved', reason: 'list' };
  const a = normalizeIp(raw);
  return a ? { kind: 'resolved', address: a } : { kind: 'unresolved', reason: raw.trim() === '' ? 'missing' : 'invalid' };
}

export function resolveClientAddress(req: AddressRequestLike, source: ClientAddressSource): string | null {
  const r = resolveClientAddressDetailed(req, source);
  return r.kind === 'resolved' ? r.address : null;
}

/** Adapters for the two request shapes Aura uses. */
export function nodeAddressRequest(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }): AddressRequestLike {
  return { header: (n) => req.headers[n.toLowerCase()], socketAddress: req.socket?.remoteAddress ?? null };
}
export function fetchAddressRequest(req: { headers: { get(name: string): string | null } }): AddressRequestLike {
  return { header: (n) => req.headers.get(n), socketAddress: null };
}
