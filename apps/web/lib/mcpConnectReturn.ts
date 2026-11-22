/**
 * AURA-MCP-02-I2b -- the only places the OAuth sign-in page may send a user
 * back to after signing in: an authorization-server interaction page on THIS
 * origin. Anything else (absolute URLs, protocol-relative `//host`, encoded
 * slashes, other paths) is refused, so the sign-in page can never become an
 * open redirect.
 */
const INTERACTION_RETURN = /^\/oauth\/interaction\/[A-Za-z0-9_-]{1,128}$/;

export function safeOAuthReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return INTERACTION_RETURN.test(value) ? value : null;
}
