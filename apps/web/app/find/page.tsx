import type { Metadata } from 'next';
import { GuestFindClient } from './GuestFindClient';

/**
 * Recipient Conversion V1 -- the public, unauthenticated guest conversion
 * entry point. Reached from the public Moment page's "Find your own
 * moment" CTA (?src=moment) or directly (?src is absent -> DIRECT). No DB
 * read happens here (unlike /moment/[token]) so this stays a thin Server
 * Component purely for metadata; all interactivity lives in the client
 * component.
 */

export const metadata: Metadata = {
  title: 'Find your moment — Aura',
  description: 'Tell Aura what you are planning and get a good time for it -- no account needed to see the result.',
};

export default function FindPage({ searchParams }: { searchParams: { src?: string; restore?: string } }) {
  const source = searchParams.src === 'moment' ? 'AURA_MOMENT' : 'DIRECT';
  const restoreToken = typeof searchParams.restore === 'string' ? searchParams.restore : null;
  return <GuestFindClient initialSource={source} initialRestoreToken={restoreToken} />;
}
