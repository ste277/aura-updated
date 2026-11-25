import type { Metadata } from 'next';
import { AccountScoped } from '../../components/AccountScoped';
import { resolveServerAccount } from '../../lib/serverAccount';
import { CapturesClient } from './CapturesClient';

/**
 * Quick Capture V1 PR B -- "Things you want to do". Same standalone-route
 * and session-verification pattern as app/goals/page.tsx: only an
 * `authenticated` boolean is forwarded; the list itself is fetched
 * client-side from GET /api/captures (PR A), never a duplicate endpoint.
 */

export const metadata: Metadata = {
  title: 'Things you want to do — Aura',
  description: 'Capture something you want to do. Aura will help find the time.',
};

export default async function CapturesPage() {
  const serverAccount = await resolveServerAccount();
  const authenticated = serverAccount !== null;
  // AURA-ANDROID-REL-04 (R3/R4): rendered for `serverAccount`; shown only once the client's verification agrees.
  return <AccountScoped onChange="reload" serverAccount={serverAccount}><CapturesClient authenticated={authenticated} /></AccountScoped>;
}
