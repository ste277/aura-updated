/**
 * AURA-ANDROID-REL-04 IR-01 (R3) -- the ONE route policy for the shared
 * account boundary, used by middleware.ts (server, edge runtime) and
 * lib/accountBoundFetch.ts (client). Edge-safe: no Node imports.
 *
 * Every /api route is ACCOUNT-SCOPED unless listed below with its reason.
 *
 *  account   A request carrying a session cookie must state the account it
 *            acts for (X-Aura-Expected-Account): missing -> 503
 *            client_upgrade_required; mismatch (incl. "signed out" while a
 *            session exists) -> 409 account_mismatch; a present cookie the
 *            edge cannot verify because the secret is unavailable -> 503
 *            (fail closed). The session cookie stays the only authorization.
 *  optional  A stated account is enforced (409 on mismatch); absence allowed.
 *  exempt    Not account-scoped by this boundary (reason given).
 */
export const EXPECTED_ACCOUNT_HEADER_NAME = 'X-Aura-Expected-Account';
/** Stated by a client that believes NO account is signed in. */
export const SIGNED_OUT_ACCOUNT = '~signed-out';

export type RouteClass = 'account' | 'optional' | 'exempt';

interface Rule { match: (path: string, method: string) => boolean; cls: RouteClass; reason: string }

const prefix = (p: string) => (path: string) => path === p.replace(/\/$/, '') || path.startsWith(p);
const exact = (p: string) => (path: string) => path === p;

export const ROUTE_RULES: Rule[] = [
  { match: prefix('/api/auth/'), cls: 'exempt', reason: 'Sign-in / sign-out protocol. Logout enforces its own account binding in its route; sign-in establishes the account.' },
  { match: prefix('/api/guest/'), cls: 'exempt', reason: 'Guest discovery: no account involved.' },
  { match: exact('/api/health'), cls: 'exempt', reason: 'Liveness probe; no data.' },
  { match: exact('/api/push/public-key'), cls: 'exempt', reason: 'Public VAPID key; no account data.' },
  { match: prefix('/api/internal/'), cls: 'exempt', reason: 'Server-to-server (cron/dispatch) with shared-secret authentication; never a browser request.' },
  { match: exact('/api/mcp'), cls: 'exempt', reason: 'MCP protocol endpoint: its own bearer/OAuth authentication; disabled (404) in production. Status preserved.' },
  { match: prefix('/api/location/'), cls: 'exempt', reason: 'Geocoding search/reverse: requires a session but returns only public place data, never account data.' },
  { match: (p) => /^\/api\/aura-moments\/[^/]+\/response$/.test(p), cls: 'exempt', reason: 'Public Moment recipient link (bearer-link token flow); recipients need no account.' },
  { match: (p, m) => (m === 'GET' || m === 'HEAD') && p === '/api/calendar/feed', cls: 'exempt', reason: 'Opened by link navigation / calendar apps (cannot carry a header); the response is a download for the current cookie holder, never rendered into an account-scoped screen.' },
  { match: (p, m) => (m === 'GET' || m === 'HEAD') && p === '/api/users/export', cls: 'exempt', reason: 'Data-export download by link navigation (cannot carry a header); same as calendar feed.' },
  { match: exact('/api/product-events'), cls: 'optional', reason: 'Telemetry posted by guest and signed-in pages; a stated account is enforced, absence allowed.' },
];

export function classifyApiRoute(pathname: string, method: string): RouteClass {
  if (!pathname.startsWith('/api/') && pathname !== '/api') return 'exempt';
  const m = method.toUpperCase();
  for (const r of ROUTE_RULES) if (r.match(pathname, m)) return r.cls;
  return 'account';
}
