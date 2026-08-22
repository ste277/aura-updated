import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { AuraMoment, AuraMomentScope, AuraMomentResponseState, getAuraMomentByToken } from './db';

/**
 * Aura Moment Sharing V1 -- domain logic for turning a selected Muhurtham
 * result into a public, snapshot-based, bearer-access share link. See
 * db.ts's AuraMoment model doc comment for the storage side; this file owns
 * everything that decides what a PUBLIC reader is allowed to see.
 */

// ── Public token ────────────────────────────────────────────────────────

/** 192 bits of entropy, base64url-encoded (~32 chars) -- unguessable,
 * opaque, and never encodes any birth/profile/activity data itself (brief
 * section 4: "Do not use Base64-encoded JSON as the token"). Every AuraMoment
 * row has exactly one of these (db.ts enforces UNIQUE), and it is the ONLY
 * public-facing identifier for the moment -- routes never expose the row's
 * internal `id`. */
const MOMENT_TOKEN_BYTES = 24;

export function generatePublicMomentToken(): string {
  return randomBytes(MOMENT_TOKEN_BYTES).toString('base64url');
}

// ── Share URL ────────────────────────────────────────────────────────────

/**
 * Builds the public origin from request headers, not req.nextUrl.origin --
 * behind a tunnel/reverse proxy nextUrl reports the internal address, which
 * would put a dead link in a shared moment. Same reasoning as
 * apps/web/app/api/auth/request-link/route.ts's own inline version; kept
 * here too (not refactored into a shared import that route would also use)
 * so this PR doesn't touch that already-working, security-sensitive auth
 * route.
 */
export function resolvePublicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function buildMomentShareUrl(req: NextRequest, publicToken: string): string {
  return `${resolvePublicOrigin(req)}/moment/${publicToken}`;
}

// ── Explanation snapshot ────────────────────────────────────────────────

/**
 * Section 3's "short pre-generated explanation snapshot" -- always
 * server-templated from `scope`, NEVER accepted as free text from the
 * client (no LLM, no arbitrary public-facing copy injection). Section 17:
 * "keep public copy relationship-neutral" -- none of these mention
 * "partner" specifically, since SavedPerson already spans
 * PARTNER/SPOUSE/FAMILY/FRIEND/OTHER.
 */
const EXPLANATION_BY_SCOPE: Record<AuraMomentScope, string> = {
  GENERAL: 'Aura found this to be a favorable time.',
  PERSONAL: 'Aura found this timing to work well for you.',
  SHARED: 'Aura found this timing to work well for both of you.',
};

export function explanationSnapshotForScope(scope: AuraMomentScope): string {
  return EXPLANATION_BY_SCOPE[scope];
}

// ── Expiry policy (brief section 16) ────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A moment stays ACTIVE until the owner revokes it, or
 * DEFAULT_EXPIRY_AFTER_EVENT_DAYS after its scheduled `endAt`, whichever
 * comes first. No background worker: expiresAt is computed once at create
 * time and every read evaluates `now > expiresAt` itself (isMomentExpired
 * below) -- "prefer a simple policy... expiry can be evaluated on read."
 */
export const DEFAULT_EXPIRY_AFTER_EVENT_DAYS = 7;

export function defaultExpiresAt(endAt: Date): Date {
  return new Date(endAt.getTime() + DEFAULT_EXPIRY_AFTER_EVENT_DAYS * MS_PER_DAY);
}

export function isMomentExpired(moment: Pick<AuraMoment, 'expiresAt'>): boolean {
  return moment.expiresAt !== null && moment.expiresAt.getTime() < Date.now();
}

// ── Public DTO ───────────────────────────────────────────────────────────

/**
 * The ONLY shape a public reader (the /moment/[token] page, or the public
 * response endpoint) is ever allowed to see. Deliberately allow-lists
 * fields one at a time rather than spreading the AuraMoment row, so adding a
 * new column to that table later can never silently leak into a public
 * payload -- see test/auraMoments.test.ts's security tests asserting this
 * DTO never contains birth data, natal fields, ownerUserId, savedPersonId,
 * or the row's internal id/publicToken.
 */
export interface PublicAuraMoment {
  activityTitle: string;
  activityIcon: string | null;
  startAt: string; // ISO
  endAt: string; // ISO
  timezone: string;
  senderDisplayName: string | null;
  sharedPersonDisplayName: string | null;
  scope: AuraMomentScope;
  ratingLabel: string | null;
  explanationSnapshot: string | null;
  responseState: AuraMomentResponseState | null;
}

export function toPublicAuraMoment(moment: AuraMoment): PublicAuraMoment {
  return {
    activityTitle: moment.activityTitle,
    activityIcon: moment.activityIcon,
    startAt: moment.startAt.toISOString(),
    endAt: moment.endAt.toISOString(),
    timezone: moment.timezone,
    senderDisplayName: moment.senderDisplayName,
    sharedPersonDisplayName: moment.sharedPersonDisplayName,
    scope: moment.scope,
    ratingLabel: moment.ratingLabel,
    explanationSnapshot: moment.explanationSnapshot,
    responseState: moment.responseState,
  };
}

export type PublicAuraMomentOutcome =
  | { status: 'OK'; moment: PublicAuraMoment }
  | { status: 'NOT_FOUND' }
  | { status: 'REVOKED' }
  | { status: 'EXPIRED' };

/**
 * The single place that turns "a token" into "what a public reader is
 * allowed to see" -- used by both the public page (/moment/[token]) and the
 * public response endpoint, so they can never disagree about whether a
 * given token is currently viewable/respondable. This is the ENTIRE public
 * read path: token -> stored snapshot -> sanitized DTO -- no Panchang
 * calculation, no Muhurta search, no natal/Tara Bala computation (brief
 * section 23).
 */
export async function resolvePublicAuraMoment(publicToken: string): Promise<PublicAuraMomentOutcome> {
  const moment = await getAuraMomentByToken(publicToken);
  if (!moment) return { status: 'NOT_FOUND' };
  if (moment.status === 'REVOKED') return { status: 'REVOKED' };
  if (isMomentExpired(moment)) return { status: 'EXPIRED' };
  return { status: 'OK', moment: toPublicAuraMoment(moment) };
}
