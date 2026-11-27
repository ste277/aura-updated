/**
 * AURA-MP-1 -- the My People feature switch (design AURA-MP-01, D9 + R2).
 * Not a flag framework: one pure function over two values, same shape as
 * the other small launch gates in this app.
 *
 *   Production builds (NODE_ENV=production, incl. Vercel Preview):
 *     ON only when NEXT_PUBLIC_AURA_MY_PEOPLE === '1'  -- fail-closed.
 *   Local/dev/test:
 *     ON unless NEXT_PUBLIC_AURA_MY_PEOPLE === '0'.
 *
 * NEXT_PUBLIC_ so the SAME value is read by server routes (at runtime) and
 * client components (inlined at build time). The default parameter must
 * reference `process.env.NEXT_PUBLIC_AURA_MY_PEOPLE` literally for Next.js
 * to inline it into the client bundle.
 *
 * The switch gates NEW capabilities only. Everything existing records depend
 * on is always on (null-safe natal reads, partial PATCH, atomic delete, export),
 * so turning it off after name-only people exist can never break a screen,
 * an API or a consumer, and never loses data.
 */
export interface MyPeopleGateEnv {
  NEXT_PUBLIC_AURA_MY_PEOPLE?: string;
  NODE_ENV?: string;
}

export function isMyPeopleEnabled(
  env: MyPeopleGateEnv = { NEXT_PUBLIC_AURA_MY_PEOPLE: process.env.NEXT_PUBLIC_AURA_MY_PEOPLE, NODE_ENV: process.env.NODE_ENV }
): boolean {
  const value = env.NEXT_PUBLIC_AURA_MY_PEOPLE;
  if (env.NODE_ENV === 'production') return value === '1';
  return value !== '0';
}
