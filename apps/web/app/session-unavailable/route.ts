import { NextRequest } from 'next/server';
import { safeReturnPath } from '../../lib/sessionPage';
import { SESSION_UNAVAILABLE_MESSAGE } from '../../lib/sessionErrors';

/**
 * AURA-AUTH-SESSION-01-I2-R1 (39246-03) -- where an E2 server page sends a
 * request whose session could not be verified (lib/sessionPage.ts). HTTP 503
 * with Retry-After, no session work, no cookie change, and a "Try again" link
 * to the original same-origin path. Never a sign-in prompt: the user may
 * well be signed in. Public by design (it reads no session).
 */
export const dynamic = 'force-dynamic';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function GET(req: NextRequest): Response {
  const returnTo = safeReturnPath(req.nextUrl.searchParams.get('returnTo'));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporarily unavailable — Aura</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}a{display:inline-block;margin-top:1rem}</style></head>
<body><h1>Aura is temporarily unavailable</h1><p>${escapeHtml(SESSION_UNAVAILABLE_MESSAGE)} You are still signed in. Nothing was changed.</p><a href="${escapeHtml(returnTo)}">Try again</a></body></html>`;
  return new Response(html, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '2', 'cache-control': 'no-store' } });
}
