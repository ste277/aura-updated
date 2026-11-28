import type { Metadata } from 'next';
import { CapturesScoped } from './CapturesClient';

/**
 * Quick Capture V1 PR B -- "Things you want to do". Same standalone-route
 * and client-verified pattern as app/goals/page.tsx (R5: no session read here); only an
 * `authenticated` boolean is forwarded; the list itself is fetched
 * client-side from GET /api/captures (PR A), never a duplicate endpoint.
 */

export const metadata: Metadata = {
  title: 'Things you want to do — Aura',
  description: 'Capture something you want to do. Aura will help find the time.',
};

export default function CapturesPage() {
  // AURA-ANDROID-REL-04 (R5): no session read here and no account-derived data in this response;
  // the client entry verifies the account first and only then mounts (and fetches) the page.
  return <CapturesScoped />;
}
