import type { AuraOAuthClient } from './authorizationServer';

/**
 * AURA-MCP-02-I2b -- client registration and authorization policy.
 *
 * Aura registers OAuth clients STATICALLY (configuration reviewed by a
 * person). Dynamic Client Registration and Client ID Metadata Documents stay
 * disabled -- enabling either is an owner decision (it lets any party mint a
 * client and put its own name on the consent screen).
 *
 * Every client is public (PKCE S256, token_endpoint_auth_method "none") and
 * is validated here before the provider sees it:
 *   - client_id: identifier-shaped, unique;
 *   - label: what the consent screen shows; plain text, 1-60 characters;
 *   - redirect_uris: exact strings (no wildcards), each either
 *       https://host/path  (no userinfo, no fragment), or
 *       http://127.0.0.1:PORT/path, http://[::1]:PORT/path or
 *       http://localhost:PORT/path (RFC 8252 native-app loopback);
 *   - allow_refresh: whether the client may hold refresh tokens.
 * At most 20 clients.
 */
export const MAX_CLIENTS = 20;
const CLIENT_ID = /^[A-Za-z0-9._:-]{3,64}$/;
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);

export function validateRedirectUri(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return 'redirect_uri must be a string of at most 512 characters';
  if (/[*\s]/.test(value)) return 'redirect_uri must not contain wildcards or whitespace';
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return 'redirect_uri is not an absolute URL';
  }
  if (u.username || u.password) return 'redirect_uri must not contain credentials';
  if (u.hash || value.includes('#')) return 'redirect_uri must not contain a fragment';
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname) && u.port) return null;
  return 'redirect_uri must be https, or http on a loopback host with an explicit port';
}

export function validateClientRegistry(input: unknown): { clients: AuraOAuthClient[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(input) || input.length === 0) return { clients: [], errors: ['at least one client is required'] };
  if (input.length > MAX_CLIENTS) errors.push(`at most ${MAX_CLIENTS} clients`);
  const seen = new Set<string>();
  const clients: AuraOAuthClient[] = [];
  for (const [i, raw] of input.entries()) {
    const c = raw as Partial<AuraOAuthClient> & Record<string, unknown>;
    const where = `client ${i}`;
    if (!c || typeof c !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (typeof c.client_id !== 'string' || !CLIENT_ID.test(c.client_id)) errors.push(`${where}: client_id must match ${CLIENT_ID}`);
    else if (seen.has(c.client_id)) errors.push(`${where}: duplicate client_id`);
    else seen.add(c.client_id);
    if (typeof c.label !== 'string' || c.label.trim().length === 0 || c.label.length > 60 || /[<>]/.test(c.label)) errors.push(`${where}: label must be 1-60 characters of plain text`);
    if (!Array.isArray(c.redirect_uris) || c.redirect_uris.length === 0 || c.redirect_uris.length > 10) errors.push(`${where}: 1-10 redirect_uris required`);
    else for (const r of c.redirect_uris) {
      const e = validateRedirectUri(r);
      if (e) errors.push(`${where}: ${e}`);
    }
    if (c.allow_refresh !== undefined && typeof c.allow_refresh !== 'boolean') errors.push(`${where}: allow_refresh must be boolean`);
    const extra = Object.keys(c).filter((k) => !['client_id', 'label', 'redirect_uris', 'allow_refresh'].includes(k));
    if (extra.length) errors.push(`${where}: unsupported fields ${extra.join(', ')}`);
    clients.push({ client_id: String(c.client_id), label: String(c.label), redirect_uris: [...(c.redirect_uris ?? [])].map(String), allow_refresh: c.allow_refresh === true });
  }
  return { clients: errors.length ? [] : clients, errors };
}

/** Parses AURA_MCP_OAUTH_CLIENTS (JSON array). */
export function parseClientRegistry(raw: string | undefined): { clients: AuraOAuthClient[]; errors: string[] } {
  if (!raw) return { clients: [], errors: ['AURA_MCP_OAUTH_CLIENTS is required'] };
  try {
    return validateClientRegistry(JSON.parse(raw));
  } catch {
    return { clients: [], errors: ['AURA_MCP_OAUTH_CLIENTS is not valid JSON'] };
  }
}
