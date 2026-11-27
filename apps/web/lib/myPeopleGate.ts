/**
 * AURA-MP-1 -- the My People feature switches (design AURA-MP-01, D9 + R2;
 * corrected in R1 / 62007 F2). Not a flag framework: two pure functions.
 *
 * 1. AURA_MY_PEOPLE_ENABLED -- AUTHORITATIVE, server-only.
 *    - Read from the server's runtime environment on every request. It is
 *      NOT a NEXT_PUBLIC_ variable, so Next.js never inlines it into any
 *      bundle.
 *    - Enabled ONLY for the exact value "1". Unset or anything else means
 *      DISABLED, in every environment: production, preview, development and
 *      test.
 *    - Every My People API behaviour is decided by this flag alone.
 *
 * 2. NEXT_PUBLIC_AURA_MY_PEOPLE -- PRESENTATION ONLY, client.
 *    - Next.js inlines a NEXT_PUBLIC_ value into the client bundle when it is
 *      defined at BUILD time, so changing it requires a rebuild.
 *    - It can only HIDE My People UI. It can never enable server behaviour.
 *    - The client shows My People options only when this flag is "1" AND the
 *      server confirms it is enabled: the `x-aura-my-people: enabled`
 *      response header on /api/people. A public flag left on while the
 *      server is disabled therefore degrades to the legacy UI.
 *
 * Vercel: environment variables are fixed per deployment. Changing either
 * flag takes effect only for a NEW deployment (redeploy). Existing
 * deployments keep the values they were built and deployed with.
 *
 * The switch gates NEW capabilities only. Everything existing records depend
 * on is always on (null-safe natal reads, partial PATCH, atomic delete,
 * export), so disabling My People after name-only people exist never breaks
 * a screen, an API or a consumer, and never loses data.
 */
export interface MyPeopleServerEnv {
  AURA_MY_PEOPLE_ENABLED?: string;
}

/** Authoritative server-side switch. Server code only. */
export function isMyPeopleServerEnabled(env: MyPeopleServerEnv = { AURA_MY_PEOPLE_ENABLED: process.env.AURA_MY_PEOPLE_ENABLED }): boolean {
  return env.AURA_MY_PEOPLE_ENABLED === '1';
}

/** The response header through which the server tells the client its state. */
export const MY_PEOPLE_CAPABILITY_HEADER = 'x-aura-my-people';

export function myPeopleCapabilityHeaderValue(serverEnabled: boolean): 'enabled' | 'disabled' {
  return serverEnabled ? 'enabled' : 'disabled';
}

/**
 * Client presentation flag (build-time inlined). The default parameter must
 * reference `process.env.NEXT_PUBLIC_AURA_MY_PEOPLE` literally for Next.js
 * to inline it.
 */
export function isMyPeoplePresentationEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_AURA_MY_PEOPLE
): boolean {
  return value === '1';
}

/** What the client may show: the public flag AND the server's confirmation. */
export function isMyPeopleClientEffective(presentationEnabled: boolean, serverHeader: string | null | undefined): boolean {
  return presentationEnabled && serverHeader === 'enabled';
}
